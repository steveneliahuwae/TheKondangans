// The Midtrans provider, tested against a fake Midtrans server we control.
// (This checks our side of the conversation; it is not a replacement for trying
//  your real Midtrans SANDBOX account, which the README walks you through.)
const http = require('http');
const { setupEnv, Client, startApp, placeOrder } = require('./helpers');
const KEY = 'SB-Mid-server-TESTKEY123';
setupEnv({ PAYMENT_PROVIDER: 'midtrans', MIDTRANS_SERVER_KEY: KEY });

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { seed } = require('../db/seed');
const { db } = require('../db/database');
seed({ quiet: true });

const sha512 = (s) => crypto.createHash('sha512').update(s).digest('hex');
const gateway = { charges: [], statusCalls: [], cancels: [], amounts: {}, statuses: {}, chargeFails: false, down: false, n: 0 };

function signedBody(orderId, txStatus, amount, key){
  const code = txStatus === 'settlement' ? '200' : txStatus === 'expire' ? '407' : '201';
  const gross = amount.toFixed(2);
  return { order_id: orderId, status_code: code, gross_amount: gross, transaction_status: txStatus,
           transaction_id: 'tx-' + orderId, signature_key: sha512(orderId + code + gross + (key || KEY)) };
}

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const expectedAuth = 'Basic ' + Buffer.from(KEY + ':').toString('base64');
    if(req.headers.authorization !== expectedAuth) return send(401, { status_code: '401', status_message: 'Unauthorized' });

    if(req.method === 'POST' && req.url === '/v2/charge'){
      const body = JSON.parse(raw);
      gateway.charges.push({ headers: req.headers, body });
      if(gateway.chargeFails) return send(200, { status_code: '400', status_message: 'Validation error' });
      gateway.amounts[body.transaction_details.order_id] = body.transaction_details.gross_amount;
      return send(200, { status_code: '201', status_message: 'QRIS transaction is created', transaction_id: 'tx-' + body.transaction_details.order_id,
                         order_id: body.transaction_details.order_id, qr_string: '00020101021226FAKEQRIS' + (++gateway.n), transaction_status: 'pending' });
    }
    let m = /^\/v2\/([^/]+)\/status$/.exec(req.url);
    if(req.method === 'GET' && m){
      const id = decodeURIComponent(m[1]);
      gateway.statusCalls.push(id);
      if(gateway.down) return req.socket.destroy();
      return send(200, signedBody(id, gateway.statuses[id] || 'pending', gateway.amounts[id] || 0));
    }
    m = /^\/v2\/([^/]+)\/cancel$/.exec(req.url);
    if(req.method === 'POST' && m){ gateway.cancels.push(decodeURIComponent(m[1])); return send(200, { status_code: '200' }); }
    send(404, { status_code: '404' });
  });
});

const paymentOf = (orderId) => db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId);
const orderOf = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
const stockOf = (id) => db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock;
const NASI = 1, MUG = 6;

let app, buyer, anon;
test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.MIDTRANS_BASE_URL = 'http://127.0.0.1:' + fake.address().port;
  app = await startApp();
  buyer = new Client(app.base); anon = new Client(app.base);
  await buyer.login('buyer@example.com');
});
test.after(async () => { await app.close(); fake.close(); });

async function newPaidCandidate(product, qty){
  const id = await placeOrder(buyer, product, qty || 1);
  const page = await buyer.get(`/orders/${id}/pay`);
  return { id, page, p: paymentOf(id) };
}
const webhook = (json) => anon.post('/payments/webhook', { json, origin: false });

test('sends Midtrans the charge it expects and shows the QR it returns', async () => {
  const { page, p } = await newPaidCandidate(NASI, 1);
  const charge = gateway.charges[gateway.charges.length - 1];
  assert.equal(charge.headers.authorization, 'Basic ' + Buffer.from(KEY + ':').toString('base64'));
  assert.equal(charge.body.payment_type, 'qris');
  assert.equal(charge.body.qris.acquirer, 'gopay');
  assert.equal(charge.body.transaction_details.gross_amount, 25000, 'whole rupiah, from our own database');
  assert.ok(Number.isInteger(charge.body.transaction_details.gross_amount));
  assert.match(charge.body.transaction_details.order_id, /^KDG-\d+-[0-9a-f]{8}$/);
  assert.equal(charge.body.custom_expiry.expiry_duration, 30);
  assert.match(page.text, /<svg/);
  assert.doesNotMatch(page.text, /Sandbox mode/, 'no fake-payment buttons with a real provider');
  assert.ok(!page.text.includes(KEY), 'the secret key never reaches the browser');
  assert.equal(p.provider, 'midtrans');
});

test('a signed "paid" notice is accepted only after Midtrans itself confirms it', async () => {
  const { id, p } = await newPaidCandidate(MUG, 1);
  gateway.statuses[p.gateway_order_id] = 'settlement';
  const r = await webhook(signedBody(p.gateway_order_id, 'settlement', p.amount));
  assert.equal(r.status, 200);
  assert.equal(orderOf(id).payment_status, 'paid');
  assert.ok(gateway.statusCalls.includes(p.gateway_order_id), 'we asked Midtrans directly');
});

test('a notice Midtrans does not back up is refused, even with a valid signature', async () => {
  const { id, p } = await newPaidCandidate(MUG, 1);          // Midtrans still says "pending"
  const r = await webhook(signedBody(p.gateway_order_id, 'settlement', p.amount));
  assert.equal(r.status, 409);
  assert.equal(orderOf(id).payment_status, 'unpaid');
});

test('if Midtrans cannot be reached, nothing is marked paid and the notice is retried later', async () => {
  const { id, p } = await newPaidCandidate(MUG, 1);
  gateway.statuses[p.gateway_order_id] = 'settlement';
  gateway.down = true;
  assert.equal((await webhook(signedBody(p.gateway_order_id, 'settlement', p.amount))).status, 503, 'asks Midtrans to retry');
  assert.equal(orderOf(id).payment_status, 'unpaid');
  gateway.down = false;
  assert.equal((await webhook(signedBody(p.gateway_order_id, 'settlement', p.amount))).status, 200, 'the retry succeeds');
  assert.equal(orderOf(id).payment_status, 'paid');
});

test('bad signatures and wrong amounts are rejected before Midtrans is even asked', async () => {
  const { id, p } = await newPaidCandidate(MUG, 1);
  gateway.statuses[p.gateway_order_id] = 'settlement';
  const calls = gateway.statusCalls.length;
  assert.equal((await webhook(signedBody(p.gateway_order_id, 'settlement', p.amount, 'some-other-key'))).status, 401, 'signed with a different key');
  const tampered = signedBody(p.gateway_order_id, 'settlement', p.amount); tampered.gross_amount = '1.00';
  assert.equal((await webhook(tampered)).status, 401, 'amount changed after signing');
  assert.equal((await webhook(signedBody(p.gateway_order_id, 'settlement', 1000))).status, 400, 'genuine signature, wrong amount');
  assert.equal(gateway.statusCalls.length, calls, 'no calls to Midtrans for any of those');
  assert.equal(orderOf(id).payment_status, 'unpaid');
});

test('if the notification never arrives, the page can still find out (and is throttled)', async () => {
  const { id, p } = await newPaidCandidate(MUG, 1);
  const s1 = (await buyer.get(`/orders/${id}/payment-status`)).json();
  assert.equal(s1.paymentStatus, 'unpaid');
  const calls = gateway.statusCalls.length;
  await buyer.get(`/orders/${id}/payment-status`);
  await buyer.get(`/orders/${id}/payment-status`);
  assert.equal(gateway.statusCalls.length, calls, 'repeated checks inside 10 seconds do not hammer Midtrans');

  gateway.statuses[p.gateway_order_id] = 'settlement';
  db.prepare("UPDATE payments SET last_checked_at = datetime('now', '-30 seconds') WHERE id = ?").run(p.id);
  const s2 = (await buyer.get(`/orders/${id}/payment-status`)).json();
  assert.equal(s2.paymentStatus, 'paid');
});

test('if Midtrans refuses to create the QR, the buyer sees a friendly error and nothing is half-created', async () => {
  const id = await placeOrder(buyer, MUG, 1);
  gateway.chargeFails = true;
  const r = await buyer.get(`/orders/${id}/pay`);
  assert.equal(r.status, 502);
  assert.match(r.text, /couldn't create the QR code/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payments WHERE order_id = ?').get(id).c, 0);
  gateway.chargeFails = false;
  assert.equal((await buyer.get(`/orders/${id}/pay`)).status, 200, 'trying again works');
  await buyer.post(`/orders/${id}/cancel`);
});

test('an "expire" notice cancels the order and returns its stock', async () => {
  const before = stockOf(MUG);
  const { id, p } = await newPaidCandidate(MUG, 2);
  assert.equal(stockOf(MUG), before - 2);
  const r = await webhook(signedBody(p.gateway_order_id, 'expire', p.amount));
  assert.equal(r.status, 200);
  assert.equal(orderOf(id).status, 'cancelled');
  assert.equal(stockOf(MUG), before);
});

test('cancelling an unpaid order also asks Midtrans to cancel the QR', async () => {
  const { id, p } = await newPaidCandidate(MUG, 1);
  await buyer.post(`/orders/${id}/cancel`);
  assert.equal(orderOf(id).status, 'cancelled');
  assert.ok(gateway.cancels.includes(p.gateway_order_id));
});
