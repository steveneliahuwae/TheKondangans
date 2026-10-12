const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/database');
const { loginLimiter, registerLimiter } = require('../middleware/security');

const router = express.Router();

// Start a fresh session when someone logs in. This stops "session fixation" (an attacker planting a
// session id before login). Only a local path is ever used as the post-login redirect.
function signIn(req, res, next, sessionUser, fallbackUrl){
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if(err) return next(err);
    req.session.user = sessionUser;
    req.session.save((err2) => {
      if(err2) return next(err2);
      const safe = typeof returnTo === 'string' && /^\/(?!\/)/.test(returnTo) ? returnTo : null;
      res.redirect(safe || fallbackUrl);
    });
  });
}

router.get('/register', (req, res) => {
  if(req.session.user) return res.redirect('/');
  res.render('auth/register', { title: 'Create an account', errors: [], old: {} });
});

router.post(
  '/register',
  registerLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters.'),
    body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match.'),
    body('role').isIn(['buyer', 'vendor']).withMessage('Choose a valid account type.'),
    body('businessName').if(body('role').equals('vendor')).trim().notEmpty().withMessage('Business name is required for vendor accounts.')
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if(!errors.isEmpty()){
      return res.status(400).render('auth/register', {
        title: 'Create an account',
        errors: errors.array(),
        old: req.body
      });
    }

    const { name, email, password, role, businessName, businessDescription, businessLocation } = req.body;

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if(existing){
      return res.status(400).render('auth/register', {
        title: 'Create an account',
        errors: [{ msg: 'An account with that email already exists.' }],
        old: req.body
      });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const insertUser = db.prepare(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    );
    const result = insertUser.run(name, email, passwordHash, role);
    const userId = result.lastInsertRowid;

    if(role === 'vendor'){
      const defaultLogo = `https://ui-avatars.com/api/?name=${encodeURIComponent(businessName)}&background=7A2E3A&color=FFFFFF&size=160&bold=true`;
      db.prepare(
        'INSERT INTO vendors (user_id, business_name, description, location, logo_url) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, businessName, businessDescription || '', businessLocation || '', defaultLogo);
    }

    signIn(req, res, next, { id: userId, name, email, role }, role === 'vendor' ? '/vendor/dashboard' : '/');
  }
);

router.get('/login', (req, res) => {
  if(req.session.user) return res.redirect('/');
  res.render('auth/login', { title: 'Log in', error: null, old: {} });
});

router.post(
  '/login',
  loginLimiter,
  [
    body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.')
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if(!errors.isEmpty()){
      return res.status(400).render('auth/login', {
        title: 'Log in',
        error: 'Enter a valid email and password.',
        old: req.body
      });
    }

    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if(!user || !bcrypt.compareSync(password, user.password_hash)){
      return res.status(400).render('auth/login', {
        title: 'Log in',
        error: 'Incorrect email or password.',
        old: { email }
      });
    }

    signIn(req, res, next, { id: user.id, name: user.name, email: user.email, role: user.role },
           user.role === 'vendor' ? '/vendor/dashboard' : '/');
  }
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

module.exports = router;
