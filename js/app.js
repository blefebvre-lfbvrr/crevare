/* Crevare — routeur, délégation d'événements, coquille (onglets), démarrage, écran de secours.
 * Chargé EN DERNIER : les modules ont déjà enregistré leurs routes et actions. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Environnement ───────── */
  let embedded = false;
  try { embedded = window.top !== window.self; } catch (e) { embedded = true; }
  const ua = navigator.userAgent || '';
  C.env = {
    embedded, // page publiée dans un cadre (claude.ai) : pas de service worker, pas d'URL modifiable
    ios: /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
    standalone: (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
    http: /^https?:$/.test(location.protocol),
  };

  /* ───────── Routes ─────────
   * C.route('#/seance/:id', (params) => html | {html, after}, { tab: '#/plan', title: 'Séance' }) */
  const routes = [];
  C.route = function (pattern, view, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\?:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ pattern, re, keys, view, tab: opts.tab || pattern, title: opts.title || '' });
  };

  /* ───────── Menu « Plus » ───────── */
  const menu = [];
  // C.menuItem({ hash, icon, label, desc, order })
  C.menuItem = (item) => { menu.push(item); menu.sort((a, b) => (a.order || 50) - (b.order || 50)); };

  /* ───────── Actions (délégation) ─────────
   * data-action="nom"  → C.action('nom', (el, ev) => …)       (clic)
   * data-change="nom"  → C.onChange('nom', (el, ev) => …)     (change)
   * data-input="nom"   → C.onInput('nom', (el, ev) => …)      (input, à chaque frappe)
   * data-form="nom"    → C.onSubmit('nom', (form, fd, ev) => …)
   * Préfixer les noms par le module : 'seance.valider', 'habit.toggle'… */
  const handlers = { click: {}, change: {}, input: {}, submit: {} };
  function reg(kind) {
    return (name, fn) => {
      if (handlers[kind][name]) console.warn(`Action « ${name} » (${kind}) déjà enregistrée`);
      handlers[kind][name] = fn;
    };
  }
  C.action = reg('click');
  C.onChange = reg('change');
  C.onInput = reg('input');
  C.onSubmit = reg('submit');

  function guard(fn) {
    return (...args) => {
      try {
        const r = fn(...args);
        if (r && typeof r.catch === 'function') r.catch(reportError);
      } catch (e) { reportError(e); }
    };
  }
  function reportError(e) {
    console.error(e);
    C.ui.toast('⚠️ ' + (e && e.message ? e.message : 'Erreur inattendue'));
  }

  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close && close.closest('#modal')) { e.preventDefault(); C.ui.closeModal(); return; }
    if (e.target.id === 'modal') { C.ui.closeModal(); return; }
    const el = e.target.closest('[data-action]');
    if (el && !el.disabled) {
      const fn = handlers.click[el.dataset.action];
      if (fn) {
        if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'LABEL') e.preventDefault();
        guard(fn)(el, e);
        return;
      }
    }
    const a = e.target.closest('a[href^="#/"], a[href="#"]');
    if (a && (embedded || !C.env.http)) { e.preventDefault(); go(a.getAttribute('href')); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && handlers.change[el.dataset.change]) guard(handlers.change[el.dataset.change])(el, e);
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el && handlers.input[el.dataset.input]) guard(handlers.input[el.dataset.input])(el, e);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = handlers.submit[form.dataset.form];
    if (fn) guard(fn)(form, new FormData(form), e);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && C.ui.isModalOpen()) C.ui.closeModal();
  });

  /* ───────── Navigation ───────── */
  let current = '#/';
  function readHash() { return /^#\/.*/.test(location.hash) ? location.hash : '#/'; }

  function go(hash, opts = {}) {
    if (!hash || hash === '#') hash = '#/';
    if (embedded || !C.env.http) {
      current = hash;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (hash === location.hash) { render(); return; }
    if (opts.replace) { history.replaceState(null, '', hash); current = hash; render(); window.scrollTo(0, 0); }
    else location.hash = hash; // → hashchange → render
  }
  C.go = go;
  C.back = function (fallback = '#/') {
    if (!embedded && C.env.http && history.length > 1) history.back();
    else go(fallback);
  };
  C.currentRoute = () => current;

  window.addEventListener('hashchange', () => {
    if (embedded) return;
    current = readHash();
    C.ui.closeModal();
    render();
    window.scrollTo(0, 0);
  });

  /* ───────── Rendu ───────── */
  const TABS = [
    { hash: '#/', label: "Aujourd'hui", icon: '◉' },
    { hash: '#/plan', label: 'Sport', icon: '▦' },
    { hash: '#/agenda', label: 'Agenda', icon: '🗓' },
    { hash: '#/chrono', label: 'Chrono', icon: '⏱' },
    { hash: '#/plus', label: 'Plus', icon: '☰' },
  ];

  function match(hash) {
    const path = hash.split('?')[0];
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        const q = hash.split('?')[1];
        if (q) q.split('&').forEach((kv) => { const [k, v] = kv.split('='); params[k] = decodeURIComponent(v || ''); });
        return { route: r, params };
      }
    }
    return null;
  }

  let rendering = false;
  function render() {
    if (rendering) return;
    rendering = true;
    const $app = document.getElementById('app');
    try {
      // Premier lancement : questionnaire de départ
      if (!C.state.profile.onboarded && !current.startsWith('#/bienvenue') && routes.some((r) => r.pattern === '#/bienvenue')) {
        current = '#/bienvenue';
      }
      const m = match(current) || match('#/');
      if (!m) { $app.innerHTML = C.ui.empty('Page introuvable', '', '<a class="btn" href="#/">Accueil</a>'); return; }
      const out = m.route.view(m.params) || '';
      const html = typeof out === 'string' ? out : out.html;
      $app.innerHTML = html;
      document.title = m.route.title ? `${m.route.title} · Crevare` : 'Crevare';
      renderTabs(m.route.tab);
      if (out && typeof out.after === 'function') out.after($app);
    } catch (e) {
      console.error(e);
      $app.innerHTML = recoveryView(e);
    } finally {
      rendering = false;
    }
  }
  C.render = render;
  C.rerender = function () {
    const y = window.scrollY;
    const active = document.activeElement && document.activeElement.id;
    render();
    window.scrollTo(0, y);
    if (active) { const el = document.getElementById(active); if (el) el.focus({ preventScroll: true }); }
  };

  function renderTabs(activeTab) {
    const $tabs = document.getElementById('tabs');
    const hide = !C.state.profile.onboarded;
    $tabs.hidden = hide;
    if (hide) return;
    $tabs.innerHTML = TABS.map((t) => `<a href="${t.hash}" class="${t.hash === activeTab ? 'active' : ''}" ${t.hash === activeTab ? 'aria-current="page"' : ''}>
      <span aria-hidden="true">${t.icon}</span><small>${t.label}</small></a>`).join('');
  }

  // Hub « Plus »
  C.route('#/plus', () => `
    <header class="top"><h1>Plus</h1></header>
    <ul class="menu">${menu.map((m) => `<li><a href="${m.hash}" class="menu-item">
      <span class="menu-icon" aria-hidden="true">${m.icon}</span>
      <span class="menu-text"><b>${esc(m.label)}</b>${m.desc ? `<small class="muted">${esc(m.desc)}</small>` : ''}</span><span aria-hidden="true">›</span></a></li>`).join('')}</ul>
    <p class="muted small center mt">Crevare · données stockées uniquement sur cet appareil.<br>Repères d'entraînement généraux, pas un avis médical.</p>`, { tab: '#/plus', title: 'Plus' });

  /* ───────── Écran de secours ───────── */
  function recoveryView(err) {
    let raw = '';
    try { raw = C.store.exportJSON(); } catch (e) { raw = '{}'; }
    return `<header class="top"><h1>Un problème est survenu</h1></header>
      <div class="card"><p>L'écran n'a pas pu s'afficher : <code>${esc(err && err.message)}</code></p>
      <p class="muted small">Tes données ne sont pas perdues. Copie-les par sécurité avant toute autre action.</p>
      <textarea id="recovery-json" rows="6" readonly>${esc(raw)}</textarea>
      <div class="row gap wrap mt">
        <button class="btn" data-action="app.copy-recovery">Copier mes données</button>
        <a class="btn ghost" href="#/">Revenir à l'accueil</a>
        ${C.store.hasBackup() ? '<button class="btn ghost" data-action="app.restore-backup">Restaurer la copie de secours</button>' : ''}
        <button class="btn ghost danger" data-action="app.reset">Repartir de zéro</button>
      </div></div>`;
  }
  C.action('app.copy-recovery', () => copyText(document.getElementById('recovery-json')));
  C.action('app.restore-backup', async () => {
    if (!(await C.ui.ask('Remplacer les données actuelles par la copie de secours ?', 'Restaurer'))) return;
    C.store.restoreBackup(); go('#/'); C.ui.toast('Copie de secours restaurée');
  });
  C.action('app.reset', async () => {
    if (!(await C.ui.ask('Effacer toutes les données de cet appareil ? Une copie de secours est gardée.', 'Tout effacer', { danger: true }))) return;
    C.store.reset(); go('#/');
  });

  // Copie dans le presse-papiers avec repli sur la sélection du texte.
  function copyText(textarea) {
    const text = textarea.value;
    const fallback = () => { textarea.focus(); textarea.select(); C.ui.toast('Texte sélectionné : copie-le manuellement'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => C.ui.toast('✓ Copié'), fallback);
    else fallback();
  }
  C.copyText = copyText;

  /* ───────── Thème ───────── */
  function applyTheme() {
    const t = C.state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1220';
  }
  C.applyTheme = applyTheme;

  /* ───────── Démarrage ───────── */
  function boot() {
    C.store.load();
    applyTheme();
    current = embedded || !C.env.http ? '#/' : readHash();
    C.store.on(() => { applyTheme(); C.rerender(); });
    if (typeof C.onBoot === 'function') C.onBoot();
    (C.bootHooks || []).forEach((fn) => guard(fn)());
    render();

    if ('serviceWorker' in navigator && C.env.http && !embedded) {
      try {
        navigator.serviceWorker.register('sw.js').then((reg) => {
          reg.addEventListener('updatefound', () => {
            const w = reg.installing;
            if (!w) return;
            w.addEventListener('statechange', () => {
              if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(w);
            });
          });
        }).catch(() => {});
      } catch (e) { /* cadre sans service worker */ }
    }
    let lastDay = U.todayKey();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && U.todayKey() !== lastDay) { lastDay = U.todayKey(); render(); }
    });
    window.addEventListener('error', (e) => console.error(e.error || e.message));
  }
  // C.bootHooks : fonctions appelées au démarrage, après le chargement des données (modules).
  C.bootHooks = C.bootHooks || [];

  function showUpdateBanner(worker) {
    const el = document.getElementById('update');
    if (!el) return;
    el.hidden = false;
    el.querySelector('button').onclick = () => {
      worker.postMessage('skipWaiting');
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.Crevare = window.Crevare || {});
