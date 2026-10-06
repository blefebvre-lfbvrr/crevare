/* Crevare — écrans Agenda : #/agenda, #/agenda/:date (jour ou ?vue=semaine), #/agenda-reglages,
 * et la carte « Aujourd'hui » (C.agendaUI.todayCard).
 * Frise 7:00–23:00 : cours, Protection civile, séance de sport conseillée, révisions, repas.
 * Les calculs viennent de C.agenda ; ici, seulement l'affichage et les actions (préfixe « agenda. »). */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Accès défensifs ───────── */

  const has = (name) => !!(C.agenda && typeof C.agenda[name] === 'function');
  function safe(fn, fallback) {
    try { const r = fn(); return r === undefined ? fallback : r; } catch (e) { if (typeof console !== 'undefined') console.error(e); return fallback; }
  }
  const call = (name, fallback, ...args) => (has(name) ? safe(() => C.agenda[name](...args), fallback) : fallback);
  const st = () => C.state || {};
  const ag = () => {
    const a = st().agenda;
    return a && typeof a === 'object' ? a : { sources: [], events: [], subjects: [], exams: [], tasks: {}, blocks: {}, revision: {} };
  };
  const list = (v) => (Array.isArray(v) ? v : []);
  const toast = (msg) => { if (C.ui && C.ui.toast) C.ui.toast(msg); };
  const rerender = () => { if (typeof C.rerender === 'function') C.rerender(); };

  /* ───────── Constantes d'affichage ───────── */

  const T_START = 7 * 60;
  const T_END = 23 * 60;
  const PX = 1.1; // pixels par minute dans la frise
  const KIND_INFO = {
    cours: { label: 'Cours', color: 'var(--info)', icon: '🎓' },
    'protection-civile': { label: 'Protection civile', color: 'var(--accent)', icon: '🚑' },
    perso: { label: 'Perso', color: 'var(--loc-repos)', icon: '📌' },
    sport: { label: 'Sport', color: 'var(--ok)', icon: '🏃' },
  };
  const KIND_OPTIONS = [
    { value: 'cours', label: 'Cours' }, { value: 'protection-civile', label: 'Protection civile' },
    { value: 'perso', label: 'Perso' }, { value: 'sport', label: 'Sport' },
  ];
  const kindInfo = (k) => KIND_INFO[k] || KIND_INFO.perso;
  const COLORS = () => (C.agenda && Array.isArray(C.agenda.COLORS) ? C.agenda.COLORS : ['info']);
  const colorVar = (token) => (COLORS().includes(token) ? `var(--${token})` : 'var(--loc-repos)');
  const KIND_TIPS = {
    relecture: 'Relis tes notes à froid, complète ce qui manque, écris 3 questions que le prof pourrait poser.',
    exercices: 'Refais 2 ou 3 exercices sans regarder la correction, puis compare.',
    synthese: 'Une fiche d\'une page : définitions, formules, méthodes types, pièges.',
    examen: 'Annales et exercices types, en temps limité. Note ce qui coince.',
    libre: '',
  };
  const WEIGHTS = [{ value: 1, label: 'Peu' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Important' }];

  // État d'affichage, gardé le temps de la visite.
  const ui = { built: null, pasteOpen: false, pending: null, result: null, syncing: new Set() };

  /* ───────── Petits outils (purs) ───────── */

  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };
  const nowMinutes = () => { const d = U.now(); return d.getHours() * 60 + d.getMinutes(); };
  // 100 → « 1 h 40 », 45 → « 45 min », 120 → « 2 h »
  function fmtMin(min) {
    const m = Math.max(0, Math.round(+min || 0));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
  }
  // Ancienneté d'une date ISO : « à l'instant », « il y a 3 h », « il y a 2 jours ».
  function ago(iso) {
    const t = Date.parse(iso || '');
    if (!isFinite(t)) return 'jamais';
    const diff = Math.max(0, U.now().getTime() - t) / 60000;
    if (diff < 2) return 'à l\'instant';
    if (diff < 60) return `il y a ${Math.round(diff)} min`;
    if (diff < 48 * 60) return `il y a ${Math.round(diff / 60)} h`;
    return `il y a ${Math.round(diff / 1440)} jours`;
  }
  const subjectOf = (id) => list(ag().subjects).find((s) => s && s.id === id) || null;

  /* Disposition en colonnes des éléments qui se chevauchent (frise).
   * items : [{ s, e, … }] → mêmes objets avec col et cols. */
  function layoutColumns(items) {
    const sorted = items.slice().sort((a, b) => a.s - b.s || b.e - a.e);
    const out = [];
    let cluster = [], clusterEnd = -Infinity, ends = [];
    const flush = () => { const n = Math.max(1, ends.length); for (const it of cluster) it.cols = n; out.push(...cluster); cluster = []; ends = []; clusterEnd = -Infinity; };
    for (const it of sorted) {
      const end = Math.max(it.e, it.s + Math.ceil(26 / PX)); // un élément très court garde une hauteur lisible
      if (cluster.length && it.s >= clusterEnd) flush();
      let col = ends.findIndex((e) => e <= it.s);
      if (col < 0) { col = ends.length; ends.push(end); } else ends[col] = end;
      it.col = col;
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, end);
    }
    if (cluster.length) flush();
    return out;
  }

  // Lignes de la frise d'une journée : événements, sport, révisions, repas.
  function dayItems(date, events, blocks, sport) {
    const items = [];
    for (const ev of events) {
      if (ev.allDay) continue;
      const k = kindInfo(ev.kind);
      items.push({
        type: 'event', s: ev.startMin, e: ev.endMin, id: ev.id, title: ev.title || 'Événement', time: ev.time,
        sub: [ev.typeLabel || k.label, ev.location].filter(Boolean).join(' · '), color: k.color, busy: ev.busy, tentative: ev.tentative,
      });
    }
    if (sport) items.push({ type: 'sport', s: toMin(sport.start), e: toMin(sport.end), title: sport.title || 'Séance de sport', time: `${sport.start}–${sport.end}`, sub: 'Créneau conseillé', color: KIND_INFO.sport.color });
    for (const b of blocks) {
      items.push({
        type: 'block', s: toMin(b.start), e: toMin(b.end), id: b.id, title: b.subjectName || 'Révision', time: `${b.start}–${b.end}`,
        sub: b.title, color: colorVar(b.color), done: !!b.done, missed: !!b.missed,
      });
    }
    return items.filter((x) => x.s != null && x.e != null);
  }

  /* ───────── Morceaux d'interface ───────── */

  function unavailable() {
    return `<header class="top"><h1>Agenda</h1></header>${C.ui.empty('Agenda indisponible', 'Le module de calendrier n\'a pas pu se charger.')}`;
  }

  function ensureTasks() {
    const today = U.todayKey();
    if (ui.built === today || !has('buildTasks')) return;
    ui.built = today;
    safe(() => C.agenda.buildTasks(today));
  }

  function header(date, mode) {
    const today = U.todayKey();
    const isWeek = mode === 'semaine';
    const step = isWeek ? 7 : 1;
    const base = isWeek ? U.mondayOf(date) : date;
    const prev = U.addDays(base, -step), next = U.addDays(base, step);
    const q = isWeek ? '?vue=semaine' : '';
    const title = isWeek ? `Semaine du ${U.fmtShort(base)}` : U.fmtDate(date);
    const sub = isWeek ? `au ${U.fmtShort(U.addDays(base, 6))}` : U.relDays(U.daysBetween(today, date));
    const showToday = isWeek ? U.mondayOf(today) !== base : date !== today;
    return `<header class="top agd-top">
      <div class="agd-head"><h1>Agenda</h1>
        <a class="icon-btn" href="#/agenda-reglages" aria-label="Réglages de l'agenda et des révisions"><span aria-hidden="true">⚙︎</span></a></div>
      <nav class="agd-nav" aria-label="${isWeek ? 'Changer de semaine' : 'Changer de jour'}">
        <a class="icon-btn" href="#/agenda/${esc(prev)}${q}" aria-label="${isWeek ? 'Semaine précédente' : 'Jour précédent'}"><span aria-hidden="true">‹</span></a>
        <div class="agd-nav-d"><b>${esc(title)}</b><small class="muted">${esc(sub)}</small></div>
        <a class="icon-btn" href="#/agenda/${esc(next)}${q}" aria-label="${isWeek ? 'Semaine suivante' : 'Jour suivant'}"><span aria-hidden="true">›</span></a>
      </nav>
      <div class="agd-modes">
        <div class="agd-seg" role="group" aria-label="Affichage">
          <a href="#/agenda/${esc(date)}" ${!isWeek ? 'aria-current="page"' : ''}>Jour</a>
          <a href="#/agenda/${esc(date)}?vue=semaine" ${isWeek ? 'aria-current="page"' : ''}>Semaine</a>
        </div>
        ${showToday ? `<a class="btn ghost small" href="#/agenda${isWeek ? '/' + esc(today) + '?vue=semaine' : ''}">Aujourd'hui</a>` : ''}
      </div>
    </header>`;
  }

  function weekSummary(date) {
    const s = call('weekStats', null, U.mondayOf(date));
    if (!s) return '';
    const pct = s.plannedMin ? Math.round((s.doneMin / s.plannedMin) * 100) : 0;
    return `<section class="agd-sum" aria-label="Révisions de la semaine">
      <p><span aria-hidden="true">📚</span> Révisions cette semaine : <b class="num">${esc(fmtMin(s.plannedMin))}</b> prévues,
        <b class="num">${esc(fmtMin(s.doneMin))}</b> faites</p>
      <div class="agd-bar" role="progressbar" aria-label="Part des révisions faites" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(pct)}">
        <span style="width:${Math.min(100, Math.max(0, pct))}%"></span></div>
    </section>`;
  }

  // Ligne d'un bloc de révision à cocher (≥ 44 px).
  function blockRow(b, opts = {}) {
    const today = U.todayKey();
    const canCheck = b.date <= today;
    const name = b.subjectName || 'Révision';
    const label = `${b.done ? 'Annuler « fait »' : 'Marquer fait'} : ${name}, ${b.start}–${b.end}`;
    return `<li class="agd-rev ${b.done ? 'is-done' : ''} ${b.missed ? 'is-missed' : ''}" style="--c:${colorVar(b.color)}">
      ${canCheck ? `<button type="button" class="agd-check" data-action="agenda.cocher" data-id="${esc(b.id)}" data-done="${b.done ? '0' : '1'}"
        aria-pressed="${b.done ? 'true' : 'false'}" aria-label="${esc(label)}"><span aria-hidden="true">${b.done ? '✓' : ''}</span></button>`
        : '<span class="agd-check is-off" aria-hidden="true"></span>'}
      <button type="button" class="agd-rev-main" data-action="agenda.bloc" data-id="${esc(b.id)}" aria-label="${esc(`Détail : ${name}, ${b.start}–${b.end}, ${b.title}`)}">
        <span class="agd-rev-t num">${esc(b.start)}–${esc(b.end)}</span>
        <span class="agd-rev-n"><b>${esc(name)}</b><small class="muted">${esc(b.title)}${opts.missed ? ' · fait ?' : ''}</small></span>
      </button>
    </li>`;
  }

  function missedSection(date) {
    if (date !== U.todayKey()) return '';
    const missed = call('missedBlocks', []) || [];
    if (!missed.length) return '';
    return `<section class="card agd-missed" aria-labelledby="agd-missed-t">
      <h2 id="agd-missed-t" class="agd-h">Tu les as faites ?</h2>
      <p class="small muted">Ces créneaux sont passés. Coche-les si tu as révisé ; sinon, elles sont déjà replacées plus tard.</p>
      <ul class="agd-revs">${missed.map((b) => `<li class="agd-rev is-missed" style="--c:${colorVar(b.color)}">
        <span class="agd-rev-n grow"><b>${esc(b.subjectName || 'Révision')}</b><small class="muted num">${esc(b.start)}–${esc(b.end)} · ${esc(b.title)}</small></span>
        <span class="agd-yn">
          <button type="button" class="btn small" data-action="agenda.cocher" data-id="${esc(b.id)}" data-done="1" aria-label="${esc(`Fait : ${b.subjectName || 'révision'} ${b.start}`)}">Fait</button>
          <button type="button" class="btn ghost small" data-action="agenda.pasfait" data-id="${esc(b.id)}" aria-label="${esc(`Pas fait : ${b.subjectName || 'révision'} ${b.start}`)}">Pas fait</button>
        </span></li>`).join('')}</ul>
    </section>`;
  }

  // Frise horaire 7:00–23:00.
  function timeline(date, items, rv) {
    const y = (m) => Math.round((Math.max(T_START, Math.min(T_END, m)) - T_START) * PX);
    const H = y(T_END);
    let hours = '';
    for (let h = 7; h <= 23; h++) hours += `<div class="agd-hr" style="top:${y(h * 60)}px"><span class="num">${h}:00</span></div>`;
    const bands = [];
    const meal = rv && rv.meal;
    const lunch = (rv && rv.lunch) || { start: '12:00', end: '13:00' };
    for (const [r, label] of [[lunch, 'Déjeuner'], [meal, 'Repas']]) {
      const a = toMin(r && r.start), b = toMin(r && r.end);
      if (a == null || b == null || b <= a) continue;
      bands.push(`<div class="agd-band" style="top:${y(a)}px;height:${Math.max(14, y(b) - y(a))}px"><span>${esc(label)}</span></div>`);
    }
    const latest = toMin(rv && rv.latestEnd);
    if (latest != null && latest < T_END) bands.push(`<div class="agd-limit" style="top:${y(latest)}px"><span>Fin des révisions ${esc(rv.latestEnd)}</span></div>`);
    const visible = items.filter((it) => it.e > T_START && it.s < T_END);
    const laid = layoutColumns(visible);
    const html = laid.map((it) => {
      const top = y(it.s);
      const h = Math.max(26, y(it.e) - top - 2);
      const w = 100 / it.cols;
      const style = `top:${top}px;height:${h}px;left:${(w * it.col).toFixed(3)}%;width:${w.toFixed(3)}%;--c:${it.color}`;
      const cls = ['agd-it', `agd-${it.type}`, h < 40 ? 'is-short' : '', it.done ? 'is-done' : '', it.busy === false ? 'is-free' : '', it.missed ? 'is-missed' : ''].filter(Boolean).join(' ');
      const inner = `<span class="agd-it-t num">${esc(it.time)}</span><span class="agd-it-n">${it.done ? '✓ ' : ''}${esc(it.title)}</span>${it.sub ? `<span class="agd-it-s">${esc(it.sub)}</span>` : ''}`;
      const aria = `${it.title}, ${it.time}${it.sub ? ', ' + it.sub : ''}${it.done ? ', fait' : ''}${it.busy === false ? ', ne bloque pas' : ''}`;
      if (it.type === 'sport') return `<a class="${cls}" style="${style}" href="#/jour/${esc(date)}" aria-label="${esc('Séance de sport conseillée : ' + aria)}">${inner}</a>`;
      const action = it.type === 'block' ? 'agenda.bloc' : 'agenda.evenement';
      return `<button type="button" class="${cls}" style="${style}" data-action="${action}" data-id="${esc(it.id)}" data-date="${esc(date)}" aria-label="${esc(aria)}">${inner}</button>`;
    }).join('');
    let now = '';
    if (date === U.todayKey()) {
      const nm = nowMinutes();
      if (nm >= T_START && nm <= T_END) now = `<div class="agd-now" style="top:${y(nm)}px" aria-hidden="true"></div>`;
    }
    return `<div class="agd-tl" style="height:${H + 24}px" role="group" aria-label="${esc('Frise de la journée, ' + U.fmtDate(date))}">
      ${hours}<div class="agd-tl-area">${bands.join('')}${html}${now}</div></div>`;
  }

  /* ───────── Vue jour ───────── */

  function welcome() {
    return `<header class="top"><h1>Agenda</h1></header>
      <section class="card agd-welcome">
        <h2>Tes cours, tes gardes… et tes révisions</h2>
        <p>Ajoute ton emploi du temps de l'école et tes événements de Protection civile. Crevare place tes révisions dans les trous,
          <b>jamais après 22 h</b>, et te conseille un créneau pour le sport.</p>
        <h3 class="agd-h">Deux façons de faire</h3>
        <ol class="agd-ways">
          <li><b>Le lien direct.</b> Colle le lien iCal (.ics) de chaque calendrier, puis touche « Synchroniser ».
            Simple, mais beaucoup de sites le bloquent.</li>
          <li><b>Le Raccourci iOS</b> (le plus fiable). Il récupère tes deux calendriers et les copie ; ici, tu touches « Coller ».
            À créer une fois, environ 5 minutes. Le pas-à-pas est dans les réglages.</li>
        </ol>
        <p class="small muted">Tes liens et ton emploi du temps restent sur ce téléphone. Rien n'est envoyé ailleurs.</p>
        <a class="btn block" href="#/agenda-reglages">Ajouter mes calendriers</a>
        <button type="button" class="btn ghost block mt" data-action="agenda.coller">📋 Coller depuis le Raccourci</button>
      </section>`;
  }

  function dayNotes(date, info, rv, blocks) {
    const notes = [];
    if (rv && rv.enabled === false) notes.push('Révisions désactivées dans les réglages.');
    else if (rv && list(rv.daysOff).includes(U.dow(date))) notes.push(`Pas de révision le ${U.DAYS[U.dow(date)].toLowerCase()} (réglage).`);
    if (info && info.allDayBusy) notes.push('Journée occupée : pas de révision prévue.');
    else if (info && info.hasCivilProtection && info.pcLongest >= 240) notes.push('Grosse journée Protection civile : révisions réduites de moitié.');
    if (!blocks.length && !notes.length && date >= U.todayKey()) notes.push('Aucune révision à placer ce jour-là.');
    return notes.map((n) => `<p class="note small agd-note">${esc(n)}</p>`).join('');
  }

  function viewDay(params = {}) {
    if (!C.agenda) return unavailable();
    const today = U.todayKey();
    const date = U.isKey(params.date) ? params.date : today;
    if (params.vue === 'semaine') return viewWeek(date);
    ensureTasks();
    if (!list(ag().sources).length) return welcome();
    const rv = call('revision', ag().revision || {}) || {};
    const events = call('eventsOn', [], date) || [];
    const blocks = (call('schedule', [], date, date) || []).filter((b) => b && b.date === date);
    const sport = (call('busyIntervals', [], date) || []).find((x) => x.kind === 'sport') || null;
    const info = call('dayInfo', null, date);
    const allDay = events.filter((e) => e.allDay);
    const outside = events.filter((e) => !e.allDay && (e.endMin <= T_START || e.startMin >= T_END));
    const items = dayItems(date, events, blocks, sport);
    return `${header(date, 'jour')}
      ${weekSummary(date)}
      ${missedSection(date)}
      ${allDay.length || outside.length ? `<ul class="agd-chips" aria-label="Toute la journée">${allDay.concat(outside).map((e) => `<li>
        <button type="button" class="agd-chip ${e.busy ? '' : 'is-free'}" style="--c:${kindInfo(e.kind).color}" data-action="agenda.evenement" data-id="${esc(e.id)}" data-date="${esc(date)}">
          <span class="num">${esc(e.time)}</span> ${esc(e.title)}</button></li>`).join('')}</ul>` : ''}
      ${dayNotes(date, info, rv, blocks)}
      ${timeline(date, items, rv)}
      <section class="card" aria-labelledby="agd-revs-t">
        <div class="card-head"><h2 id="agd-revs-t" class="agd-h">Révisions du jour</h2>
          <span class="small muted num">${esc(fmtMin(blocks.reduce((n, b) => n + (b.minutes || 0), 0)))}</span></div>
        ${blocks.length ? `<ul class="agd-revs">${blocks.map((b) => blockRow(b)).join('')}</ul>`
          : '<p class="small muted">Rien de prévu. Les révisions apparaissent après tes cours (relecture le jour même, puis J+1, J+7, J+30) et avant tes examens.</p>'}
        ${sport ? `<p class="agd-sport-line"><span aria-hidden="true">🏃</span> Sport conseillé : <a class="link" href="#/jour/${esc(date)}"><b class="num">${esc(sport.start)}–${esc(sport.end)}</b> · ${esc(sport.title || 'séance')}</a></p>` : ''}
      </section>`;
  }

  /* ───────── Vue semaine ───────── */

  function viewWeek(date) {
    ensureTasks();
    if (!list(ag().sources).length) return welcome();
    const monday = U.mondayOf(date);
    const days = U.weekDays(monday);
    const blocks = call('schedule', [], monday, days[6]) || [];
    const today = U.todayKey();
    const rows = days.map((d) => {
      const evs = (call('eventsOn', [], d) || []);
      const bl = blocks.filter((b) => b.date === d);
      const sport = (call('busyIntervals', [], d) || []).find((x) => x.kind === 'sport');
      const lines = evs.map((e) => `<li class="agd-wl ${e.busy ? '' : 'is-free'}" style="--c:${kindInfo(e.kind).color}">
          <span class="agd-wl-t num">${esc(e.allDay ? 'Journée' : e.time)}</span><span class="agd-wl-n">${esc(e.title)}</span></li>`);
      if (sport) lines.push(`<li class="agd-wl" style="--c:${KIND_INFO.sport.color}"><span class="agd-wl-t num">${esc(sport.start)}–${esc(sport.end)}</span><span class="agd-wl-n">🏃 ${esc(sport.title || 'Sport')}</span></li>`);
      const counts = [];
      const nCours = evs.filter((e) => e.kind === 'cours' && !e.allDay).length;
      const nPc = evs.filter((e) => e.kind === 'protection-civile').length;
      if (nCours) counts.push(U.plural(nCours, 'cours', 'cours'));
      if (nPc) counts.push('Protection civile');
      if (bl.length) counts.push(`${fmtMin(bl.reduce((n, b) => n + b.minutes, 0))} de révision`);
      return `<li class="card agd-wday ${d === today ? 'is-today' : ''}">
        <a class="agd-wday-h" href="#/agenda/${esc(d)}" ${d === today ? 'aria-current="date"' : ''}>
          <span><b>${esc(U.fmtDate(d))}</b><small class="muted">${esc(counts.join(' · ') || 'Rien de prévu')}</small></span><span aria-hidden="true">›</span></a>
        ${lines.length ? `<ul class="agd-wls">${lines.join('')}</ul>` : ''}
        ${bl.length ? `<ul class="agd-revs">${bl.map((b) => blockRow(b)).join('')}</ul>` : ''}
      </li>`;
    }).join('');
    return `${header(date, 'semaine')}${weekSummary(date)}<ol class="agd-week">${rows}</ol>`;
  }

  /* ───────── Feuilles (modales) ───────── */

  function openBlockSheet(id) {
    const b = call('findBlock', null, id);
    if (!b) { toast('Ce créneau a changé : l\'agenda vient d\'être recalculé.'); rerender(); return; }
    const today = U.todayKey();
    const nm = nowMinutes();
    const ended = b.date < today || (b.date === today && toMin(b.end) <= nm);
    const tasks = list(b.tasks);
    const tip = KIND_TIPS[b.kind] || '';
    let actions;
    if (b.done) {
      actions = `<p class="note ok small">Fait ✓${b.doneAt ? ` (${esc(U.fmtShort(b.doneAt))})` : ''}</p>
        <button type="button" class="btn ghost block" data-action="agenda.bloc-annuler" data-id="${esc(b.id)}">Pas fait finalement</button>`;
    } else if (ended || b.missed) {
      actions = `<div class="agd-sheet-actions">
        <button type="button" class="btn block" data-action="agenda.bloc-fait" data-id="${esc(b.id)}">✓ Fait</button>
        <button type="button" class="btn ghost block" data-action="agenda.pasfait" data-id="${esc(b.id)}">Pas fait</button></div>
        <p class="small muted">« Pas fait » : ces révisions restent à faire et sont replacées plus tard.</p>`;
    } else {
      actions = `<div class="agd-sheet-actions">
        ${b.date <= today ? `<button type="button" class="btn block" data-action="agenda.bloc-fait" data-id="${esc(b.id)}">✓ Fait</button>` : ''}
        <button type="button" class="btn ghost block" data-action="agenda.bloc-reporter" data-id="${esc(b.id)}">Reporter à demain</button></div>
        <button type="button" class="link small" data-action="agenda.bloc-retirer" data-id="${esc(b.id)}">Ne pas faire ces révisions</button>`;
    }
    C.ui.openModal({
      title: b.subjectName ? `Révision · ${b.subjectName}` : 'Révision',
      body: `<p class="agd-sheet-time num">${esc(U.fmtDate(b.date))} · ${esc(b.start)}–${esc(b.end)} (${esc(fmtMin(b.minutes))})</p>
        ${tasks.length ? `<ul class="agd-tasks">${tasks.map((t) => `<li>${esc(t.title)}</li>`).join('')}</ul>` : `<p>${esc(b.title)}</p>`}
        ${tip ? `<p class="small muted">${esc(tip)}</p>` : ''}
        ${actions}`,
    });
  }

  function openEventSheet(id, date) {
    const d = U.isKey(date) ? date : U.todayKey();
    const ev = (call('eventsOn', [], d) || []).find((e) => e.id === id);
    if (!ev) { toast('Événement introuvable : le calendrier a peut-être changé.'); return; }
    const k = kindInfo(ev.kind);
    const rows = [
      ['Quand', `${U.fmtDate(d)} · ${ev.time}`],
      ev.location ? ['Lieu', ev.location] : null,
      ev.typeLabel ? ['Type', `${ev.typeCode} — ${ev.typeLabel}`] : null,
      ['Calendrier', `${ev.sourceName || k.label} (${k.label})`],
      ev.categories && ev.categories.length && !ev.typeLabel ? ['Catégories', ev.categories.join(', ')] : null,
    ].filter(Boolean);
    C.ui.openModal({
      title: ev.title || 'Événement',
      body: `<dl class="agd-dl">${rows.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
        ${ev.tentative ? '<p class="note warn small">À confirmer (événement provisoire).</p>' : ''}
        <p class="note small ${ev.busy ? '' : 'ok'}">${ev.busy ? 'Ce créneau bloque tes révisions et ta séance de sport (marges comprises).' : 'Informatif : ne bloque pas tes révisions.'}</p>`,
    });
  }

  // Un seul calendrier collé : dans quelle source le ranger ?
  function openDestinationSheet() {
    const sources = list(ag().sources);
    C.ui.openModal({
      title: 'Quel calendrier ?',
      body: `<p class="small">Ce texte contient un seul calendrier. Où le ranger ?</p>
        <div class="agd-dest">
          ${sources.map((s) => `<button type="button" class="btn ghost block" data-action="agenda.destination" data-src="${esc(s.id)}">Remplacer « ${esc(s.name)} »</button>`).join('')}
          <button type="button" class="btn ghost block" data-action="agenda.destination" data-kind="cours">Nouveau : mes cours</button>
          <button type="button" class="btn ghost block" data-action="agenda.destination" data-kind="protection-civile">Nouveau : Protection civile</button>
          <button type="button" class="btn ghost block" data-action="agenda.destination" data-kind="perso">Nouveau : perso</button>
        </div>`,
    });
  }

  // Dernier recours : afficher un texte à copier.
  function showText(title, text) {
    const sheet = C.ui.openModal({
      title,
      body: `<p class="small muted">Copie ce texte et enregistre-le dans un fichier .ics (Notes, Fichiers, mail à toi-même).</p>
        <textarea id="agd-share-text" rows="8" readonly aria-label="Contenu du calendrier">${esc(text)}</textarea>
        <button type="button" class="btn block mt" data-agd-copy>Copier</button>`,
    });
    if (sheet && sheet.addEventListener) {
      sheet.addEventListener('click', (e) => {
        if (!e.target.closest('[data-agd-copy]')) return;
        const ta = sheet.querySelector('#agd-share-text');
        if (C.copyText) C.copyText(ta); else { ta.focus(); ta.select(); }
      });
    }
  }

  /* ───────── Import (presse-papiers, texte, fichier) ───────── */

  function resultLines(results) {
    return list(results).map((r) => (r.ok
      ? `✓ ${r.name || 'Calendrier'} : ${U.plural(r.count || 0, 'événement', 'événements')}${r.error ? ` (${r.error})` : ''}`
      : `⚠️ ${r.name || 'Calendrier'} : ${r.error || 'import impossible'}`));
  }
  function afterImport(r) {
    ui.result = resultLines(r.results);
    ui.pasteOpen = false;
    ui.pending = null;
    const okN = list(r.results).filter((x) => x.ok).reduce((n, x) => n + (x.count || 0), 0);
    toast(r.ok ? `✓ ${U.plural(okN, 'événement importé', 'événements importés')}` : '⚠️ Import incomplet : regarde le détail');
    rerender();
  }
  // Texte collé : plusieurs calendriers (Raccourci) → import direct ; un seul → demander où le ranger.
  function handleText(text) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) { toast('Le presse-papiers est vide.'); return false; }
    const parts = C.agenda.parseBundle(t);
    if (parts.length === 1 && !parts[0].kind) {
      const probe = C.agenda.parseICS(t, 'tmp');
      if (probe.isHTML || !/BEGIN:(VCALENDAR|VEVENT)/i.test(t)) {
        ui.result = [`⚠️ ${probe.errors[0] || 'Ce texte n\'est pas un calendrier.'}`];
        toast('⚠️ Ce texte n\'est pas un calendrier');
        rerender();
        return false;
      }
      ui.pending = t;
      openDestinationSheet();
      return true;
    }
    afterImport(C.agenda.importText(t));
    return true;
  }
  function openPasteZone() {
    ui.pasteOpen = true;
    if (typeof C.currentRoute === 'function' && C.currentRoute() !== '#/agenda-reglages' && C.go) C.go('#/agenda-reglages');
    else rerender();
    setTimeout(() => { const ta = typeof document !== 'undefined' && document.getElementById('agd-paste'); if (ta) ta.focus(); }, 60);
  }

  /* ───────── Réglages ───────── */

  function sourceCard(s) {
    const k = kindInfo(s.kind);
    const busySync = ui.syncing.has(s.id);
    return `<li class="card agd-src" style="--c:${k.color}">
      <div class="agd-src-h"><span class="agd-src-i" aria-hidden="true">${k.icon}</span>
        <label class="grow"><span class="agd-sr">Nom du calendrier</span>
          <input type="text" value="${esc(s.name)}" maxlength="60" autocomplete="off" data-change="agenda.source" data-id="${esc(s.id)}" data-field="name" aria-label="Nom du calendrier"></label></div>
      <label class="field"><span>Type</span>
        <select data-change="agenda.source" data-id="${esc(s.id)}" data-field="kind">${KIND_OPTIONS.map((o) => `<option value="${esc(o.value)}" ${o.value === s.kind ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Lien iCal (reste sur ce téléphone)</span>
        <input type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…" value="${esc(s.url)}"
          data-change="agenda.source" data-id="${esc(s.id)}" data-field="url"></label>
      <label class="check-row"><input type="checkbox" ${s.busy !== false ? 'checked' : ''} data-change="agenda.source" data-id="${esc(s.id)}" data-field="busy">
        <span>Ces événements m'empêchent de réviser</span></label>
      <p class="small muted">${s.lastSyncAt ? `Mis à jour ${esc(ago(s.lastSyncAt))} · ${esc(U.plural(s.count || 0, 'événement', 'événements'))}` : 'Pas encore importé.'}</p>
      ${s.lastError ? `<p class="note warn small" role="status">${esc(s.lastError)}</p>` : ''}
      <div class="row gap wrap">
        <button type="button" class="btn small" data-action="agenda.sync" data-id="${esc(s.id)}" ${!s.url || busySync ? 'disabled' : ''}>${busySync ? 'Synchronisation…' : 'Synchroniser'}</button>
        <button type="button" class="btn ghost small danger" data-action="agenda.source-suppr" data-id="${esc(s.id)}">Supprimer</button>
      </div>
    </li>`;
  }

  function guideHTML(sources) {
    const cours = sources.find((s) => s.kind === 'cours');
    const pc = sources.find((s) => s.kind === 'protection-civile');
    const nameC = cours ? cours.name : 'Mes cours';
    const nameP = pc ? pc.name : 'Protection civile';
    const env = C.env || {};
    let url = '';
    try { if (env.http && !env.embedded && typeof location !== 'undefined') url = location.href.split('#')[0]; } catch (e) { url = ''; }
    const b = (s) => `<b class="agd-ios">${esc(s)}</b>`;
    return `<div class="agd-guide">
      <p>L'app ${b('Raccourcis')} (gratuite, déjà sur ton iPhone) peut lire tes deux calendriers et copier leur contenu.
        Tu le colles ensuite ici. À créer une seule fois, environ 5 minutes.</p>
      <p class="note small">Rien ne quitte ton téléphone : le raccourci lit tes liens et copie du texte, Crevare le lit.
        Les noms des actions peuvent varier un peu selon ta version d'iOS.</p>
      <h4>Avant de commencer</h4>
      <ul class="agd-steps">
        <li>Le lien iCal de ton emploi du temps (dans ton espace école : « iCal », « S'abonner » ou « Exporter »).</li>
        <li>Le lien iCal de tes événements Protection civile (eProtec : liste des événements, option d'abonnement ou d'export du calendrier).</li>
      </ul>
      <h4>Créer le raccourci</h4>
      <ol class="agd-steps">
        <li>Ouvre ${b('Raccourcis')}, onglet ${b('Raccourcis')}, touche ${b('+')} en haut à droite. Nomme-le ${b('Crevare Agenda')}.</li>
        <li>Touche ${b('Ajouter une action')}, cherche ${b('Texte')} et colle dedans le lien de ton calendrier de cours.</li>
        <li>Ajoute ${b('Obtenir le contenu de l\'URL')} : il prend le texte juste au-dessus.</li>
        <li>Ajoute de nouveau ${b('Texte')} et colle le lien Protection civile.</li>
        <li>Ajoute encore ${b('Obtenir le contenu de l\'URL')}.</li>
        <li>Ajoute ${b('Texte')} et écris exactement les 4 lignes ci-dessous. À la place de [contenu 1] et [contenu 2], touche l'endroit
          puis choisis la variable ${b('Contenu de l\'URL')} au-dessus du clavier (la première, puis la seconde) :
          <pre class="agd-pre">--CREVARE-SOURCE cours ${esc(nameC)}
[contenu 1]
--CREVARE-SOURCE protection-civile ${esc(nameP)}
[contenu 2]</pre></li>
        <li>Ajoute ${b('Copier dans le presse-papiers')}.</li>
        <li>Ajoute ${b('Ouvrir les URL')} avec l'adresse de Crevare${url ? ` : <code>${esc(url)}</code>` : ' (celle que tu ouvres dans Safari)'}.
          Si Crevare est installé sur ton écran d'accueil, saute cette étape et ouvre l'app depuis son icône :
          le raccourci l'ouvrirait dans Safari, qui ne voit pas les mêmes données.</li>
        <li>Lance le raccourci une première fois et autorise l'accès aux deux sites.</li>
        <li>Dans Crevare : ${b('Agenda')} → ${b('Réglages')} → ${b('Coller')}. L'iPhone te demande de confirmer : touche ${b('Coller')}.</li>
      </ol>
      <h4>Astuce : tous les matins, tout seul</h4>
      <p>Raccourcis → onglet ${b('Automatisation')} → ${b('+')} → ${b('Heure de la journée')} (par exemple 7:00, chaque jour)
        → ${b('Exécuter immédiatement')} → choisis ${b('Crevare Agenda')}. Le texte est prêt : il te reste à toucher « Coller ».</p>
    </div>`;
  }

  function subjectsSection() {
    const subjects = list(ag().subjects);
    const counts = new Map(list(call('subjectsFromEvents', [])).map((s) => [s.id, s.count || 0]));
    const rows = subjects.map((s) => `<li class="agd-subj ${s.ignore ? 'is-ignored' : ''}" style="--c:${colorVar(s.color)}">
      <div class="agd-subj-h">
        <span class="agd-dot" aria-hidden="true"></span>
        <input type="text" class="grow" value="${esc(s.name)}" maxlength="80" autocomplete="off" aria-label="Nom de la matière"
          data-change="agenda.matiere" data-id="${esc(s.id)}" data-field="name">
        <span class="small muted num">${esc(U.plural(counts.get(s.id) || 0, 'cours', 'cours'))}</span>
      </div>
      <div class="agd-subj-o">
        <label class="agd-inline"><span>Couleur</span>
          <select data-change="agenda.matiere" data-id="${esc(s.id)}" data-field="color" aria-label="Couleur de ${esc(s.name)}">
            ${COLORS().map((c) => `<option value="${esc(c)}" ${c === s.color ? 'selected' : ''}>${esc((C.agenda.COLOR_LABELS || {})[c] || c)}</option>`).join('')}</select></label>
        <label class="agd-inline"><span>Importance</span>
          <select data-change="agenda.matiere" data-id="${esc(s.id)}" data-field="weight" aria-label="Importance de ${esc(s.name)}">
            ${WEIGHTS.map((w) => `<option value="${w.value}" ${+s.weight === w.value ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}</select></label>
        <label class="check-row"><input type="checkbox" ${s.ignore ? 'checked' : ''} data-change="agenda.matiere" data-id="${esc(s.id)}" data-field="ignore">
          <span>Pas de révision</span></label>
      </div>
      <details class="agd-more"><summary>Mots reconnus dans les titres</summary>
        <input type="text" value="${esc(list(s.match).join(', '))}" autocomplete="off" autocapitalize="off" aria-label="Mots reconnus, séparés par des virgules"
          data-change="agenda.matiere" data-id="${esc(s.id)}" data-field="match">
        <p class="tiny muted">Séparés par des virgules. Un titre de cours qui contient un de ces mots compte pour cette matière.</p>
      </details>
    </li>`).join('');
    return `<section class="card" aria-labelledby="agd-subj-t">
      <div class="card-head"><h2 id="agd-subj-t">Matières</h2>
        <button type="button" class="btn ghost small" data-action="agenda.matieres-scan">Rechercher</button></div>
      <p class="small muted">Déduites des titres de tes cours. Renomme, choisis une couleur et l'importance (plus de préparation avant les examens),
        ou coche « Pas de révision » (sport, langues…).</p>
      ${rows ? `<ul class="agd-subjs">${rows}</ul>` : '<p class="small">Aucune matière pour l\'instant : importe ton emploi du temps.</p>'}
    </section>`;
  }

  function examsSection() {
    const today = U.todayKey();
    const subjects = list(ag().subjects).filter((s) => !s.ignore);
    const exams = list(ag().exams).filter((x) => x && x.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const name = (id) => { const s = subjectOf(id); return s ? s.name : ''; };
    const options = `<option value="">Sans matière</option>${subjects.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}`;
    return `<section class="card" aria-labelledby="agd-ex-t">
      <h2 id="agd-ex-t">Examens</h2>
      <p class="small muted">Détectés dans tes cours (Examen, Partiel, DS, Contrôle, CC, Évaluation, Soutenance) ou ajoutés ici.
        La préparation commence 14 jours avant et se resserre à l'approche.</p>
      ${exams.length ? `<ul class="agd-exams">${exams.map((x) => `<li>
        <span class="grow"><b>${esc(x.title || 'Examen')}</b><small class="muted">${esc(U.fmtDate(x.date))} · ${esc(U.relDays(U.daysBetween(today, x.date)))}${name(x.subjectId) ? ` · ${esc(name(x.subjectId))}` : ''} · ${x.source === 'auto' ? 'détecté' : 'ajouté'}</small></span>
        ${x.source !== 'auto' ? `<button type="button" class="icon-btn small" data-action="agenda.examen-suppr" data-id="${esc(x.id)}" aria-label="${esc('Supprimer ' + (x.title || 'cet examen'))}">✕</button>` : ''}
      </li>`).join('')}</ul>` : '<p class="small">Aucun examen à venir.</p>'}
      <details class="agd-more"><summary>Ajouter un examen</summary>
        <form data-form="agenda.examen-ajout" class="agd-form">
          <label class="field"><span>Intitulé</span><input type="text" name="title" maxlength="160" placeholder="ex. Partiel de thermodynamique" required></label>
          <label class="field"><span>Matière</span><select name="subjectId">${options}</select></label>
          <label class="field"><span>Date</span><input type="date" name="date" min="${esc(U.addDays(today, 1))}" required></label>
          <button type="submit" class="btn ghost block">Ajouter l'examen</button>
        </form>
      </details>
      <details class="agd-more"><summary>Ajouter une révision libre (DM, projet…)</summary>
        <form data-form="agenda.tache-ajout" class="agd-form">
          <label class="field"><span>Quoi</span><input type="text" name="title" maxlength="160" placeholder="ex. DM de mécanique" required></label>
          <label class="field"><span>Matière</span><select name="subjectId">${options}</select></label>
          <label class="field"><span>Durée (min)</span><input type="text" name="durationMin" inputmode="numeric" autocomplete="off" value="50"></label>
          <label class="field"><span>À faire avant le</span><input type="date" name="due" min="${esc(today)}" value="${esc(U.addDays(today, 3))}" required></label>
          <button type="submit" class="btn ghost block">Ajouter la révision</button>
        </form>
      </details>
    </section>`;
  }

  function rulesSection() {
    const rv = call('revision', {}) || {};
    const num = (key, label, hint) => `<label class="field inline"><span>${esc(label)}${hint ? `<small class="muted"> ${esc(hint)}</small>` : ''}</span>
      <input type="text" inputmode="numeric" autocomplete="off" class="agd-num" value="${esc(rv[key])}" data-change="agenda.regle" data-key="${esc(key)}" aria-label="${esc(label + ' (minutes)')}"></label>`;
    const time = (key, label) => `<label class="field inline"><span>${esc(label)}</span>
      <input type="time" value="${esc(rv[key])}" data-change="agenda.regle" data-key="${esc(key)}" aria-label="${esc(label)}"></label>`;
    const meal = rv.meal || {};
    return `<section class="card agd-rules" aria-labelledby="agd-rules-t">
      <h2 id="agd-rules-t">Règles de révision</h2>
      <label class="check-row"><input type="checkbox" ${rv.enabled !== false ? 'checked' : ''} data-change="agenda.regle" data-key="enabled">
        <span>Planifier mes révisions</span></label>
      ${time('latestEnd', 'Heure de fin max')}
      ${time('weekdayStart', 'Début en semaine')}
      ${time('weekendStart', 'Début le week-end')}
      <h4>Pauses et durées (minutes)</h4>
      ${num('bufferAfterMin', 'Marge après un cours ou un événement', '(trajet, pause)')}
      ${num('bufferBeforeMin', 'Marge avant un événement')}
      ${num('blockMin', 'Durée d\'un bloc')}
      ${num('breakMin', 'Pause entre deux blocs')}
      ${num('maxWeekdayMin', 'Maximum par jour de semaine')}
      ${num('maxWeekendMin', 'Maximum par jour de week-end')}
      <p class="tiny muted">Les jours avec 4 h ou plus de Protection civile, le maximum est divisé par deux.</p>
      <h4>Repas du soir (protégé)</h4>
      <div class="row gap">
        <label class="field grow"><span>De</span><input type="time" value="${esc(meal.start || '')}" data-change="agenda.repas" data-part="start" aria-label="Début du repas"></label>
        <label class="field grow"><span>À</span><input type="time" value="${esc(meal.end || '')}" data-change="agenda.repas" data-part="end" aria-label="Fin du repas"></label>
      </div>
      <p class="tiny muted">Le déjeuner (12:00–13:00) reste toujours libre.</p>
      <h4>Jours sans révision</h4>
      <div class="agd-days" role="group" aria-label="Jours sans révision">
        ${U.DAYS_ABBR.map((d, i) => { const on = list(rv.daysOff).includes(i); return `<button type="button" class="agd-day ${on ? 'is-on' : ''}" aria-pressed="${on ? 'true' : 'false'}"
          data-action="agenda.jour-off" data-day="${i}" aria-label="${esc(U.DAYS[i])}${on ? ' : pas de révision' : ''}">${esc(d)}</button>`; }).join('')}
      </div>
      <label class="check-row mt"><input type="checkbox" ${rv.avoidTrainingDays ? 'checked' : ''} data-change="agenda.regle" data-key="avoidTrainingDays">
        <span>Pas de révision les jours de séance de sport</span></label>
      <label class="field"><span>Relectures après un cours (jours)</span>
        <input type="text" inputmode="numeric" autocomplete="off" value="${esc(list(rv.spacing).join(', '))}" data-change="agenda.regle" data-key="spacing" aria-label="Relectures après un cours, en jours"></label>
      <p class="tiny muted">Par défaut 0, 1, 7, 30 : relecture le jour même (20–30 min), le lendemain (15–20 min), exercices à J+7 (40–50 min),
        fiche de synthèse à J+30 (30 min). Revoir un cours à intervalles croissants aide à le retenir.</p>
    </section>`;
  }

  function viewSettings() {
    if (!C.agenda) return unavailable();
    ensureTasks();
    const sources = list(ag().sources);
    const anyUrl = sources.some((s) => s.url);
    return `<header class="top"><a class="back" href="#/agenda">‹ Agenda</a><h1>Agenda & révisions</h1></header>
      ${ui.result ? `<div class="note small agd-result" role="status"><ul>${ui.result.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <button type="button" class="link small" data-action="agenda.resultat-ok">OK</button></div>` : ''}

      <section class="card" aria-labelledby="agd-imp-t">
        <h2 id="agd-imp-t">Mettre à jour mes calendriers</h2>
        <p class="small">Après avoir lancé le Raccourci iOS, touche « Coller ». Tu peux aussi importer un fichier .ics.</p>
        <button type="button" class="btn block" data-action="agenda.coller">📋 Coller</button>
        <label class="btn ghost block mt agd-file">📄 Importer un fichier .ics
          <input type="file" accept=".ics,text/calendar" data-change="agenda.fichier" aria-label="Choisir un fichier .ics"></label>
        ${anyUrl ? '<button type="button" class="btn ghost block mt" data-action="agenda.sync-tout">🔄 Synchroniser les liens</button>' : ''}
        <details class="agd-more" ${ui.pasteOpen ? 'open' : ''}><summary>Coller le texte à la main</summary>
          <textarea id="agd-paste" rows="5" aria-label="Texte du calendrier" placeholder="--CREVARE-SOURCE cours Mes cours&#10;BEGIN:VCALENDAR…"></textarea>
          <button type="button" class="btn ghost small mt" data-action="agenda.importer-texte">Importer ce texte</button>
        </details>
      </section>

      <section aria-labelledby="agd-src-t">
        <h2 id="agd-src-t" class="section">Mes calendriers</h2>
        ${sources.length ? `<ul class="list agd-srcs">${sources.map(sourceCard).join('')}</ul>` : '<p class="small muted">Aucun calendrier pour l\'instant.</p>'}
        <details class="card agd-more" ${sources.length ? '' : 'open'}><summary><b>Ajouter un calendrier</b></summary>
          <form data-form="agenda.source-ajout" class="agd-form">
            <label class="field"><span>Nom</span><input type="text" name="name" maxlength="60" placeholder="ex. Mes cours" autocomplete="off"></label>
            <label class="field"><span>Type</span><select name="kind">${KIND_OPTIONS.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>
            <label class="field"><span>Lien iCal (facultatif)</span><input type="url" name="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…"></label>
            <p class="tiny muted">Le lien direct ne marche que si le site l'autorise. Sinon, utilise le Raccourci iOS ci-dessous.</p>
            <button type="submit" class="btn ghost block">Ajouter</button>
          </form>
        </details>
      </section>

      <details class="card agd-guide-card" ${sources.some((s) => s.lastSyncAt) ? '' : 'open'}>
        <summary><b>Le Raccourci iOS, pas à pas</b></summary>${guideHTML(sources)}</details>

      ${subjectsSection()}
      ${examsSection()}
      ${rulesSection()}

      <section class="card" aria-labelledby="agd-exp-t">
        <h2 id="agd-exp-t">Mes révisions dans le calendrier de l'iPhone</h2>
        <p class="small">Exporte les révisions des 14 prochains jours (rappel 10 min avant). Réexporte quand ton emploi du temps change.</p>
        <button type="button" class="btn ghost block" data-action="agenda.exporter">📅 Exporter mes révisions (.ics)</button>
      </section>
      <p class="small muted center">Tes liens et ton emploi du temps restent sur ce téléphone.</p>`;
  }

  /* ───────── Carte « Aujourd'hui » ───────── */

  function todayCard(date) {
    if (!C.agenda) return '';
    const d = U.isKey(date) ? date : U.todayKey();
    ensureTasks();
    if (!list(ag().sources).length) {
      return `<section class="card agd-card agd-invite">
        <p><b>Révisions entre tes cours et tes gardes</b></p>
        <p class="small muted">Ajoute ton emploi du temps et la Protection civile : Crevare place tes révisions, jamais après 22 h.</p>
        <a class="btn ghost small" href="#/agenda-reglages">Ajouter mes calendriers</a></section>`;
    }
    const today = U.todayKey();
    const nm = nowMinutes();
    const events = (call('eventsOn', [], d) || []).filter((e) => d !== today || e.allDay || e.endMin > nm);
    const blocks = (call('schedule', [], d, d) || []).filter((b) => b.date === d);
    const missed = d === today ? call('missedBlocks', []) || [] : [];
    const sport = (call('busyIntervals', [], d) || []).find((x) => x.kind === 'sport');
    const shown = events.slice(0, 4);
    const rows = shown.map((e) => `<li class="agd-wl ${e.busy ? '' : 'is-free'}" style="--c:${kindInfo(e.kind).color}">
      <span class="agd-wl-t num">${esc(e.allDay ? 'Journée' : e.time)}</span><span class="agd-wl-n">${esc(e.title)}<small class="muted"> · ${esc(e.typeLabel || kindInfo(e.kind).label)}</small></span></li>`).join('');
    const more = events.length > shown.length ? `<li class="small muted">et ${esc(U.plural(events.length - shown.length, 'autre événement', 'autres événements'))}</li>` : '';
    const nothing = !events.length && !blocks.length && !missed.length && !sport;
    return `<section class="card agd-card" aria-labelledby="agd-card-t">
      <div class="card-head"><h2 id="agd-card-t">Agenda</h2><a class="link small agd-open" href="#/agenda/${esc(d)}">Ouvrir</a></div>
      ${rows || more ? `<ul class="agd-wls">${rows}${more}</ul>` : ''}
      ${sport ? `<p class="agd-sport-line"><span aria-hidden="true">🏃</span> Sport conseillé : <b class="num">${esc(sport.start)}–${esc(sport.end)}</b></p>` : ''}
      ${missed.length ? `<p class="small agd-h">Fait ?</p><ul class="agd-revs">${missed.map((b) => blockRow(b, { missed: true })).join('')}</ul>` : ''}
      ${blocks.length ? `<p class="small agd-h">Révisions</p><ul class="agd-revs">${blocks.map((b) => blockRow(b)).join('')}</ul>` : ''}
      ${nothing ? '<p class="small muted">Rien d\'autre de prévu aujourd\'hui.</p>' : ''}
    </section>`;
  }

  /* ───────── Actions ───────── */

  function register() {
    C.route('#/agenda', viewDay, { tab: '#/agenda', title: 'Agenda' });
    C.route('#/agenda/:date', viewDay, { tab: '#/agenda', title: 'Agenda' });
    C.route('#/agenda-reglages', viewSettings, { tab: '#/agenda', title: 'Agenda & révisions' });
    C.menuItem({ hash: '#/agenda-reglages', icon: '🗓', label: 'Agenda & révisions', desc: 'Calendriers, matières, examens, règles de révision', order: 15 });

    // Blocs de révision
    C.action('agenda.cocher', (el) => {
      const done = el.dataset.done === '1';
      if (!C.agenda.markBlock(el.dataset.id, done)) { toast('Ce créneau a changé : l\'agenda vient d\'être recalculé.'); rerender(); return; }
      toast(done ? '✓ Révision faite' : 'Révision décochée');
    });
    C.action('agenda.bloc', (el) => openBlockSheet(el.dataset.id));
    C.action('agenda.bloc-fait', (el) => { C.ui.closeModal(); if (C.agenda.markBlock(el.dataset.id, true)) toast('✓ Révision faite'); });
    C.action('agenda.bloc-annuler', (el) => { C.ui.closeModal(); C.agenda.markBlock(el.dataset.id, false); toast('Révision décochée'); });
    C.action('agenda.pasfait', (el) => { C.ui.closeModal(); C.agenda.markBlock(el.dataset.id, false); toast('Pas grave : c\'est replacé plus tard'); });
    C.action('agenda.bloc-reporter', (el) => { C.ui.closeModal(); if (C.agenda.postponeBlock(el.dataset.id, 1)) toast('Reporté à demain'); });
    C.action('agenda.bloc-retirer', async (el) => {
      const id = el.dataset.id;
      C.ui.closeModal();
      if (!(await C.ui.ask('Retirer ces révisions ? Elles ne seront plus proposées.', 'Retirer'))) return;
      if (C.agenda.skipBlock(id)) toast('Révisions retirées');
    });
    C.action('agenda.evenement', (el) => openEventSheet(el.dataset.id, el.dataset.date));

    // Import
    C.action('agenda.coller', () => {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (!nav || !nav.clipboard || typeof nav.clipboard.readText !== 'function') {
        toast('Colle le texte dans la zone (appui long → Coller)');
        openPasteZone();
        return undefined;
      }
      // Appel direct dans le geste : l'iPhone demande de confirmer « Coller ».
      return nav.clipboard.readText().then((text) => {
        if (!handleText(text) && !String(text || '').trim()) openPasteZone();
      }, () => {
        toast('Accès refusé : colle le texte dans la zone (appui long → Coller)');
        openPasteZone();
      });
    });
    C.action('agenda.importer-texte', () => {
      const ta = typeof document !== 'undefined' ? document.getElementById('agd-paste') : null;
      handleText(ta ? ta.value : '');
    });
    C.action('agenda.destination', (el) => {
      const text = ui.pending;
      C.ui.closeModal();
      if (!text) return;
      const r = el.dataset.src ? C.agenda.importText(text, el.dataset.src) : C.agenda.importText(text, null, { kind: el.dataset.kind });
      afterImport(r);
    });
    C.onChange('agenda.fichier', (el) => {
      const f = el.files && el.files[0];
      if (!f) return undefined;
      if (f.size > 5 * 1024 * 1024) { toast('⚠️ Fichier trop gros (5 Mo maximum)'); return undefined; }
      const read = typeof f.text === 'function' ? f.text() : new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = rej; r.readAsText(f);
      });
      return read.then((text) => { el.value = ''; handleText(text); }, () => toast('⚠️ Fichier illisible'));
    });
    C.action('agenda.resultat-ok', () => { ui.result = null; rerender(); });

    // Sources
    C.action('agenda.sync', async (el) => {
      const id = el.dataset.id;
      ui.syncing.add(id);
      rerender();
      let r;
      try { r = await C.agenda.sync(id); } finally { ui.syncing.delete(id); }
      toast(r && r.ok ? `✓ ${U.plural(r.count, 'événement', 'événements')}` : '⚠️ Synchronisation impossible : regarde le détail');
      rerender();
    });
    C.action('agenda.sync-tout', async () => {
      const res = await C.agenda.syncAll();
      const ok = res.filter((r) => r.ok).length;
      toast(ok === res.length ? '✓ Calendriers à jour' : `⚠️ ${res.length - ok} lien(s) bloqué(s) : utilise le Raccourci`);
      rerender();
    });
    C.action('agenda.source-suppr', async (el) => {
      const s = list(ag().sources).find((x) => x.id === el.dataset.id);
      if (!s) return;
      if (!(await C.ui.ask(`Supprimer « ${s.name} » et ses événements de l'agenda ?`, 'Supprimer', { danger: true }))) return;
      C.agenda.removeSource(s.id);
      toast('Calendrier supprimé');
    });
    C.onChange('agenda.source', (el) => {
      const f = el.dataset.field;
      const value = f === 'busy' ? el.checked : el.value;
      C.agenda.updateSource(el.dataset.id, { [f]: value });
    });
    C.onSubmit('agenda.source-ajout', (form, fd) => {
      const kind = String(fd.get('kind') || 'perso');
      C.agenda.addSource({ name: String(fd.get('name') || '').trim(), kind, url: String(fd.get('url') || '').trim() });
      toast('Calendrier ajouté');
    });

    // Matières
    C.onChange('agenda.matiere', (el) => {
      const f = el.dataset.field;
      const value = f === 'ignore' ? el.checked : el.value;
      C.agenda.updateSubject(el.dataset.id, { [f]: value });
    });
    C.action('agenda.matieres-scan', () => {
      const n = C.agenda.rescanSubjects();
      toast(n ? `${U.plural(n, 'nouvelle matière', 'nouvelles matières')}` : 'Aucune nouvelle matière');
    });

    // Examens et révisions libres
    C.onSubmit('agenda.examen-ajout', (form, fd) => {
      const date = String(fd.get('date') || '');
      if (!U.isKey(date)) { toast('Choisis une date'); return; }
      C.agenda.addExam({ title: String(fd.get('title') || '').trim(), subjectId: String(fd.get('subjectId') || ''), date });
      toast('Examen ajouté : préparation planifiée');
    });
    C.action('agenda.examen-suppr', async (el) => {
      if (!(await C.ui.ask('Supprimer cet examen et sa préparation ?', 'Supprimer', { danger: true }))) return;
      C.agenda.removeExam(el.dataset.id);
    });
    C.onSubmit('agenda.tache-ajout', (form, fd) => {
      const due = String(fd.get('due') || '');
      if (!U.isKey(due)) { toast('Choisis une date'); return; }
      C.agenda.addTask({ title: String(fd.get('title') || '').trim(), subjectId: String(fd.get('subjectId') || ''), durationMin: U.num(fd.get('durationMin')) || 50, due });
      toast('Révision ajoutée');
    });

    // Règles
    C.onChange('agenda.regle', (el) => {
      const key = el.dataset.key;
      const value = el.type === 'checkbox' ? el.checked : el.value;
      if (!C.agenda.setRevision(key, value)) { toast('Valeur non valable'); rerender(); }
    });
    C.onChange('agenda.repas', (el) => {
      const rv = call('revision', {}) || {};
      const meal = { ...(rv.meal || {}), [el.dataset.part]: el.value };
      C.agenda.setRevision('meal', meal);
    });
    C.action('agenda.jour-off', (el) => {
      const i = +el.dataset.day;
      const cur = list((call('revision', {}) || {}).daysOff);
      C.agenda.setRevision('daysOff', cur.includes(i) ? cur.filter((x) => x !== i) : cur.concat(i));
    });

    // Export .ics
    C.action('agenda.exporter', () => {
      const today = U.todayKey();
      const text = call('icsForRevisions', '', today, U.addDays(today, 13)) || '';
      const n = (text.match(/BEGIN:VEVENT/g) || []).length;
      if (!n) { toast('Aucune révision à venir à exporter'); return undefined; }
      if (C.health && typeof C.health.shareFile === 'function') {
        return C.health.shareFile('crevare-revisions.ics', text, 'text/calendar', { title: 'Révisions Crevare' }).then((res) => {
          if (res === 'copied') toast('Texte du calendrier copié');
          else if (res === 'shared' || res === 'downloaded') toast(`✓ ${U.plural(n, 'révision exportée', 'révisions exportées')}`);
        });
      }
      showText('Révisions (.ics)', text);
      return undefined;
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.agendaUI = {
    todayCard, viewDay, viewWeek, viewSettings,
    // Fonctions pures exposées pour les tests.
    _t: { layoutColumns, dayItems, fmtMin, ago, resultLines, guideHTML, handleText, ui },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
