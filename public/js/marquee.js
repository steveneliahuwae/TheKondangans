/* Vendor slider.
 *
 * - Slides on its own, in a seamless loop (3 identical copies; we keep the scroll
 *   position inside the middle copy and silently jump by one copy when needed).
 * - You can scroll it yourself: trackpad / shift+wheel, touch swipe, mouse drag,
 *   the arrow buttons, or the arrow keys when it is focused.
 * - It STAYS STOPPED for as long as your cursor is anywhere over it, even while you
 *   move the cursor or scroll. Hover is read from the browser's own :hover state on
 *   every frame, so there is no timer that can wrongly restart it. It resumes shortly
 *   after the cursor leaves.
 * - On touch screens (no hover) it pauses while you touch/swipe and for a few seconds after.
 * - The pause button stops it until you press play again.
 * - Nothing moves automatically if the visitor prefers reduced motion.
 */
(function(){
  var wrap = document.getElementById('vendorSlider');
  if(!wrap) return;

  var marquee = wrap.querySelector('.marquee');
  var sets = marquee.querySelectorAll('.marquee-set');
  var prevBtn = wrap.querySelector('.marquee-btn.prev');
  var nextBtn = wrap.querySelector('.marquee-btn.next');
  var toggleBtn = document.getElementById('marqueeToggle');
  if(!marquee || sets.length < 3) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  var SPEED = Number(marquee.getAttribute('data-speed')) || 45;   // pixels per second
  var HOVER_RESUME_DELAY = 450;                                    // ms after the cursor leaves
  var TOUCH_HOLD = 3500;                                           // ms after the last touch

  var setW = 0;          // width of one copy of the slides
  var pos = 0;           // our own (fractional) scroll position
  var lastSet = 0;       // the scrollLeft we last wrote, to tell our moves from the user's
  var userPaused = false;
  var dragging = false, moved = false, startX = 0, startScroll = 0;
  var touchUntil = 0, lastHover = -1e9;
  var tween = null;

  function measure(){ setW = sets[0].getBoundingClientRect().width; }

  function apply(){
    marquee.scrollLeft = pos;
    lastSet = marquee.scrollLeft;
  }

  // Keep pos inside the middle copy [setW, 2*setW). Because all copies are identical,
  // jumping by exactly one copy is invisible.
  function normalise(){
    var shift = 0;
    while(pos >= 2 * setW){ pos -= setW; shift -= setW; }
    while(pos < setW){ pos += setW; shift += setW; }
    if(shift && tween){ tween.from += shift; tween.to += shift; }
    return shift;
  }

  // If the user moved it (drag, swipe, wheel, keyboard), adopt their position.
  marquee.addEventListener('scroll', function(){
    if(Math.abs(marquee.scrollLeft - lastSet) > 1.5){
      pos = marquee.scrollLeft;
      if(normalise()) apply(); else lastSet = marquee.scrollLeft;
      if(touchUntil > 0) touchUntil = performance.now() + TOUCH_HOLD;
    }
  }, { passive: true });

  function hoverActive(now){
    if(!canHover) return false;
    if(wrap.matches(':hover')){ lastHover = now; return true; }
    return (now - lastHover) < HOVER_RESUME_DELAY;      // brief grace period after leaving
  }
  function keyboardActive(){ return !!wrap.querySelector(':focus-visible'); }
  function touchActive(now){ return now < touchUntil; }

  // "Temporarily stopped because the visitor is interacting" (drives the little hint)
  function interacting(now){ return hoverActive(now) || keyboardActive() || dragging || touchActive(now); }
  function stopped(now){ return reduceMotion || userPaused || document.hidden || interacting(now); }

  var hintOn = false;
  function syncHint(now){
    var on = !reduceMotion && !userPaused && interacting(now);
    if(on !== hintOn){ hintOn = on; wrap.classList.toggle('is-paused', on); }
  }

  /* ---- animation loop ---- */
  var prev = performance.now();
  function tick(now){
    var dt = Math.min(now - prev, 100) / 1000;
    prev = now;

    if(tween){
      var t = Math.min(1, (now - tween.start) / tween.dur);
      pos = tween.from + (tween.to - tween.from) * (1 - Math.pow(1 - t, 3));
      normalise(); apply();
      if(t >= 1) tween = null;
    } else if(!stopped(now)){
      pos += SPEED * dt;
      normalise(); apply();
    }

    syncHint(now);
    requestAnimationFrame(tick);
  }

  /* ---- arrows + keyboard: glide by two slides ---- */
  function glide(direction){
    var slide = sets[0].querySelector('.vendor-slide');
    var step = slide ? slide.getBoundingClientRect().width + 18 : 320;
    tween = { from: pos, to: pos + direction * step * 2, start: performance.now(), dur: reduceMotion ? 1 : 420 };
  }
  if(prevBtn) prevBtn.addEventListener('click', function(){ glide(-1); });
  if(nextBtn) nextBtn.addEventListener('click', function(){ glide(1); });
  marquee.addEventListener('keydown', function(e){
    if(e.key === 'ArrowRight'){ e.preventDefault(); glide(1); }
    else if(e.key === 'ArrowLeft'){ e.preventDefault(); glide(-1); }
  });

  /* ---- mouse drag to scroll (touch uses the browser's own swipe) ---- */
  marquee.addEventListener('pointerdown', function(e){
    if(e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true; moved = false;
    startX = e.clientX; startScroll = marquee.scrollLeft;
    tween = null;
    marquee.classList.add('dragging');
  });
  window.addEventListener('pointermove', function(e){
    if(!dragging) return;
    var dx = e.clientX - startX;
    if(Math.abs(dx) > 4) moved = true;
    marquee.scrollLeft = startScroll - dx;
  });
  function endDrag(){
    if(!dragging) return;
    dragging = false;
    marquee.classList.remove('dragging');
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  // a drag must not count as a click on a vendor link
  marquee.addEventListener('click', function(e){
    if(moved){ e.preventDefault(); e.stopPropagation(); moved = false; }
  }, true);
  marquee.addEventListener('dragstart', function(e){ e.preventDefault(); });

  /* ---- touch: pause while touching, and for a few seconds afterwards ---- */
  function touched(){ touchUntil = performance.now() + TOUCH_HOLD; }
  marquee.addEventListener('touchstart', function(){ touchUntil = Infinity; }, { passive: true });
  marquee.addEventListener('touchend', touched, { passive: true });
  marquee.addEventListener('touchcancel', touched, { passive: true });

  /* ---- pause / play button ---- */
  if(toggleBtn){
    toggleBtn.addEventListener('click', function(){
      userPaused = !userPaused;
      toggleBtn.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', userPaused ? 'Play sliding' : 'Pause sliding');
    });
  }

  /* ---- resize: re-measure and keep roughly the same place ---- */
  window.addEventListener('resize', function(){
    var oldW = setW;
    measure();
    if(oldW > 0 && setW > 0){
      pos = setW + (((pos - oldW) % oldW) + oldW) % oldW * (setW / oldW);
      normalise(); apply();
    }
  });

  measure();
  if(setW > 0){
    pos = setW;               // start at the beginning of the middle copy
    apply();
    requestAnimationFrame(tick);
  }
})();
