const express = require('express');
const QRCode = require('qrcode');
const { db } = require('../db/database');
const config = require('../lib/config');
const payments = require('../lib/payments');
const { requireAuth, requireRole } = require('../middleware/auth');
const { payLimiter, statusLimiter, webhookLimiter } = require('../middleware/security');

const router = express.Router();

// A buyer can only ever see their own orders. Someone else's order looks exactly like a missing one.
function ownedOrder(req, res, asJson){
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(req.params.id, req.session.user.id);
  if(!order){
    if(asJson) res.status(404).json({ error: 'not found' });
    else res.status(404).render('error', { title: 'Not found', message: 'That order does not exist.' });
    return null;
  }
  return order;
}

const iso = (sql) => (sql ? sql.replace(' ', 'T') + 'Z' : null);

// The payment page: shows the QRIS code for an order.
router.get('/orders/:id/pay', requireAuth, requireRole('buyer'), payLimiter, async (req, res) => {
  payments.expireStalePayments();
  const order = ownedOrder(req, res);
  if(!order) return;

  if(order.payment_status === 'paid') return res.redirect('/orders/' + order.id);

  const view = (state, extra) => res.render('payments/qris', Object.assign({
    title: 'Pay with QRIS', order, state, payment: null, qrSvg: null,
    sandbox: config.providerName() === 'mock', expiresAt: null
  }, extra));

  if(order.status !== 'pending' || order.payment_status !== 'unpaid'){
    return view('closed');                               // cancelled, expired, or otherwise not payable
  }

  let payment;
  try {
    payment = await payments.startQrisPayment(order);
  } catch(err){
    if(err instanceof payments.PaymentExpiredError) return view('expired');
    console.error('[payments] could not create QRIS payment:', err.message);
    res.status(502);
    return view('error');
  }

  const qrSvg = await QRCode.toString(payment.qr_string, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  view('active', { payment, qrSvg, expiresAt: iso(payment.expires_at) });
});

// The payment page asks this every few seconds: "has it been paid yet?"
router.get('/orders/:id/payment-status', requireAuth, requireRole('buyer'), statusLimiter, async (req, res) => {
  payments.expireStalePayments();
  let order = ownedOrder(req, res, true);
  if(!order) return;

  let latest = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order.id);
  if(latest && latest.status === 'pending'){
    try { await payments.reconcile(latest); } catch(err){ console.warn('[payments] status check failed:', err.message); }
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    latest = db.prepare('SELECT * FROM payments WHERE id = ?').get(latest.id);
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    orderStatus: order.status,
    paymentStatus: order.payment_status,
    attemptStatus: latest ? latest.status : null,
    expiresAt: latest ? iso(latest.expires_at) : null
  });
});

// The gateway calls this when a payment changes. No login: it is trusted only if the signature is valid.
router.post('/payments/webhook', webhookLimiter, async (req, res) => {
  const result = await payments.processNotification(req.body);
  res.status(result.status).json(result.body);
});

// SANDBOX ONLY: pretend the gateway reported a payment, using the same signed path as the real webhook.
router.post('/dev/simulate-payment/:id', requireAuth, requireRole('buyer'), async (req, res) => {
  if(config.isProd() || config.providerName() !== 'mock'){
    return res.status(404).render('error', { title: 'Not found', message: "That page doesn't exist." });
  }
  const order = ownedOrder(req, res);
  if(!order) return;

  const outcome = ['paid', 'expired', 'failed'].includes(req.body.outcome) ? req.body.outcome : 'paid';
  const payment = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(order.id);
  if(payment){
    const mock = require('../lib/payments/mock');
    await payments.processNotification(mock.buildNotification(payment, outcome));
  }
  res.redirect('/orders/' + order.id + '/pay');
});

module.exports = router;
