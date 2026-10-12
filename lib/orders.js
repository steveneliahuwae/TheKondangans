const { db } = require('../db/database');

// Cancel a pending order and put its stock back. Returns true if it was cancelled.
const cancelOrder = db.transaction((orderId) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if(!order || order.status !== 'pending') return false;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  items.forEach((item) => {
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
  });
  db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(order.id);
  return true;
});

module.exports = { cancelOrder };
