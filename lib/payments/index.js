const crypto = require('crypto');
const { db } = require('../../db/database');
const config = require('../config');
const { cancelOrder } = require('../orders');

function getProvider(){
  const name = config.providerName();
  if(name === 'midtrans') return require('./midtrans');
  if(name === 'mock') return require('./mock');
  throw new Error(`Unknown PAYMENT_PROVIDER "${name}"`);
}

const sqlTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const asDate = (sql) => new Date(sql.replace(' ', 'T') + 'Z');
const isLive = (payment) => asDate(payment.expires_at).getTime() > Date.now();

class PaymentExpiredError extends Error {}

// ---------------------------------------------------------------------------
// Creating a QR code
// ---------------------------------------------------------------------------
const inFlight = new Map();   // order id -> promise, so a double click can't create two QR codes

async function startQrisPayment(order){
  if(inFlight.has(order.id)) return inFlight.get(order.id);

  const job = (async () => {
    const pending = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(order.id);
    if(pending){
      if(isLive(pending)) return pending;
      throw new PaymentExpiredError('The QR code for this order has expired.');
    }

    const provider = getProvider();
    const expiryMinutes = config.expiryMinutes();
    // The amount ALWAYS comes from our own database, never from the browser.
    const amount = order.total;
    const gatewayOrderId = `KDG-${order.id}-${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = sqlTime(new Date(Date.now() + expiryMinutes * 60000));

    const result = await provider.createQris({ gatewayOrderId, amount, expiryMinutes });

    const info = db.prepare(`
      INSERT INTO payments (order_id, provider, provider_ref, gateway_order_id, amount, qr_string, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(order.id, provider.name, result.providerRef || null, gatewayOrderId, amount, result.qrString, expiresAt);
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid);
  })().finally(() => inFlight.delete(order.id));

  inFlight.set(order.id, job);
  return job;
}

// ---------------------------------------------------------------------------
// Changing a payment's status. This is the ONLY place a payment becomes "paid".
// ---------------------------------------------------------------------------
const applyStatus = db.transaction((paymentId, status, providerRef) => {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if(!payment) return 'missing';

  if(payment.status === 'paid') return 'already-paid';          // idempotent: a paid payment never changes again
  if(status === 'pending') return 'ignored';
  if(payment.status !== 'pending' && status !== 'paid') return 'ignored';

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(payment.order_id);

  if(status === 'paid'){
    db.prepare(`UPDATE payments SET status = 'paid', paid_at = datetime('now'),
                provider_ref = COALESCE(?, provider_ref), updated_at = datetime('now') WHERE id = ?`)
      .run(providerRef || null, payment.id);

    if(order.status === 'cancelled'){
      // Money arrived for an order we already cancelled. Never lose track of it: flag it for a refund.
      db.prepare("UPDATE orders SET payment_status = 'refund_needed', updated_at = datetime('now') WHERE id = ?").run(order.id);
      console.warn(`[payments] REFUND NEEDED: order ${order.id} was paid after it was cancelled (payment ${payment.gateway_order_id}).`);
      return 'paid-after-cancel';
    }
    db.prepare("UPDATE orders SET payment_status = 'paid', updated_at = datetime('now') WHERE id = ?").run(order.id);
    return 'paid';
  }

  // expired or failed
  db.prepare("UPDATE payments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, payment.id);
  if(status === 'expired' && order.status === 'pending' && order.payment_status === 'unpaid'){
    cancelOrder(order.id);                                      // releases the stock too
    db.prepare("UPDATE orders SET payment_status = 'expired' WHERE id = ?").run(order.id);
  }
  return status;
});

// Cancel an order's live QR codes (buyer cancelled the order).
async function cancelPendingPayments(orderId){
  const pending = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'pending'").all(orderId);
  db.prepare("UPDATE payments SET status = 'cancelled', updated_at = datetime('now') WHERE order_id = ? AND status = 'pending'").run(orderId);
  const provider = getProvider();
  for(const p of pending){ if(p.provider === provider.name) await provider.cancel(p.gateway_order_id); }
}

// ---------------------------------------------------------------------------
// Notifications from the gateway (the webhook)
// ---------------------------------------------------------------------------
async function processNotification(body){
  const provider = getProvider();
  const reject = (status, reason, id) => {
    console.warn(`[payments] webhook rejected (${reason})` + (id ? ` order_id=${String(id).slice(0, 60)}` : ''));
    return { status, body: { ok: false, error: reason } };
  };

  // 1. Is this really from the gateway? (secret-key signature)
  if(!provider.verifyNotification(body)) return reject(401, 'invalid signature');

  const n = provider.normalize(body);
  const payment = db.prepare('SELECT * FROM payments WHERE gateway_order_id = ?').get(n.gatewayOrderId);
  if(!payment) return reject(404, 'unknown order', n.gatewayOrderId);

  // 2. Does the amount match what WE recorded for this payment?
  if(n.amount !== payment.amount) return reject(400, 'amount mismatch', n.gatewayOrderId);

  // 3. Before releasing an order as paid, double-check straight with the gateway.
  if(n.status === 'paid' && provider.fetchStatus && payment.provider === provider.name){
    let confirmed = null;
    try { confirmed = await provider.fetchStatus(n.gatewayOrderId); }
    catch(err){ return reject(503, 'could not confirm with gateway (will be retried)', n.gatewayOrderId); }
    if(!confirmed || confirmed.status !== 'paid' || confirmed.amount !== payment.amount){
      return reject(409, 'gateway does not confirm this payment', n.gatewayOrderId);
    }
  }

  const outcome = applyStatus(payment.id, n.status, n.providerRef);
  return { status: 200, body: { ok: true, result: outcome } };
}

// If the notification never reaches us (for example on a laptop with no public address),
// ask the gateway ourselves. At most once every 10 seconds per payment.
async function reconcile(payment){
  const provider = getProvider();
  if(!provider.fetchStatus || payment.status !== 'pending' || payment.provider !== provider.name) return;

  const recent = db.prepare("SELECT 1 AS ok FROM payments WHERE id = ? AND last_checked_at > datetime('now', '-10 seconds')").get(payment.id);
  if(recent) return;
  db.prepare("UPDATE payments SET last_checked_at = datetime('now') WHERE id = ?").run(payment.id);

  const status = await provider.fetchStatus(payment.gateway_order_id);
  if(status && status.amount === payment.amount && status.status !== 'pending'){
    applyStatus(payment.id, status.status, status.providerRef);
  }
}

// Unpaid orders don't hold stock forever.
function expireStalePayments(){
  const rows = db.prepare("SELECT id FROM payments WHERE status = 'pending' AND expires_at <= datetime('now', ?)")
    .all(`-${config.expiryGraceMinutes} minutes`);
  rows.forEach((r) => applyStatus(r.id, 'expired'));
  return rows.length;
}

module.exports = {
  getProvider, startQrisPayment, processNotification, applyStatus,
  cancelPendingPayments, reconcile, expireStalePayments, isLive, PaymentExpiredError
};
