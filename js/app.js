'use strict';

/* ════════════════════ Utilitaires ════════════════════ */

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAYS_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => dateKey(new Date());
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const dow = (k) => (parseKey(k).getDay() + 6) % 7; // 0 = lundi
const mondayOf = (k) => addDays(k, -dow(k));
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const fmtDate = (k) => { const d = parseKey(k); return `${DAYS[dow(k)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtShort = (k) => { const d = parseKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTime(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
// Accepte "3:45", "1:02:30" ou un nombre de secondes.
function parseTime(str) {
  str = String(str ?? '').trim().replace(',', '.');
  if (!str) return null;
  const parts = str.split(/[:'h]/).filter((p) => p !== '').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
function fmtBench(b, v) {
  if (v == null) return '—';
  if (b.unit === 'time') return fmtTime(v);
  if (b.unit === 'reps') return `${v} reps`;
  if (b.unit === 'palier') return `palier ${v}`;
  return `${v} ${b.unit}`;
}
const uid = () => Math.random().toString(36).slice(2, 9);

/* ════════════════════ Stockage ════════════════════ */

const STORE_KEY = 'crevare.v1';

function defaultState() {
  const t = todayKey();
  return {
    version: 1,
    startDate: t,
    goals: {
      ssa:     { name: 'SSA (Surveillant Sauveteur Aquatique)', date: addDays(t, 85) },
      hyrox:   { name: 'Hyrox', date: addDays(t, 270) },
      pompier: { name: 'Sapeur-pompier volontaire', date: addDays(t, 730) },
    },
    schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
    overrides: {},
    workouts: {},
    habits: DEFAULT_HABITS.map((h) => ({ ...h })),
    habitLog: {},
    benchmarks: {},
    settings: { sound: true },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) { /* stockage indisponible : on repart d'un état vierge */ }
  return defaultState();
}

let state = loadState();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('⚠️ Sauvegarde impossible sur cet appareil'); }
}

/* ════════════════════ Logique d'entraînement ════════════════════ */

const PHASE_ORDER = ['ssa', 'hyrox', 'pompier'];

function phaseStart(phase) {
  const i = PHASE_ORDER.indexOf(phase);
  return i === 0 ? state.startDate : addDays(state.goals[PHASE_ORDER[i - 1]].date, 1);
}

function phaseInfo(k) {
  let phase = PHASE_ORDER.find((p) => k <= state.goals[p].date) || 'pompier';
  const start = phaseStart(phase);
  const week = Math.max(1, Math.floor(daysBetween(mondayOf(start), k) / 7) + 1);
  const toGoal = daysBetween(k, state.goals[phase].date);
  const taper = toGoal >= 0 && toGoal <= 7;
  const deload = !taper && week % 4 === 0;
  return { phase, week, deload, taper, toGoal };
}

function sessionIdFor(k) {
  if (state.overrides[k]) return state.overrides[k];
  const info = phaseInfo(k);
  if (info.deload && dow(k) === 5) return 'test_day';
  return state.schedule[info.phase][dow(k)];
}

// Séance réellement associée au jour : celle déjà commencée/faite, sinon celle du planning.
function sessionOf(k) {
  return state.workouts[k]?.sessionId && SESSIONS[state.workouts[k].sessionId] ? state.workouts[k].sessionId : sessionIdFor(k);
}

function setsFor(ex, info) {
  return (info.deload || info.taper) && ex.sets > 2 ? ex.sets - 1 : ex.sets;
}

function isWorkoutDone(k) { return !!state.workouts[k]?.done; }

// Dernière performance enregistrée pour un exercice avant la date donnée.
function lastPerf(exId, beforeKey) {
  const keys = Object.keys(state.workouts).filter((k) => k < beforeKey).sort().reverse();
  for (const k of keys) {
    const sets = state.workouts[k].log?.[exId];
    if (sets && sets.some((s) => s.done)) return { date: k, sets: sets.filter((s) => s.done) };
  }
  return null;
}

function describePerf(ex, sets) {
  if (ex.track === 'load') {
    const best = sets.reduce((m, s) => (+s.kg || 0) > (+m.kg || 0) ? s : m, sets[0]);
    return `${sets.length} × ${best.reps || '?'} @ ${best.kg || '?'} kg`;
  }
  if (ex.track === 'reps') return sets.map((s) => s.reps || '?').join(' · ') + ' reps';
  if (ex.track === 'time') return sets.map((s) => fmtTime(s.sec) || '?').join(' · ');
  if (ex.track === 'dist') return sets.map((s) => (s.m || '?') + ' m').join(' · ');
  return `${sets.length} série(s)`;
}

function habitsDoneCount(k) {
  const log = state.habitLog[k] || {};
  return state.habits.filter((h) => log[h.id]).length;
}

function habitStreak(hid) {
  let k = todayKey(), n = 0;
  if (!state.habitLog[k]?.[hid]) k = addDays(k, -1);
  while (state.habitLog[k]?.[hid]) { n++; k = addDays(k, -1); }
  return n;
}

function workoutStreakWeeks() {
  // Semaines consécutives (la semaine en cours incluse si entamée) avec ≥ 3 séances faites.
  let monday = mondayOf(todayKey()), n = 0;
  const count = (m) => [0, 1, 2, 3, 4, 5, 6].filter((i) => isWorkoutDone(addDays(m, i))).length;
  if (count(monday) < 3) monday = addDays(monday, -7);
  while (count(monday) >= 3) { n++; monday = addDays(monday, -7); }
  return n;
}

/* ════════════════════ Rendu ════════════════════ */

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');

function locBadge(loc) {
  const l = LOCATIONS[loc];
  return `<span class="badge" style="--c:${l.color}">${l.icon} ${l.label}</span>`;
}
function goalTags(goals) {
  return goals.map((g) => `<span class="tag" style="--c:${GOAL_TAGS[g].color}">${GOAL_TAGS[g].label}</span>`).join('');
}

function countdownText(days) {
  if (days < 0) return 'passé';
  if (days === 0) return "aujourd'hui !";
  if (days < 60) return `J − ${days}`;
  const months = Math.floor(days / 30.4);
  return `${months} mois`;
}

function viewToday() {
  const t = todayKey();
  const info = phaseInfo(t);
  const sid = sessionOf(t);
  const s = SESSIONS[sid];
  const w = state.workouts[t];
  const goalDay = PHASE_ORDER.find((p) => state.goals[p].date === t);

  const goalsHtml = PHASE_ORDER.map((p) => {
    const g = state.goals[p];
    const d = daysBetween(t, g.date);
    const total = Math.max(1, daysBetween(phaseStart(p), g.date));
    const pct = Math.min(100, Math.max(0, 100 - (d / Math.max(total, d)) * 100));
    return `<div class="goal" style="--c:${GOAL_TAGS[p].color}">
      <div class="goal-top"><span>${GOAL_TAGS[p].label}</span><b>${countdownText(d)}</b></div>
      <div class="bar"><i style="width:${p === info.phase ? pct : 0}%"></i></div>
      <small>${fmtShort(g.date)} ${parseKey(g.date).getFullYear()}</small>
    </div>`;
  }).join('');

  let phaseNote = '';
  if (info.taper) phaseNote = `<p class="note warn">🎯 Semaine d'affûtage : volume réduit, intensité conservée. Dors beaucoup.</p>`;
  else if (info.deload) phaseNote = `<p class="note">🔋 Semaine allégée (1 série de moins) + journée tests samedi.</p>`;

  let btn;
  if (sid === 'rest') btn = '';
  else if (w?.done) btn = `<a class="btn ghost" href="#/s/${t}">✓ Séance faite — voir</a>`;
  else if (w) btn = `<a class="btn" href="#/s/${t}">Reprendre la séance</a>`;
  else btn = `<a class="btn" href="#/s/${t}">Commencer</a>`;

  return `
    <header class="top"><h1>${fmtDate(t)}</h1><p class="muted">Crevare — ${esc(PHASES[info.phase].label)} · semaine ${info.week}</p></header>
    ${goalDay ? `<div class="card hero"><h2>🔥 Jour J : ${esc(state.goals[goalDay].name)}</h2><p>Échauffe-toi bien, fais confiance à ton entraînement. Tu es prêt·e.</p></div>` : ''}
    <section class="goals">${goalsHtml}</section>
    <section class="card session-card" style="--c:${LOCATIONS[s.loc].color}">
      <div class="row between">${locBadge(s.loc)}<span class="muted">${s.duration ? `~${s.duration} min` : ''}</span></div>
      <h2>${esc(s.title)}</h2>
      <p class="muted">${esc(s.intro)}</p>
      ${phaseNote}
      <div class="row gap">${btn}<button class="btn ghost small" data-action="change-session" data-key="${t}">Changer</button></div>
    </section>
    <section class="card">
      <div class="row between"><h3>Habitudes du jour</h3><span class="muted">${habitsDoneCount(t)}/${state.habits.length}</span></div>
      ${habitChecklist(t)}
    </section>
    <section class="card">
      <h3>Focus du bloc</h3>
      <p class="muted">${esc(PHASES[info.phase].focus)}</p>
      ${weekStrip(mondayOf(t))}
    </section>`;
}

function habitChecklist(k) {
  const log = state.habitLog[k] || {};
  if (!state.habits.length) return `<p class="muted">Aucune habitude. Ajoute-en dans l'onglet Habitudes.</p>`;
  return `<ul class="habits">${state.habits.map((h) => `
    <li><button class="habit ${log[h.id] ? 'on' : ''}" data-action="toggle-habit" data-key="${k}" data-id="${h.id}">
      <span class="hicon">${esc(h.icon)}</span><span>${esc(h.name)}</span><span class="check">${log[h.id] ? '✓' : ''}</span>
    </button></li>`).join('')}</ul>`;
}

function weekStrip(monday) {
  const t = todayKey();
  return `<div class="strip">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const k = addDays(monday, i);
    const s = SESSIONS[sessionOf(k)];
    const done = isWorkoutDone(k);
    return `<a href="#/s/${k}" class="sday ${k === t ? 'today' : ''} ${done ? 'done' : ''}" style="--c:${LOCATIONS[s.loc].color}">
      <small>${DAYS_SHORT[i]}</small><span>${done ? '✓' : LOCATIONS[s.loc].icon}</span></a>`;
  }).join('')}</div>`;
}

let weekOffset = 0;
function viewWeek() {
  const monday = addDays(mondayOf(todayKey()), weekOffset * 7);
  const info = phaseInfo(monday);
  const t = todayKey();
  const doneCount = [0, 1, 2, 3, 4, 5, 6].filter((i) => isWorkoutDone(addDays(monday, i))).length;
  const counts = {};
  [0, 1, 2, 3, 4, 5, 6].forEach((i) => { const l = SESSIONS[sessionOf(addDays(monday, i))].loc; counts[l] = (counts[l] || 0) + 1; });

  return `
    <header class="top row between">
      <button class="icon-btn" data-action="week" data-d="-1" aria-label="Semaine précédente">‹</button>
      <div class="center"><h1>Semaine du ${fmtShort(monday)}</h1>
        <p class="muted">${esc(PHASES[info.phase].label)} · S${info.week}${info.deload ? ' · allégée' : ''}${info.taper ? ' · affûtage' : ''}</p></div>
      <button class="icon-btn" data-action="week" data-d="1" aria-label="Semaine suivante">›</button>
    </header>
    ${weekOffset ? `<p class="center"><button class="btn ghost small" data-action="week" data-d="0">Revenir à cette semaine</button></p>` : ''}
    <p class="muted center">${doneCount} séance(s) faite(s) · ${Object.entries(counts).filter(([l]) => l !== 'repos').map(([l, n]) => `${LOCATIONS[l].icon} ${n}`).join('  ')}</p>
    <ul class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const k = addDays(monday, i);
      const s = SESSIONS[sessionOf(k)];
      const done = isWorkoutDone(k);
      return `<li class="wday ${k === t ? 'today' : ''} ${done ? 'done' : ''}" style="--c:${LOCATIONS[s.loc].color}">
        <a href="#/s/${k}" class="wmain">
          <div class="wdate"><b>${DAYS[i].slice(0, 3)}</b><small>${parseKey(k).getDate()}</small></div>
          <div class="winfo"><span class="wtitle">${esc(s.title)}</span>
            <span class="muted small">${LOCATIONS[s.loc].icon} ${LOCATIONS[s.loc].label}${s.duration ? ` · ${s.duration} min` : ''}${state.overrides[k] ? ' · modifiée' : ''}</span></div>
          <div class="wstate">${done ? '✓' : ''}</div>
        </a>
        <button class="icon-btn small" data-action="change-session" data-key="${k}" aria-label="Changer la séance">⇄</button>
      </li>`;
    }).join('')}</ul>
    <p class="muted small center">Le planning type de chaque bloc se règle dans Réglages.</p>`;
}

/* ───── Séance ───── */

function viewSession(k) {
  const sid = sessionOf(k);
  const s = SESSIONS[sid];
  const info = phaseInfo(k);
  const w = state.workouts[k];
  const isFuture = k > todayKey();

  const exHtml = s.exercises.map((ex) => {
    const n = setsFor(ex, info);
    const log = w?.log?.[ex.id] || [];
    const prev = lastPerf(ex.id, k);
    const rows = Array.from({ length: n }, (_, i) => setRow(k, ex, i, log[i] || {}, prev?.sets[i] || prev?.sets[prev.sets.length - 1])).join('');
    const allDone = log.filter((x) => x?.done).length >= n;
    return `<li class="ex ${allDone ? 'done' : ''}">
      <div class="ex-head"><h3>${esc(ex.name)}</h3><span class="muted small">${n > 1 ? `${n} × ` : ''}${esc(ex.reps)}${ex.rest ? ` · repos ${fmtTime(ex.rest)}` : ''}</span></div>
      ${ex.note ? `<p class="muted small">${esc(ex.note)}</p>` : ''}
      ${prev ? `<p class="prev small">↺ ${fmtShort(prev.date)} : ${esc(describePerf(ex, prev.sets))}</p>` : ''}
      <div class="sets">${rows}</div>
    </li>`;
  }).join('');

  const footer = sid === 'rest' ? '' : w?.done
    ? `<div class="card"><p>✓ Terminée${w.rpe ? ` · effort ${w.rpe}/10` : ''}</p>${w.notes ? `<p class="muted">${esc(w.notes)}</p>` : ''}
       <button class="btn ghost small" data-action="reopen" data-key="${k}">Rouvrir la séance</button></div>`
    : `<div class="row gap wrap"><button class="btn" data-action="finish" data-key="${k}">Terminer la séance</button>
       <button class="btn ghost" data-action="quick-done" data-key="${k}">Marquer faite sans détail</button></div>`;

  return `
    <header class="top"><a href="#/semaine" class="back">‹ Semaine</a>
      <h1>${esc(s.title)}</h1>
      <p class="muted">${fmtDate(k)}${isFuture ? ' · à venir' : ''}</p>
      <div class="row gap wrap">${locBadge(s.loc)}${goalTags(s.goals)}${s.duration ? `<span class="muted small">~${s.duration} min</span>` : ''}</div>
    </header>
    <p class="intro">${esc(s.intro)}</p>
    ${info.taper ? `<p class="note warn">🎯 Affûtage : séries réduites, garde l'intensité mais arrête-toi frais.</p>` : info.deload ? `<p class="note">🔋 Semaine allégée : une série de moins sur les gros exercices.</p>` : ''}
    <ul class="exercises">${exHtml}</ul>
    ${footer}
    <button class="btn ghost small" data-action="change-session" data-key="${k}">Changer de séance</button>`;
}

function setRow(k, ex, i, v, prev) {
  const attr = (field) => `data-action="set-input" data-key="${k}" data-ex="${ex.id}" data-i="${i}" data-f="${field}"`;
  const ph = (val) => (val != null && val !== '' ? `placeholder="${esc(val)}"` : '');
  let inputs = '';
  if (ex.track === 'reps') inputs = `<input type="number" inputmode="numeric" min="0" ${attr('reps')} value="${esc(v.reps)}" ${ph(prev?.reps)}><span class="unit">reps</span>`;
  else if (ex.track === 'load') inputs = `<input type="number" inputmode="decimal" step="0.5" min="0" ${attr('kg')} value="${esc(v.kg)}" ${ph(prev?.kg)}><span class="unit">kg</span>
      <input type="number" inputmode="numeric" min="0" ${attr('reps')} value="${esc(v.reps)}" ${ph(prev?.reps)}><span class="unit">reps</span>`;
  else if (ex.track === 'time') inputs = `<input type="text" inputmode="decimal" ${attr('sec')} value="${esc(fmtTime(v.sec))}" ${ph(fmtTime(prev?.sec) || 'm:ss')}><span class="unit">temps</span>`;
  else if (ex.track === 'dist') inputs = `<input type="number" inputmode="decimal" min="0" ${attr('m')} value="${esc(v.m)}" ${ph(prev?.m)}><span class="unit">m</span>`;
  else inputs = `<span class="muted small">Série ${i + 1}</span>`;
  return `<div class="set ${v.done ? 'on' : ''}"><span class="snum">${i + 1}</span>${inputs}
    <button class="set-check" data-action="set-done" data-key="${k}" data-ex="${ex.id}" data-i="${i}" aria-label="Valider la série">✓</button></div>`;
}

function ensureWorkout(k) {
  if (!state.workouts[k]) state.workouts[k] = { sessionId: sessionIdFor(k), done: false, startedAt: Date.now(), log: {} };
  return state.workouts[k];
}

function finishWorkout(k, rpe, notes) {
  const w = ensureWorkout(k);
  w.done = true; w.finishedAt = Date.now(); w.rpe = rpe; w.notes = notes;
  // Alimente les tests de référence liés aux exercices.
  const s = SESSIONS[w.sessionId];
  s.exercises.filter((ex) => ex.bench).forEach((ex) => {
    const b = BENCHMARKS.find((x) => x.id === ex.bench);
    const vals = (w.log[ex.id] || []).filter((x) => x?.done).map((x) => ex.track === 'time' ? x.sec : ex.track === 'dist' ? +x.m : +x.reps).filter((x) => x > 0);
    if (!b || !vals.length) return;
    const best = b.lower ? Math.min(...vals) : Math.max(...vals);
    addBench(b.id, k, best);
  });
  save();
}

function addBench(id, k, value) {
  const list = (state.benchmarks[id] ||= []);
  const existing = list.find((e) => e.date === k);
  const b = BENCHMARKS.find((x) => x.id === id);
  if (existing) existing.value = b.lower ? Math.min(existing.value, value) : Math.max(existing.value, value);
  else list.push({ date: k, value });
  list.sort((a, c) => a.date.localeCompare(c.date));
}

/* ───── Habitudes ───── */

function viewHabits() {
  const t = todayKey();
  const days = Array.from({ length: 28 }, (_, i) => addDays(t, i - 27));
  const rows = state.habits.map((h) => {
    const done = days.filter((k) => state.habitLog[k]?.[h.id]).length;
    return `<li class="card habit-row">
      <div class="row between"><b>${esc(h.icon)} ${esc(h.name)}</b>
        <span class="muted small">🔥 ${habitStreak(h.id)} j · ${Math.round((done / 28) * 100)}%</span></div>
      <div class="grid28">${days.map((k) => `<button class="cell ${state.habitLog[k]?.[h.id] ? 'on' : ''} ${k === t ? 'today' : ''}"
        data-action="toggle-habit" data-key="${k}" data-id="${h.id}" title="${fmtDate(k)}"></button>`).join('')}</div>
      <div class="row end"><button class="link danger small" data-action="del-habit" data-id="${h.id}">Supprimer</button></div>
    </li>`;
  }).join('');

  return `
    <header class="top"><h1>Habitudes</h1><p class="muted">Aujourd'hui : ${habitsDoneCount(t)}/${state.habits.length}</p></header>
    <section class="card">${habitChecklist(t)}</section>
    <h2 class="section">4 dernières semaines</h2>
    <p class="muted small">Touche une case pour cocher un jour oublié.</p>
    <ul class="list">${rows}</ul>
    <form class="card row gap" data-form="add-habit">
      <input name="icon" class="emoji-in" maxlength="2" placeholder="✨" aria-label="Icône">
      <input name="name" required placeholder="Nouvelle habitude (ex : pas d'alcool)" aria-label="Nom de l'habitude">
      <button class="btn small">Ajouter</button>
    </form>`;
}

/* ───── Progrès ───── */

function sparkline(b, entries) {
  if (entries.length < 2) return '';
  const W = 280, H = 60, P = 6;
  const vals = entries.map((e) => e.value);
  const all = b.target != null ? [...vals, b.target] : vals;
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => P + (i / (entries.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  const pts = entries.map((e, i) => `${x(i).toFixed(1)},${y(e.value).toFixed(1)}`).join(' ');
  const target = b.target != null ? `<line x1="${P}" x2="${W - P}" y1="${y(b.target)}" y2="${y(b.target)}" class="tline"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" role="img" aria-label="Évolution ${esc(b.name)}">${target}
    <polyline points="${pts}" class="sline"/>${entries.map((e, i) => `<circle cx="${x(i)}" cy="${y(e.value)}" r="2.5" class="sdot"/>`).join('')}</svg>`;
}

function viewProgress() {
  const t = todayKey();
  const monthStart = t.slice(0, 8) + '01';
  const doneKeys = Object.keys(state.workouts).filter((k) => state.workouts[k].done);
  const thisMonth = doneKeys.filter((k) => k >= monthStart).length;
  const last28 = doneKeys.filter((k) => k > addDays(t, -28)).length;
  const planned28 = Array.from({ length: 28 }, (_, i) => addDays(t, -i)).filter((k) => k >= state.startDate && !['rest', 'mobility'].includes(sessionIdFor(k))).length;
  const byLoc = {};
  doneKeys.filter((k) => k > addDays(t, -28)).forEach((k) => { const l = SESSIONS[state.workouts[k].sessionId]?.loc; if (l) byLoc[l] = (byLoc[l] || 0) + 1; });

  // Carte d'activité : 16 semaines.
  const firstMonday = addDays(mondayOf(t), -15 * 7);
  const heat = Array.from({ length: 16 }, (_, w) => `<div class="hcol">${[0, 1, 2, 3, 4, 5, 6].map((d) => {
    const k = addDays(firstMonday, w * 7 + d);
    if (k > t) return `<i class="hcell future"></i>`;
    const wk = state.workouts[k];
    const hab = state.habits.length ? habitsDoneCount(k) / state.habits.length : 0;
    const cls = wk?.done ? 'w' : hab >= 0.6 ? 'h' : '';
    return `<i class="hcell ${cls}" title="${fmtDate(k)}"></i>`;
  }).join('')}</div>`).join('');

  const benchHtml = BENCHMARKS.map((b) => {
    const entries = state.benchmarks[b.id] || [];
    const last = entries[entries.length - 1];
    const first = entries[0];
    let delta = '';
    if (last && first && entries.length > 1) {
      const diff = last.value - first.value;
      const good = b.lower == null ? null : b.lower ? diff < 0 : diff > 0;
      const txt = b.unit === 'time' ? `${diff < 0 ? '−' : '+'}${fmtTime(Math.abs(diff))}` : `${diff > 0 ? '+' : ''}${+diff.toFixed(1)}`;
      delta = `<span class="delta ${good === true ? 'up' : good === false ? 'down' : ''}">${txt}</span>`;
    }
    const reached = last && b.target != null && (b.lower ? last.value <= b.target : last.value >= b.target);
    return `<li class="card bench" style="--c:${b.goal ? GOAL_TAGS[b.goal].color : '#94a3b8'}">
      <div class="row between"><b>${esc(b.name)}</b>${b.goal ? goalTags([b.goal]) : ''}</div>
      <div class="row between bench-val"><span class="big">${last ? fmtBench(b, last.value) : '—'}</span>${delta}</div>
      <p class="muted small">${b.target != null ? `Objectif ${b.lower ? '≤' : '≥'} ${fmtBench(b, b.target)} ${reached ? '· ✅ atteint' : ''}` : ''}${last ? ` · ${fmtShort(last.date)}` : ''}</p>
      ${sparkline(b, entries)}
      <div class="row gap"><button class="btn small" data-action="add-bench" data-id="${b.id}">+ Résultat</button>
        ${entries.length ? `<button class="btn ghost small" data-action="hist-bench" data-id="${b.id}">Historique</button>` : ''}</div>
    </li>`;
  }).join('');

  return `
    <header class="top"><h1>Progrès</h1></header>
    <section class="stats">
      <div class="stat"><b>${thisMonth}</b><small>séances ce mois</small></div>
      <div class="stat"><b>${planned28 ? Math.min(100, Math.round((last28 / planned28) * 100)) : 0}%</b><small>régularité 4 sem.</small></div>
      <div class="stat"><b>${workoutStreakWeeks()}</b><small>sem. ≥ 3 séances</small></div>
    </section>
    <section class="card">
      <h3>Activité (16 semaines)</h3>
      <div class="heat">${heat}</div>
      <p class="muted small"><i class="hcell w inline"></i> séance faite  <i class="hcell h inline"></i> habitudes ≥ 60 %</p>
      <p class="muted small">28 derniers jours : ${Object.entries(byLoc).map(([l, n]) => `${LOCATIONS[l].icon} ${n}`).join('  ') || 'aucune séance'}</p>
    </section>
    <h2 class="section">Tests de référence</h2>
    <p class="muted small">Remplis automatiquement par certaines séances (test SSA, apnée, 1 km, journée tests…), ou à la main.</p>
    <ul class="list">${benchHtml}</ul>`;
}

/* ───── Réglages ───── */

function viewSettings() {
  const opts = (sel) => Object.entries(SESSIONS).map(([id, s]) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${LOCATIONS[s.loc].icon} ${esc(s.title)}</option>`).join('');
  return `
    <header class="top"><h1>Réglages</h1></header>
    <section class="card">
      <h3>Dates des objectifs</h3>
      ${PHASE_ORDER.map((p) => `<label class="field"><span>${GOAL_TAGS[p].label} — ${esc(state.goals[p].name)}</span>
        <input type="date" data-action="goal-date" data-id="${p}" value="${state.goals[p].date}"></label>`).join('')}
      <label class="field"><span>Début du programme</span><input type="date" data-action="start-date" value="${state.startDate}"></label>
      <p class="muted small">Les blocs s'enchaînent : SSA jusqu'à sa date, puis Hyrox, puis Pompier. Toutes les 4 semaines : semaine allégée + journée tests.</p>
    </section>
    ${PHASE_ORDER.map((p) => `<section class="card">
      <h3>Semaine type — ${esc(PHASES[p].label)}</h3>
      <p class="muted small">${esc(PHASES[p].focus)}</p>
      ${DAYS.map((d, i) => `<label class="field inline"><span>${d}</span>
        <select data-action="schedule" data-phase="${p}" data-i="${i}">${opts(state.schedule[p][i])}</select></label>`).join('')}
      <button class="link small" data-action="reset-schedule" data-phase="${p}">Rétablir le planning conseillé</button>
    </section>`).join('')}
    <section class="card">
      <h3>Préférences</h3>
      <label class="field inline"><span>Son et vibration en fin de repos</span>
        <input type="checkbox" data-action="sound" ${state.settings.sound ? 'checked' : ''}></label>
    </section>
    <section class="card">
      <h3>Données</h3>
      <p class="muted small">Tout est stocké sur ce téléphone uniquement. Exporte régulièrement une sauvegarde.</p>
      <div class="row gap wrap">
        <button class="btn small" data-action="export">Exporter (JSON)</button>
        <label class="btn ghost small file">Importer<input type="file" accept="application/json" data-action="import" hidden></label>
        <button class="btn ghost small danger" data-action="reset-all">Tout effacer</button>
      </div>
    </section>
    <p class="muted small center">Crevare · ces séances sont des repères généraux, pas un avis médical. Fais valider ton aptitude par un médecin avant les épreuves.</p>`;
}

/* ════════════════════ Routeur ════════════════════ */

const TABS = [
  { hash: '#/', label: "Aujourd'hui", icon: '◉' },
  { hash: '#/semaine', label: 'Semaine', icon: '▦' },
  { hash: '#/habitudes', label: 'Habitudes', icon: '✓' },
  { hash: '#/progres', label: 'Progrès', icon: '↗' },
  { hash: '#/reglages', label: 'Réglages', icon: '⚙' },
];

function render() {
  const h = location.hash || '#/';
  let html;
  const m = h.match(/^#\/s\/(\d{4}-\d{2}-\d{2})$/);
  if (m) html = viewSession(m[1]);
  else if (h === '#/semaine') html = viewWeek();
  else if (h === '#/habitudes') html = viewHabits();
  else if (h === '#/progres') html = viewProgress();
  else if (h === '#/reglages') html = viewSettings();
  else html = viewToday();
  $app.innerHTML = html;

  const active = m ? '#/semaine' : (TABS.find((t) => t.hash === h) ? h : '#/');
  document.getElementById('tabs').innerHTML = TABS.map((t) =>
    `<a href="${t.hash}" class="${t.hash === active ? 'active' : ''}"><span>${t.icon}</span><small>${t.label}</small></a>`).join('');
}

function rerender() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ════════════════════ Modales & toasts ════════════════════ */

function openModal(html) {
  $modal.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  $modal.classList.add('open');
}
function closeModal() { $modal.classList.remove('open'); $modal.innerHTML = ''; }
$modal.addEventListener('click', (e) => { if (e.target === $modal || e.target.closest('[data-close]')) closeModal(); });

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

/* ════════════════════ Minuteur de repos ════════════════════ */

const timer = { end: 0, id: null };
const $timer = document.getElementById('timer');

function startRest(sec) {
  timer.end = Date.now() + sec * 1000;
  $timer.classList.add('open');
  clearInterval(timer.id);
  timer.id = setInterval(tickRest, 250);
  tickRest();
}
function tickRest() {
  const left = Math.ceil((timer.end - Date.now()) / 1000);
  if (left <= 0) { stopRest(); alertEnd(); return; }
  $timer.querySelector('b').textContent = fmtTime(left);
}
function stopRest() { clearInterval(timer.id); $timer.classList.remove('open'); }
function alertEnd() {
  if (!state.settings.sound) return;
  navigator.vibrate?.([200, 100, 200]);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
  } catch (e) { /* audio indisponible */ }
  toast('⏱️ Repos terminé — série suivante !');
}
$timer.addEventListener('click', (e) => {
  const a = e.target.closest('[data-t]')?.dataset.t;
  if (a === 'skip') stopRest();
  if (a === 'add') { timer.end += 15000; tickRest(); }
});

/* ════════════════════ Actions ════════════════════ */

function findEx(k, exId) { return SESSIONS[sessionOf(k)].exercises.find((e) => e.id === exId); }

const actions = {
  'toggle-habit'(el) {
    const { key, id } = el.dataset;
    const log = (state.habitLog[key] ||= {});
    if (log[id]) delete log[id]; else log[id] = true;
    save(); rerender();
  },
  'del-habit'(el) {
    const h = state.habits.find((x) => x.id === el.dataset.id);
    if (!confirm(`Supprimer « ${h.name} » ?`)) return;
    state.habits = state.habits.filter((x) => x.id !== h.id);
    save(); rerender();
  },
  week(el) { const d = +el.dataset.d; weekOffset = d === 0 ? 0 : weekOffset + d; rerender(); },
  'change-session'(el) {
    const k = el.dataset.key;
    const cur = sessionOf(k);
    const groups = Object.keys(LOCATIONS).map((loc) => {
      const items = Object.entries(SESSIONS).filter(([, s]) => s.loc === loc);
      if (!items.length) return '';
      return `<h4>${LOCATIONS[loc].icon} ${LOCATIONS[loc].label}</h4>${items.map(([id, s]) =>
        `<button class="pick ${id === cur ? 'on' : ''}" data-action="pick-session" data-key="${k}" data-id="${id}">
          <span>${esc(s.title)}</span><small class="muted">${s.duration ? `${s.duration} min` : ''} ${goalTags(s.goals)}</small></button>`).join('')}`;
    }).join('');
    openModal(`<div class="row between"><h3>${fmtDate(k)}</h3><button class="icon-btn" data-close>✕</button></div>
      <p class="muted small">Imprévu, salle fermée, fatigue ? Choisis une autre séance pour ce jour.</p>
      ${state.overrides[k] ? `<button class="btn ghost small" data-action="pick-session" data-key="${k}" data-id="">↺ Revenir au planning</button>` : ''}
      ${groups}`);
  },
  'pick-session'(el) {
    const { key, id } = el.dataset;
    const w = state.workouts[key];
    if (w && (w.done || Object.keys(w.log || {}).length) && !confirm('Une séance est déjà enregistrée pour ce jour. La remplacer ?')) return;
    if (id) state.overrides[key] = id; else delete state.overrides[key];
    delete state.workouts[key];
    save(); closeModal(); rerender();
  },
  'set-done'(el) {
    const { key, ex, i } = el.dataset;
    const w = ensureWorkout(key);
    const sets = (w.log[ex] ||= []);
    const v = (sets[+i] ||= {});
    // Si rien n'a été saisi, on reprend la valeur suggérée (dernière perf).
    if (!v.done) {
      el.closest('.set').querySelectorAll('input').forEach((inp) => {
        const f = inp.dataset.f;
        if (v[f] == null || v[f] === '') {
          const raw = inp.value || inp.placeholder;
          if (raw && raw !== 'm:ss') v[f] = f === 'sec' ? parseTime(raw) : raw;
        }
      });
    }
    v.done = !v.done;
    save(); rerender();
    const exDef = findEx(key, ex);
    if (v.done && exDef?.rest) startRest(exDef.rest);
  },
  finish(el) {
    const k = el.dataset.key;
    openModal(`<div class="row between"><h3>Bravo 💪</h3><button class="icon-btn" data-close>✕</button></div>
      <form data-form="finish" data-key="${k}">
        <label class="field"><span>Effort ressenti (RPE) : <b id="rpe-out">7</b>/10</span>
          <input type="range" name="rpe" min="1" max="10" value="7" oninput="document.getElementById('rpe-out').textContent=this.value"></label>
        <label class="field"><span>Notes (douleurs, sensations, conditions…)</span><textarea name="notes" rows="3"></textarea></label>
        <button class="btn">Enregistrer</button>
      </form>`);
  },
  'quick-done'(el) { finishWorkout(el.dataset.key, null, ''); toast('✓ Séance enregistrée'); rerender(); },
  reopen(el) { const w = state.workouts[el.dataset.key]; if (w) { w.done = false; save(); rerender(); } },
  'add-bench'(el) {
    const b = BENCHMARKS.find((x) => x.id === el.dataset.id);
    const hint = b.unit === 'time' ? 'm:ss (ex : 3:42)' : b.unit;
    openModal(`<div class="row between"><h3>${esc(b.name)}</h3><button class="icon-btn" data-close>✕</button></div>
      <form data-form="bench" data-id="${b.id}">
        <label class="field"><span>Date</span><input type="date" name="date" value="${todayKey()}" required></label>
        <label class="field"><span>Résultat (${hint})</span>
          <input name="value" required ${b.unit === 'time' ? 'inputmode="decimal"' : 'type="number" step="0.1" inputmode="decimal"'} autofocus></label>
        <button class="btn">Ajouter</button>
      </form>`);
  },
  'hist-bench'(el) {
    const b = BENCHMARKS.find((x) => x.id === el.dataset.id);
    const list = state.benchmarks[b.id] || [];
    openModal(`<div class="row between"><h3>${esc(b.name)}</h3><button class="icon-btn" data-close>✕</button></div>
      <ul class="hist">${list.slice().reverse().map((e) => `<li><span>${fmtShort(e.date)} ${parseKey(e.date).getFullYear()}</span><b>${fmtBench(b, e.value)}</b>
        <button class="link danger small" data-action="del-bench" data-id="${b.id}" data-date="${e.date}">✕</button></li>`).join('')}</ul>`);
  },
  'del-bench'(el) {
    const { id, date } = el.dataset;
    state.benchmarks[id] = (state.benchmarks[id] || []).filter((e) => e.date !== date);
    save(); rerender();
    actions['hist-bench'](el);
  },
  'reset-schedule'(el) {
    const p = el.dataset.phase;
    state.schedule[p] = [...DEFAULT_SCHEDULE[p]];
    save(); rerender(); toast('Planning rétabli');
  },
  export() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crevare-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'reset-all'() {
    if (!confirm('Effacer toutes tes données (séances, habitudes, tests) ? Exporte une sauvegarde avant.')) return;
    state = defaultState(); save(); location.hash = '#/'; render();
  },
};

const changeActions = {
  'set-input'(el) {
    const { key, ex, i, f } = el.dataset;
    const w = ensureWorkout(key);
    const sets = (w.log[ex] ||= []);
    const v = (sets[+i] ||= {});
    v[f] = f === 'sec' ? parseTime(el.value) : el.value;
    save();
  },
  'goal-date'(el) {
    if (!el.value) return;
    state.goals[el.dataset.id].date = el.value;
    const [a, b, c] = PHASE_ORDER.map((p) => state.goals[p].date);
    if (!(a < b && b < c)) toast('⚠️ Les dates doivent se suivre : SSA → Hyrox → Pompier');
    save();
  },
  'start-date'(el) { if (el.value) { state.startDate = el.value; save(); } },
  schedule(el) { state.schedule[el.dataset.phase][+el.dataset.i] = el.value; save(); },
  sound(el) { state.settings.sound = el.checked; save(); },
  import(el) {
    const file = el.files[0];
    if (!file) return;
    file.text().then((txt) => {
      const data = JSON.parse(txt);
      if (!data || data.version !== 1 || !data.goals) throw new Error('format');
      state = { ...defaultState(), ...data }; save(); render(); toast('✓ Données importées');
    }).catch(() => toast('⚠️ Fichier invalide'));
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action] || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  e.preventDefault();
  actions[el.dataset.action](el);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && changeActions[el.dataset.action]) changeActions[el.dataset.action](el);
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  if (form.dataset.form === 'add-habit') {
    state.habits.push({ id: uid(), name: fd.get('name').trim(), icon: fd.get('icon').trim() || '✨' });
    save(); rerender();
  } else if (form.dataset.form === 'finish') {
    finishWorkout(form.dataset.key, +fd.get('rpe'), fd.get('notes').trim());
    closeModal(); toast('✓ Séance enregistrée'); rerender();
  } else if (form.dataset.form === 'bench') {
    const b = BENCHMARKS.find((x) => x.id === form.dataset.id);
    const raw = fd.get('value');
    const val = b.unit === 'time' ? parseTime(raw) : parseFloat(String(raw).replace(',', '.'));
    if (val == null || isNaN(val)) { toast('⚠️ Valeur invalide'); return; }
    const list = (state.benchmarks[b.id] ||= []);
    const ex = list.find((x) => x.date === fd.get('date'));
    if (ex) ex.value = val; else list.push({ date: fd.get('date'), value: val });
    list.sort((a, c) => a.date.localeCompare(c.date));
    save(); closeModal(); rerender();
  }
});

/* ════════════════════ Démarrage ════════════════════ */

render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Rafraîchit la vue au retour sur l'app (changement de jour).
let lastDay = todayKey();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && todayKey() !== lastDay) { lastDay = todayKey(); render(); }
});
