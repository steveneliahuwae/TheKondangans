function requireAuth(req, res, next){
  if(!req.session.user){
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles){
  return function(req, res, next){
    if(!req.session.user){
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    if(!roles.includes(req.session.user.role)){
      return res.status(403).render('error', {
        title: 'Access denied',
        message: "You don't have permission to view this page."
      });
    }
    next();
  };
}

// Makes the logged-in user (if any) available to every view as `currentUser`
function attachUser(req, res, next){
  res.locals.currentUser = req.session.user || null;
  res.locals.cartCount = (req.session.cart || []).reduce((sum, item) => sum + item.quantity, 0);
  next();
}

module.exports = { requireAuth, requireRole, attachUser };
