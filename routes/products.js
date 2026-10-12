const express = require('express');
const { db } = require('../db/database');

const router = express.Router();

// Units sold for a product, across all buyers (cancelled orders don't count)
const SOLD_SQL = `COALESCE((
  SELECT SUM(oi.quantity) FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = products.id AND o.status != 'cancelled'
), 0)`;

// Everything a product card needs. Callers append more AND ... conditions.
const CARD_SELECT = `
  SELECT products.*,
         vendors.business_name, vendors.location, vendors.description AS vendor_description,
         vendors.logo_url AS vendor_logo,
         categories.name AS category_name,
         ${SOLD_SQL} AS sold
  FROM products
  JOIN vendors ON vendors.id = products.vendor_id
  LEFT JOIN categories ON categories.id = products.category_id
  WHERE products.is_active = 1`;

// Whitelist — the sort key from the URL is never put into SQL directly
const SORTS = {
  newest: 'products.created_at DESC',
  popular: 'sold DESC, products.created_at DESC',
  price_asc: 'products.price ASC',
  price_desc: 'products.price DESC'
};

// Query-string values can be arrays if someone repeats a parameter; only accept strings
const str = (v) => (typeof v === 'string' ? v.trim() : '');

router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  // Vendor showcase (the sliding banner under the hero).
  // Vendors are ranked by total units sold across ALL buyers (cancelled orders
  // don't count), then by how many products they list. Each gets up to 3 products.
  const rankedVendors = db.prepare(`
    SELECT vendors.id, vendors.business_name, vendors.location, vendors.logo_url,
           COALESCE(SUM(CASE WHEN orders.status != 'cancelled' THEN order_items.quantity END), 0) AS total_sold,
           (SELECT COUNT(*) FROM products p WHERE p.vendor_id = vendors.id AND p.is_active = 1) AS product_count
    FROM vendors
    LEFT JOIN order_items ON order_items.vendor_id = vendors.id
    LEFT JOIN orders ON orders.id = order_items.order_id
    GROUP BY vendors.id
    HAVING product_count > 0
    ORDER BY total_sold DESC, product_count DESC, vendors.created_at ASC
  `).all();

  const thumbsStmt = db.prepare(`
    SELECT products.id, products.name, products.image_url, products.category_id,
           categories.name AS category_name, ${SOLD_SQL} AS sold
    FROM products
    LEFT JOIN categories ON categories.id = products.category_id
    WHERE products.vendor_id = ? AND products.is_active = 1
    ORDER BY sold DESC, products.created_at DESC
    LIMIT 3
  `);

  const showcaseVendors = rankedVendors.map((v, i) => ({
    ...v,
    top: v.total_sold > 0 && i < 3,
    thumbs: thumbsStmt.all(v.id)
  }));

  // The slider loops by repeating its slides, so make sure there are enough
  // to fill a wide screen even when there are only a few vendors.
  const showcase = [];
  while(showcaseVendors.length > 0 && showcase.length < 10){
    showcase.push(...showcaseVendors);
  }

  const category = str(req.query.category);
  const vendor = str(req.query.vendor);
  const q = str(req.query.q);
  const sort = SORTS[str(req.query.sort)] ? str(req.query.sort) : 'newest';
  const minPrice = parseInt(str(req.query.minPrice), 10);
  const maxPrice = parseInt(str(req.query.maxPrice), 10);

  let sql = CARD_SELECT;
  const params = [];

  if(category){
    sql += ' AND products.category_id = ?';
    params.push(category);
  }
  if(vendor){
    sql += ' AND products.vendor_id = ?';
    params.push(vendor);
  }
  if(q){
    sql += ' AND (products.name LIKE ? OR products.description LIKE ? OR vendors.business_name LIKE ?)';
    const like = '%' + q + '%';
    params.push(like, like, like);
  }
  if(Number.isFinite(minPrice)){
    sql += ' AND products.price >= ?';
    params.push(minPrice);
  }
  if(Number.isFinite(maxPrice)){
    sql += ' AND products.price <= ?';
    params.push(maxPrice);
  }
  sql += ' ORDER BY ' + SORTS[sort];

  const products = db.prepare(sql).all(...params);
  const activeVendorRow = vendor
    ? db.prepare('SELECT id, business_name FROM vendors WHERE id = ?').get(vendor)
    : null;

  res.render('products/index', {
    title: 'The Kondangans — Wedding & Event Marketplace',
    products,
    categories,
    showcase,
    showcaseCount: showcaseVendors.length,
    activeCategory: category ? Number(category) : null,
    activeVendor: activeVendorRow ? activeVendorRow.id : null,
    activeVendorName: activeVendorRow ? activeVendorRow.business_name : null,
    query: q,
    sort,
    minPrice: Number.isFinite(minPrice) ? minPrice : '',
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : '',
    hasFilters: Boolean(category || vendor || q || Number.isFinite(minPrice) || Number.isFinite(maxPrice))
  });
});

router.get('/products/:id', (req, res) => {
  const product = db.prepare(CARD_SELECT + ' AND products.id = ?').get(req.params.id);

  if(!product){
    return res.status(404).render('error', { title: 'Not found', message: 'That product does not exist.' });
  }

  const moreFromVendor = db.prepare(
    CARD_SELECT + ' AND products.vendor_id = ? AND products.id != ? ORDER BY ' + SORTS.popular + ' LIMIT 4'
  ).all(product.vendor_id, product.id);

  res.render('products/show', { title: product.name, product, moreFromVendor });
});

module.exports = router;
