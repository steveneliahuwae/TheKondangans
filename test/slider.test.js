// Simulated-browser tests for the vendor slider (hover/scroll/drag/touch/loop/pause behaviour).
const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'marquee.js'), 'utf8');

function makeEnv(opts){
  opts = Object.assign({ reduce: false, canHover: true }, opts || {});
  const W = 3000, V = 1200;
  let nowMs = 1000, rafCb = null;
  const state = { hover: false, focusVisible: false };
  const handlers = { marquee: {}, window: {}, prev: {}, next: {}, toggle: {} };
  const on = (bucket) => (type, fn) => { (handlers[bucket][type] = handlers[bucket][type] || []).push(fn); };
  const fire = (bucket, type, ev) => (handlers[bucket][type] || []).forEach(fn => fn(ev || {}));

  let sl = 0;
  const marquee = {
    get scrollLeft(){ return sl; },
    set scrollLeft(v){ sl = Math.max(0, Math.min(3 * W - V, Math.round(v))); },   // like a real browser: integer + clamped
    getAttribute: (n) => n === 'data-speed' ? '45' : null,
    addEventListener: on('marquee'),
    classList: { add(){}, remove(){} },
    querySelectorAll: (s) => s === '.marquee-set' ? sets : [],
  };
  const slide = { getBoundingClientRect: () => ({ width: 304 }) };
  const mkSet = (first) => ({ getBoundingClientRect: () => ({ width: W }), querySelector: () => first ? slide : null });
  const sets = [mkSet(true), mkSet(false), mkSet(false)];
  const prev = { addEventListener: on('prev') }, next = { addEventListener: on('next') };
  const toggle = { attrs: {}, addEventListener: on('toggle'), setAttribute(k, v){ this.attrs[k] = v; } };
  let paused = false;
  const wrap = {
    querySelector: (s) => s === '.marquee' ? marquee : s === '.marquee-btn.prev' ? prev : s === '.marquee-btn.next' ? next : s === ':focus-visible' ? (state.focusVisible ? {} : null) : null,
    matches: (s) => s === ':hover' ? state.hover : false,
    classList: { toggle(c, on){ paused = !!on; } },
  };
  const ctx = {
    document: { getElementById: (id) => id === 'vendorSlider' ? wrap : id === 'marqueeToggle' ? toggle : null, hidden: false },
    window: { matchMedia: (q) => ({ matches: q.includes('reduced-motion') ? opts.reduce : q.includes('hover') ? opts.canHover : false }),
              addEventListener: on('window') },
    performance: { now: () => nowMs },
    requestAnimationFrame: (cb) => { rafCb = cb; },
    Math, Number, Infinity,
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return {
    W, V, marquee, state, fire, toggle, isPaused: () => paused,
    frame(ms){ nowMs += ms; const cb = rafCb; rafCb = null; if(cb) cb(nowMs); },
    run(totalMs, step){ step = step || 16; for(let t = 0; t < totalMs; t += step) this.frame(step); },
    setScroll(v){ sl = v; },
    now: () => nowMs,
  };
}

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if(!cond) fails++; };

// 1. Auto-slides at ~45px/s and starts in the middle copy
let e = makeEnv();
ok(e.marquee.scrollLeft === e.W, 'starts at the beginning of the middle copy (' + e.marquee.scrollLeft + ')');
let s0 = e.marquee.scrollLeft; e.run(2000);
let moved = e.marquee.scrollLeft - s0;
ok(moved > 80 && moved < 100, 'auto-slides ~45px/s: moved ' + moved + 'px in 2s');

// 2. Seamless loop: runs for 3 minutes and never leaves the middle copy
let minP = 1e9, maxP = -1; e = makeEnv();
for(let i = 0; i < 11250; i++){ e.frame(16); const v = e.marquee.scrollLeft; minP = Math.min(minP, v); maxP = Math.max(maxP, v); }
ok(minP >= e.W - 1 && maxP < 2 * e.W + 1, 'loops forever inside the middle copy (range ' + minP + '..' + maxP + ') over 3 minutes');

// 3. HOVER stops it, and it STAYS stopped while the cursor moves / the user scrolls
e = makeEnv(); e.run(500);
e.state.hover = true; e.run(100);
let frozen = e.marquee.scrollLeft;
e.run(5000);                                    // cursor sits (or moves) over it for 5s
ok(e.marquee.scrollLeft === frozen, 'hovering stops it and it stays stopped for 5s (' + frozen + ' -> ' + e.marquee.scrollLeft + ')');
ok(e.isPaused(), 'the "Paused" hint is shown while hovering');
// user scrolls sideways while still hovering (browser fires scroll events)
e.setScroll(frozen + 400); e.fire('marquee', 'scroll'); e.run(50);
let afterScroll = e.marquee.scrollLeft;
e.run(3000);                                    // keeps hovering after scrolling
ok(afterScroll === frozen + 400 && e.marquee.scrollLeft === afterScroll, 'scrolling while hovering keeps it stopped, at the spot the user scrolled to (' + afterScroll + ')');
// cursor "moves" repeatedly over it
for(let i = 0; i < 40; i++){ e.fire('marquee', 'pointermove'); e.run(100); }
ok(e.marquee.scrollLeft === afterScroll, 'moving the cursor around over it does NOT restart it');

// 4. Leaving: resumes only after the grace period, from where the user left it
e.state.hover = false; e.run(200);
ok(e.marquee.scrollLeft === afterScroll, 'does not restart instantly when the cursor leaves (grace period)');
e.run(1500);
ok(e.marquee.scrollLeft > afterScroll, 'resumes after the cursor has left, continuing from where the user left it (' + afterScroll + ' -> ' + e.marquee.scrollLeft + ')');
ok(!e.isPaused(), 'hint hidden again once running');

// 5. User scroll while NOT hovering (touch-less keyboard/wheel edge) is adopted, not fought
e = makeEnv(); e.run(300);
e.setScroll(e.W + 1000); e.fire('marquee', 'scroll'); e.run(16);
ok(Math.abs(e.marquee.scrollLeft - (e.W + 1000)) < 12, 'adopts a position the user scrolled to instead of snapping back (' + e.marquee.scrollLeft + ')');

// 6. Seamless wrap in both directions when the user scrolls near the ends
e = makeEnv(); e.run(100);
e.setScroll(10); e.fire('marquee', 'scroll');
ok(e.marquee.scrollLeft >= e.W && e.marquee.scrollLeft < 2 * e.W, 'scrolling far left wraps into the middle copy (' + e.marquee.scrollLeft + ')');
e.setScroll(2 * e.W + 700); e.fire('marquee', 'scroll');
ok(e.marquee.scrollLeft >= e.W && e.marquee.scrollLeft < 2 * e.W, 'scrolling far right wraps into the middle copy (' + e.marquee.scrollLeft + ')');

// 7. Pause button: stops for good (even with no hover) until pressed again
e = makeEnv(); e.run(200);
e.fire('toggle', 'click');
let pAt = e.marquee.scrollLeft; e.run(4000);
ok(e.marquee.scrollLeft === pAt && e.toggle.attrs['aria-pressed'] === 'true', 'pause button stops it permanently (aria-pressed=true)');
e.fire('toggle', 'click'); e.run(1000);
ok(e.marquee.scrollLeft > pAt && e.toggle.attrs['aria-label'] === 'Pause sliding', 'pressing again resumes it');

// 8. Arrow buttons glide by two slides, and loop seamlessly
e = makeEnv(); e.state.hover = true; e.run(200);
let a0 = e.marquee.scrollLeft; e.fire('next', 'click'); e.run(700);
ok(Math.abs((e.marquee.scrollLeft - a0) - 304 * 2 - 36) < 20, 'next arrow glides ~2 slides (' + (e.marquee.scrollLeft - a0) + 'px)');
a0 = e.marquee.scrollLeft; e.fire('prev', 'click'); e.run(700);
ok(Math.abs((a0 - e.marquee.scrollLeft) - 304 * 2 - 36) < 20, 'prev arrow glides back ~2 slides');
// arrow at the very edge of the loop still works (wrap during the glide)
e = makeEnv(); e.state.hover = true; e.run(50); e.setScroll(2 * e.W - 100); e.fire('marquee', 'scroll'); e.run(16);
e.fire('next', 'click'); e.run(700);
ok(e.marquee.scrollLeft >= e.W && e.marquee.scrollLeft < 2 * e.W, 'glide across the loop seam stays in range (' + e.marquee.scrollLeft + ')');

// 9. Keyboard focus pauses it
e = makeEnv(); e.run(200); e.state.focusVisible = true; e.run(50);
let k0 = e.marquee.scrollLeft; e.run(3000);
ok(e.marquee.scrollLeft === k0, 'keyboard focus stops it');

// 10. Mouse drag, and a drag does not count as a click
e = makeEnv(); e.run(200);
const dragStart = e.marquee.scrollLeft;
e.fire('marquee', 'pointerdown', { pointerType: 'mouse', button: 0, clientX: 500 });
e.fire('window', 'pointermove', { clientX: 380 });
e.run(500);
ok(e.marquee.scrollLeft === dragStart + 120, 'dragging left by 120px scrolls the content by 120px (' + (e.marquee.scrollLeft - dragStart) + ')');
e.fire('marquee', 'scroll'); e.fire('window', 'pointerup'); 
let prevented = false;
e.fire('marquee', 'click', { preventDefault(){ prevented = true; }, stopPropagation(){} });
ok(prevented, 'a drag is not treated as a click on a vendor link');
prevented = false;
e.fire('marquee', 'click', { preventDefault(){ prevented = true; }, stopPropagation(){} });
ok(!prevented, 'a real click afterwards still works');

// 11. Touch screens: pauses while touching and ~3.5s after, then resumes
e = makeEnv({ canHover: false }); e.run(500);
e.fire('marquee', 'touchstart'); let t0 = e.marquee.scrollLeft; e.run(3000);
ok(e.marquee.scrollLeft === t0, 'touching holds it still');
e.fire('marquee', 'touchend'); e.run(2000);
ok(e.marquee.scrollLeft === t0, 'still held 2s after the finger lifts');
e.run(2500);
ok(e.marquee.scrollLeft > t0, 'resumes about 3.5s after the last touch');

// 12. Reduced motion: never moves on its own, but manual scrolling still works
e = makeEnv({ reduce: true }); let r0 = e.marquee.scrollLeft; e.run(5000);
ok(e.marquee.scrollLeft === r0, 'prefers-reduced-motion: no automatic movement');
e.setScroll(r0 + 500); e.fire('marquee', 'scroll'); e.run(100);
ok(e.marquee.scrollLeft === r0 + 500, 'manual scrolling still works with reduced motion');

console.log(fails === 0 ? '\nALL SLIDER TESTS PASSED' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
