const express = require('express');
const { db } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function getCart(req){
  if(!req.session.cart) req.session.cart = [];
  return req.session.cart;
}

router.get('/cart', requireAuth, (req, res) => {
  const cart = getCart(req);
  const items = cart.map((item) => {
    const product = db.prepare(`
      SELECT products.*, vendors.business_name FROM products
      JOIN vendors ON vendors.id = products.vendor_id
      WHERE products.id = ?
    `).get(item.productId);
    return product ? { ...item, product } : null;
  }).filter(Boolean);

  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  res.render('cart/index', { title: 'Your cart', items, total });
});

router.post('/cart/add', requireAuth, (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = Math.max(1, Number(req.body.quantity) || 1);

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(productId);
  if(!product){
    return res.status(404).render('error', { title: 'Not found', message: 'That product does not exist.' });
  }

  const cart = getCart(req);
  const existing = cart.find((item) => item.productId === productId);
  if(existing){
    existing.quantity += quantity;
  } else {
    cart.push({ productId, quantity });
  }

  res.redirect('/cart');
});

router.post('/cart/update', requireAuth, (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = Math.max(0, Number(req.body.quantity) || 0);

  const cart = getCart(req);
  const idx = cart.findIndex((item) => item.productId === productId);
  if(idx !== -1){
    if(quantity === 0) cart.splice(idx, 1);
    else cart[idx].quantity = quantity;
  }

  res.redirect('/cart');
});

router.post('/cart/remove', requireAuth, (req, res) => {
  const productId = Number(req.body.productId);
  req.session.cart = getCart(req).filter((item) => item.productId !== productId);
  res.redirect('/cart');
});

module.exports = router;
