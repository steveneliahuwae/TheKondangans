// Midtrans Core API, QRIS via GoPay acquirer.
// Docs: https://docs.midtrans.com/reference/qris
//
// Needs MIDTRANS_SERVER_KEY (keep it secret: it only ever lives on the server).
// Sandbox is used unless MIDTRANS_IS_PRODUCTION=true. MIDTRANS_BASE_URL overrides the host (used by tests).

const { signatureMatches, normalise } = require('./util');

const baseUrl = () => process.env.MIDTRANS_BASE_URL ||
  (process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com');
const serverKey = () => process.env.MIDTRANS_SERVER_KEY || '';
const authHeader = () => 'Basic ' + Buffer.from(serverKey() + ':').toString('base64');
const headers = () => ({ accept: 'application/json', 'content-type': 'application/json', authorization: authHeader() });

async function createQris({ gatewayOrderId, amount, expiryMinutes }){
  const extra = process.env.MIDTRANS_NOTIFICATION_URL
    ? { 'X-Override-Notification': process.env.MIDTRANS_NOTIFICATION_URL } : {};

  const res = await fetch(baseUrl() + '/v2/charge', {
    method: 'POST',
    headers: { ...headers(), ...extra },
    body: JSON.stringify({
      payment_type: 'qris',
      transaction_details: { order_id: gatewayOrderId, gross_amount: amount },
      qris: { acquirer: 'gopay' },
      custom_expiry: { expiry_duration: expiryMinutes, unit: 'minute' }
    }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => null);

  if(!data || String(data.status_code) !== '201' || !data.qr_string){
    throw new Error('Midtrans did not create the QRIS payment: ' + ((data && data.status_message) || 'HTTP ' + res.status));
  }
  return { providerRef: data.transaction_id || null, qrString: data.qr_string };
}

// Ask Midtrans directly (server to server, with our secret key) what the status really is.
async function fetchStatus(gatewayOrderId){
  const res = await fetch(`${baseUrl()}/v2/${encodeURIComponent(gatewayOrderId)}/status`, {
    headers: headers(),
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => null);
  if(!data || data.order_id !== gatewayOrderId) return null;
  // The status response is signed like a notification: if a signature is present it must be valid.
  if(data.signature_key && !signatureMatches(data, serverKey())) return null;
  return normalise(data);
}

async function cancel(gatewayOrderId){
  try {
    await fetch(`${baseUrl()}/v2/${encodeURIComponent(gatewayOrderId)}/cancel`, {
      method: 'POST', headers: headers(), signal: AbortSignal.timeout(8000)
    });
  } catch(err){
    console.warn('[payments] could not cancel at gateway (it will simply expire):', err.message);
  }
}

module.exports = {
  name: 'midtrans',
  createQris,
  verifyNotification: (body) => signatureMatches(body, serverKey()),
  normalize: normalise,
  fetchStatus,
  cancel
};
