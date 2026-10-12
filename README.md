# The Kondangans — B2B Wedding & Event Marketplace

A working web app connecting wedding/event organizers (buyers) with local
UMKM vendors (sellers) — catering, decoration, souvenirs, and more.

## Run it

```
npm install
npm run seed    # demo vendors, products, photos and a demo buyer (safe to re-run any time)
npm start
```

Then open http://localhost:3000

## Demo accounts

All demo accounts use the password `password123`.

| Role   | Email                  | Notes                          |
|--------|-------------------------|---------------------------------|
| Buyer  | buyer@example.com       | Rina Wijaya                     |
| Vendor | vendor1@example.com     | Dapur Ibu Sari (catering)       |
| Vendor | vendor2@example.com     | Kondangan Decor Studio (decor)  |
| Vendor | vendor3@example.com     | Souvenir Kondangan Jaya         |

Or just register a new account from `/register` — you can sign up as
either a buyer or a vendor.

## What it does

**As a buyer:** browse products by category or search, view product
details and vendor info, add items to a cart, check out (creates a real
order and reduces stock), and track your order history.

**As a vendor:** a dashboard with your stats, full product management
(add / edit / hide / delete), a business profile you can edit (name,
description, location, and a logo/photo URL), and visibility into
orders that include your products, with the ability to advance order
status (pending → confirmed → shipped → completed).

Every vendor gets a placeholder logo automatically on signup (colored
initials), shown on their dashboard, their product pages, and next to
their name in the catalog — go to **Business Profile → Logo / photo
URL** to swap it for a real photo any time.

**Popular vendors:** right under the search banner, a sliding showcase shows
every vendor with a collage of their products. Vendors are ranked by total
units sold across *all* buyers (cancelled orders don't count), with a
"Top seller" badge on the leaders. It pauses when you hover over it, and
clicking a vendor filters the catalog to their products.

## The look

The UI follows a Tokopedia/Blibli-style marketplace layout: a top bar, a
sticky header with search, a category sub-menu, a hero banner with the
search bar over a food picture, category tiles, popular vendors, a
filterable/sortable product grid (price range, newest, best selling,
price), and a product page with a sticky order box.

**Hero picture:** the banner behind the search bar is
`public/images/hero-food.jpg`. Replace that file (keep the name) to change it.
A wide landscape photo works best, with the food toward the right because the
headline sits on the left. Larger photos look sharper: the current one is small.

**Product photos:** the demo products use keyword-matched photos from
LoremFlickr (a free service that serves Creative-Commons Flickr photos).
The number after `lock=` in each URL pins the photo, so it never changes by
itself. If a photo doesn't fit its product, change that number in `db/seed.js`
(then delete `db/kondangans.sqlite` and run the seed again) or, much easier,
open the vendor's **Edit product** page and paste a different image URL.
Treat these as stand-ins: real vendors should upload their own product photos.
While a photo loads, or if it can't load, the card shows a coloured tile with the
category icon, so nothing ever looks broken.

**Changing colours:** all colours live at the top of
`public/css/style.css` (the `:root` block). Change `--maroon`, `--gold`, `--saffron` and
`--leaf` to re-theme the whole site.

## Payments (QRIS)

After checkout the buyer lands on a payment page with a QRIS code, a countdown and a live
"waiting for payment" status. The order is held (stock reserved) while they pay. If the code
expires unpaid, the order is cancelled and the stock goes back. Sellers can only confirm and
ship an order **after it is paid**.

**Two modes (`PAYMENT_PROVIDER` in `.env`):**

- `mock` (default): a **fake sandbox** so you can try the whole flow on your computer with no
  account. The QR it shows is a test code that real banking apps cannot scan or pay. On the payment
  page, sandbox buttons let you pretend the provider reported "paid", "declined" or "expired".
  The app **refuses to start in production with this mode**.
- `midtrans`: real QRIS through [Midtrans](https://midtrans.com).

**Trying real QRIS with the Midtrans sandbox (free):**

1. Create a Midtrans account and open the **Sandbox** environment.
2. Copy your sandbox **Server Key** into `.env`:
   `PAYMENT_PROVIDER=midtrans` and `MIDTRANS_SERVER_KEY=SB-Mid-server-...`
3. Restart the app and place an order. The QR comes from Midtrans. Pay it with the Midtrans
   simulator (Midtrans documents a QRIS/GoPay simulator for the sandbox).
4. Optional, so Midtrans can push notifications to you: in the Midtrans dashboard set the
   *Payment Notification URL* to `https://YOUR-PUBLIC-ADDRESS/payments/webhook` (on your own computer
   a tunnel such as ngrok gives you one). **Without it everything still works**: the payment page
   asks Midtrans for the status itself every few seconds.

> I could only test the Midtrans connection against a **fake Midtrans server** I wrote, never against
> the real one, so please try your sandbox account before trusting it with real money.

**Going live** needs things only you can do: a Midtrans account activated for production (they
verify the business), then `MIDTRANS_IS_PRODUCTION=true` with your live key, HTTPS, and the settings
below.

### How payments are kept secure

- **The browser can never say "I paid".** An order only becomes paid through the gateway's
  notification, and only if its **signature** (SHA-512 with your secret key, compared in constant
  time) is valid, the **amount matches** what the server recorded, and, with Midtrans, the server
  **asks Midtrans directly** to confirm before accepting it.
- **Amounts always come from the server's own database**, never from the page.
- **Safe to repeat:** replayed notifications do nothing, and a paid payment can never be undone by
  a later "expired" or "declined" notice. Two clicks can't create two QR codes.
- **No lost money:** a payment that arrives after an order was cancelled is flagged
  *Refund pending* instead of being ignored.
- **Privacy of orders:** a buyer can only see and pay their own orders; sellers can only touch orders
  that contain their products (this was a gap before and is now fixed).
- **The secret key** stays on the server. **Cross-site form posts are blocked**, logins and payment
  endpoints are **rate limited**, a **fresh session starts at login** (stops session fixation), cookies
  are `httpOnly` + `SameSite`, and standard **security headers** are set (including a Content
  Security Policy).
- **Unsafe setups are refused at startup:** in production the app will not run with the fake sandbox,
  a weak `SESSION_SECRET`, or Midtrans without its key.

### Before you put it on the internet

- Serve it over **HTTPS** only, and set `NODE_ENV=production`.
- Set `SESSION_SECRET` to a long random value (32+ characters).
- Set `TRUST_PROXY=1` if it sits behind a proxy or load balancer.
- Use your **live** Midtrans key with `MIDTRANS_IS_PRODUCTION=true`, and set the notification URL.
- Back up `db/kondangans.sqlite`.

### What this does NOT cover

- **Refunds** are not automated. Orders flagged *Refund pending* must be refunded in the Midtrans dashboard.
- It has **not had a professional security audit**. It follows the standard protections above, but no
  software can honestly be called "fully secure".
- The Content Security Policy still allows inline scripts (the pages use a few). If a page ever looks
  broken because of it, set `DISABLE_CSP=true` to turn it off while you investigate.
- The "one QR at a time" protection assumes a single server process, which is how this app runs.
- No email verification or CAPTCHA on sign-up.

## Tests

```
npm test
```

Runs automated tests, including attack-style ones: forged and tampered payment notifications, replays,
other people's orders, cross-site posts, session fixation, brute-forced logins, the unsafe-config
guards, the Midtrans connection (against a fake Midtrans) and the vendor slider's behaviour.

## Stack

Node.js + Express + SQLite (via `better-sqlite3`) + EJS templates.
No separate database server to install — the whole app, including its
database, is just files in this folder.

## Project structure

```
app.js                  Express app entry point
lib/payments/           payment service + providers (mock sandbox, Midtrans)
lib/config.js           safety checks run at startup
middleware/security.js  headers, cross-site check, rate limits
routes/                 auth, products, cart, orders, payments, vendor
views/                  EJS templates (views/payments/qris.ejs is the QR page)
db/                     schema, seed, SQLite database
public/                 css, js (slider, payment page), images
test/                   automated tests
```
