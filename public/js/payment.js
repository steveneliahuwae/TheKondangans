/* Payment page: countdown + "has it been paid yet?" check. The server decides; this only displays. */
(function(){
  var card = document.getElementById('payCard');
  if(!card || card.getAttribute('data-state') !== 'active') return;

  var orderId = card.getAttribute('data-order');
  var expires = Date.parse(card.getAttribute('data-expires'));
  var countdown = document.getElementById('countdown');
  var statusEl = document.getElementById('payStatus');
  var done = false;

  function pad(n){ return (n < 10 ? '0' : '') + n; }

  function tickCountdown(){
    if(done) return;
    var left = Math.max(0, Math.round((expires - Date.now()) / 1000));
    countdown.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
    if(left === 0) statusEl.textContent = 'The code has expired. Checking…';
  }

  function finish(message, cls, redirectTo){
    done = true;
    statusEl.className = 'pay-status ' + cls;
    statusEl.textContent = message;
    if(redirectTo) setTimeout(function(){ window.location.href = redirectTo; }, 1600);
  }

  function check(){
    if(done) return;
    fetch('/orders/' + orderId + '/payment-status', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(s){
        if(!s || done) return;
        if(s.paymentStatus === 'paid'){
          finish('Payment received. Thank you!', 'is-paid', '/orders/' + orderId);
        } else if(s.paymentStatus === 'refund_needed'){
          finish('Payment was received after the order closed. It will be refunded.', 'is-bad', '/orders/' + orderId);
        } else if(s.orderStatus === 'cancelled' || s.paymentStatus === 'expired'){
          finish('This QR code expired and the order was cancelled.', 'is-bad', '/orders/' + orderId);
        } else if(s.attemptStatus === 'failed'){
          finish('The payment was declined. Reload this page for a new QR code.', 'is-bad');
        }
      })
      .catch(function(){ /* network blip: just try again next time */ });
  }

  tickCountdown();
  setInterval(tickCountdown, 1000);
  setInterval(check, 3000);
})();
