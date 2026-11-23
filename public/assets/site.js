/* BaybexAI site script: menu, solution filter, lead forms, self-analytics, Meta Pixel + GA4 events */
(function () {
  var BX = window.BX || {}, d = document;
  var rid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); };
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} };
  var ss = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} };

  /* ---- visitor / session / first-touch attribution ---- */
  var vid = ls('bx_vid'); if (!vid) { vid = rid(); ls('bx_vid', vid); }
  var last = +ls('bx_last') || 0, sid = ss('bx_sid');
  if (!sid || Date.now() - last > 30 * 60e3) { sid = rid(); ss('bx_sid', sid); }
  ls('bx_last', Date.now());
  var q = new URLSearchParams(location.search);
  if (q.get('utm_source')) ss('bx_utm', JSON.stringify({ us: q.get('utm_source'), um: q.get('utm_medium') || '', uc: q.get('utm_campaign') || '' }));
  else if (q.get('fbclid') && !ss('bx_utm')) ss('bx_utm', JSON.stringify({ us: 'facebook', um: 'paid_or_social', uc: '' }));
  else if (q.get('gclid') && !ss('bx_utm')) ss('bx_utm', JSON.stringify({ us: 'google', um: 'cpc', uc: '' }));
  var utm = {}; try { utm = JSON.parse(ss('bx_utm') || '{}'); } catch (e) {}
  if (!ss('bx_ref')) ss('bx_ref', d.referrer || '-');
  var firstRef = ss('bx_ref') === '-' ? '' : ss('bx_ref');

  function send(t, extra) {
    if (!BX.sa) return;
    var b = { t: t, p: location.pathname, ti: d.title, r: d.referrer, v: vid, sid: sid, l: BX.lang, us: utm.us, um: utm.um, uc: utm.uc, pt: BX.page && BX.page.type };
    for (var k in extra) b[k] = extra[k];
    var body = JSON.stringify(b);
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/t', new Blob([body], { type: 'application/json' }))) return; } catch (e) {}
    try { fetch('/api/t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }); } catch (e) {}
  }
  var fbq = function () { if (BX.px && window.fbq) window.fbq.apply(null, arguments); };
  var gtag = function () { if ((BX.ga || window.dataLayer) && window.gtag) window.gtag.apply(null, arguments); };

  /* ---- page view (+ ViewContent on solution pages) ---- */
  var page = BX.page || {}, vc = '';
  if (page.type === 'solution') {
    vc = 'vc_' + rid();
    fbq('track', 'ViewContent', { content_name: page.name, content_category: page.category, content_type: 'product' }, { eventID: vc });
    gtag('event', 'view_item', { items: [{ item_id: page.id, item_name: page.name, item_category: page.category }] });
  }
  send('pageview', { vc: vc, lb: page.name || '' });

  /* ---- click tracking ---- */
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a'); if (!a) return;
    var h = a.getAttribute('href') || '';
    if (/wa\.me|whatsapp/i.test(h)) { var ce = 'ct_' + rid(); fbq('track', 'Contact', { method: 'whatsapp' }, { eventID: ce }); gtag('event', 'contact', { method: 'whatsapp' }); send('whatsapp_click', { ce: ce, lb: page.name || '' }); }
    else if (h.indexOf('tel:') === 0) { var ce2 = 'ct_' + rid(); fbq('track', 'Contact', { method: 'phone' }, { eventID: ce2 }); gtag('event', 'contact', { method: 'phone' }); send('call_click', { ce: ce2 }); }
    else if (h.indexOf('mailto:') === 0) { gtag('event', 'contact', { method: 'email' }); send('email_click'); }
    else if (h === '#demo' || /\/contact$/.test(h)) send('demo_click', { lb: page.name || '' });
    else if (/^https?:/.test(h) && a.host !== location.host) send(a.closest('.cta') ? 'live_demo_click' : 'outbound_click', { lb: a.host });
  });

  /* ---- mobile menu ---- */
  var bg = d.getElementById('burger'), ln = d.getElementById('links');
  if (bg && ln) bg.addEventListener('click', function () { var o = ln.classList.toggle('open'); bg.setAttribute('aria-expanded', o); });
  /* remember language choice */
  d.querySelectorAll('[data-lang]').forEach(function (a) { a.addEventListener('click', function () { ls('bx_lang', a.dataset.lang); }); });

  /* ---- home: filter solutions in place (links still work without JS) ---- */
  var grid = d.getElementById('solgrid');
  if (grid) d.querySelectorAll('.tab[data-cat]').forEach(function (tb) {
    tb.addEventListener('click', function (e) {
      e.preventDefault(); var c = tb.dataset.cat;
      d.querySelectorAll('.tab[data-cat]').forEach(function (x) { x.classList.toggle('on', x === tb); });
      grid.querySelectorAll('.card').forEach(function (cd) { cd.style.display = c === 'all' || cd.dataset.cat === c ? '' : 'none'; });
    });
  });

  /* ---- lead forms ---- */
  var U = BX.ui || {};
  d.querySelectorAll('form.f').forEach(function (f) {
    var started = false;
    f.addEventListener('input', function () { if (!started) { started = true; send('form_start', { lb: f.dataset.type }); } });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = {}; new FormData(f).forEach(function (v, k) { fd[k] = v; });
      var m = f.querySelector('.fmsg'), b = f.querySelector('button[type=submit]');
      fd.phone = String(fd.phone || '').replace(/[০-৯]/g, function (x) { return '০১২৩৪৫৬৭৮৯'.indexOf(x); }).trim();
      var msg = function (cls, t) { m.innerHTML = ''; var el = d.createElement('div'); el.className = 'msg ' + cls; el.textContent = t; m.appendChild(el); };
      if (!String(fd.name || '').trim() || !/^[+0-9\s-]{6,20}$/.test(fd.phone)) return msg('err', U.err);
      var eid = 'ld_' + rid();
      fd.eid = eid; fd.page = location.pathname; fd.ref = firstRef; fd.us = utm.us; fd.um = utm.um; fd.uc = utm.uc;
      b.disabled = true; b.textContent = U.sending;
      fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) })
        .then(function (r) {
          if (r.ok) {
            f.reset(); msg('ok', U.ok);
            fbq('track', 'Lead', { content_name: fd.solution || fd.type }, { eventID: eid });
            gtag('event', 'generate_lead', { form_type: fd.type, item_name: fd.solution || '' });
            send('lead', { lb: fd.solution || fd.type });
          } else msg('err', r.status === 429 ? U.many : U.err);
        })
        .catch(function () { msg('err', U.net); })
        .then(function () { b.disabled = false; b.textContent = U.send; });
    });
  });
  if (/[?&]sent=1/.test(location.search)) { var fm = d.querySelector('form.f .fmsg'); if (fm) { fm.innerHTML = '<div class="msg ok"></div>'; fm.firstChild.textContent = U.ok; } }

  /* ---- reveal on scroll ---- */
  var els = d.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) els.forEach(function (x) { x.classList.add('in'); });
  else { var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }); }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' }); els.forEach(function (x) { io.observe(x); }); }
})();
