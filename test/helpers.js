const os = require('os');
const path = require('path');
const fs = require('fs');

// Each test file runs in its own process with its own throwaway database.
function setupEnv(extra){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdg-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_PATH: path.join(dir, 'test.sqlite'),
    SESSION_DIR: dir,
    SESSION_SECRET: 'test-secret-test-secret-test-secret-123456',
    PAYMENT_PROVIDER: 'mock',
    MOCK_PAYMENT_SECRET: 'unit-test-mock-secret'
  }, extra || {});
  return dir;
}

// A tiny "browser": keeps cookies, sends the Origin header a real browser would.
class Client {
  constructor(base){ this.base = base; this.cookies = {}; }

  async request(method, urlPath, opts){
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if(Object.keys(this.cookies).length){
      headers.cookie = Object.entries(this.cookies).map(([k, v]) => k + '=' + v).join('; ');
    }
    if(method !== 'GET' && opts.origin !== false) headers.origin = opts.origin || this.base;

    let body;
    if(opts.form){ body = new URLSearchParams(opts.form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
    if(opts.json !== undefined){ body = JSON.stringify(opts.json); headers['content-type'] = 'application/json'; }

    const res = await fetch(this.base + urlPath, { method, headers, body, redirect: 'manual' });
    for(const c of res.headers.getSetCookie()){
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if(value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) delete this.cookies[name];
      else this.cookies[name] = value;
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location'), json: () => JSON.parse(text) };
  }
  get(p, o){ return this.request('GET', p, o); }
  post(p, o){ return this.request('POST', p, o); }
  login(email, password){ return this.post('/login', { form: { email, password: password || 'password123' } }); }
}

async function startApp(){
  const app = require('../app');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) };
}

// Put a product in the cart and check out. Returns the new order id.
async function placeOrder(client, productId, quantity){
  await client.post('/cart/add', { form: { productId: String(productId), quantity: String(quantity || 1) } });
  const r = await client.post('/checkout', { form: { shippingAddress: 'Jl. Melati 1 No.10, Cikarang, Bekasi 17530' } });
  const m = /\/orders\/(\d+)\/pay/.exec(r.location || '');
  if(!m) throw new Error('checkout did not redirect to the pay page: ' + r.status + ' ' + r.location);
  return Number(m[1]);
}

module.exports = { setupEnv, Client, startApp, placeOrder };
