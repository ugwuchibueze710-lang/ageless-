// Reports crashes on this page to the site's IT log (forwarded to Black Daddy Tech). Customers see nothing.
(function () {
  var sent = 0, seen = {};
  function report(d) {
    if (sent >= 10) return;
    var k = (d.kind || '') + '|' + (d.message || '');
    if (seen[k]) return; seen[k] = 1; sent++;
    d.path = location.pathname + location.hash.split('?')[0];
    try {
      var body = JSON.stringify(d);
      if (navigator.sendBeacon) navigator.sendBeacon('/api/it/report', new Blob([body], { type: 'application/json' }));
      else fetch('/api/it/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) { /* never break the page */ }
  }
  window.addEventListener('error', function (e) {
    if (!e.message) return;
    report({ kind: 'browser_error', message: String(e.message).slice(0, 300), stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2500) : (e.filename || '') + ':' + (e.lineno || '') });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason || {};
    report({ kind: 'browser_error', message: String(r.message || r).slice(0, 300), stack: r.stack ? String(r.stack).slice(0, 2500) : '' });
  });
  window.AG_REPORT = report;
})();
