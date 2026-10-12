const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function getVendorOr404(req, res){
  const vendor = db.prepare('SELECT * FROM vendors WHERE user_id = ?').get(req.session.user.id);
  if(!vendor){
    res.status(404).render('error', { title: 'Not found', message: 'Vendor profile not found.' });
    return null;
  }
  return vendor;
}

// Scoped to /vendor/* only — without the path prefix here, this would
// accidentally apply to every request on the site, since the router
// itself is mounted at '/' in app.js.
router.use('/vendor', requireAuth, requireRole('vendor'));

router.get('/vendor/dashboard', (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products WHERE vendor_id = ?').get(vendor.id).c;
  const pendingOrders = db.prepare(`
    SELECT COUNT(DISTINCT orders.id) AS c FROM orders
    JOIN order_items ON order_items.order_id = orders.id
    WHERE order_items.vendor_id = ? AND orders.status = 'pending'
  `).get(vendor.id).c;
  const recentProducts = db.prepare('SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 5').all(vendor.id);

  res.render('vendor/dashboard', {
    title: 'Vendor dashboard',
    vendor, productCount, pendingOrders, recentProducts
  });
});

router.get('/vendor/profile', (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  res.render('vendor/profile', { title: 'Business profile', vendor, errors: [], old: {} });
});

const profileValidators = [
  body('businessName').trim().isLength({ min: 2, max: 150 }).withMessage('Business name must be 2-150 characters.'),
  body('description').trim().isLength({ max: 1000 }).withMessage('Description is too long.'),
  body('location').trim().isLength({ max: 150 }).withMessage('Location is too long.'),
  body('logoUrl').optional({ checkFalsy: true }).isURL().withMessage('Logo must be a valid image URL.')
];

router.post('/vendor/profile', profileValidators, (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  const errors = validationResult(req);
  if(!errors.isEmpty()){
    return res.status(400).render('vendor/profile', {
      title: 'Business profile',
      vendor: { ...vendor, ...req.body },
      errors: errors.array(),
      old: req.body
    });
  }

  const { businessName, description, location, logoUrl } = req.body;
  db.prepare(`
    UPDATE vendors SET business_name = ?, description = ?, location = ?, logo_url = ?
    WHERE id = ?
  `).run(businessName, description || '', location || '', logoUrl || '', vendor.id);

  res.redirect('/vendor/dashboard');
});

router.get('/vendor/products', (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  const products = db.prepare('SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC').all(vendor.id);
  res.render('vendor/products', { title: 'My products', vendor, products });
});

router.get('/vendor/products/new', (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('vendor/product-form', { title: 'Add product', categories, product: null, errors: [], old: {} });
});

const productValidators = [
  body('name').trim().isLength({ min: 2, max: 150 }).withMessage('Product name must be 2-150 characters.'),
  body('description').trim().isLength({ max: 2000 }).withMessage('Description is too long.'),
  body('price').isInt({ min: 0 }).withMessage('Price must be a positive number.'),
  body('stock').isInt({ min: 0 }).withMessage('Stock must be a positive whole number.'),
  body('categoryId').optional({ checkFalsy: true }).isInt().withMessage('Choose a valid category.'),
  body('imageUrl').optional({ checkFalsy: true }).isURL().withMessage('Image must be a valid URL.')
];

router.post('/vendor/products/new', productValidators, (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  const errors = validationResult(req);
  if(!errors.isEmpty()){
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.status(400).render('vendor/product-form', {
      title: 'Add product', categories, product: null, errors: errors.array(), old: req.body
    });
  }

  const { name, description, price, stock, categoryId, imageUrl } = req.body;
  db.prepare(`
    INSERT INTO products (vendor_id, category_id, name, description, price, stock, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(vendor.id, categoryId || null, name, description || '', price, stock, imageUrl || '');

  res.redirect('/vendor/products');
});

router.get('/vendor/products/:id/edit', (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?').get(req.params.id, vendor.id);
  if(!product) return res.status(404).render('error', { title: 'Not found', message: 'Product not found.' });

  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('vendor/product-form', { title: 'Edit product', categories, product, errors: [], old: {} });
});

router.post('/vendor/products/:id/edit', productValidators, (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?').get(req.params.id, vendor.id);
  if(!product) return res.status(404).render('error', { title: 'Not found', message: 'Product not found.' });

  const errors = validationResult(req);
  if(!errors.isEmpty()){
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.status(400).render('vendor/product-form', {
      title: 'Edit product', categories, product: { ...product, ...req.body }, errors: errors.array(), old: req.body
    });
  }

  const { name, description, price, stock, categoryId, imageUrl } = req.body;
  db.prepare(`
    UPDATE products SET name = ?, description = ?, price = ?, stock = ?, category_id = ?, image_url = ?
    WHERE id = ? AND vendor_id = ?
  `).run(name, description || '', price, stock, categoryId || null, imageUrl || '', product.id, vendor.id);

  res.redirect('/vendor/products');
});

router.post('/vendor/products/:id/toggle', (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?').get(req.params.id, vendor.id);
  if(!product) return res.status(404).render('error', { title: 'Not found', message: 'Product not found.' });

  db.prepare('UPDATE products SET is_active = ? WHERE id = ?').run(product.is_active ? 0 : 1, product.id);
  res.redirect('/vendor/products');
});

router.post('/vendor/products/:id/delete', (req, res) => {
  const vendor = getVendorOr404(req, res);
  if(!vendor) return;

  db.prepare('DELETE FROM products WHERE id = ? AND vendor_id = ?').run(req.params.id, vendor.id);
  res.redirect('/vendor/products');
});

module.exports = router;
