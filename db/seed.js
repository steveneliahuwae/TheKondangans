// Demo data. Safe to run as many times as you like: it only ADDS what is
// missing (new vendors, products) and fills in missing photos/logos.
// It never overwrites a photo or logo a vendor has set themselves,
// and never deletes anything.

const bcrypt = require('bcryptjs');
const { db } = require('./database');

// Product photos come from LoremFlickr: a free service that returns a
// Creative-Commons Flickr photo matching the keywords. The number after
// "lock=" pins the photo, so a product keeps the same picture. If a photo
// doesn't suit a product, change that number to get a different one,
// or replace it with your own image URL from the vendor's "Edit product" page.
const photo = (keywords, lock) => `https://loremflickr.com/640/640/${keywords}?lock=${lock}`;

const logo = (name, bg, fg) => {
  const initials = encodeURIComponent(name.split(' ').slice(0, 2).join(' '));
  return `https://ui-avatars.com/api/?name=${initials}&background=${bg}&color=${fg}&size=160&bold=true`;
};

const CATEGORIES = ['Catering & Snacks', 'Decoration', 'Souvenirs', 'Printing & Invitations', 'Photography'];

const BUYER = { name: 'Rina Wijaya', email: 'buyer@example.com' };

const VENDORS = [
  {
    owner: 'Budi Santoso', email: 'vendor1@example.com',
    business: 'Dapur Ibu Sari', location: 'Bekasi, Jawa Barat',
    description: 'Home-based catering specializing in traditional Indonesian dishes for weddings and events.',
    logo: logo('Dapur Ibu Sari', '7A2E3A', 'FFFFFF'),
    products: [
      { name: 'Nasi Kotak Paket Hemat', category: 'Catering & Snacks', price: 25000, stock: 500, image: photo('nasi,rice', 11),
        description: 'Boxed rice meal with chicken, vegetables, and crackers. Minimum order 50 boxes.' },
      { name: 'Prasmanan Wedding Package', category: 'Catering & Snacks', price: 15000000, stock: 10, image: photo('buffet,catering', 12),
        description: 'Full buffet package for up to 200 guests, 5 main dishes.' },
      { name: 'Snack Box Arisan', category: 'Catering & Snacks', price: 18000, stock: 300, image: photo('pastry,snacks', 13),
        description: 'Assorted snack box, minimum order 20 boxes.' }
    ]
  },
  {
    owner: 'Sinta Dewi', email: 'vendor2@example.com',
    business: 'Kondangan Decor Studio', location: 'Cikarang, Jawa Barat',
    description: 'Wedding and event decoration — backdrops, floral arrangements, and full venue styling.',
    logo: logo('Kondangan Decor Studio', 'C9A24B', '2B2320'),
    products: [
      { name: 'Backdrop Pelaminan Minimalis', category: 'Decoration', price: 3500000, stock: 5, image: photo('wedding,decoration', 21),
        description: 'Minimalist wedding backdrop with fresh flowers, setup included.' },
      { name: 'Rangkaian Bunga Meja Tamu', category: 'Decoration', price: 150000, stock: 50, image: photo('wedding,flowers', 22),
        description: 'Table centerpiece flower arrangement, per unit.' }
    ]
  },
  {
    owner: 'Andi Prasetyo', email: 'vendor3@example.com',
    business: 'Souvenir Kondangan Jaya', location: 'Bekasi, Jawa Barat',
    description: 'Custom wedding and event souvenirs — mugs, keychains, and tote bags with personalized printing.',
    logo: logo('Souvenir Kondangan Jaya', '5F2029', 'FFFFFF'),
    products: [
      { name: 'Mug Custom Nama Pengantin', category: 'Souvenirs', price: 22000, stock: 400, image: photo('mug,cup', 31),
        description: 'Personalized ceramic mug, minimum order 50 pcs.' },
      { name: 'Tote Bag Souvenir', category: 'Souvenirs', price: 28000, stock: 250, image: photo('tote,bag', 32),
        description: 'Canvas tote bag with custom print, minimum order 50 pcs.' }
    ]
  },
  {
    owner: 'Dewi Lestari', email: 'vendor4@example.com',
    business: 'Cetak Undangan Kita', location: 'Jakarta Timur, DKI Jakarta',
    description: 'Custom wedding invitations, thank-you cards and stationery, printed fast for events of any size.',
    logo: logo('Cetak Undangan Kita', '2F7A4B', 'FFFFFF'),
    products: [
      { name: 'Undangan Pernikahan Custom', category: 'Printing & Invitations', price: 4500, stock: 2000, image: photo('wedding,invitation', 41),
        description: 'Full-colour custom wedding invitation, price per piece, minimum order 100 pcs.' },
      { name: 'Paket Kartu Ucapan & Amplop', category: 'Printing & Invitations', price: 3000, stock: 3000, image: photo('stationery,envelope', 42),
        description: 'Thank-you card and envelope set, price per set, minimum order 100 sets.' }
    ]
  },
  {
    owner: 'Rizky Pratama', email: 'vendor5@example.com',
    business: 'Lensa Momen Studio', location: 'Tambun, Bekasi',
    description: 'Wedding and event photography with fast online delivery of edited photos.',
    logo: logo('Lensa Momen Studio', 'D2591F', 'FFFFFF'),
    products: [
      { name: 'Paket Foto Pernikahan Full Day', category: 'Photography', price: 6500000, stock: 8, image: photo('wedding,photographer', 51),
        description: 'Full-day wedding photography with two photographers, edited photos delivered online.' },
      { name: 'Sesi Foto Prewedding', category: 'Photography', price: 2800000, stock: 12, image: photo('photographer,camera', 52),
        description: 'Half-day outdoor pre-wedding shoot, 40 edited photos included.' }
    ]
  },
  {
    owner: 'Maya Anggraini', email: 'vendor6@example.com',
    business: 'Manis Legit Bakery', location: 'Bekasi Selatan, Jawa Barat',
    description: 'Custom wedding cakes, cupcakes and dessert tables baked fresh to order.',
    logo: logo('Manis Legit Bakery', 'A8485A', 'FFFFFF'),
    products: [
      { name: 'Kue Pengantin 3 Tingkat', category: 'Catering & Snacks', price: 1850000, stock: 6, image: photo('wedding,cake', 61),
        description: 'Three-tier wedding cake in custom flavours, serves around 80 guests.' },
      { name: 'Cupcake & Dessert Table', category: 'Catering & Snacks', price: 1200000, stock: 10, image: photo('cupcakes,dessert', 62),
        description: 'Assorted cupcakes and desserts for 100 guests, delivered and set up.' }
    ]
  }
];

function seed(options){
  const quiet = options && options.quiet;
  const stats = { vendors: 0, products: 0, photos: 0 };
  const passwordHash = bcrypt.hashSync('password123', 10);

  const run = db.transaction(() => {
    CATEGORIES.forEach((name) => db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(name));
    const categoryId = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;

    function ensureUser(name, email, role){
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if(existing) return { id: existing.id, created: false };
      const r = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(name, email, passwordHash, role);
      return { id: Number(r.lastInsertRowid), created: true };
    }

    ensureUser(BUYER.name, BUYER.email, 'buyer');

    VENDORS.forEach((v) => {
      const user = ensureUser(v.owner, v.email, 'vendor');
      let vendor = db.prepare('SELECT * FROM vendors WHERE user_id = ?').get(user.id);

      if(!vendor){
        const r = db.prepare('INSERT INTO vendors (user_id, business_name, description, location, logo_url) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, v.business, v.description, v.location, v.logo);
        vendor = { id: Number(r.lastInsertRowid) };
        stats.vendors++;
      } else if(!vendor.logo_url){
        db.prepare('UPDATE vendors SET logo_url = ? WHERE id = ?').run(v.logo, vendor.id);
      }

      v.products.forEach((p) => {
        const existing = db.prepare('SELECT id, image_url FROM products WHERE vendor_id = ? AND name = ?').get(vendor.id, p.name);
        if(!existing){
          db.prepare(`INSERT INTO products (vendor_id, category_id, name, description, price, stock, image_url)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(vendor.id, categoryId(p.category), p.name, p.description, p.price, p.stock, p.image);
          stats.products++;
        } else if(!existing.image_url){
          db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(p.image, existing.id);
          stats.photos++;
        }
      });
    });
  });

  run();

  if(quiet) return stats;
  console.log(`Seed complete: ${stats.vendors} vendor(s) added, ${stats.products} product(s) added, ${stats.photos} product photo(s) filled in.`);
  console.log('');
  console.log('Demo accounts (all use password: password123):');
  console.log('  Buyer  -> ' + BUYER.email);
  VENDORS.forEach((v) => console.log(`  Vendor -> ${v.email} (${v.business})`));
  return stats;
}

module.exports = { seed };
if(require.main === module) seed();
