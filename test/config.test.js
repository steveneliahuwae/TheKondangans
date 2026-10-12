// The app must refuse to start with a configuration that would be unsafe with real money.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
function check(env){
  const clean = { PATH: process.env.PATH };
  return spawnSync(process.execPath, ['-e', "require('./lib/config').assertSafeConfig()"], { cwd: root, env: Object.assign(clean, env), encoding: 'utf8' });
}
const GOOD_SECRET = 'a'.repeat(16) + 'B'.repeat(16) + '1234';

test('local development with the sandbox is fine', () => {
  assert.equal(check({}).status, 0);
  assert.equal(check({ PAYMENT_PROVIDER: 'mock' }).status, 0);
});
test('production refuses the fake sandbox payment provider', () => {
  const r = check({ NODE_ENV: 'production', SESSION_SECRET: GOOD_SECRET, PAYMENT_PROVIDER: 'mock' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sandbox and must never run in production/);
});
test('production refuses a weak or default session secret', () => {
  for(const secret of [undefined, 'short', 'kondangans-dev-secret-change-me-kondangans-dev-secret', 'change-this-to-a-long-random-string']){
    const env = { NODE_ENV: 'production', PAYMENT_PROVIDER: 'midtrans', MIDTRANS_SERVER_KEY: 'k' };
    if(secret) env.SESSION_SECRET = secret;
    const r = check(env);
    assert.notEqual(r.status, 0, 'rejected: ' + secret);
    assert.match(r.stderr, /SESSION_SECRET/);
  }
});
test('midtrans needs its server key', () => {
  const r = check({ PAYMENT_PROVIDER: 'midtrans' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /MIDTRANS_SERVER_KEY/);
});
test('an unknown payment provider is refused', () => {
  assert.notEqual(check({ PAYMENT_PROVIDER: 'paypal' }).status, 0);
});
test('a proper production setup is accepted', () => {
  const r = check({ NODE_ENV: 'production', SESSION_SECRET: GOOD_SECRET, PAYMENT_PROVIDER: 'midtrans', MIDTRANS_SERVER_KEY: 'Mid-server-xyz' });
  assert.equal(r.status, 0, r.stderr);
});
