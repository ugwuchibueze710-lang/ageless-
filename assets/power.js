// If the website is switched off (from BDT) while this page is open, reload within a minute so the
// visitor sees the "back soon" page instead of a store they can't order from.
(function () {
  function check() {
    fetch('/api/config', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) {
      if (c && c.offline && c.offline.on) location.reload();
    }).catch(function () {});
  }
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
})();
