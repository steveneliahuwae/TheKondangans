const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../lib/config');

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
function headers(){
  const csp = process.env.DISABLE_CSP === 'true' ? false : {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // The pages use small inline scripts and handlers, so 'unsafe-inline' is needed for now.
      // (Everything printed into pages is escaped, which is the main XSS defence.)
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],        // nobody can put this site in a frame (clickjacking)
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      ...(config.isProd() ? { upgradeInsecureRequests: [] } : {})
    }
  };
  return helmet({
    contentSecurityPolicy: csp,
    // 'strict-origin-when-cross-origin' keeps the Origin header on same-site form posts,
    // which the cross-site check below relies on.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false
  });
}

// ---------------------------------------------------------------------------
// Cross-site request forgery: refuse state-changing requests that did not come from our own pages.
// (Combined with SameSite session cookies.) The payment webhook is exempt: it is called by the
// gateway, and is protected by its signature instead.
// ---------------------------------------------------------------------------
function originCheck(req, res, next){
  if(req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if(req.path === '/payments/webhook') return next();

  const site = req.get('sec-fetch-site');           // sent by all modern browsers
  if(site){
    if(site === 'same-origin' || site === 'none') return next();
  } else {
    const origin = req.get('origin');
    if(origin && origin !== 'null'){
      try { if(new URL(origin).host === req.host) return next(); } catch(e){ /* fall through */ }
    }
  }
  console.warn(`[security] blocked cross-site ${req.method} ${req.path}`);
  return res.status(403).render('error', {
    title: 'Request blocked',
    message: 'That request did not come from this site, so it was blocked for your safety.'
  });
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------
function limiter(windowMs, limit, extra){
  return rateLimit({
    windowMs, limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      const wantsJson = req.path.startsWith('/payments/') || (req.get('accept') || '').includes('application/json');
      if(wantsJson) return res.status(429).json({ ok: false, error: 'Too many requests, slow down.' });
      res.status(429).render('error', { title: 'Too many attempts', message: 'Too many requests. Please wait a few minutes and try again.' });
    },
    ...(extra || {})
  });
}

module.exports = {
  headers,
  originCheck,
  loginLimiter: limiter(15 * 60 * 1000, 10, { skipSuccessfulRequests: true }),   // only failed logins count
  registerLimiter: limiter(60 * 60 * 1000, 20),
  payLimiter: limiter(15 * 60 * 1000, 40),
  statusLimiter: limiter(60 * 1000, 300),
  webhookLimiter: limiter(60 * 1000, 300)
};
