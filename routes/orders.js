const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const payments = require('../lib/payments');
const { cancelOrder } = require('../lib/orders');

const router = express.Router();

const STATUS_ORDER = ['pending', 'confirmed', 'shipped', 'completed'];

router.get('/checkout', requireAuth, requireRole('buyer'), (req, res) => {
  const cart = req.session.cart || [];
  if(cart.length === 0) return res.redirect('/cart');

  const items = cart.map((item) => {
    const product = db.prepare(`
      SELECT products.*, vendors.business_name FROM products
      JOIN vendors ON vendors.id = products.vendor_id
      WHERE products.id = ?
    `).get(item.productId);
    return product ? { ...item, product } : null;
  }).filter(Boolean);

  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  res.render('orders/checkout', { title: 'Checkout', items, total, errors: [] });
});

router.post(
  '/checkout',
  requireAuth,
  requireRole('buyer'),
  [body('shippingAddress').trim().isLength({ min: 10 }).withMessage('Enter a complete shipping address (at least 10 characters).')],
  (req, res) => {
    const cart = req.session.cart || [];
    if(cart.length === 0) return res.redirect('/cart');

    const errors = validationResult(req);
    if(!errors.isEmpty()){
      const items = cart.map((item) => {
        const product = db.prepare(`
          SELECT products.*, vendors.business_name FROM products
          JOIN vendors ON vendors.id = products.vendor_id
          WHERE products.id = ?
        `).get(item.productId);
        return product ? { ...item, product } : null;
      }).filter(Boolean);
      const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

      return res.status(400).render('orders/checkout', {
        title: 'Checkout',
        items, total,
        errors: errors.array()
      });
    }

    const buyerId = req.session.user.id;
    const shippingAddress = req.body.shippingAddress;

    const placeOrder = db.transaction(() => {
      let total = 0;
      const lineItems = [];

      for(const cartItem of cart){
        const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(cartItem.productId);
        if(!product) continue;

        const qty = Math.min(cartItem.quantity, product.stock);
        if(qty <= 0) continue;

        total += product.price * qty;
        lineItems.push({
          productId: product.id,
          vendorId: product.vendor_id,
          name: product.name,
          price: product.price,
          quantity: qty
        });

        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, product.id);
      }

      if(lineItems.length === 0){
        throw new Error('NO_VALID_ITEMS');
      }

      const orderResult = db.prepare(
        'INSERT INTO orders (buyer_id, status, total, shipping_address) VALUES (?, ?, ?, ?)'
      ).run(buyerId, 'pending', total, shippingAddress);

      const orderId = orderResult.lastInsertRowid;

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, vendor_id, product_name, unit_price, quantity)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      lineItems.forEach((item) => {
        insertItem.run(orderId, item.productId, item.vendorId, item.name, item.price, item.quantity);
      });

      return orderId;
    });

    let orderId;
    try {
      orderId = placeOrder();
    } catch(err){
      return res.status(400).render('error', {
        title: 'Checkout failed',
        message: 'None of the items in your cart could be ordered (they may be out of stock). Please review your cart and try again.'
      });
    }

    req.session.cart = [];
    res.redirect('/orders/' + orderId + '/pay');
  }
);

router.get('/orders', requireAuth, (req, res) => {
  payments.expireStalePayments();
  const user = req.session.user;
  let orders;

  if(user.role === 'buyer'){
    orders = db.prepare('SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC').all(user.id);
  } else if(user.role === 'vendor'){
    const vendor = db.prepare('SELECT * FROM vendors WHERE user_id = ?').get(user.id);
    orders = vendor ? db.prepare(`
      SELECT DISTINCT orders.* FROM orders
      JOIN order_items ON order_items.order_id = orders.id
      WHERE order_items.vendor_id = ?
      ORDER BY orders.created_at DESC
    `).all(vendor.id) : [];
  } else {
    orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  }

  res.render('orders/index', { title: 'Orders', orders });
});

router.get('/orders/:id', requireAuth, (req, res) => {
  payments.expireStalePayments();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if(!order) return res.status(404).render('error', { title: 'Not found', message: 'That order does not exist.' });

  const user = req.session.user;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  const isOwner = user.role === 'buyer' && order.buyer_id === user.id;
  const vendor = user.role === 'vendor' ? db.prepare('SELECT * FROM vendors WHERE user_id = ?').get(user.id) : null;
  const isInvolvedVendor = vendor && items.some((item) => item.vendor_id === vendor.id);

  if(!isOwner && !isInvolvedVendor && user.role !== 'admin'){
    return res.status(403).render('error', { title: 'Access denied', message: "You don't have permission to view this order." });
  }

  const buyer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(order.buyer_id);

  res.render('orders/show', {
    title: 'Order #' + order.id,
    order, items, buyer,
    isOwner,
    // Sellers can only move an order forward once it has been paid.
    canAdvance: (isInvolvedVendor || user.role === 'admin') && order.payment_status === 'paid' &&
                STATUS_ORDER.includes(order.status) && order.status !== 'completed',
    waitingForPayment: (isInvolvedVendor || user.role === 'admin') && order.payment_status !== 'paid' &&
                       order.status !== 'cancelled',
    canPay: isOwner && order.status === 'pending' && order.payment_status === 'unpaid',
    // A paid order can't be cancelled here (that would need a refund).
    canCancel: isOwner && order.status === 'pending' && order.payment_status !== 'paid',
    nextStatus: nextStatus(order.status)
  });
});

router.post('/orders/:id/advance', requireAuth, requireRole('vendor', 'admin'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if(!order) return res.status(404).render('error', { title: 'Not found', message: 'That order does not exist.' });

  // A vendor may only touch orders that contain their own products.
  if(req.session.user.role === 'vendor'){
    const vendor = db.prepare('SELECT id FROM vendors WHERE user_id = ?').get(req.session.user.id);
    const involved = vendor && db.prepare('SELECT 1 AS ok FROM order_items WHERE order_id = ? AND vendor_id = ? LIMIT 1').get(order.id, vendor.id);
    if(!involved){
      return res.status(403).render('error', { title: 'Access denied', message: "That order doesn't include your products." });
    }
  }

  // Never ship or confirm an order that has not been paid.
  if(order.payment_status !== 'paid'){
    return res.status(400).render('error', { title: 'Not paid yet', message: "This order hasn't been paid yet, so it can't be moved forward." });
  }

  const next = nextStatus(order.status);
  if(next){
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, order.id);
  }
  res.redirect('/orders/' + order.id);
});

router.post('/orders/:id/cancel', requireAuth, requireRole('buyer'), async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if(!order || order.buyer_id !== req.session.user.id){
    return res.status(404).render('error', { title: 'Not found', message: 'That order does not exist.' });
  }
  if(order.status === 'pending' && order.payment_status !== 'paid'){
    if(cancelOrder(order.id)){
      db.prepare("UPDATE orders SET payment_status = 'expired' WHERE id = ? AND payment_status = 'unpaid'").run(order.id);
      await payments.cancelPendingPayments(order.id);
    }
  }
  res.redirect('/orders/' + order.id);
});

function nextStatus(current){
  const idx = STATUS_ORDER.indexOf(current);
  if(idx === -1 || idx === STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1];
}

module.exports = router;
