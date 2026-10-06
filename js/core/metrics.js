/* Crevare — mesures et statistiques : tests de référence (meilleur, dernier, tendance), historique et
 * progression des exercices, charge sRPE, régularité, habitudes, poids, forme du jour.
 * Fonctions pures sur C.state (sauf addBench / updateBench / removeBench / recordsFromSession / forgetSession,
 * qui écrivent via C.store.update). Aucune dépendance au DOM : chargeable dans les tests Node. */
(function (C) {
  'use strict';
  const U = C.util;

  /* ───────── Constantes ───────── */

  const CONTEXTS = ['test', 'entrainement', 'officiel', 'ancien', 'sante'];
  const BEST_CONTEXTS = ['test', 'officiel']; // « meilleur » = mesures de test uniquement
  const LAST_CONTEXTS = ['test', 'entrainement', 'officiel', 'sante']; // tout sauf l'ancien format (non comparable)
  const TREND_DAYS = 90;
  const DAYS_PER_MONTH = 30.44;
  const PRUDENCE = 0.75; // projection : on suppose une progression un peu plus lente qu'aujourd'hui
  const PROJECTION_MAX_DAYS = 730;
  const HABIT_MILESTONE = 66; // Lally 2010 : médiane de 66 jours pour qu'une habitude devienne automatique

  // Champ de série selon l'unité du test, puis selon le type de saisie de l'exercice.
  const UNIT_FIELD = { time: 'sec', reps: 'reps', m: 'm', cm: 'cm', palier: 'palier', kg: 'kg', km: 'km' };
  const TRACK_FIELDS = { reps: ['reps'], load: ['kg', 'reps'], time: ['sec'], dist: ['m'], run: ['km', 'sec'], palier: ['palier'], cm: ['cm'], check: [] };
  const TRACK_FIELD = { reps: 'reps', load: 'kg', time: 'sec', dist: 'm', run: 'sec', palier: 'palier', cm: 'cm' };
  const ALL_FIELDS = ['reps', 'kg', 'sec', 'm', 'km', 'palier', 'cm'];

  // Exercices tenus (gainage, isométrie) : on progresse en ajoutant du temps.
  const HOLD = new Set(['plank', 'side_plank', 'hollow_hold', 'wall_sit', 'dead_hang', 'copenhagen_plank', 'single_leg_balance',
    'spanish_squat', 'swim_eggbeater', 'stretch_hamstrings', 'test_plank_max', 'test_wall_sit_max']);
  // Cardio en durée : même règle que la course (+5 min max toutes les 2 semaines).
  const DURATION = new Set(['bike_easy', 'walk_brisk']);
  // Parcours tractions : négatives → élastique → strictes.
  const PULL_CHAIN = ['pullup_negative', 'pullup_band', 'pullup_strict'];
  const LOWER_MUSCLES = ['quadriceps', 'fessiers', 'ischios', 'mollets', 'adducteurs'];
  const LOWER_IDS = new Set(['goblet_squat', 'back_squat', 'leg_press', 'split_squat_db', 'rdl', 'hip_thrust', 'leg_curl', 'step_up',
    'calf_raise', 'sled_push', 'sled_pull', 'farmers_carry', 'sandbag_lunge']);
  const LEG_ZONES = ['genou', 'cheville', 'hanche'];
  // « Douleur au genou », « à la cheville »…
  const ZONE_AT = { genou: 'au genou', cheville: 'à la cheville', epaule: 'à l\'épaule', dos: 'au dos', hanche: 'à la hanche', poignet: 'au poignet', coude: 'au coude', nuque: 'à la nuque', autre: 'ailleurs' };
  const KINDS = ['piscine', 'salle', 'course', 'maison', 'autre'];

  /* ───────── Accès défensifs ───────── */

  const st = () => C.state || {};
  const D = () => C.data || {};
  const benchDef = (id) => { try { return D().getBenchmark ? D().getBenchmark(id) : null; } catch (e) { return null; } };
  const exDef = (id) => { try { return D().getExercise ? D().getExercise(id) : null; } catch (e) { return null; } };
  const lowerOf = (id) => { const b = benchDef(id); return !!(b && b.lower); };
  const better = (a, b, lower) => (lower ? a < b : a > b);
  const sessionsList = () => Object.values(U.isObj(st().sessions) ? st().sessions : {}).filter((s) => U.isObj(s) && U.isKey(s.date));
  const finishedOrder = (a, b) => b.date.localeCompare(a.date) || (+b.finishedAt || 0) - (+a.finishedAt || 0);

  function durationOf(s) {
    if (C.sessions && typeof C.sessions.durationOf === 'function') return U.num(C.sessions.durationOf(s));
    if (U.num(s.durationMin)) return U.num(s.durationMin);
    if (s.startedAt && s.finishedAt) return Math.max(1, Math.round((s.finishedAt - s.startedAt) / 60000));
    return U.num(s.plannedMin);
  }

  // Une série contient-elle au moins une mesure ?
  function hasMeasure(track, set) {
    if (!set) return false;
    const fields = TRACK_FIELDS[track] || ALL_FIELDS;
    return fields.some((f) => set[f] != null && set[f] !== '' && isFinite(set[f]));
  }

  /* ───────── Tests de référence ───────── */

  // Entrées valides d'un test, de la plus ancienne à la plus récente. opts : { contexts, from, to }.
  function benchEntries(benchId, opts = {}) {
    const all = U.isObj(st().benchmarks) ? st().benchmarks : {};
    const list = all[benchId];
    if (!Array.isArray(list)) return [];
    const ctx = Array.isArray(opts.contexts) ? opts.contexts : null;
    return list
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => U.isObj(e) && U.isKey(e.date) && U.num(e.value) != null)
      .map(({ e, i }) => ({ e: { ...e, value: U.num(e.value), context: CONTEXTS.includes(e.context) ? e.context : 'test' }, i }))
      .filter(({ e }) => (!ctx || ctx.includes(e.context)) && (!opts.from || e.date >= opts.from) && (!opts.to || e.date <= opts.to))
      .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
      .map(({ e }) => e);
  }

  // Meilleure mesure de TEST (contextes test + officiel). Égalité : la première obtenue.
  function benchBest(benchId) {
    const lower = lowerOf(benchId);
    let best = null;
    for (const e of benchEntries(benchId, { contexts: BEST_CONTEXTS })) if (!best || better(e.value, best.value, lower)) best = e;
    return best;
  }

  // Dernière mesure, toutes sources sauf l'ancien format.
  function benchLast(benchId) {
    const list = benchEntries(benchId, { contexts: LAST_CONTEXTS });
    return list.length ? list[list.length - 1] : null;
  }

  // Tendance : régression linéaire sur les 90 derniers jours (tests + entraînement), en unité par mois.
  // → { perMonth, direction:'mieux'|'moins-bien'|'stable', n, slope (par jour), intercept, from } ou null (< 3 points).
  function benchTrend(benchId, opts = {}) {
    const today = U.isKey(opts.today) ? opts.today : U.todayKey();
    const from = U.addDays(today, -(opts.days || TREND_DAYS));
    const pts = benchEntries(benchId, { contexts: opts.contexts || LAST_CONTEXTS, from, to: today });
    if (pts.length < 3) return null;
    const t = U.linearTrend(pts.map((e) => ({ x: U.daysBetween(from, e.date), y: e.value })));
    if (!t) return null; // toutes les mesures le même jour
    const perMonth = t.slope * DAYS_PER_MONTH;
    const b = benchDef(benchId);
    const step = (b && b.step) || 1;
    const threshold = Math.max(step / 2, Math.abs(U.mean(pts.map((e) => e.value))) * 0.005);
    const lower = !!(b && b.lower);
    const direction = Math.abs(perMonth) < threshold ? 'stable' : (lower ? perMonth < 0 : perMonth > 0) ? 'mieux' : 'moins-bien';
    return { perMonth: U.round(perMonth, 3), direction, n: pts.length, slope: t.slope, intercept: t.intercept, from };
  }

  // « −4 s/mois », « +1,5 rep/mois », « +0,5 palier/mois »
  function fmtPerMonth(unit, v) {
    if (v == null || !isFinite(v)) return '';
    const a = Math.abs(v);
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    let txt;
    switch (unit) {
      case 'time': txt = a >= 60 ? U.formatDuration(a) : `${U.fmtNum(a, a < 10 ? 1 : 0)} s`; break;
      case 'reps': txt = `${U.fmtNum(a, 1)} rep${a >= 2 ? 's' : ''}`; break;
      case 'palier': txt = `${U.fmtNum(a, 1)} palier`; break;
      case 'm': txt = `${U.fmtNum(a, 1)} m`; break;
      case 'cm': txt = `${U.fmtNum(a, 1)} cm`; break;
      case 'kg': txt = `${U.fmtNum(a, 1)} kg`; break;
      case 'km': txt = `${U.fmtNum(a, 2)} km`; break;
      default: txt = U.fmtNum(a, 2);
    }
    return `${sign}${txt}/mois`;
  }
  function fmtTrend(benchId, trend) {
    if (!trend) return '';
    const b = benchDef(benchId);
    return fmtPerMonth(b ? b.unit : '', trend.perMonth);
  }

  // Projection prudente de la date d'atteinte d'une cible : seulement si la tendance est favorable et
  // calculée sur au moins 4 points. → { reached:true } | { date, days, n } | { beyond:true, n } | null.
  function benchProjection(benchId, targetValue, opts = {}) {
    const target = U.num(targetValue);
    if (target == null) return null;
    const lower = lowerOf(benchId);
    const ref = benchBest(benchId);
    if (ref && (lower ? ref.value <= target : ref.value >= target)) return { reached: true };
    const t = benchTrend(benchId, opts);
    if (!t || t.direction !== 'mieux' || t.n < 4) return null;
    const today = U.isKey(opts.today) ? opts.today : U.todayKey();
    const now = t.intercept + t.slope * U.daysBetween(t.from, today);
    const days = (target - now) / (t.slope * PRUDENCE);
    if (!isFinite(days)) return null;
    const d = Math.max(0, Math.ceil(days));
    if (d > PROJECTION_MAX_DAYS) return { beyond: true, n: t.n };
    return { date: U.addDays(today, d), days: d, n: t.n };
  }

  function cleanEntry(input, keepId) {
    return {
      id: keepId || (input.id ? String(input.id).slice(0, 80) : U.uid()),
      date: U.isKey(input.date) ? input.date : U.todayKey(),
      value: U.num(input.value),
      context: CONTEXTS.includes(input.context) ? input.context : 'test',
      source: String(input.source || '').slice(0, 120),
      note: String(input.note || '').slice(0, 300),
    };
  }
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date));

  // Ajoute une mesure. Une entrée de même source (non vide) et même date est remplacée. Renvoie l'entrée ou null.
  function addBench(benchId, input = {}, opts = {}) {
    if (!benchId || !U.isObj(input) || U.num(input.value) == null) return null;
    let entry = cleanEntry(input);
    C.store.update((s) => {
      if (!U.isObj(s.benchmarks)) s.benchmarks = {};
      const list = Array.isArray(s.benchmarks[benchId]) ? s.benchmarks[benchId] : [];
      const old = entry.source ? list.find((x) => U.isObj(x) && x.source === entry.source && x.date === entry.date) : null;
      if (old && !input.id) entry = { ...entry, id: old.id || entry.id };
      const kept = list.filter((x) => x !== old);
      kept.push(entry);
      s.benchmarks[benchId] = kept.sort(byDate);
    }, { silent: !!opts.silent });
    return entry;
  }

  // Modifie une mesure (date, valeur, contexte, note). Renvoie l'entrée modifiée ou null.
  function updateBench(benchId, entryId, patch = {}, opts = {}) {
    let out = null;
    C.store.update((s) => {
      const list = U.isObj(s.benchmarks) && Array.isArray(s.benchmarks[benchId]) ? s.benchmarks[benchId] : null;
      const i = list ? list.findIndex((x) => U.isObj(x) && x.id === entryId) : -1;
      if (i < 0) return;
      const next = cleanEntry({ ...list[i], ...patch }, list[i].id);
      if (next.value == null) return;
      list[i] = next;
      list.sort(byDate);
      out = next;
    }, { silent: !!opts.silent });
    return out;
  }

  function removeBench(benchId, entryId, opts = {}) {
    let removed = false;
    C.store.update((s) => {
      const list = U.isObj(s.benchmarks) && Array.isArray(s.benchmarks[benchId]) ? s.benchmarks[benchId] : null;
      if (!list) return;
      const kept = list.filter((x) => !(U.isObj(x) && x.id === entryId));
      removed = kept.length !== list.length;
      if (kept.length) s.benchmarks[benchId] = kept; else delete s.benchmarks[benchId];
    }, { silent: !!opts.silent });
    return removed;
  }

  // Mesures d'une séance terminée (fonction pure) : pour chaque test lié (item.bench, sinon le test de
  // l'exercice), la meilleure série MESURÉE. Test → 'test' (ou 'officiel' le jour J), sinon 'entrainement'.
  function sessionRecords(session) {
    if (!U.isObj(session) || session.status !== 'done' || !U.isKey(session.date)) return [];
    const byBench = {};
    for (const item of Array.isArray(session.exercises) ? session.exercises : []) {
      if (!U.isObj(item) || item.skipped) continue;
      const ex = item.bench ? null : exDef(item.exId);
      const benchId = item.bench || (ex && ex.bench) || null;
      if (!benchId) continue;
      const isTest = item.bench ? !!item.test : !!(ex && ex.cat === 'test');
      const b = benchDef(benchId);
      const field = (b && UNIT_FIELD[b.unit]) || TRACK_FIELD[item.track] || null;
      if (!field) continue;
      const lower = !!(b && b.lower);
      const sets = Array.isArray((session.log || {})[item.key]) ? session.log[item.key] : [];
      for (const s of sets) {
        if (!U.isObj(s) || !s.done || s.measured === false) continue;
        const v = U.num(s[field]);
        if (v == null || !isFinite(v)) continue;
        if ((field === 'sec' || field === 'km') && v <= 0) continue;
        if (field !== 'cm' && v < 0) continue;
        const slot = (byBench[benchId] = byBench[benchId] || { test: null, train: null, lower });
        const k = isTest ? 'test' : 'train';
        if (slot[k] == null || better(v, slot[k], lower)) slot[k] = v;
      }
    }
    const official = session.kind === 'event';
    return Object.entries(byBench).map(([benchId, s]) => (s.test != null
      ? { benchId, value: s.test, context: official ? 'officiel' : 'test' }
      : { benchId, value: s.train, context: 'entrainement' })).filter((r) => r.value != null);
  }

  // Écrit les mesures d'une séance. Idempotent : les entrées de cette séance (source 'seance:<id>') sont
  // d'abord retirées, donc réenregistrer une séance corrigée remplace (et une séance rouverte n'écrit rien).
  function recordsFromSession(session, opts = {}) {
    if (!U.isObj(session) || !session.id) return [];
    const source = 'seance:' + session.id;
    const recs = sessionRecords(session);
    C.store.update((s) => {
      if (!U.isObj(s.benchmarks)) s.benchmarks = {};
      const all = s.benchmarks;
      const oldIds = {};
      for (const id of Object.keys(all)) {
        if (!Array.isArray(all[id])) continue;
        const kept = all[id].filter((e) => {
          if (U.isObj(e) && e.source === source) { oldIds[id] = e.id; return false; }
          return true;
        });
        if (kept.length !== all[id].length) { if (kept.length) all[id] = kept; else delete all[id]; }
      }
      for (const r of recs) {
        const list = Array.isArray(all[r.benchId]) ? all[r.benchId] : (all[r.benchId] = []);
        list.push({ id: oldIds[r.benchId] || U.uid(), date: session.date, value: r.value, context: r.context, source, note: '' });
        list.sort(byDate);
      }
    }, { silent: opts.silent !== false });
    return recs;
  }

  // Retire les mesures écrites par une séance (à appeler quand la séance est supprimée).
  function forgetSession(sessionId, opts = {}) {
    if (!sessionId) return;
    recordsFromSession({ id: sessionId, status: 'deleted' }, opts);
  }

  /* ───────── Exercices : historique et progression ───────── */

  // Séances terminées contenant l'exercice, plus récentes d'abord : [{ date, sessionId, sets, key, track, reps }].
  // sets = séries validées (mesurées ou non). opts : { limit, before (date exclue) }.
  function exerciseHistory(exId, opts = {}) {
    const limit = opts.limit > 0 ? opts.limit : Infinity;
    const out = [];
    for (const s of sessionsList()) {
      if (s.status !== 'done' || (opts.before && s.date >= opts.before)) continue;
      for (const it of Array.isArray(s.exercises) ? s.exercises : []) {
        if (!U.isObj(it) || it.exId !== exId) continue;
        const sets = (Array.isArray((s.log || {})[it.key]) ? s.log[it.key] : []).filter((x) => U.isObj(x) && x.done);
        if (!sets.length) continue;
        out.push({ date: s.date, sessionId: s.id, sets: sets.map((x) => ({ ...x })), key: it.key, track: it.track || null, reps: it.reps || '', finishedAt: s.finishedAt });
      }
    }
    out.sort(finishedOrder);
    return out.slice(0, limit).map(({ finishedAt, ...rest }) => rest);
  }

  // Dernière performance MESURÉE avant une date (exclue) : { date, sessionId, sets } ou null.
  function lastPerformance(exId, beforeDate) {
    const ex = exDef(exId);
    for (const h of exerciseHistory(exId, { before: U.isKey(beforeDate) ? beforeDate : null })) {
      const track = h.track || (ex && ex.track);
      const sets = h.sets.filter((x) => x.measured !== false && hasMeasure(track, x));
      if (sets.length) return { date: h.date, sessionId: h.sessionId, sets };
    }
    return null;
  }

  // Fourchette de répétitions d'une prescription : « 8–12 » → [8, 12] ; « 10 par jambe » → [10, 10].
  function parseRange(text, target) {
    const s = String(text || '');
    let m = s.match(/(\d+)\s*(?:–|—|-|à)\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2])].sort((a, b) => a - b);
    if (!/max/i.test(s) && !/\d\s*(s|sec|min|m|km)\b/i.test(s)) {
      m = s.match(/(\d+)/);
      if (m && Number(m[1]) > 0) return [Number(m[1]), Number(m[1])];
    }
    const t = U.num(target && target.reps);
    return t ? [t, t] : null;
  }

  function isLowerBody(exId, ex) {
    if (LOWER_IDS.has(exId)) return true;
    const mus = (ex && Array.isArray(ex.muscles) ? ex.muscles : []);
    return mus.length > 0 && LOWER_MUSCLES.includes(mus[0]);
  }

  // Exercice en temps : tenue (on ajoute du temps), effort chronométré (plus bas = mieux) ou durée de cardio.
  function timeKind(exId, ex) {
    if (HOLD.has(exId)) return 'hold';
    if (DURATION.has(exId)) return 'duration';
    const b = ex && ex.bench ? benchDef(ex.bench) : null;
    if (b) return b.lower ? 'effort' : 'hold';
    const cat = ex && ex.cat;
    if (['gainage', 'prevention', 'mobilite'].includes(cat)) return 'hold';
    if (['natation', 'sauvetage', 'hyrox', 'course'].includes(cat)) return 'effort';
    return null;
  }

  const maxPain = (p) => Math.max(0, ...Object.values(U.isObj(p) ? p : {}).map(Number).filter((n) => isFinite(n)));

  // Douleur maximale notée à la dernière séance terminée (et à la séance de l'historique), et au check-in du jour.
  function recentPain(lastEntry) {
    const today = U.todayKey();
    const done = sessionsList().filter((s) => s.status === 'done' && s.date <= today).sort(finishedOrder);
    let p = done.length ? maxPain(done[0].pain) : 0;
    const hs = lastEntry && lastEntry.sessionId && U.isObj(st().sessions) ? st().sessions[lastEntry.sessionId] : null;
    if (hs) p = Math.max(p, maxPain(hs.pain));
    const ci = U.isObj(st().checkins) ? st().checkins[today] : null;
    if (U.isObj(ci)) p = Math.max(p, maxPain(ci.pain));
    return p;
  }

  const fmtKg = (v) => `${U.fmtNum(v, 2)} kg`;
  const fmtSec = (v) => (v < 60 ? `${Math.round(v)} s` : U.formatDuration(v));
  function fmtMin(sec) {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${U.pad(m % 60)}` : `${m} min`;
  }
  const roundTo = (v, step) => Math.round(v / step) * step;

  function testSuggestion(c) {
    const b = benchDef(c.item.bench);
    if (c.pain >= 4) return { text: 'Douleur notée la dernière fois : fais ce test seulement si tout va bien, sinon reporte-le.', target: {} };
    const best = benchBest(c.item.bench);
    if (!best) return null;
    const field = (b && UNIT_FIELD[b.unit]) || TRACK_FIELD[c.track] || 'reps';
    const val = D().formatBench ? D().formatBench(c.item.bench, best.value) : String(best.value);
    return { text: `Ton record : ${val} (${U.fmtShort(best.date)}). Donne ton maximum, sans forcer sur une douleur.`, target: { [field]: best.value } };
  }

  function loadSuggestion(c) {
    const { item, ex, last, hist, nSets } = c;
    const kgOf = (s) => U.num(s.kg);
    const repsOf = (s) => U.num(s.reps) || 0;
    const sets = last.sets.filter((s) => kgOf(s) != null);
    if (!sets.length) return null;
    const kg = Math.max(...sets.map(kgOf));
    const top = sets.filter((s) => kgOf(s) === kg);
    const [lo, hi] = parseRange(item.reps, item.target) || [Math.min(...top.map(repsOf)), Math.max(...top.map(repsOf))];
    const assisted = /assist/.test(item.exId);
    const lower = isLowerBody(item.exId, ex);
    const inc = kg < 12 && !assisted ? 2 : lower ? 5 : 2.5;
    if (c.pain >= 4) return { text: `Douleur notée la dernière fois : reste à ${fmtKg(kg)} (ou allège), sans chercher à progresser.`, target: { kg, reps: lo } };
    if (top.length >= nSets && top.every((s) => repsOf(s) >= hi)) {
      const next = assisted ? Math.max(0, kg - inc) : kg + inc;
      return {
        text: assisted ? `Toutes tes séries à ${hi} : baisse l'assistance à ${fmtKg(next)} et repars à ${lo}.`
          : `Toutes tes séries à ${hi} reps : passe à ${fmtKg(next)}${kg < 12 ? ' (haltère suivant)' : ''} et repars à ${lo}.`,
        target: { kg: next, reps: lo },
      };
    }
    if (sets.filter((s) => repsOf(s) < lo).length >= 2) return { text: `Garde ${fmtKg(kg)} : vise d'abord ${lo} reps sur chaque série.`, target: { kg, reps: lo } };
    // Stagnation : 3 séances à la même charge sans gagner de répétitions → −10 %, puis on remonte.
    const recent = hist.slice(0, 3).map((h) => {
      const at = h.sets.filter((s) => kgOf(s) === kg);
      return at.length ? at.reduce((a, s) => a + repsOf(s), 0) : null;
    });
    if (recent.length === 3 && recent.every((v) => v != null) && recent[0] <= recent[2]) {
      const down = assisted ? roundTo(kg * 1.1, 2.5) : Math.min(kg - 1, roundTo(kg * 0.9, kg >= 20 ? 2.5 : 1));
      return { text: `3 séances sans progrès à ${fmtKg(kg)} : repars à ${fmtKg(Math.max(0, down))} puis remonte.`, target: { kg: Math.max(0, down), reps: hi } };
    }
    const minR = Math.min(...top.map(repsOf));
    return { text: `Garde ${fmtKg(kg)} et ajoute 1 rep par série (objectif ${hi}).`, target: { kg, reps: Math.min(hi, Math.max(lo, minR + 1)) } };
  }

  function repsSuggestion(c) {
    const { item, ex, last, nSets } = c;
    const reps = last.sets.map((s) => U.num(s.reps)).filter((v) => v != null);
    if (!reps.length) return null;
    const minR = Math.min(...reps), maxR = Math.max(...reps);
    const full = reps.length >= nSets;
    const range = parseRange(item.reps, item.target);
    if (c.pain >= 4) return { text: `Douleur notée la dernière fois : pas plus de ${maxR} reps par série, sans forcer.`, target: { reps: minR } };
    const chain = PULL_CHAIN.indexOf(item.exId);
    if (chain === 0) {
      const goal = range ? range[1] : 3;
      if (full && minR >= goal) return { text: `Négatives solides (${goal} par série) : passe aux tractions avec élastique (3 × 5).`, target: { reps: 5 }, next: 'pullup_band' };
      return { text: `Ajoute 1 négative par série (objectif ${goal}, descente de 3 à 5 s).`, target: { reps: Math.min(goal, minR + 1) } };
    }
    if (chain === 1) {
      const goal = range ? range[1] : 8;
      if (full && minR >= goal) return { text: `${goal} reps partout : prends l'élastique plus fin. Avec le plus fin, passe aux tractions strictes.`, target: { reps: 5 }, next: 'pullup_strict' };
      return { text: `Ajoute 1 rep par série (objectif ${goal}), puis élastique plus fin.`, target: { reps: Math.min(goal, minR + 1) } };
    }
    if (chain === 2 || item.exId === 'chinup_strict') {
      if (maxR < 5) return { text: 'Séries de 1 à 2 tractions strictes (10 à 15 au total), 1 min de repos. Complète avec des négatives.', target: { reps: Math.max(1, Math.min(2, maxR)) } };
      if (maxR >= 10) return { text: '10 tractions ou plus : ajoute un lest léger (2,5 kg) sur 3 à 6 reps.', target: { reps: 5 } };
      return { text: 'Ajoute 1 rep par série en gardant 2 reps en réserve.', target: { reps: minR + 1 } };
    }
    if (range) {
      const [lo, hi] = range;
      if (full && minR >= hi) {
        const hx = (ex.harder || []).map(exDef).find(Boolean);
        if (hx && hi >= 12) return { text: `${hi} reps partout : essaie « ${hx.name} ».`, target: { reps: lo }, next: hx.id };
        return { text: `${hi} reps partout : ajoute 2 reps par série.`, target: { reps: hi + 2 } };
      }
      return { text: `Ajoute 1 rep par série (objectif ${hi}).`, target: { reps: Math.min(hi, Math.max(lo, minR + 1)) } };
    }
    return { text: `Dernière fois : ${reps.join(', ')}. Ajoute 1 rep si c'était facile.`, target: { reps: minR + 1 } };
  }

  // Course et cardio en durée : +5 min au plus, et pas plus d'une hausse toutes les 2 semaines.
  function durationSuggestion(c) {
    const useSec = c.hist.some((h) => h.sets.some((s) => U.num(s.sec) > 0));
    const measureOf = (h) => Math.max(0, ...h.sets.map((s) => U.num(useSec ? s.sec : s.km) || 0));
    const lastV = measureOf(c.last);
    if (!lastV) return null;
    const fmt = (v) => (useSec ? fmtMin(v) : `${U.fmtNum(v, 1)} km`);
    if (c.pain >= 4) return { text: `Douleur notée la dernière fois : garde ${fmt(lastV)} ou moins, en souplesse.`, target: useSec ? { sec: lastV } : { km: lastV } };
    // Dernier changement de niveau : la première sortie notée, puis chaque hausse d'au moins 1 min (ou 0,2 km).
    const chron = c.hist.slice().reverse();
    const minGain = useSec ? 60 : 0.2;
    let maxSoFar = 0, lastChange = chron[0].date;
    chron.forEach((h, i) => {
      const v = measureOf(h);
      if (i > 0 && v >= maxSoFar + minGain) lastChange = h.date;
      maxSoFar = Math.max(maxSoFar, v);
    });
    const today = U.todayKey();
    const legs = ((st().profile || {}).injuries || []).some((i) => i && i.active !== false && (i.zone === 'genou' || i.zone === 'cheville'));
    if (U.daysBetween(lastChange, today) < 14) {
      return { text: `Garde ${fmt(lastV)} jusqu'au ${U.fmtShort(U.addDays(lastChange, 14))} : on n'allonge qu'une fois toutes les 2 semaines.`, target: useSec ? { sec: lastV } : { km: lastV } };
    }
    const next = useSec ? lastV + 300 : U.round(lastV + 0.5, 1);
    return {
      text: `Tu peux allonger de ${useSec ? '5 min' : '0,5 km'} au plus : ${fmt(next)}, en aisance${legs ? ', si genou et cheville vont bien' : ''}.`,
      target: useSec ? { sec: next } : { km: next },
    };
  }

  function timeSuggestion(c) {
    const { item, ex, last, nSets } = c;
    const kind = timeKind(item.exId, ex);
    if (kind === 'duration') return durationSuggestion(c);
    const secs = last.sets.map((s) => U.num(s.sec)).filter((v) => v > 0);
    if (!secs.length || !kind) return null;
    if (kind === 'hold') {
      const base = Math.min(...secs);
      if (c.pain >= 4) return { text: `Douleur notée la dernière fois : garde ${fmtSec(base)}, sans forcer.`, target: { sec: base } };
      const tgt = U.num(item.target && item.target.sec);
      if (tgt && secs.length >= nSets && base < tgt) return { text: `Vise ${fmtSec(tgt)} sur toutes tes séries avant d'ajouter du temps.`, target: { sec: tgt } };
      const inc = base < 45 ? 5 : 10;
      return { text: `Ajoute ${inc} s : vise ${fmtSec(base + inc)} par série.`, target: { sec: base + inc } };
    }
    const best = Math.min(...secs);
    if (c.pain >= 4) return { text: 'Douleur notée la dernière fois : reste en aisance, sans chrono.', target: {} };
    return { text: `Dernière fois : ${U.formatDuration(best)}. Vise le même temps, plus régulier.`, target: { sec: best } };
  }

  // Apnée : +2,5 m par semaine au maximum, jamais au-delà de la cible (aucun intérêt pour l'examen).
  function apneaSuggestion(c) {
    if (c.track !== 'dist') return null;
    const bestOf = (h) => Math.max(0, ...h.sets.map((s) => U.num(s.m) || 0));
    const best = bestOf(c.last);
    if (!best) return null;
    const ref = benchDef('apnea_dyn');
    const cap = (ref && ref.target && U.num(ref.target.value)) || 18;
    if (best >= cap) return { text: `${U.fmtNum(cap, 1)} m atteints : inutile d'aller plus loin. Travaille l'aisance et la récupération.`, target: { m: best } };
    if (c.pain >= 4) return { text: `Garde ${U.fmtNum(best, 1)} m, toujours accompagné.`, target: { m: best } };
    const weekAgo = U.addDays(U.todayKey(), -7);
    const older = c.hist.filter((h) => h.date <= weekAgo).map(bestOf);
    const base = older.length ? Math.max(...older) : best;
    const allowed = Math.min(cap, roundTo(base + 2.5, 0.5));
    if (allowed <= best) return { text: `Garde ${U.fmtNum(best, 1)} m cette semaine (+2,5 m par semaine au maximum). Toujours accompagné.`, target: { m: best } };
    return { text: `Tu peux viser ${U.fmtNum(allowed, 1)} m (+2,5 m par semaine au maximum), accompagné, sans hyperventiler.`, target: { m: allowed } };
  }

  // Suggestion pour la prochaine fois. history : sortie d'exerciseHistory (n'importe quel ordre) ; par défaut, calculée.
  // → { text, target, next? (exercice suivant de la progression) } ou null (rien d'utile à proposer).
  // Jamais d'augmentation si une douleur ≥ 4 a été notée à la dernière séance (ou au check-in du jour).
  function suggestNext(item, history) {
    if (!U.isObj(item) || !item.exId) return null;
    const ex = exDef(item.exId) || {};
    const track = item.track || ex.track;
    if (!track || track === 'check') return null;
    const hist = (Array.isArray(history) ? history : exerciseHistory(item.exId, { limit: 8 }))
      .filter((h) => U.isObj(h) && U.isKey(h.date) && Array.isArray(h.sets))
      .map((h) => ({ ...h, sets: h.sets.filter((x) => U.isObj(x) && x.done !== false && x.measured !== false && hasMeasure(track, x)) }))
      .filter((h) => h.sets.length)
      .sort((a, b) => b.date.localeCompare(a.date));
    const last = hist[0] || null;
    const c = { item, ex, track, hist, last, pain: recentPain(last), nSets: Math.max(1, Math.round(U.num(item.sets) || (last ? last.sets.length : 1))) };
    if (item.test && item.bench) return testSuggestion(c);
    if (!last) return null;
    if (item.apnea || ex.apnea) return apneaSuggestion(c);
    switch (track) {
      case 'load': return loadSuggestion(c);
      case 'reps': return repsSuggestion(c);
      case 'time': return timeSuggestion(c);
      case 'run': return durationSuggestion(c);
      default: return null;
    }
  }

  /* ───────── Charge, semaine, régularité ───────── */

  // Charge sRPE (Foster) : durée (min) × effort (RPE 1-10). null si l'un des deux manque.
  function sessionLoad(s) {
    if (!U.isObj(s) || s.status === 'skipped') return null;
    const rpe = U.num(s.rpe);
    const dur = durationOf(s);
    if (!rpe || !dur) return null;
    return Math.round(dur * rpe);
  }

  // Type d'une séance pour les minutes par type.
  function typeOf(s) {
    const k = s.kind, loc = s.loc;
    if (k === 'swim' || loc === 'piscine') return 'piscine';
    if (k === 'run' || loc === 'dehors') return 'course';
    if (loc === 'salle' || k === 'gym') return 'salle';
    if (loc === 'maison' || k === 'home' || k === 'rehab') return 'maison';
    return 'autre';
  }
  // Type d'une séance Apple Santé (libellé libre).
  function healthType(type) {
    const t = U.normalize(type);
    if (/swim|nata|pisc|nage/.test(t)) return 'piscine';
    if (/run|cours|jog|foot/.test(t)) return 'course';
    if (/strength|muscu|force|functional|fonction|hiit|cross|train|row|rame|ski|ellip/.test(t)) return 'salle';
    return 'autre';
  }

  const doneIn = (from, to) => sessionsList().filter((s) => s.status === 'done' && s.date >= from && s.date <= to);
  const isPlannedDay = (dp) => U.isObj(dp) && (dp.kind === 'session' || dp.kind === 'event') && !dp.optional;
  function plannerWeek(monday) {
    if (!C.planner || typeof C.planner.week !== 'function') return null;
    try { const w = C.planner.week(monday); return Array.isArray(w) && w.length === 7 ? w : null; } catch (e) { return null; }
  }
  // Séance « bonus » (mini-séance facultative proposée un jour de repos) : exclue des comptes.
  const isBonus = (s, plans) => {
    if (!plans || !s.templateId) return false;
    const dp = plans[U.dow(s.date)];
    return !!(dp && Array.isArray(dp.bonus) && dp.bonus.includes(s.templateId));
  };

  function weekLoad(monday) {
    const mon = U.mondayOf(monday);
    return doneIn(mon, U.addDays(mon, 6)).reduce((a, s) => a + (sessionLoad(s) || 0), 0);
  }

  // Résumé d'une semaine : { done, planned (null sans planificateur), bonus, minutes, load, byKind, unrated, healthMin }.
  function weekSummary(monday) {
    const mon = U.mondayOf(U.isKey(monday) ? monday : U.todayKey());
    const end = U.addDays(mon, 6);
    const plans = plannerWeek(mon);
    const list = doneIn(mon, end);
    const byKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
    let done = 0, bonus = 0, minutes = 0, load = 0, unrated = 0, healthMin = 0;
    for (const s of list) {
      if (isBonus(s, plans)) bonus++; else done++;
      const m = durationOf(s) || 0;
      minutes += m;
      byKind[typeOf(s)] += m;
      const l = sessionLoad(s);
      if (l) load += l; else unrated++;
    }
    // Séances de la montre (Apple Santé) non reliées à une séance de l'app.
    const workouts = U.isObj(st().health) && Array.isArray(st().health.workouts) ? st().health.workouts : [];
    for (const w of workouts) {
      if (!U.isObj(w) || w.linkedSessionId || !U.isKey(w.date) || w.date < mon || w.date > end) continue;
      const m = Math.round(U.num(w.durationMin) || 0);
      if (m <= 0) continue;
      const t = healthType(w.type);
      if (list.some((s) => s.date === w.date && typeOf(s) === t)) continue;
      healthMin += m; minutes += m; byKind[t] += m;
    }
    return { monday: mon, done, planned: plans ? plans.filter(isPlannedDay).length : null, bonus, minutes: Math.round(minutes), load, byKind, unrated, healthMin };
  }

  // Régularité sur les N dernières semaines (semaine en cours comprise) : séances faites / prévues,
  // jours passés seulement, depuis plan.startDate. Aujourd'hui ne compte que si la séance est faite.
  // Une séance faite un autre jour de la même semaine compense un jour prévu manqué. Bonus exclus.
  function regularityDetail(weeks = 4) {
    const today = U.todayKey();
    const start = U.isKey((st().plan || {}).startDate) ? st().plan.startDate : today;
    const firstMon = U.addDays(U.mondayOf(today), -7 * (Math.max(1, Math.round(weeks)) - 1));
    const from = U.maxKey(start, firstMon);
    let done = 0, planned = 0;
    if (from > today) return { done, planned, pct: null };
    for (let mon = U.mondayOf(from); mon <= today; mon = U.addDays(mon, 7)) {
      const plans = plannerWeek(mon);
      if (!plans) return { done: 0, planned: 0, pct: null };
      let p = 0, d = 0;
      for (const dp of plans) {
        const date = dp && dp.date;
        if (!U.isKey(date) || date < from || date > today) continue;
        const has = doneIn(date, date).some((s) => !isBonus(s, plans));
        if (date === today && !has) continue; // journée en cours
        if (isPlannedDay(dp)) p++;
        if (has) d++;
      }
      planned += p;
      done += Math.min(d, p);
    }
    return { done, planned, pct: planned ? Math.round((done / planned) * 100) : null };
  }
  const regularity = (weeks = 4) => regularityDetail(weeks).pct;

  /* ───────── Habitudes ───────── */

  const habitById = (id) => (Array.isArray(st().habits) ? st().habits : []).find((h) => U.isObj(h) && h.id === id) || null;
  function habitValue(h, date) {
    const day = U.isObj(st().habitLog) ? st().habitLog[date] : null;
    return U.isObj(day) ? day[h.id] : undefined;
  }
  // Jour réussi ? check : coché ; number : cible atteinte ; avoid : AUCUN écart noté (true = écart).
  function habitDone(h, date) {
    const v = habitValue(h, date);
    if (h.type === 'avoid') return !(v === true || (typeof v === 'number' && v > 0));
    if (h.type === 'number') {
      if (v === true) return true;
      const n = U.num(v);
      if (n == null) return false;
      const t = U.num(h.target);
      return t ? n >= t - 1e-9 : n > 0;
    }
    return v === true || (typeof v === 'number' && v > 0);
  }
  const isWeekly = (h) => h.type !== 'avoid' && U.num(h.perWeek) >= 1 && U.num(h.perWeek) < 7;
  const habitStart = (h) => (U.isKey(h.createdAt) ? h.createdAt : U.isKey(st().createdAt) ? st().createdAt : U.todayKey());
  const habitEnd = (h, today) => (U.isKey(h.archivedAt) && h.archivedAt < today ? h.archivedAt : today);
  function weekCount(h, monday, end) {
    const start = habitStart(h);
    return U.weekDays(monday).filter((d) => d >= start && d <= end && habitDone(h, d)).length;
  }
  // Objectif de la semaine (réduit pour la semaine de création, si elle est incomplète).
  function weekNeed(h, monday) {
    const start = habitStart(h);
    const avail = U.weekDays(monday).filter((d) => d >= start).length;
    return Math.max(1, Math.min(Math.round(U.num(h.perWeek)), avail));
  }

  // Série tolérante : un seul manque ne la casse pas, deux de suite oui. Aujourd'hui (ou la semaine en cours)
  // pas encore validé ne compte pas comme un manque. En jours, ou en semaines pour « x fois par semaine ».
  function habitStreak(habitId) {
    const h = habitById(habitId);
    if (!h) return 0;
    const today = U.todayKey();
    const start = habitStart(h);
    const end = habitEnd(h, today);
    if (end < start) return 0;
    let count = 0, miss = 0;
    if (isWeekly(h)) {
      const curMon = U.mondayOf(today);
      for (let w = U.mondayOf(end); w >= U.mondayOf(start); w = U.addDays(w, -7)) {
        const ok = weekCount(h, w, end) >= weekNeed(h, w);
        if (w === curMon && !ok) continue;
        if (ok) { count++; miss = 0; } else if (++miss >= 2) break;
      }
      return count;
    }
    for (let d = end; d >= start; d = U.addDays(d, -1)) {
      const ok = habitDone(h, d);
      if (d === today && !ok && h.type !== 'avoid') continue;
      if (ok) { count++; miss = 0; } else if (++miss >= 2) break;
    }
    return count;
  }

  // Taux de réussite (%) sur les `days` derniers jours, jamais avant la création (days ≤ 0 : depuis la création).
  // null si aucun jour ne compte encore.
  function habitRate(habitId, days = 28) {
    const h = habitById(habitId);
    if (!h) return null;
    const today = U.todayKey();
    const start = habitStart(h);
    const end = habitEnd(h, today);
    const from = days > 0 ? U.maxKey(start, U.addDays(end, -(days - 1))) : start;
    if (end < from) return null;
    let ok = 0, n = 0;
    if (isWeekly(h)) {
      const curMon = U.mondayOf(today);
      for (let w = U.mondayOf(from); w <= end; w = U.addDays(w, 7)) {
        const good = weekCount(h, w, end) >= weekNeed(h, w);
        if (w === curMon && !good) continue;
        n++; if (good) ok++;
      }
    } else {
      for (let d = from; d <= end; d = U.addDays(d, 1)) {
        const good = habitDone(h, d);
        if (d === today && !good && h.type !== 'avoid') continue;
        n++; if (good) ok++;
      }
    }
    return n ? Math.round((ok / n) * 100) : null;
  }

  // Tout ce qu'affiche une carte d'habitude.
  function habitInfo(habitId) {
    const h = habitById(habitId);
    if (!h) return null;
    const today = U.todayKey();
    const start = habitStart(h);
    const end = habitEnd(h, today);
    let total = 0;
    for (let d = start; d <= end; d = U.addDays(d, 1)) if (habitDone(h, d)) total++;
    const weekly = isWeekly(h);
    const mon = U.mondayOf(today);
    return {
      streak: habitStreak(habitId), unit: weekly ? 'semaines' : 'jours', weekly,
      rate28: habitRate(habitId, 28), rateAll: habitRate(habitId, 0),
      total, milestone: HABIT_MILESTONE, milestonePct: Math.min(100, Math.round((total / HABIT_MILESTONE) * 100)),
      sinceDays: Math.max(0, U.daysBetween(start, today)) + 1,
      weekDone: weekly ? weekCount(h, mon, today) : null, weekNeed: weekly ? weekNeed(h, mon) : null,
      todayDone: habitDone(h, today), todayValue: habitValue(h, today),
    };
  }

  /* ───────── Corps ───────── */

  // Poids des `days` derniers jours (days ≤ 0 : tout) avec la moyenne sur 7 jours glissants.
  function weightSeries(days = 90) {
    const today = U.todayKey();
    const body = U.isObj(st().body) ? st().body : {};
    const all = Object.keys(body).filter((k) => U.isKey(k) && k <= today && U.isObj(body[k]) && U.num(body[k].weight) != null).sort();
    const from = days > 0 ? U.addDays(today, -(days - 1)) : '0000-01-01';
    const out = [];
    let lo = 0, acc = 0;
    for (let i = 0; i < all.length; i++) {
      acc += U.num(body[all[i]].weight);
      const minDate = U.addDays(all[i], -6);
      while (all[lo] < minDate) { acc -= U.num(body[all[lo]].weight); lo++; }
      if (all[i] >= from) out.push({ date: all[i], weight: U.num(body[all[i]].weight), avg7: U.round(acc / (i - lo + 1), 2) });
    }
    return out;
  }

  /* ───────── Forme du jour (check-in) ───────── */

  // → { level:'vert'|'orange'|'rouge'|null, reasons:[…], suggestion:'normal'|'allege'|'doux'|'repos' }
  // Douleur genou/cheville ≥ 4 → doux (sans impact) ; sommeil + énergie bas → allégé ; tout bas → repos ;
  // douleur ≥ 7 → repos (et avis médical si ça persiste).
  function readiness(date) {
    const d = U.isKey(date) ? date : U.todayKey();
    const c = U.isObj(st().checkins) ? st().checkins[d] : null;
    if (!U.isObj(c)) return { level: null, reasons: [], suggestion: 'normal' };
    const n = (v, lo, hi) => { const x = U.num(v); return x != null && x >= lo && x <= hi ? x : null; };
    const sleep = n(c.sleep, 1, 5), energy = n(c.energy, 1, 5), sore = n(c.soreness, 1, 5);
    const rank = { normal: 0, allege: 1, doux: 2, repos: 3 };
    let suggestion = 'normal';
    const raise = (s) => { if (rank[s] > rank[suggestion]) suggestion = s; };
    const reasons = [];
    const lowSleep = sleep != null && sleep <= 2, lowEnergy = energy != null && energy <= 2, highSore = sore != null && sore >= 4;
    if (lowSleep) reasons.push('Nuit difficile');
    if (lowEnergy) reasons.push('Peu d\'énergie');
    if (highSore) reasons.push('Courbatures marquées');
    const lows = [lowSleep, lowEnergy, highSore].filter(Boolean).length;
    if (lows === 3 || (sleep === 1 && energy === 1)) raise('repos');
    else if (lows === 2 || sore === 5) raise('allege');
    for (const [zone, v] of Object.entries(U.isObj(c.pain) ? c.pain : {})) {
      const p = n(v, 0, 10);
      if (p == null || p < 4) continue;
      const at = ZONE_AT[zone] || `(${zone})`;
      if (p >= 7) { reasons.push(`Douleur forte ${at} (${p}/10)`); raise('repos'); }
      else { reasons.push(`Douleur ${at} (${p}/10)`); raise(LEG_ZONES.includes(zone) ? 'doux' : 'allege'); }
    }
    const level = suggestion === 'repos' ? 'rouge' : suggestion === 'normal' ? 'vert' : 'orange';
    return { level, reasons, suggestion };
  }

  C.metrics = {
    CONTEXTS, BEST_CONTEXTS, LAST_CONTEXTS, KINDS, HABIT_MILESTONE,
    benchEntries, benchBest, benchLast, benchTrend, fmtTrend, fmtPerMonth, benchProjection,
    addBench, updateBench, removeBench, recordsFromSession, forgetSession,
    exerciseHistory, lastPerformance, suggestNext,
    sessionLoad, weekLoad, weekSummary, regularity, regularityDetail,
    habitStreak, habitRate, habitInfo, habitDone, habitValue,
    weightSeries, readiness,
    // Fonctions pures exposées pour les tests et les écrans
    _t: { sessionRecords, parseRange, hasMeasure, timeKind, typeOf, healthType, isWeekly, isLowerBody, durationOf },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
