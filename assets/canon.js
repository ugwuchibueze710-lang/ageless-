// Send visitors on www or the old pages.dev address to https://agelessevv.com (same page),
// so logins, carts and Square sign-in always happen on one address.
(function () {
  var h = location.hostname;
  if (h === 'www.agelessevv.com' || h === 'ageless-4dq.pages.dev') location.replace('https://agelessevv.com' + location.pathname + location.search + location.hash);
})();
