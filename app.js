require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');

const config = require('./lib/config');
config.assertSafeConfig();                        // refuse to start with an unsafe setup

const { db } = require('./db/database');          // also ensures the schema is applied on boot
const icons = require('./lib/icons');
const security = require('./middleware/security');
const payments = require('./lib/payments');

const { attachUser } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const vendorRoutes = require('./routes/vendor');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a proxy / load balancer (needed for correct IPs, rate limits and secure cookies): TRUST_PROXY=1
if(process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.locals.icon = icons.icon;
app.locals.categoryIcon = icons.categoryIcon;
app.locals.formatIDR = (amount) => 'Rp' + Number(amount).toLocaleString('id-ID');
app.locals.formatDate = (isoString) => {
  const d = new Date(isoString.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

app.use(security.headers());
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: process.env.SESSION_DIR || path.join(__dirname, 'db') }),
  secret: process.env.SESSION_SECRET || 'kondangans-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,                  // not readable by page scripts
    sameSite: 'lax',                 // not sent on cross-site POSTs
    secure: config.isProd()          // HTTPS only in production
  }
}));

app.use(attachUser);

app.use((req, res, next) => {
  res.locals.navCategories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  next();
});

app.use(security.originCheck);                    // blocks cross-site form posts (not the signed payment webhook)

app.use('/', authRoutes);
app.use('/', productRoutes);
app.use('/', cartRoutes);
app.use('/', orderRoutes);
app.use('/', paymentRoutes);
app.use('/', vendorRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', message: "That page doesn't exist." });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.' });
});

// Unpaid orders stop holding stock once their QR code has expired.
const sweeper = setInterval(() => {
  try { payments.expireStalePayments(); } catch(err){ console.error('[payments] expiry sweep failed:', err.message); }
}, 60 * 1000);
sweeper.unref();

module.exports = app;

if(require.main === module){
  app.listen(PORT, () => {
    console.log(`The Kondangans running at http://localhost:${PORT}`);
    console.log(`Payments: ${config.providerName()}${config.providerName() === 'mock' ? ' (SANDBOX, fake QR codes)' : ''}`);
  });
}
