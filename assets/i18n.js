// Tiny screen translator used by the shop and the admin.
// It translates interface text as it appears on screen (exact phrases + a few patterns) and leaves
// everything else alone — customer names, addresses, product names and order details stay as typed.
// Switching back to English restores the original text.
(function () {
  var TEXT = 3, ATTRS = ['placeholder', 'title', 'aria-label'];
  function create(o) {
    var key = o.storageKey, langs = o.langs, lang = 'en';
    try { lang = localStorage.getItem(key) || o.default || 'en'; } catch (e) {}
    if (!langs[lang] && lang !== 'en') lang = 'en';
    var busy = false;
    function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
    function tr(s, L) {
      L = L || lang; if (L === 'en' || !s) return null;
      var pack = langs[L]; if (!pack) return null;
      var k = norm(s); if (!k || !/[A-Za-z]/.test(k)) return null;
      if (Object.prototype.hasOwnProperty.call(pack.dict, k)) return pack.dict[k];
      for (var i = 0; i < (pack.rules || []).length; i++) {
        var r = pack.rules[i], m = k.match(r[0]);
        if (m) return typeof r[1] === 'function' ? r[1](m, function (x) { return tr(x, L) || x; }) : k.replace(r[0], r[1]);
      }
      return null;
    }
    function keepSpace(orig, t) { var a = orig.match(/^\s*/)[0], b = orig.match(/\s*$/)[0]; return a + t + b; }
    function skip(el) { return !el || el.closest('script,style,textarea,[data-notr],.notr'); }
    function doText(n) {
      if (skip(n.parentElement)) return;
      if (n.__t !== n.nodeValue) n.__o = n.nodeValue;      // app wrote new text: that's the new original
      var t = tr(n.__o);
      var v = t == null ? n.__o : keepSpace(n.__o, t);
      if (n.nodeValue !== v) n.nodeValue = v;
      n.__t = n.nodeValue;
    }
    function doAttrs(el) {
      if (!el || el.closest('script,style,[data-notr],.notr')) return;
      el.__oa = el.__oa || {}; el.__ta = el.__ta || {};
      ATTRS.forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        var cur = el.getAttribute(a);
        if (el.__ta[a] !== cur) el.__oa[a] = cur;
        var t = tr(el.__oa[a]); var v = t == null ? el.__oa[a] : t;
        if (cur !== v) el.setAttribute(a, v);
        el.__ta[a] = v;
      });
    }
    function walk(root) {
      if (!root) return;
      if (root.nodeType === TEXT) return doText(root);
      if (root.nodeType !== 1) return;
      doAttrs(root);
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT), n;
      while ((n = w.nextNode())) { if (n.nodeType === TEXT) doText(n); else doAttrs(n); }
    }
    function apply() {
      var html = document.documentElement, pack = langs[lang];
      html.lang = lang; html.dir = pack && pack.rtl ? 'rtl' : 'ltr';
      document.body.classList.toggle('rtl', !!(pack && pack.rtl));
      busy = true; walk(document.body); if (o.title) document.title = tr(o.title) || o.title; busy = false;
      (o.onChange || function () {})(lang);
    }
    var mo = new MutationObserver(function (list) {
      if (busy) return; busy = true;
      list.forEach(function (m) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach(walk);
      });
      busy = false;
    });
    function start() { apply(); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    return {
      get lang() { return lang; },
      set: function (L) { lang = langs[L] || L === 'en' ? L : 'en'; try { localStorage.setItem(key, lang); } catch (e) {} apply(); },
      t: function (s) { return tr(s) || s; },
      langs: langs,
    };
  }
  window.I18N = { create: create };
})();
