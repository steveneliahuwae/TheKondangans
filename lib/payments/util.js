const crypto = require('crypto');

const sha512 = (text) => crypto.createHash('sha512').update(text).digest('hex');

// Constant-time comparison of two hex strings (avoids leaking how many characters matched).
function safeEqualHex(a, b){
  if(typeof a !== 'string' || typeof b !== 'string') return false;
  if(!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const bufA = Buffer.from(a.toLowerCase(), 'hex');
  const bufB = Buffer.from(b.toLowerCase(), 'hex');
  if(bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Midtrans-style signature: SHA512(order_id + status_code + gross_amount + secret key).
// All four parts must be strings, exactly as received (never numbers or objects).
function signatureMatches(body, secret){
  if(!secret || !body || typeof body !== 'object') return false;
  const { order_id, status_code, gross_amount, signature_key } = body;
  if([order_id, status_code, gross_amount, signature_key].some((v) => typeof v !== 'string')) return false;
  return safeEqualHex(sha512(order_id + status_code + gross_amount + secret), signature_key);
}

// Turn a Midtrans-style payload into our own simple shape.
function normalise(body){
  const gross = Number(body.gross_amount);
  const amount = Number.isInteger(gross) ? gross : NaN;     // rupiah has no cents, so anything else is wrong
  const ts = body.transaction_status;
  let status = 'pending';
  if(ts === 'settlement' || (ts === 'capture' && body.fraud_status === 'accept')) status = 'paid';
  else if(ts === 'expire') status = 'expired';
  else if(ts === 'cancel' || ts === 'deny' || ts === 'failure') status = 'failed';
  return { gatewayOrderId: body.order_id, amount, status, providerRef: body.transaction_id || null };
}

module.exports = { sha512, safeEqualHex, signatureMatches, normalise };
