// Ageless admin — single-page app (no framework). All user data is escaped before rendering.
(function () {
  'use strict';
  var app = document.getElementById('app'), me = null, PL = {};
  function can(p) { return !!(me && me.perms && me.perms.indexOf(p) >= 0); }
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(c) { return '$' + (Number(c || 0) / 100).toFixed(2); }
  function dollars(c) { return c == null || c === '' ? '' : (Number(c) / 100).toFixed(2); }
  function when(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  var STATUS = { pending_payment: 'Pending payment', paid: 'Paid', processing: 'Processing', awaiting_approval: 'Awaiting customer approval', ready_for_pickup: 'Ready for pickup',
    shipped: 'Shipped', completed: 'Completed', canceled: 'Canceled', refunded: 'Refunded', payment_failed: 'Payment failed', expired: 'Expired' };
  function statusBadge(s) { var cls = { paid: 'b-ok', processing: 'b-warn', awaiting_approval: 'b-warn', ready_for_pickup: 'b-ok', shipped: 'b-ok', completed: '', canceled: 'b-bad', refunded: 'b-bad', payment_failed: 'b-bad', pending_payment: '' }[s] || ''; return '<span class="badge ' + cls + '">' + esc(STATUS[s] || s) + '</span>'; }
  function fulBadge(f) { return f === 'pickup' ? '<span class="badge b-pickup">In-store pickup</span>' : '<span class="badge b-shipping">Home delivery</span>'; }

  var toastT;
  function toast(msg, err) { var t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 3200); }

  function api(path, opts) {
    opts = opts || {};
    var h = { 'X-Ageless-Admin': '1' };
    if (opts.body && !(opts.body instanceof FormData)) { h['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
    return fetch('/api' + path, { method: opts.method || 'GET', headers: h, body: opts.body, credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && ['/admin/login', '/admin/setup', '/admin/me'].indexOf(path) < 0) { me = null; go('#/login'); throw new Error(j.error || 'Please log in.'); }
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong.'); e.data = j; throw e; }
        return j;
      });
    });
  }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = 'Working…'; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }
  function act(btn, p, ok) { busy(btn, true); return p.then(function (r) { busy(btn, false); if (ok) toast(ok); return r; }).catch(function (e) { busy(btn, false); toast(e.message, true); throw e; }); }
  function jsonList(v) { try { var a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  // Before saving: run the contradiction check (instant rules + AI review when available). If it finds problems, show them with fixes.
  function checkedSave(btn, kind, data, save, extra) {
    busy(btn, true);
    return api('/admin/check', { method: 'POST', body: Object.assign({ kind: kind, data: data }, extra || {}) }).catch(function () { return { issues: [] }; }).then(function (r) {
      busy(btn, false);
      if (!r.issues || !r.issues.length) return act(btn, save());
      return new Promise(function (resolve) {
        var bad = r.issues.some(function (i) { return i.level === 'error'; });
        var m = modal('<h2>' + (bad ? 'Hold on — this setup contradicts itself' : 'Before you save') + '</h2>' +
          '<ul class="issues">' + r.issues.map(function (i, n) { return '<li class="' + esc(i.level) + '"><b>' + (i.level === 'error' ? '⛔ ' : '⚠️ ') + esc(i.message) + '</b>' + (i.fix ? '<br><span class="muted small">Suggestion: ' + esc(i.fix) + '</span>' : '') +
            (i.patch ? '<br><button type="button" class="btn small" data-fix="' + n + '">Apply this fix</button>' : '') + '</li>'; }).join('') + '</ul>' +
          (r.ai ? '<p class="muted small">Checked by the assistant' + (r.aiNote ? ': ' + esc(r.aiNote) : '') + '</p>' : '') +
          '<div class="row"><button class="btn" data-close>Go back & edit</button><button class="btn ' + (bad ? 'danger' : 'primary') + '" id="anyway">Save anyway</button></div>');
        m.addEventListener('click', function (e) {
          var fx = e.target.closest('[data-fix]');
          if (fx) { var p = r.issues[+fx.dataset.fix].patch; Object.keys(p).forEach(function (k) { data[k] = p[k]; }); fx.textContent = 'Fix applied ✓'; fx.disabled = true; }
          if (e.target.closest('[data-close]')) resolve(null);
        });
        $('#anyway', m).onclick = function () { m.remove(); act(btn, save()).then(resolve, function () { resolve(null); }); };
      });
    });
  }
  function modal(html) {
    var m = document.createElement('div'); m.className = 'modal'; m.innerHTML = '<div class="sheet">' + html + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
    document.body.appendChild(m); return m;
  }

  // ---------------- boot / routing ----------------
  function setNav(name) {
    $$('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === name); });
    $$('[data-perm]').forEach(function (a) { a.hidden = !can(a.dataset.perm); });
  }
  function shell(on) { $('#top').hidden = !on; $('#tabbar').hidden = !on; $('#aiFab').hidden = !(on && can('ai')); if (!on) $('#aiPanel').hidden = true; }

  // ---------------- AI assistant ----------------
  var AI = { msgs: [], status: null };
  try { AI.msgs = JSON.parse(sessionStorage.getItem('ag-ai') || '[]'); } catch (e) { AI.msgs = []; }
  function aiSave() { try { sessionStorage.setItem('ag-ai', JSON.stringify(AI.msgs.slice(-30))); } catch (e) {} }
  function aiRender() {
    var log = $('#aiLog');
    log.innerHTML = (AI.msgs.length ? '' : '<div class="ai-msg a">Hi ' + esc(me ? me.name.split(' ')[0] : '') + '! I can look things up and make changes for you — sales, prices, quantities, orders, settings, the website banner, staff. I always show you exactly what I\'ll change and wait for you to tap Confirm.\n\nTry: “What sold today?”, “Put keychains 50% off until Sunday”, “Which items are out of stock?”</div>') +
      AI.msgs.map(function (m, i) {
        if (m.role === 'sys') return '<div class="ai-msg sys">' + esc(m.content) + '</div>';
        var h = '<div class="ai-msg ' + (m.role === 'user' ? 'u' : 'a') + '">' + esc(m.content) + '</div>';
        if (m.proposals && m.proposals.length) {
          var risky = m.proposals.some(function (p) { return p.risk; });
          h += '<div class="ai-props"><h4>' + (m.done ? (m.done === 'applied' ? '✓ Applied' : 'Not applied') : 'Ready to change') + '</h4><ol>' + m.proposals.map(function (p) { return '<li>' + esc(p.summary) + (p.risk ? '<span class="risk">⚠ ' + esc(p.risk) + '</span>' : '') + (p.result ? '<span class="' + (p.result.ok ? 'muted' : 'risk') + ' small"> — ' + (p.result.ok ? 'done' : esc(p.result.error)) + '</span>' : '') + '</li>'; }).join('') + '</ol>' +
            (m.done ? '' : (risky ? '<label class="check"><input type="checkbox" data-sure="' + i + '"> Yes, I\'m sure — I understand the warning above</label>' : '') +
              '<div class="row"><button class="btn primary small" data-apply="' + i + '">Confirm</button><button class="btn small" data-skip="' + i + '">Don\'t do it</button></div>') + '</div>';
        }
        return h;
      }).join('');
    log.scrollTop = log.scrollHeight;
  }
  function aiOpen(v) {
    $('#aiPanel').hidden = !v;
    if (!v) return;
    aiRender(); $('#aiQ').focus();
    if (!AI.status) api('/admin/ai/status').then(function (r) { AI.status = r; $('#aiSub').textContent = r.configured ? '' : 'not set up yet'; }).catch(function () {});
  }
  function aiAsk(q) {
    AI.msgs.push({ role: 'user', content: q }); aiSave(); aiRender();
    var t = document.createElement('div'); t.className = 'ai-typing'; t.textContent = 'Thinking…'; $('#aiLog').appendChild(t); $('#aiLog').scrollTop = 1e9;
    $('#aiSend').disabled = true;
    var hist = AI.msgs.filter(function (m) { return m.role === 'user' || m.role === 'assistant' || m.role === 'sys'; }).map(function (m) { return { role: m.role === 'user' ? 'user' : 'assistant', content: m.role === 'sys' ? '[note] ' + m.content : m.content }; });
    api('/admin/ai/chat', { method: 'POST', body: { messages: hist } }).then(function (r) {
      AI.msgs.push({ role: 'assistant', content: r.reply || '', proposals: r.proposals || [] });
    }).catch(function (e) { AI.msgs.push({ role: 'sys', content: 'Assistant error: ' + e.message }); })
      .then(function () { $('#aiSend').disabled = false; aiSave(); aiRender(); });
  }
  function aiInit() {
    $('#aiFab').onclick = function () { aiOpen(true); };
    $('#aiX').onclick = function () { aiOpen(false); };
    $('#aiClear').onclick = function () { AI.msgs = []; aiSave(); aiRender(); };
    $('#aiForm').onsubmit = function (e) { e.preventDefault(); var q = $('#aiQ').value.trim(); if (!q) return; $('#aiQ').value = ''; aiAsk(q); };
    $('#aiQ').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aiForm').requestSubmit(); } };
    $('#aiLog').addEventListener('click', function (e) {
      var ap = e.target.closest('[data-apply]'), sk = e.target.closest('[data-skip]');
      if (sk) { var m0 = AI.msgs[+sk.dataset.skip]; m0.done = 'skipped'; AI.msgs.push({ role: 'sys', content: 'You chose not to apply those changes.' }); aiSave(); aiRender(); return; }
      if (!ap) return;
      var i = +ap.dataset.apply, m = AI.msgs[i], sure = $('[data-sure="' + i + '"]');
      if (m.proposals.some(function (p) { return p.risk; }) && !(sure && sure.checked)) { toast('Tick "Yes, I\'m sure" first — this includes a risky change.', true); return; }
      act(ap, api('/admin/ai/apply', { method: 'POST', body: { sure: !!(sure && sure.checked), actions: m.proposals.map(function (p) { return { method: p.method, path: p.path, body: p.body }; }) } })).then(function (r) {
        r.results.forEach(function (x, n) { m.proposals[n].result = x; });
        var ok = r.results.length === m.proposals.length && r.results.every(function (x) { return x.ok; });
        m.done = ok ? 'applied' : 'partial';
        AI.msgs.push({ role: 'sys', content: ok ? 'Applied: ' + m.proposals.map(function (p) { return p.summary; }).join('; ') : 'Some changes failed: ' + r.results.filter(function (x) { return !x.ok; }).map(function (x) { return x.error; }).join('; ') });
        aiSave(); aiRender(); route();
      });
    });
  }
  function route() {
    $$('.modal').forEach(function (m) { m.remove(); });
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('?')[0].split('/').filter(Boolean);
    if (parts[0] === 'join') { shell(false); return viewJoin(); }
    if (!me) {
      return api('/admin/me').then(function (r) { me = r.staff; PL = r.permLabels || {}; $('#whoName').textContent = me.name + ' · ' + (me.role === 'owner' ? 'owner' : 'employee'); route(); })
        .catch(function () { shell(false); api('/admin/bootstrap').then(function (b) { b.needsSetup ? viewSetup(b) : viewLogin(); }); });
    }
    shell(true);
    var v = parts[0] || 'home';
    setNav(v === 'more' ? 'more' : v);
    window.scrollTo(0, 0);
    app.innerHTML = '<p class="muted center pad">Loading…</p>';
    var views = { home: viewHome, orders: parts[1] ? function () { viewOrder(parts[1]); } : viewOrders, products: parts[1] ? function () { viewProduct(parts[1]); } : viewProducts,
      stock: viewStock, categories: viewCategories, settings: viewSettings, staff: parts[1] ? function () { viewActivity(parts[1]); } : viewStaff, activity: function () { viewActivity(null); }, outbox: viewOutbox, more: viewMore, log: viewLog };
    var need = { orders: 'orders', products: 'products', stock: 'stock', categories: 'products', settings: 'settings', staff: 'staff', activity: 'staff', outbox: 'orders', log: 'staff' }[v];
    if (need && !can(need)) { app.innerHTML = '<p class="alert">You don\'t have access to this page. Ask the owner if you need it.</p>'; return; }
    (views[v] || viewHome)();
  }
  aiInit();
  window.addEventListener('hashchange', route);
  $('#logoutBtn').addEventListener('click', function () { api('/admin/logout', { method: 'POST' }).finally(function () { me = null; go('#/login'); }); });

  // ---------------- login / setup ----------------
  function viewLogin() {
    app.innerHTML = '<div class="login card"><img class="logo" src="/assets/img/logo-sm.png" alt="Ageless"><h1 class="center">Admin login</h1>' +
      '<form class="form" id="f"><label>Email<input name="email" type="email" autocomplete="username" required></label>' +
      '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>' +
      '<button class="btn primary big">Log in</button></form></div>';
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault(); var f = e.target;
      act(f.querySelector('button'), api('/admin/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } })).then(function (r) {
        me = null; go('#/');
      });
    });
  }
  function viewSetup(b) {
    app.innerHTML = '<div class="login card"><img class="logo" src="/assets/img/logo-sm.png" alt="Ageless"><h1 class="center">Create the owner account</h1>' +
      (b.setupKeyConfigured ? '' : '<p class="alert bad">The server has no setup key yet (ADMIN_SETUP_KEY). Ask your developer to add it.</p>') +
      '<p class="muted small">This only works once. Use the setup key your developer gave you.</p>' +
      '<form class="form" id="f"><label>Setup key<input name="setupKey" required autocomplete="off"></label>' +
      '<label>Your name<input name="name" required></label><label>Email<input name="email" type="email" required autocomplete="username"></label>' +
      '<label>Password (10+ characters)<input name="password" type="password" minlength="10" required autocomplete="new-password"></label>' +
      '<button class="btn primary big">Create account</button></form></div>';
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault(); var f = e.target;
      act(f.querySelector('button'), api('/admin/setup', { method: 'POST', body: { setupKey: f.setupKey.value.trim(), name: f.name.value, email: f.email.value, password: f.password.value } }), 'Welcome!').then(function () { go('#/'); });
    });
  }

  // ---------------- dashboard ----------------
  function viewHome() {
    api('/admin/dashboard').then(function (d) {
      var R = d.revenue;
      function stat(label, x) { return '<div class="stat"><span>' + label + '</span><b>' + money(x.cents) + '</b><span>' + x.n + ' order' + (x.n === 1 ? '' : 's') + '</span></div>'; }
      var open = d.byStatus.filter(function (s) { return ['paid', 'processing', 'awaiting_approval', 'ready_for_pickup'].indexOf(s.status) >= 0; }).reduce(function (t, s) { return t + s.n; }, 0);
      var check = [
        [d.square.connected, 'Square connected' + (d.square.connected ? ' (' + esc(d.square.location || '') + ', ' + d.square.env + ')' : (me.role === 'owner' ? ' — <a href="#/settings">connect in Settings</a>' : ''))],
        [d.noQuantity === 0, d.noQuantity ? d.noQuantity + ' product(s) have no quantity yet — <a href="#/stock">set quantities</a> (they cannot be bought until you do)' : 'Every product has a quantity'],
        [d.email.configured, d.email.configured ? 'Email sending is on' : 'Email sending is not set up yet — customer emails wait in <a href="#/outbox">Emails</a> (' + d.email.unsent + ' not sent)'],
      ];
      app.innerHTML = '<h1>Welcome, ' + esc(me.name.split(' ')[0]) + '</h1>' +
        (d.alerts.length ? '<div class="card"><h2>Needs attention</h2>' + d.alerts.map(function (a) { return '<div class="alert bad row between"><span>' + esc(a.message) + (a.order_id ? ' <a href="#/orders/' + a.order_id + '">Open order</a>' : '') + '</span><button class="btn small" data-res="' + a.id + '">Done</button></div>'; }).join('') + '</div>' : '') +
        (R ? '<div class="grid g4">' + stat('Today', R.today) + stat('Last 7 days', R.week) + stat('Last 30 days', R.month) + stat('All time', R.all) + '</div>' +
        '<p class="muted small" style="margin:6px 0 14px">Sales after refunds, from paid website orders.</p>' : '') +
        '<div class="grid g2"><div class="card"><div class="row between"><h2>Recent orders</h2><a class="btn small" href="#/orders?status=open">' + open + ' open</a></div><div class="list">' +
        (d.recent.length ? d.recent.map(orderRow).join('') : '<p class="muted">No orders yet.</p>') + '</div></div>' +
        '<div><div class="card"><h2>Setup checklist</h2><ul class="checklist">' + check.map(function (c) { return '<li class="' + (c[0] ? 'done' : '') + '">' + c[1] + '</li>'; }).join('') + '</ul></div>' +
        '<div class="card"><h2>Low stock</h2>' + (d.lowStock.length ? '<table class="simple">' + d.lowStock.map(function (l) { return '<tr><td>' + esc(l.name) + (l.vname !== 'Regular' ? ' — ' + esc(l.vname) : '') + '</td><td class="right">' + (l.stock <= 0 ? '<span class="badge b-bad">Out</span>' : l.stock + ' left') + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">Nothing low.</p>') + '</div></div></div>';
      $$('[data-res]').forEach(function (b) { b.onclick = function () { act(b, api('/admin/alerts/' + b.dataset.res + '/resolve', { method: 'POST' })).then(viewHome); }; });
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }
  function orderRow(o) {
    return '<a class="item" href="#/orders/' + o.id + '">' + (o.image_url ? '<img src="' + esc(o.image_url) + '" alt="">' : '<span class="thumb"></span>') +
      '<span><span class="t">' + esc(o.name) + '</span> <span class="muted small">' + esc(o.code) + '</span><br>' + fulBadge(o.fulfillment) + ' ' + statusBadge(o.status) + (o.payment_method === 'store' && !o.paid_at && ['canceled','expired'].indexOf(o.status) < 0 ? ' <span class="badge b-warn">Pay at pickup</span>' : '') + '</span>' +
      '<span class="right"><span class="money">' + money(o.total_cents) + '</span><br><span class="muted small">' + when(o.created_at) + '</span></span></a>';
  }

  // ---------------- orders ----------------
  function viewOrders() {
    var qs = new URLSearchParams((location.hash.split('?')[1]) || '');
    app.innerHTML = '<h1>Orders</h1><form class="card grid g4" id="flt">' +
      '<label>Status<select name="status"><option value="all">All</option><option value="open">Open (needs work)</option>' + Object.keys(STATUS).filter(function (k) { return k !== 'expired'; }).map(function (k) { return '<option value="' + k + '">' + STATUS[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>Type<select name="fulfillment"><option value="">Pickup + delivery</option><option value="pickup">In-store pickup</option><option value="shipping">Home delivery</option></select></label>' +
      '<label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label>' +
      '<label style="grid-column:1/-1">Search<input name="q" placeholder="Name, email, phone or order number"></label></form><div class="list" id="ol"></div><div class="center" id="more"></div>';
    var f = $('#flt'); ['status', 'fulfillment', 'from', 'to', 'q'].forEach(function (k) { if (qs.get(k)) f[k].value = qs.get(k); });
    var page = 1;
    function load(append) {
      var p = new URLSearchParams(new FormData(f)); p.set('page', page);
      api('/admin/orders?' + p).then(function (r) {
        var ol = $('#ol'); var html = r.orders.map(orderRow).join('');
        ol.innerHTML = append ? ol.innerHTML + html : (html || '<p class="muted center pad">No orders match.</p>');
        $('#more').innerHTML = r.more ? '<button class="btn">Load more</button>' : '';
        if (r.more) $('#more button').onclick = function () { page++; load(true); };
      }).catch(function (e) { toast(e.message, true); });
    }
    var t; f.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { page = 1; load(false); }, 300); });
    f.addEventListener('submit', function (e) { e.preventDefault(); });
    load(false);
  }

  function viewOrder(id) {
    api('/admin/orders/' + id).then(function (r) {
      var o = r.order, owner = can('refunds'), remaining = o.total_cents - o.refunded_cents;
      var unpaidStore = o.payment_method === 'store' && !o.paid_at, open = ['processing', 'ready_for_pickup', 'awaiting_approval'].indexOf(o.status) >= 0;
      var addr = o.fulfillment === 'shipping' ? esc(o.ship_street) + (o.ship_street2 ? '<br>' + esc(o.ship_street2) : '') + '<br>' + esc(o.ship_city) + ', ' + esc(o.ship_state) + ' ' + esc(o.ship_zip) : '';
      var actions = [];
      if (['paid'].indexOf(o.status) >= 0) actions.push(['processing', 'Start processing']);
      if (['paid', 'processing', 'awaiting_approval'].indexOf(o.status) >= 0 && o.fulfillment === 'pickup') actions.push(['ready_for_pickup', 'Ready for pickup (emails customer)']);
      if (['paid', 'processing', 'awaiting_approval'].indexOf(o.status) >= 0 && o.fulfillment === 'shipping') actions.push(['shipped', 'Mark shipped (emails customer)']);
      if (['ready_for_pickup', 'shipped', 'paid', 'processing'].indexOf(o.status) >= 0 && !unpaidStore) actions.push(['completed', o.fulfillment === 'pickup' ? 'Picked up — complete' : 'Delivered — complete']);
      var pendingSubs = o.substitutions.filter(function (s) { return s.status === 'pending'; });
      app.innerHTML = '<a href="#/orders" class="muted small">← Orders</a><div class="row between"><h1>' + esc(o.code) + '</h1><div class="row">' + fulBadge(o.fulfillment) + statusBadge(o.status) + (o.payment_method === 'store' ? (o.paid_at ? '<span class="badge b-ok">Paid at store</span>' : '<span class="badge b-warn">Pay at pickup — not paid</span>') : '') + '</div></div>' +
        (unpaidStore && open ? '<div class="alert">The customer pays when they pick up. Collect <b>' + money(o.total_cents) + '</b> plus any sales tax at the register, then tap <b>Paid & picked up</b>.</div>' : '') +
        '<div class="grid g2"><div class="card"><h2>Customer</h2><dl class="kv"><dt>Name</dt><dd>' + esc(o.name) + '</dd><dt>Phone</dt><dd><a href="tel:' + esc(o.phone) + '">' + esc(o.phone) + '</a></dd>' +
        '<dt>Email</dt><dd><a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a></dd>' + (addr ? '<dt>Ship to</dt><dd>' + addr + '</dd>' : '<dt>Pickup</dt><dd>In store at Eastland Mall</dd>') +
        (o.notes ? '<dt>Note</dt><dd>' + esc(o.notes) + '</dd>' : '') + (o.tracking_number ? '<dt>Tracking</dt><dd>' + esc(o.tracking_carrier || '') + ' ' + esc(o.tracking_number) + '</dd>' : '') + '</dl></div>' +
        '<div class="card"><h2>Payment</h2><dl class="kv"><dt>Subtotal</dt><dd>' + money(o.subtotal_cents) + '</dd>' + (o.shipping_cents ? '<dt>Shipping</dt><dd>' + money(o.shipping_cents) + '</dd>' : '') +
        '<dt>Tax</dt><dd>' + money(o.tax_cents) + '</dd><dt>Total</dt><dd class="money">' + money(o.total_cents) + '</dd>' + (o.refunded_cents ? '<dt>Refunded</dt><dd>' + money(o.refunded_cents) + '</dd>' : '') +
        (o.discount_cents ? '<dt>Sale savings</dt><dd>' + money(o.discount_cents) + '</dd>' : '') + '<dt>Payment</dt><dd>' + (o.payment_method === 'store' ? (o.paid_at ? 'Paid at the store (' + esc((o.payment_status || '').replace('PAID_IN_STORE_', '').toLowerCase()) + ')' : 'Pay at pickup — not paid yet') : o.card_last4 ? esc(o.card_brand || 'Card') + ' •••• ' + esc(o.card_last4) : '—') + '</dd><dt>Placed</dt><dd>' + when(o.created_at) + '</dd>' + (o.paid_at ? '<dt>Paid</dt><dd>' + when(o.paid_at) + '</dd>' : '') +
        (o.square_payment_id ? '<dt>Square</dt><dd class="small muted">' + esc(o.square_payment_id) + '</dd>' : '') + '</dl></div></div>' +
        '<div class="card"><h2>Items</h2><div class="list">' + o.items.map(function (it) {
          var st = it.status === 'ok' ? '' : '<span class="badge ' + (it.status === 'substituted' ? 'b-ok' : 'b-warn') + '">' + esc(it.status.replace('_', ' ')) + '</span>';
          var btns = '';
          if (['paid', 'processing', 'awaiting_approval'].indexOf(o.status) >= 0) {
            if (it.status === 'ok') btns = '<button class="btn small" data-unav="' + it.id + '">Mark unavailable</button>';
            if (it.status === 'unavailable') btns = '<button class="btn small primary" data-sub="' + it.id + '">Offer substitute</button>' + (unpaidStore ? ' <button class="btn small danger" data-refitem="' + it.id + '">Remove item</button>' : owner ? ' <button class="btn small danger" data-refitem="' + it.id + '">Refund item</button>' : '');
          }
          return '<div class="item"><img src="' + esc(it.image_url || '') + '" alt=""><span><span class="t">' + esc(it.name) + '</span>' + (it.variation_name && it.variation_name !== 'Regular' ? ' — ' + esc(it.variation_name) : '') +
            (it.original_name ? '<br><span class="muted small">Originally: ' + esc(it.original_name) + '</span>' : '') + '<br><span class="muted small">' + it.qty + ' × ' + (it.list_cents ? '<s>' + money(it.list_cents) + '</s> ' : '') + money(it.unit_cents) + '</span> ' + st + '</span>' +
            '<span class="right"><span class="money">' + money(it.unit_cents * it.qty) + '</span><br>' + btns + '</span></div>';
        }).join('') + '</div>' +
        (pendingSubs.length ? pendingSubs.map(function (s) { return '<div class="alert">Waiting for the customer to approve <b>' + esc(s.new_name) + '</b> (sent ' + when(s.created_at) + '). <button class="btn small" data-withdraw="' + s.id + '">Withdraw offer</button></div>'; }).join('') : '') + '</div>' +
        '<div class="card"><h2>Update order</h2>' + (actions.length ? '<div class="row">' + actions.map(function (a) { return '<button class="btn' + (a[0] !== 'completed' ? ' primary' : '') + '" data-st="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>' : '<p class="muted">No status changes available.</p>') +
        (unpaidStore && open ? '<div class="sep"></div><div class="row"><button class="btn primary" id="paidStore">Paid & picked up</button><button class="btn danger" id="noShow">Cancel — not picked up</button></div>' : '') +
        (owner && o.square_payment_id && remaining > 0 ? '<div class="sep"></div><div class="row"><button class="btn danger" id="refundBtn">Refund…</button><span class="muted small">' + money(remaining) + ' can still be refunded</span></div>' : '') +
        '<div class="sep"></div><div class="row"><button class="btn small" data-resend="customer_confirmation">Resend confirmation</button></div>' +
        '<div class="sep"></div><form id="noteF" class="row"><input name="note" placeholder="Add an internal note" style="flex:1"><button class="btn small">Add note</button></form></div>' +
        '<div class="grid g2"><div class="card"><h2>History</h2><ul class="timeline">' + o.events.map(function (e) { return '<li><b>' + when(e.at) + ' · ' + esc(e.actor) + '</b>' + esc(e.action.replace(/_/g, ' ')) + (e.detail ? ' — ' + esc(e.detail) : '') + '</li>'; }).join('') + '</ul></div>' +
        '<div class="card"><h2>Emails</h2>' + (o.emails.length ? '<table class="simple">' + o.emails.map(function (m) { return '<tr><td><a href="#/outbox?id=' + m.id + '">' + esc(m.subject) + '</a><br><span class="muted small">' + esc(m.to_email) + ' · ' + when(m.created_at) + '</span></td><td>' + mailBadge(m.status) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">None.</p>') + '</div></div>';

      $$('[data-st]').forEach(function (b) { b.onclick = function () {
        var to = b.dataset.st;
        if (to === 'shipped') {
          var m = modal('<h2>Mark shipped</h2><form class="form" id="shf"><label>Carrier<input name="carrier" placeholder="USPS, UPS, FedEx…"></label><label>Tracking number<input name="tracking"></label><div class="row"><button class="btn primary">Mark shipped & email customer</button><button type="button" class="btn" data-close>Cancel</button></div></form>');
          $('#shf', m).onsubmit = function (e) { e.preventDefault(); act(e.target.querySelector('button'), api('/admin/orders/' + o.id + '/status', { method: 'POST', body: { status: 'shipped', carrier: e.target.carrier.value, tracking: e.target.tracking.value } }), 'Marked shipped').then(function () { m.remove(); viewOrder(id); }); };
          return;
        }
        act(b, api('/admin/orders/' + o.id + '/status', { method: 'POST', body: { status: to } }), 'Updated').then(function () { viewOrder(id); });
      }; });
      $$('[data-unav]').forEach(function (b) { b.onclick = function () { if (confirm('Mark this item unavailable? You will then offer a same-price substitute or refund it.')) act(b, api('/admin/orders/' + o.id + '/items/' + b.dataset.unav + '/unavailable', { method: 'POST' })).then(function () { viewOrder(id); }); }; });
      $$('[data-sub]').forEach(function (b) { b.onclick = function () { substitutePicker(o, b.dataset.sub, id); }; });
      $$('[data-refitem]').forEach(function (b) { b.onclick = function () {
        var it = o.items.find(function (x) { return String(x.id) === b.dataset.refitem; });
        if (unpaidStore) { if (confirm('Remove ' + it.name + ' from this order? The customer has not paid, so their total just goes down by ' + money(it.unit_cents * it.qty) + '.')) act(b, api('/admin/orders/' + o.id + '/items/' + it.id + '/remove', { method: 'POST' }), 'Item removed').then(function () { viewOrder(id); }); return; }
        refundModal(o, id, { itemIds: [it.id], amount: dollars(it.unit_cents * it.qty), reason: 'Item unavailable: ' + it.name });
      }; });
      if ($('#paidStore')) $('#paidStore').onclick = function () {
        var m = modal('<h2>Paid & picked up</h2><p>Collect <b>' + money(o.total_cents) + '</b> plus any sales tax at the register (ring it up in Square as usual).</p><form class="form" id="psf"><label>How did they pay?<select name="method"><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option></select></label><div class="row"><button class="btn primary">Mark paid & complete</button><button type="button" class="btn" data-close>Cancel</button></div></form>');
        $('#psf', m).onsubmit = function (e) { e.preventDefault(); act(e.target.querySelector('.primary'), api('/admin/orders/' + o.id + '/paid-in-store', { method: 'POST', body: { method: e.target.method.value } }), 'Order completed').then(function () { m.remove(); viewOrder(id); }); };
      };
      if ($('#noShow')) $('#noShow').onclick = function () {
        var m = modal('<h2>Cancel this order?</h2><p class="muted">Nothing was charged. The items go back into stock and the customer gets a cancellation email.</p><form class="form" id="nsf"><label>Reason (sent to the customer)<input name="reason" value="Not picked up within the hold time"></label><div class="row"><button class="btn danger">Cancel order</button><button type="button" class="btn" data-close>Keep it</button></div></form>');
        $('#nsf', m).onsubmit = function (e) { e.preventDefault(); act(e.target.querySelector('.danger'), api('/admin/orders/' + o.id + '/cancel-unpaid', { method: 'POST', body: { reason: e.target.reason.value } }), 'Order canceled, items back in stock').then(function () { m.remove(); viewOrder(id); }); };
      };
      $$('[data-withdraw]').forEach(function (b) { b.onclick = function () { act(b, api('/admin/substitutions/' + b.dataset.withdraw + '/withdraw', { method: 'POST' }), 'Offer withdrawn').then(function () { viewOrder(id); }); }; });
      $$('[data-resend]').forEach(function (b) { b.onclick = function () { act(b, api('/admin/orders/' + o.id + '/resend', { method: 'POST', body: { kind: b.dataset.resend } })).then(function (r) { toast(r.status === 'sent' ? 'Email sent' : 'Saved to Emails (sending not set up)'); viewOrder(id); }); }; });
      if ($('#refundBtn')) $('#refundBtn').onclick = function () { refundModal(o, id, {}); };
      $('#noteF').onsubmit = function (e) { e.preventDefault(); if (!e.target.note.value.trim()) return; act(e.target.querySelector('button'), api('/admin/orders/' + o.id + '/note', { method: 'POST', body: { note: e.target.note.value } }), 'Note added').then(function () { viewOrder(id); }); };
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }
  function refundModal(o, id, pre) {
    var remaining = o.total_cents - o.refunded_cents;
    var m = modal('<h2>Refund through Square</h2><p class="muted small">Up to ' + money(remaining) + '. The money goes back to the customer\'s card.</p><form class="form" id="rf">' +
      '<label class="check"><input type="checkbox" name="full"> Refund everything left (' + money(remaining) + ')</label>' +
      '<label>Amount ($)<input name="amount" inputmode="decimal" value="' + esc(pre.amount || '') + '"></label><label>Reason<input name="reason" value="' + esc(pre.reason || '') + '"></label>' +
      '<label class="check"><input type="checkbox" name="restock"> Put the item(s) back in stock</label>' +
      '<label class="check"><input type="checkbox" name="cancel"> Also cancel the order (emails the customer)</label>' +
      '<div class="row"><button class="btn danger">Refund</button><button type="button" class="btn" data-close>Cancel</button></div></form>');
    $('#rf', m).onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      if (!confirm('Refund ' + (f.full.checked ? money(remaining) : '$' + f.amount.value) + ' now? This cannot be undone.')) return;
      act(f.querySelector('button'), api('/admin/orders/' + o.id + '/refund', { method: 'POST', body: { full: f.full.checked, amount: f.amount.value, reason: f.reason.value, restock: f.restock.checked, cancel: f.cancel.checked, itemIds: pre.itemIds || [] } }), 'Refund sent to Square').then(function () { m.remove(); viewOrder(id); });
    };
  }
  function substitutePicker(o, itemId, id) {
    var it = o.items.find(function (x) { return String(x.id) === String(itemId); });
    api('/admin/orders/' + o.id + '/items/' + itemId + '/alternatives').then(function (r) {
      var m = modal('<h2>Offer a substitute</h2><p class="muted small">Same price as ' + esc(it.name) + ' (' + money(it.unit_cents) + '), with at least ' + it.qty + ' in stock. The customer gets an email and must approve it; nothing changes until they do.</p>' +
        (r.alternatives.length ? '<div class="list">' + r.alternatives.map(function (a) { return '<label class="item" style="cursor:pointer"><img src="' + esc(a.image_url || '') + '" alt=""><span><span class="t">' + esc(a.name) + '</span>' + (a.vname !== 'Regular' ? ' — ' + esc(a.vname) : '') + '<br><span class="muted small">' + a.available + ' available</span></span><input type="radio" name="alt" value="' + a.variation_id + '" style="width:auto"></label>'; }).join('') + '</div>' +
          '<label style="margin-top:10px">Message to the customer (optional)<textarea name="msg" rows="2"></textarea></label><div class="row" style="margin-top:12px"><button class="btn primary" id="sendSub">Email the offer</button><button class="btn" data-close>Cancel</button></div>'
          : '<p class="alert">No other item at this exact price is in stock. Refund the item instead.</p><button class="btn" data-close>Close</button>'));
      if ($('#sendSub', m)) $('#sendSub', m).onclick = function () {
        var pick = $('input[name=alt]:checked', m); if (!pick) return toast('Pick a substitute first', true);
        act($('#sendSub', m), api('/admin/orders/' + o.id + '/items/' + itemId + '/substitute', { method: 'POST', body: { variation_id: Number(pick.value), message: $('textarea', m).value } })).then(function (res) {
          m.remove();
          var m2 = modal('<h2>Offer created</h2><p>' + (res.emailStatus === 'sent' ? 'Email sent to the customer.' : 'Email sending is not set up, so send this link to the customer yourself (text or email):') + '</p><input readonly value="' + esc(res.link) + '"><div class="row" style="margin-top:12px"><button class="btn primary" data-close>Done</button></div>');
          m2.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) viewOrder(id); });
        });
      };
    }).catch(function (e) { toast(e.message, true); });
  }
  function mailBadge(s) { return s === 'sent' ? '<span class="badge b-ok">Sent</span>' : s === 'failed' ? '<span class="badge b-bad">Failed</span>' : '<span class="badge b-warn">Not sent</span>'; }

  // ---------------- products ----------------
  var cats = [];
  function loadCats() { return api('/admin/categories').then(function (r) { cats = r.categories; return cats; }); }
  function viewProducts() {
    Promise.all([api('/admin/products'), loadCats()]).then(function (res) {
      var ps = res[0].products;
      app.innerHTML = '<div class="row between"><h1>Products</h1><a class="btn primary" href="#/products/new">+ Add product</a></div>' +
        '<div class="card row"><input id="ps" placeholder="Search products" style="flex:1;min-width:180px"><select id="pc" style="max-width:220px"><option value="">All categories</option>' + cats.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select></div><div class="list" id="pl"></div>';
      function draw() {
        var q = $('#ps').value.toLowerCase(), c = $('#pc').value;
        $('#pl').innerHTML = ps.filter(function (p) { return (!q || p.name.toLowerCase().indexOf(q) >= 0) && (!c || String(p.category_id) === c); }).map(function (p) {
          var prices = p.variations.map(function (v) { return v.price_cents; }), lo = Math.min.apply(null, prices), hi = Math.max.apply(null, prices);
          var unset = p.variations.some(function (v) { return v.stock == null; }), stock = p.variations.reduce(function (t, v) { return t + (v.stock || 0); }, 0);
          var tags = (p.status === 'hidden' ? '<span class="badge">Hidden</span> ' : '') + (p.featured ? '<span class="badge b-ok">Featured</span> ' : '') + (p.is_sample ? '<span class="badge">Sample photo</span> ' : '') +
            (!p.price_confirmed ? '<span class="badge b-warn">Price unconfirmed</span> ' : '') + (unset ? '<span class="badge b-warn">Quantity not set</span> ' : stock <= 0 ? '<span class="badge b-bad">Out of stock</span> ' : '') + (p.square_item_id ? '<span class="badge b-ok">In Square</span>' : '');
          return '<a class="item" href="#/products/' + p.id + '">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<span class="thumb"></span>') + '<span><span class="t">' + esc(p.name) + '</span> <span class="muted small">' + esc(p.category_name || 'No category') + '</span><br>' + tags + '</span>' +
            '<span class="right"><span class="money">' + money(lo) + (hi !== lo ? '–' + money(hi) : '') + '</span><br><span class="muted small">' + (unset ? 'qty ?' : stock + ' in stock') + '</span></span></a>';
        }).join('') || '<p class="muted center pad">No products.</p>';
      }
      $('#ps').oninput = draw; $('#pc').onchange = draw; draw();
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }

  // client-side resize so phone photos upload fast and fit the server limit
  function resize(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not read photo')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That file is not a photo this browser can read.')); };
      img.src = url;
    });
  }
  function uploadPhotos(pid, files) {
    return Promise.all(files.map(resize)).then(function (blobs) {
      var fd = new FormData(); blobs.forEach(function (b, i) { fd.append('photo', b, 'photo' + i + '.jpg'); });
      return api('/admin/products/' + pid + '/images', { method: 'POST', body: fd });
    });
  }

  function viewProduct(id) {
    var isNew = id === 'new';
    Promise.all([isNew ? Promise.resolve({ product: { name: '', description: '', category_id: '', featured: 0, status: 'active', variations: [{ name: 'Regular', price_cents: '', stock: '', sku: '' }], images: [] } }) : api('/admin/products/' + id), loadCats()]).then(function (res) {
      var p = res[0].product, queued = [];
      app.innerHTML = '<a href="#/products" class="muted small">← Products</a><h1>' + (isNew ? 'Add product' : esc(p.name)) + '</h1>' +
        (p.is_sample ? '<p class="alert">This item came from the store\'s Google photos. Replace the photo with a real one, confirm the price, or hide/delete it.</p>' : '') +
        '<div class="card"><h2>Photos</h2><p class="muted small">Take photos with your phone camera or pick from your gallery. The first photo is the main one.</p><div class="photos" id="phs"></div></div>' +
        '<form class="card form" id="pf"><label>Product name<input name="name" required maxlength="120" value="' + esc(p.name) + '"></label>' +
        '<label>Description<textarea name="description" rows="3" maxlength="3000">' + esc(p.description) + '</textarea></label>' +
        '<div class="grid g2"><label>Category<select name="category_id"><option value="">No category</option>' + cats.map(function (c) { return '<option value="' + c.id + '"' + (String(c.id) === String(p.category_id) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
        '<label>On the website<select name="status"><option value="active"' + (p.status === 'active' ? ' selected' : '') + '>Show on site</option><option value="hidden"' + (p.status === 'hidden' ? ' selected' : '') + '>Hidden</option></select></label></div>' +
        '<label class="check"><input type="checkbox" name="featured"' + (p.featured ? ' checked' : '') + '> Featured (shown first)</label>' +
        '<div><h3>Prices & quantities</h3><p class="muted small">Add a row for each size/color. Leave quantity empty only if you do not know it yet — the item cannot be bought online until it has a quantity.</p>' +
        '<table class="vtable"><thead><tr><th>Option</th><th>Price $</th><th>Qty</th><th>SKU</th><th></th></tr></thead><tbody id="vb"></tbody></table><button type="button" class="btn small" id="addV">+ Add option</button></div>' +
        '<button class="btn primary big">' + (isNew ? 'Save product' : 'Save changes') + '</button>' +
        (!isNew ? '<div class="row between"><button type="button" class="btn small" id="syncBtn">Sync to Square now</button><button type="button" class="btn danger small" id="delBtn">Delete product</button></div>' : '') + '</form>';
      var vb = $('#vb');
      function vrow(v) { var tr = document.createElement('tr'); tr.dataset.id = v.id || ''; tr.innerHTML = '<td><input name="vn" value="' + esc(v.name || 'Regular') + '" maxlength="60"></td><td><input name="vp" inputmode="decimal" value="' + esc(dollars(v.price_cents)) + '" required></td><td><input name="vs" inputmode="numeric" value="' + esc(v.stock == null ? '' : v.stock) + '"></td><td><input name="vk" value="' + esc(v.sku || '') + '" maxlength="40"></td><td><button type="button" class="btn small" data-rm>✕</button></td>'; vb.appendChild(tr); }
      p.variations.forEach(vrow);
      $('#addV').onclick = function () { vrow({ name: '', price_cents: '', stock: '', sku: '' }); };
      vb.addEventListener('click', function (e) { if (e.target.closest('[data-rm]')) { if ($$('tr', vb).length > 1) e.target.closest('tr').remove(); else toast('A product needs at least one price', true); } });
      function drawPhotos() {
        var ph = $('#phs');
        ph.innerHTML = p.images.map(function (im, i) { return '<div class="ph"><img src="' + esc(im.src) + '" alt="">' + (i === 0 ? '<span class="badge first">Main</span>' : '') + '<div class="ctl"><button type="button" data-l="' + i + '" aria-label="Move left">◀</button><button type="button" data-d="' + im.id + '" aria-label="Delete photo">🗑</button><button type="button" data-r="' + i + '" aria-label="Move right">▶</button></div></div>'; }).join('') +
          queued.map(function (f) { return '<div class="ph"><img src="' + URL.createObjectURL(f) + '" alt=""><span class="badge first">Uploads on save</span></div>'; }).join('') +
          '<label class="addph"><b>+</b>Take or add photos<input type="file" accept="image/*" capture="environment" multiple hidden id="fileIn"></label>' +
          '<label class="addph"><b>🖼</b>From gallery<input type="file" accept="image/*" multiple hidden id="fileIn2"></label>';
        [$('#fileIn'), $('#fileIn2')].forEach(function (inp) { inp.onchange = function () {
          var files = Array.prototype.slice.call(inp.files || []).slice(0, 10); if (!files.length) return;
          if (isNew) { queued = queued.concat(files); drawPhotos(); return; }
          toast('Uploading ' + files.length + ' photo(s)…');
          uploadPhotos(p.id, files).then(function () { toast('Photos added'); viewProduct(id); }).catch(function (e) { toast(e.message, true); });
        }; });
        $$('[data-d]', ph).forEach(function (b) { b.onclick = function () { if (confirm('Delete this photo?')) act(b, api('/admin/images/' + b.dataset.d, { method: 'DELETE' }), 'Photo deleted').then(function () { viewProduct(id); }); }; });
        function move(i, d) { var j = i + d; if (j < 0 || j >= p.images.length) return; var t = p.images[i]; p.images[i] = p.images[j]; p.images[j] = t;
          api('/admin/products/' + p.id + '/images/order', { method: 'POST', body: { ids: p.images.map(function (x) { return x.id; }) } }).then(drawPhotos).catch(function (e) { toast(e.message, true); }); }
        $$('[data-l]', ph).forEach(function (b) { b.onclick = function () { move(Number(b.dataset.l), -1); }; });
        $$('[data-r]', ph).forEach(function (b) { b.onclick = function () { move(Number(b.dataset.r), 1); }; });
      }
      drawPhotos();
      $('#pf').onsubmit = function (e) {
        e.preventDefault(); var f = e.target;
        var body = { name: f.name.value, description: f.description.value, category_id: f.category_id.value || null, status: f.status.value, featured: f.featured.checked,
          variations: $$('tr', vb).map(function (tr) { return { id: tr.dataset.id ? Number(tr.dataset.id) : null, name: $('[name=vn]', tr).value, price: $('[name=vp]', tr).value, stock: $('[name=vs]', tr).value, sku: $('[name=vk]', tr).value }; }) };
        checkedSave(f.querySelector('.big'), 'product', body, function () { return api(isNew ? '/admin/products' : '/admin/products/' + p.id, { method: isNew ? 'POST' : 'PUT', body: body }); },
          { productId: isNew ? null : p.id, hasPhoto: queued.length > 0 || (p.images || []).length > 0 }).then(function (r) {
          if (!r) return;
          var pid = isNew ? r.id : p.id;
          var next = queued.length ? uploadPhotos(pid, queued) : Promise.resolve();
          return next.then(function () {
            if (r.sync && r.sync.error) toast(r.sync.error, true); else toast(isNew ? 'Product added' : 'Saved');
            if (isNew) go('#/products/' + pid); else viewProduct(id);
          });
        }).catch(function () {});
      };
      if ($('#delBtn')) $('#delBtn').onclick = function () { if (confirm('Delete "' + p.name + '" from the website' + (p.square_item_id ? ' and Square' : '') + '? Past orders keep their record.')) act($('#delBtn'), api('/admin/products/' + p.id, { method: 'DELETE' })).then(function (r) { toast(r.note || 'Deleted', !!r.note); go('#/products'); }); };
      if ($('#syncBtn')) $('#syncBtn').onclick = function () { act($('#syncBtn'), api('/admin/products/' + p.id + '/sync', { method: 'POST' })).then(function (r) { toast(r.error || r.skipped || 'Synced to Square', !!r.error); }); };
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }

  // ---------------- quantities ----------------
  function viewStock() {
    api('/admin/products').then(function (r) {
      var rows = [];
      r.products.forEach(function (p) { p.variations.forEach(function (v) { rows.push({ p: p, v: v }); }); });
      app.innerHTML = '<div class="row between"><h1>Quantities</h1><button class="btn primary" id="saveQ" disabled>Save changes</button></div>' +
        '<div class="card row"><input id="qs" placeholder="Search" style="flex:1;min-width:160px"><select id="qf" style="max-width:200px"><option value="">All</option><option value="unset">Quantity not set</option><option value="low">Low or out (≤2)</option></select></div>' +
        '<p class="muted small">Set how many you have. At 0 the website shows "Out of stock" right away.' + ' When Square is connected, changes are sent to Square too.</p><div class="list" id="ql"></div>';
      var changed = {};
      function draw() {
        var q = $('#qs').value.toLowerCase(), f = $('#qf').value;
        $('#ql').innerHTML = rows.filter(function (x) { var s = x.v.id in changed ? changed[x.v.id] : x.v.stock; return (!q || x.p.name.toLowerCase().indexOf(q) >= 0) && (!f || (f === 'unset' ? s === '' || s == null : s !== '' && s != null && Number(s) <= 2)); }).map(function (x) {
          var s = x.v.id in changed ? changed[x.v.id] : (x.v.stock == null ? '' : x.v.stock);
          return '<div class="item">' + (x.p.image ? '<img src="' + esc(x.p.image) + '" alt="">' : '<span class="thumb"></span>') + '<span><span class="t">' + esc(x.p.name) + '</span>' + (x.v.name !== 'Regular' ? ' — ' + esc(x.v.name) : '') + '<br><span class="muted small">' + money(x.v.price_cents) + (x.v.available != null && x.v.available !== x.v.stock ? ' · ' + x.v.available + ' free (others in checkouts)' : '') + '</span></span>' +
            '<span class="qty" data-v="' + x.v.id + '"><button type="button" data-m>−</button><input inputmode="numeric" value="' + esc(s) + '" placeholder="?"><button type="button" data-p>+</button></span></div>';
        }).join('') || '<p class="muted center pad">Nothing here.</p>';
      }
      $('#ql').addEventListener('click', function (e) {
        var q = e.target.closest('.qty'); if (!q) return; var inp = $('input', q), n = parseInt(inp.value || '0', 10) || 0;
        if (e.target.closest('[data-m]')) n = Math.max(0, n - 1); else if (e.target.closest('[data-p]')) n = n + 1; else return;
        inp.value = n; changed[q.dataset.v] = String(n); $('#saveQ').disabled = false;
      });
      $('#ql').addEventListener('input', function (e) { var q = e.target.closest('.qty'); if (!q) return; changed[q.dataset.v] = e.target.value.replace(/\D/g, ''); $('#saveQ').disabled = false; });
      $('#qs').oninput = draw; $('#qf').onchange = draw; draw();
      $('#saveQ').onclick = function () {
        var changes = Object.keys(changed).map(function (k) { return { variation_id: Number(k), stock: changed[k] }; });
        act($('#saveQ'), api('/admin/stock', { method: 'POST', body: { changes: changes } })).then(function (r) { toast(r.squareErrors.length ? 'Saved; Square: ' + r.squareErrors[0] : 'Quantities saved', !!r.squareErrors.length); viewStock(); });
      };
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }

  // ---------------- categories ----------------
  function viewCategories() {
    loadCats().then(function () {
      app.innerHTML = '<h1>Categories</h1><form class="card row" id="cf"><input name="name" placeholder="New category, e.g. 3D Prints" style="flex:1" required><button class="btn primary">Add</button></form><div class="list" id="cl"></div>';
      $('#cl').innerHTML = cats.map(function (c, i) { return '<div class="item cat"><span><input value="' + esc(c.name) + '" data-name="' + c.id + '"><span class="muted small">' + c.products + ' product(s)</span></span>' +
        '<span class="row"><label class="check small"><input type="checkbox" data-vis="' + c.id + '"' + (c.visible ? ' checked' : '') + '> Visible</label><button class="btn small" data-up="' + i + '">▲</button><button class="btn small" data-dn="' + i + '">▼</button><button class="btn small" data-save="' + c.id + '">Save</button><button class="btn small danger" data-del="' + c.id + '">✕</button></span></div>'; }).join('') || '<p class="muted">No categories yet.</p>';
      $('#cf').onsubmit = function (e) { e.preventDefault(); act(e.target.querySelector('button'), api('/admin/categories', { method: 'POST', body: { name: e.target.name.value } }), 'Category added').then(viewCategories); };
      function save(c, extra) { return api('/admin/categories/' + c.id, { method: 'PUT', body: Object.assign({ name: $('[data-name="' + c.id + '"]').value, visible: $('[data-vis="' + c.id + '"]').checked, sort: c.sort }, extra || {}) }); }
      $$('[data-save]').forEach(function (b) { b.onclick = function () { var c = cats.find(function (x) { return String(x.id) === b.dataset.save; }); act(b, save(c), 'Saved').then(viewCategories); }; });
      $$('[data-vis]').forEach(function (b) { b.onchange = function () { var c = cats.find(function (x) { return String(x.id) === b.dataset.vis; }); save(c).then(function () { toast('Saved'); }).catch(function (e) { toast(e.message, true); }); }; });
      function swap(i, d) { var j = i + d; if (j < 0 || j >= cats.length) return; var a = cats[i], b = cats[j];
        Promise.all([save(a, { sort: j }), save(b, { sort: i })]).then(function () { return Promise.all(cats.map(function (c, k) { return k === i || k === j ? null : save(c, { sort: k }); })); }).then(viewCategories).catch(function (e) { toast(e.message, true); }); }
      $$('[data-up]').forEach(function (b) { b.onclick = function () { swap(Number(b.dataset.up), -1); }; });
      $$('[data-dn]').forEach(function (b) { b.onclick = function () { swap(Number(b.dataset.dn), 1); }; });
      $$('[data-del]').forEach(function (b) { b.onclick = function () { if (confirm('Delete this category? Its products stay, just without a category.')) act(b, api('/admin/categories/' + b.dataset.del, { method: 'DELETE' }), 'Deleted').then(viewCategories); }; });
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }

  // ---------------- settings ----------------
  function viewSettings() {
    var qs = new URLSearchParams(location.hash.split('?')[1] || '');
    api('/admin/settings').then(function (r) {
      var s = r.settings, q = r.square, tiers = []; try { tiers = JSON.parse(s.shipping_tiers || '[]'); } catch (e) {}
      var sqMsg = qs.get('square') === 'connected' ? '<p class="alert" style="border-color:var(--ok)">Square is connected. Next: press "Send all products to Square".</p>' : qs.get('square') === 'error' ? '<p class="alert bad">Square connection failed: ' + esc(qs.get('msg') || '') + '</p>' : qs.get('square') === 'denied' ? '<p class="alert bad">Square connection was canceled.</p>' : '';
      app.innerHTML = '<h1>Settings</h1>' + sqMsg +
        '<div class="card"><h2>Square payments</h2>' +
        (!q.appConfigured ? '<p class="alert">The Square app keys are not on the server yet (your developer adds SQUARE_APP_ID, SQUARE_APP_SECRET and SQUARE_ENV). Then the Connect button appears here.</p>' :
          q.connected ? '<p><span class="badge b-ok">Connected</span> ' + esc(q.locationName || '') + ' · ' + (q.env === 'production' ? 'Live payments' : '<span class="badge b-warn">Sandbox (test cards only)</span>') + '<br><span class="muted small">Since ' + when(q.connectedAt) + '. Every website payment goes straight into this Square account.</span></p>' +
            (q.locations.length > 1 ? '<label>Store location<select id="loc">' + q.locations.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === q.locationId ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</select></label>' : '') +
            '<div class="row" style="margin-top:10px"><button class="btn primary" id="pushAll">Send all products to Square</button><button class="btn" id="pullStock">Get stock & prices from Square</button><button class="btn" id="imp">Import items from Square</button></div>' +
            '<div class="sep"></div><button class="btn danger small" id="disc">Disconnect Square</button>'
            : '<p>Connect Nathan\'s Square account so customers can pay online. You will log in on Square\'s own page and approve access; we never see your Square password.</p><button class="btn primary big" id="conn">Connect Square</button>') +
        '<div class="sep"></div><p class="muted small">Webhook URL for the Square app: <code>' + esc(q.webhookUrl) + '</code> · signature key ' + (q.webhookSecretSet ? '<span class="badge b-ok">set</span>' : '<span class="badge b-warn">not set</span>') + '</p></div>' +
        '<form class="card form" id="sf"><h2>Pickup & shipping</h2>' +
        '<label class="check"><input type="checkbox" name="pickup_enabled"' + (s.pickup_enabled === '1' ? ' checked' : '') + '> Offer in-store pickup</label>' +
        '<label>Pickup instructions (shown at checkout and in emails)<textarea name="pickup_instructions" rows="2">' + esc(s.pickup_instructions) + '</textarea></label>' +
        '<label class="check"><input type="checkbox" name="shipping_enabled"' + (s.shipping_enabled === '1' ? ' checked' : '') + '> Offer home delivery (US only)</label>' +
        '<div class="grid g2"><label>Shipping price rule<select name="shipping_mode"><option value="flat"' + (s.shipping_mode !== 'tiers' ? ' selected' : '') + '>One flat rate</option><option value="tiers"' + (s.shipping_mode === 'tiers' ? ' selected' : '') + '>Rate by order total</option></select></label>' +
        '<label>Flat rate ($)<input name="shipping_flat_cents" inputmode="decimal" value="' + esc(dollars(s.shipping_flat_cents)) + '" placeholder="e.g. 8.00"></label></div>' +
        '<div id="tiers"><p class="muted small">Rate by order total: each row = "orders from $X pay $Y shipping".</p><table class="vtable"><tbody id="tb"></tbody></table><button type="button" class="btn small" id="addT">+ Add row</button></div>' +
        '<label>Free shipping on orders over ($, optional)<input name="shipping_free_over_cents" inputmode="decimal" value="' + esc(dollars(s.shipping_free_over_cents)) + '"></label>' +
        '<label>Shipping note (shown at checkout)<input name="shipping_note" value="' + esc(s.shipping_note) + '"></label>' +
        '<p class="muted small">Delivery only appears on the website once Square is connected, because delivery orders must be paid online.</p>' +
        '<h2 style="margin-top:8px">Paying & timing</h2>' +
        '<label class="check"><input type="checkbox" name="pay_in_store_enabled"' + (s.pay_in_store_enabled === '1' ? ' checked' : '') + '> Let pickup customers pay at the store (cash or card at the counter)</label>' +
        '<p class="muted small">While Square is not connected, pay-at-pickup is the only way to order, so it stays on.</p>' +
        '<label>When is a pickup order usually ready? (shown at checkout and in the confirmation email)<input name="pickup_ready_text" maxlength="160" value="' + esc(s.pickup_ready_text) + '" placeholder="e.g. Ready in about 2 hours · Ready today by 4 PM"></label>' +
        '<label>How long does shipping take? (shown at checkout and in emails)<input name="shipping_time_text" maxlength="160" value="' + esc(s.shipping_time_text) + '" placeholder="e.g. Ships in 1–2 business days, arrives in 3–5"></label>' +
        '<label>Hold unpaid pickup orders for (days)<input name="pickup_hold_days" inputmode="numeric" value="' + esc(s.pickup_hold_days) + '"></label>' +
        '<h2 style="margin-top:8px">Sale</h2>' +
        (r.saleActive ? '<p><span class="badge b-ok">Live now</span> ' + esc(r.saleActive.label) + '</p>' : '') +
        '<label class="check"><input type="checkbox" name="sale_enabled"' + (s.sale_enabled === '1' ? ' checked' : '') + '> Sale is on</label>' +
        '<div class="grid g2"><label>Percent off<input name="sale_percent" inputmode="numeric" value="' + esc(s.sale_percent) + '" placeholder="e.g. 50"></label>' +
        '<label>Applies to<select name="sale_category_id"><option value="">Everything in the store</option>' + r.categories.map(function (c) { return '<option value="' + c.id + '"' + (String(c.id) === String(s.sale_category_id) ? ' selected' : '') + '>' + esc(c.name) + ' only</option>'; }).join('') + '</select></label></div>' +
        '<div class="grid g2"><label>Banner text<input name="sale_label" maxlength="140" value="' + esc(s.sale_label) + '" placeholder="e.g. Black Friday — 50% off everything"></label>' +
        '<label>Last day of the sale (optional)<input name="sale_ends" type="date" value="' + esc(s.sale_ends) + '"></label></div>' +
        '<p class="muted small">Sale prices show crossed out on the website and are charged at checkout. The sale ends by itself after the last day.</p>' +
        '<h2 style="margin-top:8px">Website text</h2>' +
        '<label>Announcement bar (top of the shop; leave empty to hide)<input name="site_announcement" maxlength="140" value="' + esc(s.site_announcement) + '" placeholder="e.g. New Demon Slayer plush just arrived!"></label>' +
        '<label>Rolling banner words (one per line)<textarea name="marquee_items" rows="5">' + esc(jsonList(s.marquee_items).join('\n')) + '</textarea></label>' +
        '<label>Store address (shown in Visit Us)<textarea name="store_address" rows="3">' + esc(s.store_address) + '</textarea></label>' +
        '<p class="muted small" style="margin-bottom:4px">Store hours</p><table class="vtable"><tbody id="hb"></tbody></table><button type="button" class="btn small" id="addH">+ Add hours row</button>' +
        '<h2 style="margin-top:8px">Store contact</h2><div class="grid g2"><label>Email for new-order alerts<input name="store_email" type="email" value="' + esc(s.store_email) + '"></label><label>Store phone<input name="store_phone" value="' + esc(s.store_phone) + '"></label></div>' +
        '<label>Hold items in a shopper\'s checkout for (minutes)<input name="hold_minutes" inputmode="numeric" value="' + esc(s.hold_minutes) + '"></label>' +
        '<p class="muted small">Email sending: ' + (r.email.configured ? '<span class="badge b-ok">on</span> from ' + esc(r.email.from) : '<span class="badge b-warn">not set up</span> — emails are saved in Emails so nothing is lost') + '</p>' +
        '<button class="btn primary big">Save settings</button></form>' +
        '<div class="card"><h2>My password</h2><form class="form" id="pw"><label>Current password<input name="current" type="password" autocomplete="current-password"></label><label>New password (10+ characters)<input name="password" type="password" minlength="10" autocomplete="new-password"></label><button class="btn">Change password</button></form></div>' +
        (can('staff') ? '<p class="small"><a href="#/log">System log</a></p>' : '');
      var tb = $('#tb');
      function trow(t) { var tr = document.createElement('tr'); tr.innerHTML = '<td>From $<input name="tmin" inputmode="decimal" value="' + esc(dollars(t.min_cents)) + '"></td><td>pay $<input name="trate" inputmode="decimal" value="' + esc(dollars(t.rate_cents)) + '"></td><td><button type="button" class="btn small" data-rm>✕</button></td>'; tb.appendChild(tr); }
      (tiers.length ? tiers : [{ min_cents: 0, rate_cents: '' }]).forEach(trow);
      $('#addT').onclick = function () { trow({ min_cents: '', rate_cents: '' }); };
      tb.onclick = function (e) { if (e.target.closest('[data-rm]')) e.target.closest('tr').remove(); };
      var hb = $('#hb');
      function hrow(h) { var tr = document.createElement('tr'); tr.innerHTML = '<td><input name="hday" placeholder="Days" value="' + esc(h[0] || '') + '"></td><td><input name="htime" placeholder="Hours" value="' + esc(h[1] || '') + '"></td><td><button type="button" class="btn small" data-rm>✕</button></td>'; hb.appendChild(tr); }
      (jsonList(s.store_hours).length ? jsonList(s.store_hours) : [['', '']]).forEach(hrow);
      $('#addH').onclick = function () { hrow(['', '']); };
      hb.onclick = function (e) { if (e.target.closest('[data-rm]')) e.target.closest('tr').remove(); };
      function mode() { $('#tiers').hidden = $('[name=shipping_mode]').value !== 'tiers'; } $('[name=shipping_mode]').onchange = mode; mode();
      $('#sf').onsubmit = function (e) {
        e.preventDefault(); var f = e.target;
        var body = {
          pickup_enabled: f.pickup_enabled.checked, pickup_instructions: f.pickup_instructions.value, shipping_enabled: f.shipping_enabled.checked, shipping_mode: f.shipping_mode.value,
          shipping_flat_cents: f.shipping_flat_cents.value, shipping_free_over_cents: f.shipping_free_over_cents.value, shipping_note: f.shipping_note.value, store_email: f.store_email.value, store_phone: f.store_phone.value, hold_minutes: f.hold_minutes.value,
          shipping_tiers: $$('tr', tb).filter(function (tr) { return $('[name=trate]', tr).value !== ''; }).map(function (tr) { return { min: $('[name=tmin]', tr).value || '0', rate: $('[name=trate]', tr).value }; }),
          pay_in_store_enabled: f.pay_in_store_enabled.checked, pickup_ready_text: f.pickup_ready_text.value, shipping_time_text: f.shipping_time_text.value, pickup_hold_days: f.pickup_hold_days.value,
          sale_enabled: f.sale_enabled.checked, sale_percent: f.sale_percent.value, sale_category_id: f.sale_category_id.value, sale_label: f.sale_label.value, sale_ends: f.sale_ends.value,
          site_announcement: f.site_announcement.value, marquee_items: f.marquee_items.value.split('\n'), store_address: f.store_address.value,
          store_hours: $$('tr', hb).map(function (tr) { return [$('[name=hday]', tr).value, $('[name=htime]', tr).value]; }) };
        checkedSave(f.querySelector('.big'), 'settings', body, function () { return api('/admin/settings', { method: 'PUT', body: body }); }).then(function (x) { if (x) { toast('Settings saved'); viewSettings(); } });
      };
      $('#pw').onsubmit = function (e) { e.preventDefault(); act(e.target.querySelector('button'), api('/admin/password', { method: 'POST', body: { current: e.target.current.value, password: e.target.password.value } }), 'Password changed').then(function () { e.target.reset(); }); };
      if ($('#conn')) $('#conn').onclick = function () { act($('#conn'), api('/admin/square/connect')).then(function (x) { location.href = x.url; }); };
      if ($('#disc')) $('#disc').onclick = function () { if (confirm('Disconnect Square? Online checkout will stop until you connect again.')) act($('#disc'), api('/admin/square/disconnect', { method: 'POST' }), 'Disconnected').then(viewSettings); };
      if ($('#loc')) $('#loc').onchange = function () { api('/admin/square/location', { method: 'POST', body: { locationId: $('#loc').value } }).then(function () { toast('Location saved'); }).catch(function (e) { toast(e.message, true); }); };
      if ($('#pullStock')) $('#pullStock').onclick = function () { act($('#pullStock'), api('/admin/square/pull-stock', { method: 'POST' })).then(function (x) { toast('Updated ' + x.updated + ' stock counts from Square'); }); };
      if ($('#imp')) $('#imp').onclick = function () { act($('#imp'), api('/admin/square/import', { method: 'POST' })).then(function (x) { toast(x.note); }); };
      if ($('#pushAll')) $('#pushAll').onclick = function () {
        var b = $('#pushAll'); busy(b, true);
        (function step() { api('/admin/square/push', { method: 'POST' }).then(function (x) {
          if (x.errors.length) { busy(b, false); toast(x.errors[0], true); return; }
          if (x.remaining > 0) { b.textContent = x.remaining + ' left…'; step(); } else { busy(b, false); toast('All products are in Square'); }
        }).catch(function (e) { busy(b, false); toast(e.message, true); }); })();
      };
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }

  // ---------------- staff, invites, activity ----------------
  function permBoxes(selected, full) {
    return '<label class="check"><input type="radio" name="mode" value="full"' + (full ? ' checked' : '') + (me.role === 'owner' ? '' : ' disabled') + '> <b>Full access — same as ' + (me.role === 'owner' ? 'me' : 'an owner') + '</b></label>' +
      '<label class="check"><input type="radio" name="mode" value="custom"' + (full ? '' : ' checked') + '> <b>Choose what they can do:</b></label><div class="grid" style="padding-left:24px">' +
      Object.keys(PL).map(function (k) { return '<label class="check"><input type="checkbox" name="perm" value="' + k + '"' + (selected.indexOf(k) >= 0 ? ' checked' : '') + (((k === 'staff' || k === 'ai') && me.role !== 'owner') ? ' disabled' : '') + '> ' + esc(PL[k]) + '</label>'; }).join('') + '</div>';
  }
  function readPerms(root) { return { full: $('input[name=mode]:checked', root).value === 'full', perms: $$('input[name=perm]:checked', root).map(function (x) { return x.value; }) }; }
  function shareLink(link, name) {
    var text = 'Hi' + (name ? ' ' + name : '') + '! Here is your Ageless admin invite. Open it to set up your login: ' + link;
    var m = modal('<h2>Invite link ready</h2><p class="muted small">Send it by text or email. It works once and expires in 7 days.</p><input readonly id="lnk" value="' + esc(link) + '">' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="cp">Copy link</button>' + (navigator.share ? '<button class="btn" id="sh">Share…</button>' : '') +
      '<a class="btn" href="sms:?&body=' + encodeURIComponent(text) + '">Text it</a><a class="btn" href="mailto:?subject=' + encodeURIComponent('Your Ageless admin invite') + '&body=' + encodeURIComponent(text) + '">Email it</a><button class="btn" data-close>Done</button></div>');
    $('#cp', m).onclick = function () { var i = $('#lnk', m); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Link copied'); }).catch(function () { document.execCommand('copy'); toast('Link copied'); }); };
    if ($('#sh', m)) $('#sh', m).onclick = function () { navigator.share({ title: 'Ageless admin invite', text: text, url: link }).catch(function () {}); };
    m.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) viewStaff(); });
  }
  function viewStaff() {
    Promise.all([api('/admin/staff'), api('/admin/invites')]).then(function (res) {
      var r = res[0], inv = res[1].invites.filter(function (i) { return i.state === 'open'; });
      PL = r.permLabels || PL;
      app.innerHTML = '<div class="row between"><h1>Staff</h1><button class="btn primary" id="invBtn">+ Employee access</button></div>' +
        '<p class="muted small">Create an invite link, choose what the person can do, and send it to them. They open it, type their name and a password, and they\'re in. You can see everything they do under Activity.</p>' +
        '<div class="list">' + r.staff.map(function (s) {
          var full = s.role === 'owner';
          return '<div class="item" style="grid-template-columns:1fr"><div class="row between"><span><span class="t">' + esc(s.name) + '</span> ' + (full ? '<span class="badge b-ok">Full access</span>' : '<span class="badge">Employee</span>') +
            (s.online ? ' <span class="badge b-ok">● Online now</span>' : '') + (s.active ? '' : ' <span class="badge b-bad">Disabled</span>') + '<br><span class="muted small">' + esc(s.email) + ' · last login ' + (s.last_login ? when(s.last_login) : 'never') + '</span>' +
            (s.last_action ? '<br><span class="muted small">Last action: ' + esc(s.last_action.split(' · ')[0]) + ' · ' + when(s.last_action.split(' · ')[1]) + '</span>' : '') + '</span></div>' +
            (full ? '' : '<div class="small muted" style="margin:6px 0">Can: ' + (s.perms.map(function (p) { return esc((PL[p] || p).split(',')[0]); }).join(' · ') || 'nothing yet') + '</div>') +
            '<div class="row" style="margin-top:6px"><a class="btn small primary" href="#/staff/' + s.id + '">Activity</a>' + (s.id === me.id ? '<span class="muted small">(you)</span>' :
              '<button class="btn small" data-perm-edit="' + s.id + '">Permissions</button><button class="btn small" data-act="' + s.id + '" data-to="' + (s.active ? 0 : 1) + '">' + (s.active ? 'Disable' : 'Enable') + '</button><button class="btn small" data-pw="' + s.id + '">Reset password</button>') + '</div></div>';
        }).join('') + '</div>' +
        '<div class="card" style="margin-top:14px"><h2>Open invite links</h2>' + (inv.length ? '<table class="simple">' + inv.map(function (i) { return '<tr><td>' + esc(i.name || i.email || 'Anyone with the link') + '<br><span class="muted small">' + (i.role === 'owner' ? 'Full access' : i.perms.length + ' permission(s)') + ' · expires ' + when(i.expires_at) + '</span></td><td class="right"><button class="btn small danger" data-cancel="' + i.id + '">Cancel</button></td></tr>'; }).join('') + '</table>' : '<p class="muted">None.</p>') + '</div>' +
        '<p><a href="#/activity" class="btn">See everyone\'s activity</a></p>';
      $('#invBtn').onclick = function () {
        var m = modal('<h2>Employee access</h2><form class="form" id="invf"><label>Their name (optional)<input name="name" maxlength="60"></label><label>Their email (optional — locks the link to this email)<input name="email" type="email"></label>' +
          permBoxes(['orders', 'products', 'stock'], false) + '<label>Link works for<select name="days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></label>' +
          '<div class="row"><button class="btn primary">Create invite link</button><button type="button" class="btn" data-close>Cancel</button></div></form>');
        $('#invf', m).onsubmit = function (e) { e.preventDefault(); var f = e.target, p = readPerms(f);
          act(f.querySelector('.primary'), api('/admin/invites', { method: 'POST', body: { name: f.name.value, email: f.email.value, days: f.days.value, full: p.full, perms: p.perms } })).then(function (x) { m.remove(); shareLink(x.link, f.name.value); }); };
      };
      $$('[data-perm-edit]').forEach(function (b) { b.onclick = function () {
        var s = r.staff.find(function (x) { return String(x.id) === b.dataset.permEdit; });
        var m = modal('<h2>' + esc(s.name) + '\'s access</h2><form class="form" id="pf2">' + permBoxes(s.perms, s.role === 'owner') + '<div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div></form>');
        $('#pf2', m).onsubmit = function (e) { e.preventDefault(); var p = readPerms(e.target);
          act(e.target.querySelector('.primary'), api('/admin/staff/' + s.id, { method: 'PUT', body: p.full ? { role: 'owner' } : { role: me.role === 'owner' ? 'employee' : undefined, perms: p.perms } }), 'Access updated').then(function () { m.remove(); viewStaff(); }); };
      }; });
      $$('[data-act]').forEach(function (b) { b.onclick = function () { act(b, api('/admin/staff/' + b.dataset.act, { method: 'PUT', body: { active: b.dataset.to === '1' } }), 'Updated').then(viewStaff); }; });
      $$('[data-pw]').forEach(function (b) { b.onclick = function () { var p = prompt('New temporary password (10+ characters):'); if (p) act(b, api('/admin/staff/' + b.dataset.pw, { method: 'PUT', body: { password: p } }), 'Password reset'); }; });
      $$('[data-cancel]').forEach(function (b) { b.onclick = function () { act(b, api('/admin/invites/' + b.dataset.cancel, { method: 'DELETE' }), 'Invite canceled').then(viewStaff); }; });
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }
  function viewActivity(staffId) {
    var rows = [], before = null;
    app.innerHTML = '<a href="#/staff" class="muted small">← Staff</a><h1 id="actH">Activity</h1><p class="muted small">Logins, logouts and every change made in the admin, newest first.</p><div class="card"><ul class="timeline" id="al"></ul><div class="center" id="am"></div></div>';
    function load() {
      api('/admin/activity?' + (staffId ? 'staff=' + staffId + '&' : '') + (before ? 'before=' + before : '')).then(function (r) {
        rows = rows.concat(r.activity); if (r.activity.length) before = r.activity[r.activity.length - 1].id;
        if (staffId && rows[0]) $('#actH').textContent = (rows[0].name || rows[0].email) + ' — activity';
        $('#al').innerHTML = rows.map(function (a) {
          var txt = esc(a.action).replace(/order #(\d+)/, '<a href="#/orders/$1">order #$1</a>').replace(/product #(\d+)/, '<a href="#/products/$1">product #$1</a>');
          return '<li><b>' + when(a.at) + (staffId ? '' : ' · ' + esc(a.name || a.email || 'unknown')) + (a.ip ? ' · ' + esc(a.ip) : '') + '</b>' + txt + '</li>';
        }).join('') || '<li class="muted">Nothing yet.</li>';
        $('#am').innerHTML = r.more ? '<button class="btn small">Load older</button>' : '';
        if (r.more) $('#am button').onclick = load;
      }).catch(function (e) { toast(e.message, true); });
    }
    load();
  }
  function viewJoin() {
    var t = new URLSearchParams(location.hash.split('?')[1] || '').get('t') || '';
    api('/admin/join/' + encodeURIComponent(t)).then(function (i) {
      app.innerHTML = '<div class="login card"><img class="logo" src="/assets/img/logo-sm.png" alt="Ageless"><h1 class="center">Join the Ageless team</h1>' +
        '<p class="muted small">You\'re invited with ' + (i.full ? '<b>full access</b>.' : 'access to:</p><ul class="small" style="margin:0 0 10px 18px">' + i.perms.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul><p class="muted small">') + ' Set up your login below.</p>' +
        '<form class="form" id="jf"><label>Your name<input name="name" required value="' + esc(i.name || '') + '"></label><label>Email<input name="email" type="email" required autocomplete="username" value="' + esc(i.email || '') + '"' + (i.email ? ' readonly' : '') + '></label>' +
        '<label>Choose a password (10+ characters)<input name="password" type="password" minlength="10" required autocomplete="new-password"></label><button class="btn primary big">Create my login</button></form></div>';
      $('#jf').onsubmit = function (e) { e.preventDefault(); var f = e.target;
        act(f.querySelector('button'), api('/admin/join/' + encodeURIComponent(t), { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value } }), 'Welcome!').then(function () { me = null; go('#/'); }); };
    }).catch(function (e) { app.innerHTML = '<div class="login card"><img class="logo" src="/assets/img/logo-sm.png" alt="Ageless"><p class="alert bad">' + esc(e.message) + '</p><a class="btn" href="#/login">Go to login</a></div>'; });
  }

  // ---------------- emails / log / more ----------------
  function viewOutbox() {
    var id = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
    if (id) {
      return api('/admin/outbox/' + id).then(function (r) {
        var m = r.email; app.innerHTML = '<a href="#/outbox" class="muted small">← Emails</a><h1>' + esc(m.subject) + '</h1><p>To ' + esc(m.to_email) + ' · ' + mailBadge(m.status) + (m.error ? ' <span class="small muted">' + esc(m.error) + '</span>' : '') + '</p>' +
          (m.status !== 'sent' && m.to_email.indexOf('@') > 0 ? '<p><a class="btn primary" href="mailto:' + encodeURIComponent(m.to_email) + '?subject=' + encodeURIComponent(m.subject) + '">Send it from my email app</a></p>' : '') +
          '<iframe class="mail" sandbox="" title="Email preview"></iframe>';
        $('iframe.mail').srcdoc = m.body_html;
      }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
    }
    api('/admin/outbox').then(function (r) {
      app.innerHTML = '<h1>Emails</h1><p class="muted small">Every customer and store email, with whether it was sent.</p><div class="card"><table class="simple">' + (r.emails.map(function (m) { return '<tr><td><a href="#/outbox?id=' + m.id + '">' + esc(m.subject) + '</a><br><span class="muted small">' + esc(m.to_email) + ' · ' + when(m.created_at) + '</span></td><td>' + mailBadge(m.status) + '</td></tr>'; }).join('') || '<tr><td class="muted">No emails yet.</td></tr>') + '</table></div>';
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }
  function viewLog() {
    api('/admin/log').then(function (r) {
      app.innerHTML = '<h1>System log</h1><div class="card"><table class="simple">' + r.log.map(function (l) { return '<tr><td class="small">' + when(l.at) + '</td><td><span class="badge ' + (l.level === 'error' ? 'b-bad' : l.level === 'warn' ? 'b-warn' : '') + '">' + esc(l.level) + '</span></td><td>' + esc(l.msg) + (l.detail ? '<br><span class="muted small">' + esc(l.detail) + '</span>' : '') + '</td></tr>'; }).join('') + '</table></div>';
    }).catch(function (e) { app.innerHTML = '<p class="alert bad">' + esc(e.message) + '</p>'; });
  }
  function viewMore() {
    var links = [];
    if (can('products')) links.push(['#/categories', 'Categories']);
    if (can('orders')) links.push(['#/outbox', 'Emails']);
    if (can('settings')) links.push(['#/settings', 'Settings & Square']);
    if (can('staff')) links.push(['#/staff', 'Staff & employee access'], ['#/activity', 'Staff activity'], ['#/log', 'System log']);
    app.innerHTML = '<h1>More</h1><div class="list">' + links.map(function (l) { return '<a class="item" style="grid-template-columns:1fr" href="' + l[0] + '"><span class="t">' + l[1] + '</span></a>'; }).join('') +
      '<button class="item btn" style="grid-template-columns:1fr" id="lo2">Log out (' + esc(me.name) + ')</button></div>';
    $('#lo2').onclick = function () { $('#logoutBtn').click(); };
  }

  route();
})();
