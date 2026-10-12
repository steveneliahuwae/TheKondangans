// Payment + security tests against the sandbox provider.
const { setupEnv, Client, startApp, placeOrder } = require('./helpers');
setupEnv();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { seed } = require('../db/seed');
const { db } = require('../db/database');

seed({ quiet: true });

const SECRET = process.env.MOCK_PAYMENT_SECRET;
const sha512 = (s) => crypto.createHash('sha512').update(s).digest('hex');
// Build a notification exactly like the gateway would (the test knows the secret; an attacker does not).
function notification(orderId, status, amount, txStatus){
  const gross = amount.toFixed(2);
  return { order_id: orderId, status_code: status, gross_amount: gross, transaction_status: txStatus,
           signature_key: sha512(orderId + status + gross + SECRET) };
}
const settle = (p, amount) => notification(p.gateway_order_id, '200', amount === undefined ? p.amount : amount, 'settlement');
const paymentOf = (orderId) => db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId);
const orderOf = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
const stockOf = (id) => db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock;
const NASI = 1, MUG = 6;     // seeded products: Nasi Kotak (25.000), Mug (22.000)

let app, buyer, buyer2, vendor1, vendor3, anon;

test.before(async () => {
  app = await startApp();
  buyer = new Client(app.base); vendor1 = new Client(app.base); vendor3 = new Client(app.base);
  buyer2 = new Client(app.base); anon = new Client(app.base);
  assert.equal((await buyer.login('buyer@example.com')).status, 302);
  assert.equal((await vendor1.login('vendor1@example.com')).status, 302);
  assert.equal((await vendor3.login('vendor3@example.com')).status, 302);
  const reg = await buyer2.post('/register', { form: { name: 'Second Buyer', email: 'second@example.com', password: 'password123', confirmPassword: 'password123', role: 'buyer' } });
  assert.equal(reg.status, 302);
});
test.after(() => app.close());

test('checkout leads to a QRIS page whose amount comes from the server', async () => {
  const id = await placeOrder(buyer, NASI, 2);
  const page = await buyer.get(`/orders/${id}/pay`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<svg/, 'a QR code is drawn');
  assert.match(page.text, /Rp50\.000/, 'amount is 2 x 25.000');
  const p = paymentOf(id);
  assert.equal(p.status, 'pending');
  assert.equal(p.amount, 50000);
  assert.equal(orderOf(id).payment_status, 'unpaid');
});

test('reloading the pay page does not create a second QR code', async () => {
  const id = await placeOrder(buyer, MUG, 1);
  await Promise.all([1, 2, 3, 4, 5].map(() => buyer.get(`/orders/${id}/pay`)));
  const count = db.prepare("SELECT COUNT(*) c FROM payments WHERE order_id = ? AND status = 'pending'").get(id).c;
  assert.equal(count, 1);
});

test('browser-supplied data can never mark an order paid', async () => {
  const id = await placeOrder(buyer, MUG, 1);
  await buyer.get(`/orders/${id}/pay`);
  for(const body of [{ paymentStatus: 'paid' }, { payment_status: 'paid', status: 'paid' }]){
    await buyer.post(`/orders/${id}/cancel`.replace('/cancel', '/advance'), { form: body });
  }
  const r = await buyer.get(`/orders/${id}/payment-status?paymentStatus=paid`);
  assert.equal(r.json().paymentStatus, 'unpaid');
  assert.equal(orderOf(id).payment_status, 'unpaid');
  await buyer.post(`/orders/${id}/cancel`);       // tidy up
});

test('full happy path: simulated payment marks the order paid and unlocks the seller', async () => {
  const id = await placeOrder(buyer, NASI, 1);
  await buyer.get(`/orders/${id}/pay`);
  assert.equal((await buyer.get(`/orders/${id}/payment-status`)).json().paymentStatus, 'unpaid');

  // seller cannot ship an unpaid order
  const early = await vendor1.post(`/orders/${id}/advance`);
  assert.equal(early.status, 400);
  assert.equal(orderOf(id).status, 'pending');

  const sim = await buyer.post(`/dev/simulate-payment/${id}`, { form: { outcome: 'paid' } });
  assert.equal(sim.status, 302);
  assert.equal(orderOf(id).payment_status, 'paid');
  assert.equal((await buyer.get(`/orders/${id}/payment-status`)).json().paymentStatus, 'paid');
  assert.equal((await buyer.get(`/orders/${id}/pay`)).status, 302, 'a paid order has nothing left to pay');

  assert.equal((await vendor1.post(`/orders/${id}/advance`)).status, 302);
  assert.equal(orderOf(id).status, 'confirmed');
});

test('a vendor cannot touch an order that does not contain their products', async () => {
  const id = await placeOrder(buyer, NASI, 1);                         // vendor1's product
  await buyer.get(`/orders/${id}/pay`);
  await buyer.post(`/dev/simulate-payment/${id}`, { form: { outcome: 'paid' } });
  const r = await vendor3.post(`/orders/${id}/advance`);               // vendor3 is not on this order
  assert.equal(r.status, 403);
  assert.equal(orderOf(id).status, 'pending');
});

test('webhook rejects forged, malformed and tampered notifications', async () => {
  const id = await placeOrder(buyer, MUG, 3);
  await buyer.get(`/orders/${id}/pay`);
  const p = paymentOf(id);
  const post = (json) => anon.post('/payments/webhook', { json, origin: false });

  assert.equal((await post({})).status, 401, 'empty body');
  assert.equal((await post({ order_id: p.gateway_order_id, status_code: '200', gross_amount: '66000.00', transaction_status: 'settlement' })).status, 401, 'no signature');
  const forged = settle(p); forged.signature_key = sha512('attacker guess');
  assert.equal((await post(forged)).status, 401, 'wrong signature');
  const wrongKey = settle(p); wrongKey.signature_key = sha512(p.gateway_order_id + '200' + p.amount.toFixed(2) + 'not-the-real-secret');
  assert.equal((await post(wrongKey)).status, 401, 'signed with the wrong key');
  const typed = settle(p); typed.gross_amount = [typed.gross_amount];
  assert.equal((await post(typed)).status, 401, 'array instead of string');
  assert.equal((await post(notification('KDG-999-deadbeef', '200', 1000, 'settlement'))).status, 404, 'unknown payment');

  // genuine signature, but for a different amount than we recorded
  assert.equal((await post(settle(p, 1000))).status, 400, 'underpayment is refused');
  assert.equal((await post(settle(p, p.amount + 1))).status, 400, 'overpayment mismatch is refused');

  assert.equal(orderOf(id).payment_status, 'unpaid', 'nothing above changed the order');
  assert.equal(paymentOf(id).status, 'pending');
});

test('webhook is idempotent and a paid payment can never be undone', async () => {
  const id = await placeOrder(buyer, MUG, 1);
  await buyer.get(`/orders/${id}/pay`);
  const p = paymentOf(id);
  const post = (json) => anon.post('/payments/webhook', { json, origin: false });

  assert.equal((await post(notification(p.gateway_order_id, '201', p.amount, 'pending'))).json().result, 'ignored');
  assert.equal(orderOf(id).payment_status, 'unpaid', 'a "pending" notice changes nothing');

  const first = await post(settle(p));
  assert.equal(first.status, 200);
  assert.equal(first.json().result, 'paid');
  assert.equal((await post(settle(p))).json().result, 'already-paid', 'replaying is harmless');

  await post(notification(p.gateway_order_id, '407', p.amount, 'expire'));
  await post(notification(p.gateway_order_id, '202', p.amount, 'deny'));
  assert.equal(paymentOf(id).status, 'paid', 'later expire/deny notices cannot undo a payment');
  assert.equal(orderOf(id).payment_status, 'paid');
  assert.equal(orderOf(id).status, 'pending', 'and the order was not cancelled');
});

test('other people cannot see or pay your order', async () => {
  const id = await placeOrder(buyer, MUG, 1);
  await buyer.get(`/orders/${id}/pay`);
  assert.equal((await buyer2.get(`/orders/${id}/pay`)).status, 404);
  assert.equal((await buyer2.get(`/orders/${id}/payment-status`)).status, 404);
  assert.equal((await buyer2.post(`/dev/simulate-payment/${id}`, { form: { outcome: 'paid' } })).status, 404);
  assert.equal((await buyer2.post(`/orders/${id}/cancel`)).status, 404);
  assert.equal((await vendor1.get(`/orders/${id}/pay`)).status, 403, 'sellers have no pay page');
  const loggedOut = await anon.get(`/orders/${id}/pay`);
  assert.equal(loggedOut.status, 302);
  assert.match(loggedOut.location, /\/login/);
  assert.equal(paymentOf(id).status, 'pending');
  await buyer.post(`/orders/${id}/cancel`);
});

test('unpaid orders expire: cancelled, and the stock is released', async () => {
  const before = stockOf(MUG);
  const id = await placeOrder(buyer, MUG, 4);
  assert.equal(stockOf(MUG), before - 4, 'stock is held while the buyer pays');
  await buyer.get(`/orders/${id}/pay`);

  // QR just ran out, still inside the short grace period: the page says expired, order not yet cancelled
  db.prepare("UPDATE payments SET expires_at = datetime('now', '-1 minutes') WHERE order_id = ?").run(id);
  const grace = await buyer.get(`/orders/${id}/pay`);
  assert.match(grace.text, /has expired/);
  assert.equal(orderOf(id).status, 'pending');

  // past the grace period: the next visit cancels it and releases the stock
  db.prepare("UPDATE payments SET expires_at = datetime('now', '-10 minutes') WHERE order_id = ?").run(id);
  await buyer.get('/orders');
  assert.equal(orderOf(id).status, 'cancelled');
  assert.equal(orderOf(id).payment_status, 'expired');
  assert.equal(paymentOf(id).status, 'expired');
  assert.equal(stockOf(MUG), before, 'stock came back');
});

test('money that arrives after an order was cancelled is flagged for refund, not lost', async () => {
  const id = await placeOrder(buyer, MUG, 1);
  await buyer.get(`/orders/${id}/pay`);
  const p = paymentOf(id);
  await buyer.post(`/orders/${id}/cancel`);
  assert.equal(orderOf(id).status, 'cancelled');
  assert.equal(paymentOf(id).status, 'cancelled');

  const r = await anon.post('/payments/webhook', { json: settle(p), origin: false });
  assert.equal(r.status, 200);
  assert.equal(orderOf(id).payment_status, 'refund_needed');
  assert.equal(orderOf(id).status, 'cancelled', 'a cancelled order stays cancelled');
  assert.match((await buyer.get(`/orders/${id}`)).text, /will be refunded/);
});

test('a paid order cannot be cancelled by the buyer', async () => {
  const id = await placeOrder(buyer, MUG, 1);
  await buyer.get(`/orders/${id}/pay`);
  await buyer.post(`/dev/simulate-payment/${id}`, { form: { outcome: 'paid' } });
  await buyer.post(`/orders/${id}/cancel`);
  assert.equal(orderOf(id).status, 'pending');
  assert.equal(orderOf(id).payment_status, 'paid');
});

test('a declined payment can be retried with a fresh QR code', async () => {
  const id = await placeOrder(buyer, MUG, 1);
  await buyer.get(`/orders/${id}/pay`);
  await buyer.post(`/dev/simulate-payment/${id}`, { form: { outcome: 'failed' } });
  assert.equal(orderOf(id).status, 'pending');
  assert.equal(paymentOf(id).status, 'failed');
  await buyer.get(`/orders/${id}/pay`);
  assert.equal(paymentOf(id).status, 'pending', 'new attempt');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payments WHERE order_id = ?').get(id).c, 2);
  await buyer.post(`/orders/${id}/cancel`);
});

test('cross-site requests are blocked, same-site ones work, the webhook is exempt', async () => {
  const add = (opts) => buyer.post('/cart/add', Object.assign({ form: { productId: String(MUG), quantity: '1' } }, opts));
  assert.equal((await add({ origin: false })).status, 403, 'no Origin header');
  assert.equal((await add({ origin: 'https://evil.example' })).status, 403, 'foreign Origin');
  assert.equal((await add({ origin: 'null' })).status, 403, 'Origin: null');
  assert.equal((await add({ headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'browser says cross-site');
  assert.equal((await add({ headers: { 'sec-fetch-site': 'same-site' } })).status, 403, 'sibling sites are not trusted either');
  assert.equal((await add({})).status, 302, 'our own pages work');
  assert.equal((await add({ headers: { 'sec-fetch-site': 'same-origin' } })).status, 302);
  // the webhook is called by the gateway (no Origin) and is protected by its signature instead
  assert.equal((await anon.post('/payments/webhook', { json: {}, origin: false })).status, 401);
  await buyer.post('/cart/remove', { form: { productId: String(MUG) } });
});

test('security headers are set', async () => {
  const r = await anon.get('/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('logging in starts a brand-new session (no session fixation)', async () => {
  const c = new Client(app.base);
  await c.get('/checkout');                                  // creates a session cookie while logged out
  const before = c.cookies['connect.sid'];
  assert.ok(before, 'got a pre-login session cookie');
  const login = await c.login('buyer@example.com');
  assert.equal(login.status, 302);
  assert.notEqual(c.cookies['connect.sid'], before, 'session id changed at login');
  const stale = new Client(app.base); stale.cookies['connect.sid'] = before;
  const r = await stale.get('/orders');
  assert.equal(r.status, 302, 'the old session id is not logged in');
});

test('brute-forcing a login is slowed down (runs last: it locks this test client out)', async () => {
  const c = new Client(app.base);
  let blocked = false;
  for(let i = 0; i < 14 && !blocked; i++){
    const r = await c.login('buyer@example.com', 'wrong-password-' + i);
    if(r.status === 429) blocked = true;
  }
  assert.ok(blocked, 'got a 429 after repeated failures');
});
