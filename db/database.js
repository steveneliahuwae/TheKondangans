const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'kondangans.sqlite');
const isNewDb = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema on every boot — CREATE TABLE IF NOT EXISTS is safe to re-run
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Lightweight migrations — for databases created before a column existed.
// CREATE TABLE IF NOT EXISTS above only helps brand-new databases, so any
// column added after the first release needs to be patched in here too.
function ensureColumn(table, column, definition){
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((col) => col.name === column);
  if(!exists){
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}
ensureColumn('vendors', 'logo_url', 'TEXT');

// Online payments: orders now carry a payment status.
if(ensureColumn('orders', 'payment_status', "TEXT NOT NULL DEFAULT 'unpaid'")){
  // This database predates online payments. Orders that were already confirmed,
  // shipped or completed were handled offline, so count them as paid.
  db.exec("UPDATE orders SET payment_status = 'paid' WHERE status IN ('confirmed', 'shipped', 'completed')");
}

module.exports = { db, isNewDb };
