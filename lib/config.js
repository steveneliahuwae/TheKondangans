// Central place for settings that affect security. Read lazily so tests can change them.

const isProd = () => process.env.NODE_ENV === 'production';
const providerName = () => (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

module.exports = {
  isProd,
  providerName,
  // How long a QRIS code stays valid.
  expiryMinutes: () => Math.max(5, Number(process.env.PAYMENT_EXPIRY_MINUTES) || 30),
  // Extra time before WE cancel an unpaid order, so a payment made in the last seconds is not lost.
  expiryGraceMinutes: 2,

  // Refuse to start with a configuration that would be unsafe with real money.
  assertSafeConfig(){
    const problems = [];
    const provider = providerName();

    if(!['mock', 'midtrans'].includes(provider)){
      problems.push(`PAYMENT_PROVIDER "${provider}" is not supported (use "mock" or "midtrans").`);
    }
    if(provider === 'midtrans' && !process.env.MIDTRANS_SERVER_KEY){
      problems.push('PAYMENT_PROVIDER=midtrans needs MIDTRANS_SERVER_KEY (your Midtrans server key).');
    }
    if(isProd()){
      const secret = process.env.SESSION_SECRET || '';
      if(secret.length < 32 || /change-this|kondangans-dev/i.test(secret)){
        problems.push('SESSION_SECRET must be a long random value (32+ characters) in production.');
      }
      if(provider === 'mock'){
        problems.push('PAYMENT_PROVIDER=mock is a fake sandbox and must never run in production. Use a real provider.');
      }
    }
    if(problems.length){
      throw new Error('Unsafe or incomplete configuration:\n - ' + problems.join('\n - '));
    }
  }
};
