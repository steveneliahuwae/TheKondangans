// SANDBOX provider. Lets you try the whole QRIS flow with no merchant account.
// The QR code it makes is a test code that real banking apps cannot scan or pay.
// It still signs and verifies notifications exactly like a real gateway, so the
// secure code path is the one being exercised. Refuses to run in production (see lib/config.js).

const crypto = require('crypto');
const { sha512, signatureMatches, normalise } = require('./util');

let generated = null;
function secret(){
  if(process.env.MOCK_PAYMENT_SECRET) return process.env.MOCK_PAYMENT_SECRET;
  if(!generated) generated = crypto.randomBytes(32).toString('hex');   // random per run, so nobody can forge it
  return generated;
}

const OUTCOMES = {
  paid:    { transaction_status: 'settlement', status_code: '200' },
  expired: { transaction_status: 'expire',     status_code: '407' },
  failed:  { transaction_status: 'deny',       status_code: '202' }
};

module.exports = {
  name: 'mock',

  async createQris({ gatewayOrderId, amount }){
    return {
      providerRef: 'mock-' + crypto.randomUUID(),
      qrString: `KONDANGANS-SANDBOX-QRIS|${gatewayOrderId}|${amount}`
    };
  },

  verifyNotification: (body) => signatureMatches(body, secret()),
  normalize: normalise,
  // No fetchStatus on purpose: there is no real gateway to ask. (Real providers define it, and the
  // payment service then double-checks every "paid" notification with the gateway before accepting it.)
  async cancel(){},

  // Used only by the sandbox "simulate payment" button.
  buildNotification(payment, outcome){
    const o = OUTCOMES[outcome];
    if(!o) throw new Error('Unknown outcome');
    const gross = payment.amount.toFixed(2);
    return {
      order_id: payment.gateway_order_id,
      status_code: o.status_code,
      gross_amount: gross,
      transaction_status: o.transaction_status,
      transaction_id: payment.provider_ref,
      signature_key: sha512(payment.gateway_order_id + o.status_code + gross + secret())
    };
  }
};
