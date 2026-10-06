/* Crevare — composants d'interface partagés : modale, toast, confirmation, champ de durée,
 * mini-graphiques, badges. Les vues produisent des chaînes HTML ; tout texte venant de
 * l'utilisateur ou de l'état DOIT passer par U.esc(). */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  const LOCATIONS = {
    maison:  { label: 'Maison',       icon: '🏠', color: 'var(--loc-maison)' },
    salle:   { label: 'Fitness Park', icon: '🏋️', color: 'var(--loc-salle)' },
    piscine: { label: 'Piscine',      icon: '🏊', color: 'var(--loc-piscine)' },
    dehors:  { label: 'Extérieur',    icon: '🏃', color: 'var(--loc-dehors)' },
    repos:   { label: 'Repos',        icon: '🧘', color: 'var(--loc-repos)' },
    autre:   { label: 'Autre',        icon: '•',  color: 'var(--muted)' },
  };
  const GOALS = {
    ssa:     { label: 'SSA',     color: 'var(--goal-ssa)' },
    hyrox:   { label: 'HYROX',   color: 'var(--goal-hyrox)' },
    pompier: { label: 'Pompier', color: 'var(--goal-pompier)' },
    general: { label: 'Général', color: 'var(--muted)' },
    custom:  { label: 'Perso',   color: 'var(--goal-custom)' },
  };

  /* ───────── Toast ───────── */
  let toastTimer;
  function toast(msg, ms = 2600) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ───────── Modale (feuille du bas) ───────── */
  let modalReturnFocus = null;
  let modalOnClose = null;

  // openModal({ title, body, onClose }) — body est du HTML déjà échappé.
  function openModal(opts) {
    const o = typeof opts === 'string' ? { body: opts } : opts;
    const $m = document.getElementById('modal');
    modalReturnFocus = document.activeElement;
    modalOnClose = o.onClose || null;
    $m.innerHTML = `<div class="sheet ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true" ${o.title ? 'aria-labelledby="modal-title"' : ''}>
      ${o.title ? `<div class="sheet-head"><h2 id="modal-title">${esc(o.title)}</h2><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>` : ''}
      ${o.body}</div>`;
    $m.classList.add('open');
    document.body.classList.add('modal-open');
    const first = $m.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button:not([data-close])');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    return $m.querySelector('.sheet');
  }
  function closeModal() {
    const $m = document.getElementById('modal');
    if (!$m.classList.contains('open')) return;
    $m.classList.remove('open');
    $m.innerHTML = '';
    document.body.classList.remove('modal-open');
    const cb = modalOnClose; modalOnClose = null;
    if (cb) cb();
    if (modalReturnFocus && modalReturnFocus.focus) try { modalReturnFocus.focus({ preventScroll: true }); } catch (e) { /* élément disparu */ }
  }
  const isModalOpen = () => document.getElementById('modal').classList.contains('open');

  // Confirmation dans la page (confirm() n'est pas disponible partout). Renvoie une Promise<boolean>.
  function ask(message, yesLabel = 'Confirmer', opts = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const sheet = openModal({
        title: opts.title || 'Confirmer',
        body: `<p>${esc(message)}</p><div class="row gap wrap mt">
          <button class="btn ${opts.danger ? 'danger-solid' : ''}" data-ask="yes">${esc(yesLabel)}</button>
          <button class="btn ghost" data-ask="no">${esc(opts.noLabel || 'Annuler')}</button></div>`,
        onClose: () => { if (!answered) resolve(false); },
      });
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ask]');
        if (!b) return;
        answered = true;
        closeModal();
        resolve(b.dataset.ask === 'yes');
      });
    });
  }

  /* ───────── Champ de durée ─────────
   * Clavier numérique ; on tape des chiffres, l'affichage se met en forme (345 → 3:45).
   * Valeur lue avec readTime(input) → secondes ou null. */
  function timeInput(o = {}) {
    const attrs = Object.entries(o.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
    const val = o.value != null && o.value !== '' ? U.formatDuration(o.value) : '';
    const ph = o.placeholder != null && o.placeholder !== '' ? U.formatDuration(o.placeholder) : (o.placeholderText || 'm:ss');
    return `<input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="done" class="time-in ${esc(o.cls || '')}"
      data-time ${o.id ? `id="${esc(o.id)}"` : ''} ${o.name ? `name="${esc(o.name)}"` : ''} ${attrs}
      value="${esc(val)}" placeholder="${esc(ph)}" aria-label="${esc(o.label || 'Durée (minutes:secondes)')}" ${o.required ? 'required' : ''}>`;
  }
  function readTime(input) {
    if (!input) return null;
    return U.parseDuration(input.value);
  }
  // Mise en forme pendant la frappe (délégation globale).
  if (typeof document !== 'undefined') {
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.matches || !el.matches('input[data-time]')) return;
      const raw = el.value;
      if (/[^\d:]/.test(raw) && !/^\d*$/.test(raw.replace(/:/g, ''))) return; // saisie libre (ex. "1h05") : on laisse
      el.value = U.formatDigitsLive(raw.replace(/\D/g, ''));
    });
  }

  /* ───────── Mini-graphiques SVG ───────── */

  // Ligne d'évolution. points : [{x (nombre, ex. jour), y, label?}] ; opts : {target, height, lowerIsBetter, fmt}
  function sparkline(points, opts = {}) {
    const pts = points.filter((p) => p && isFinite(p.y));
    if (pts.length < 2) return '';
    const W = 300, H = opts.height || 64, P = 6;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const all = opts.target != null ? [...ys, opts.target] : ys;
    let ymin = Math.min(...all), ymax = Math.max(...all);
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const xmin = Math.min(...xs), xmax = Math.max(...xs) === xmin ? xmin + 1 : Math.max(...xs);
    const x = (v) => P + ((v - xmin) / (xmax - xmin)) * (W - 2 * P);
    const y = (v) => H - P - ((v - ymin) / (ymax - ymin)) * (H - 2 * P);
    const line = pts.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    const area = `${x(pts[0].x).toFixed(1)},${H - P} ${line} ${x(pts[pts.length - 1].x).toFixed(1)},${H - P}`;
    const last = pts[pts.length - 1];
    let trend = '';
    if (opts.trend) {
      const t = U.linearTrend(pts);
      if (t) trend = `<line class="spark-trend" x1="${x(xmin)}" x2="${x(xmax)}" y1="${y(t.intercept + t.slope * xmin)}" y2="${y(t.intercept + t.slope * xmax)}"/>`;
    }
    const tgt = opts.target != null ? `<line class="spark-target" x1="${P}" x2="${W - P}" y1="${y(opts.target)}" y2="${y(opts.target)}"/>` : '';
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.label || 'Évolution')}">
      <polygon class="spark-area" points="${area}"/>${tgt}${trend}
      <polyline class="spark-line" points="${line}"/>
      <circle class="spark-dot" cx="${x(last.x)}" cy="${y(last.y)}" r="3.5"/></svg>`;
  }

  // Barres verticales. data : [{label, value, cls?}] ; opts : {height, max, fmt}
  function bars(data, opts = {}) {
    if (!data.length) return '';
    const H = opts.height || 90;
    const max = opts.max || Math.max(1, ...data.map((d) => d.value || 0));
    return `<div class="bars" style="--h:${H}px" role="img" aria-label="${esc(opts.label || 'Graphique')}">${data.map((d) => `
      <div class="bar-col" title="${esc(d.label)} : ${esc(opts.fmt ? opts.fmt(d.value) : d.value)}">
        <div class="bar-fill ${esc(d.cls || '')}" style="height:${Math.round(((d.value || 0) / max) * 100)}%"></div>
        <small>${esc(d.label)}</small></div>`).join('')}</div>`;
  }

  /* ───────── Badges & petits éléments ───────── */
  function locBadge(loc) {
    const l = LOCATIONS[loc] || LOCATIONS.autre;
    return `<span class="badge" style="--c:${l.color}"><span aria-hidden="true">${l.icon}</span> ${esc(l.label)}</span>`;
  }
  function goalTag(type) {
    const g = GOALS[type] || GOALS.custom;
    return `<span class="tag" style="--c:${g.color}">${esc(g.label)}</span>`;
  }
  const goalTags = (types) => (types || []).map(goalTag).join('');
  function empty(title, text, actionHTML = '') {
    return `<div class="empty"><p class="empty-title">${esc(title)}</p>${text ? `<p class="muted">${esc(text)}</p>` : ''}${actionHTML}</div>`;
  }
  // Valeur affichable selon l'unité d'un test
  function fmtValue(unit, v) {
    if (v == null || v === '') return '—';
    switch (unit) {
      case 'time': return U.formatDuration(v);
      case 'reps': return `${U.fmtNum(v, 0)} reps`;
      case 'palier': return `palier ${U.fmtNum(v, 1)}`;
      case 'm': return `${U.fmtNum(v, 1)} m`;
      case 'cm': return `${U.fmtNum(v, 1)} cm`;
      case 'kg': return `${U.fmtNum(v, 1)} kg`;
      case 'km': return `${U.fmtNum(v, 2)} km`;
      default: return `${U.fmtNum(v, 2)} ${esc(unit || '')}`;
    }
  }
  // Segmenté : [{value, label}] → boutons radio stylés
  function segmented(name, options, current, extra = '') {
    return `<div class="seg" role="radiogroup">${options.map((o) => `
      <label class="seg-opt"><input type="radio" name="${esc(name)}" value="${esc(o.value)}" ${String(o.value) === String(current) ? 'checked' : ''} ${extra}>
      <span>${esc(o.label)}</span></label>`).join('')}</div>`;
  }

  C.ui = { LOCATIONS, GOALS, toast, openModal, closeModal, isModalOpen, ask, timeInput, readTime, sparkline, bars, locBadge, goalTag, goalTags, empty, fmtValue, segmented };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
