/* Crevare — bibliothèque d'exercices (#/bibliotheque, #/exercice/:id), création d'exercices perso,
 * séances perso (#/mes-seances, #/mes-seances/:id) et sélecteur d'exercices partagé (C.libraryUI.pickExercise).
 * Les fonctions pures (sans DOM) sont exposées dans C.libraryUI._t pour les tests. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Référentiels ───────── */

  const GOAL_OPTS = [
    { value: '', label: 'Tous' }, { value: 'ssa', label: 'SSA' }, { value: 'hyrox', label: 'HYROX' },
    { value: 'pompier', label: 'Pompier' }, { value: 'general', label: 'Général' },
  ];
  const LOC_LABELS = { maison: 'Maison', salle: 'Salle', piscine: 'Piscine', dehors: 'Extérieur' };
  const LOC_OPTS = Object.entries(LOC_LABELS).map(([value, label]) => ({ value, label }));
  const ZONE_LABELS = { genou: 'Genou', cheville: 'Cheville', epaule: 'Épaule', dos: 'Dos', poignet: 'Poignet', hanche: 'Hanche' };
  const IMPACT_OPTS = [{ value: 0, label: 'Aucun choc' }, { value: 1, label: 'Course, appuis' }, { value: 2, label: 'Sauts, réceptions' }];
  const TRACK_FALLBACK = {
    reps: { label: 'Répétitions' }, load: { label: 'Charge et répétitions' }, time: { label: 'Temps' }, dist: { label: 'Distance (m)' },
    run: { label: 'Distance (km) et temps' }, palier: { label: 'Palier' }, cm: { label: 'Centimètres' }, check: { label: 'Fait / pas fait' },
  };
  // Temps : plus long = mieux pour les maintiens (gainage, chaise…), plus court = mieux pour les épreuves.
  const HOLD_CATS = ['gainage', 'prevention', 'mobilite', 'force'];
  const RACE_CATS = ['natation', 'course', 'hyrox', 'sauvetage', 'apnee', 'test'];
  const HYROX_GEAR = ['sled', 'wall_ball', 'sandbag', 'skierg'];
  const POOL_GEAR = ['palmes', 'masque_tuba', 'objet_leste', 'bouee_tube'];
  const TREND_LABELS = { mieux: '↗ en progrès', 'moins-bien': '↘ en baisse', stable: '→ stable' };

  /* ───────── Accès défensifs ───────── */

  const D = () => C.data || {};
  const getEx = (id) => (D().getExercise ? D().getExercise(id) : null);
  const cats = () => D().EXERCISE_CATS || {};
  const tracks = () => D().TRACKS || TRACK_FALLBACK;
  const catInfo = (cat) => cats()[cat] || { label: cat || 'Autre', icon: '•' };
  const metricsFn = (name) => (C.metrics && typeof C.metrics[name] === 'function' ? C.metrics[name] : null);
  const sesT = () => (C.sessionUI && C.sessionUI._t) || null;
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.error(e); return fallback; }
  }
  const exHref = (id) => `#/exercice/${encodeURIComponent(id)}`;

  /* ───────── Fonctions pures ───────── */

  // Zones de blessure actives.
  const injuredZones = (profile) => [...new Set(((profile && profile.injuries) || []).filter((i) => i && i.active !== false).map((i) => i.zone))];
  // « Sans impact » coché par défaut si le genou ou la cheville est blessé.
  const defaultLowImpact = (profile) => injuredZones(profile).some((z) => z === 'genou' || z === 'cheville');

  // Matériel disponible : maison + salle (si renseignée ; HYROX seulement si la salle est équipée)
  // + petit matériel de piscine si une piscine est enregistrée + partenaire si un binôme est indiqué.
  function availableEquipment(profile, EQ) {
    const p = profile || {};
    const eq = p.equipment || {};
    const home = Array.isArray(eq.home) ? eq.home : [];
    const gym = eq.gym || {};
    const out = new Set(home);
    if (gym.name || gym.hyrox) {
      for (const [k, v] of Object.entries(EQ || {})) if (v && v.gym) out.add(k);
      if (!gym.hyrox) HYROX_GEAR.forEach((k) => { if (!home.includes(k)) out.delete(k); });
    }
    const pools = Array.isArray(p.pools) ? p.pools : [];
    if (pools.length) {
      POOL_GEAR.forEach((k) => out.add(k));
      if (pools.some((pl) => pl && pl.mannequin)) out.add('mannequin');
    }
    if (String(p.apneaBuddy || '').trim()) out.add('partenaire');
    return [...out];
  }

  // Regroupe une liste par catégorie (exercices perso d'abord), dans l'ordre des catégories.
  function groupByCat(list, CATS) {
    const groups = [];
    const custom = list.filter((e) => e.custom || String(e.id).startsWith('perso:'));
    if (custom.length) groups.push({ cat: 'perso', label: 'Mes exercices', icon: '⭐', items: custom });
    const order = Object.entries(CATS || {}).sort((a, b) => (a[1].order || 99) - (b[1].order || 99)).map(([k]) => k);
    const rest = list.filter((e) => !custom.includes(e));
    for (const cat of [...order, ...new Set(rest.map((e) => e.cat).filter((c) => !order.includes(c)))]) {
      const items = rest.filter((e) => e.cat === cat);
      if (items.length) groups.push({ cat, label: (CATS[cat] || {}).label || cat, icon: (CATS[cat] || {}).icon || '•', items });
    }
    return groups;
  }

  // Sens de la performance d'un exercice : 'lower' (plus bas = mieux), 'higher', ou null (pas de « meilleur »).
  function perfDirection(ex, getBench) {
    if (!ex || ex.track === 'check') return null;
    if (ex.bench && getBench) {
      const b = safe(() => getBench(ex.bench), null);
      if (b && typeof b.lower === 'boolean') return b.lower ? 'lower' : 'higher';
    }
    if (ex.track === 'run') return 'lower'; // allure (s/km)
    if (ex.track === 'time') {
      if (HOLD_CATS.includes(ex.cat)) return 'higher';
      if (RACE_CATS.includes(ex.cat)) return 'lower';
      return null; // cardio en durée libre : pas de « meilleur »
    }
    return 'higher';
  }

  // Valeur comparable d'une série faite et mesurée (charge : 1RM estimée d'Epley ; course : allure).
  function perfValue(track, set) {
    if (!set || set.done === false || set.measured === false) return null;
    const n = (v) => (v == null || v === '' || !isFinite(v) ? null : Number(v));
    switch (track) {
      case 'reps': return n(set.reps);
      case 'load': { const kg = n(set.kg); if (kg == null) return null; const r = n(set.reps) || 1; return kg * (1 + r / 30); }
      case 'time': { const s = n(set.sec); return s > 0 ? s : null; }
      case 'dist': return n(set.m);
      case 'run': { const km = n(set.km), s = n(set.sec); return km > 0 && s > 0 ? s / km : null; }
      case 'palier': return n(set.palier);
      case 'cm': return n(set.cm);
      default: return null;
    }
  }
  const isBetter = (a, b, dir) => (dir === 'lower' ? a < b : a > b);

  // Tendance sur les dernières valeurs (dans l'ordre chronologique), au moins 3 points.
  function trendOf(values, dir) {
    const vals = (values || []).filter((v) => v != null && isFinite(v));
    if (!dir || vals.length < 3) return null;
    const t = U.linearTrend(vals.map((y, x) => ({ x, y })));
    if (!t) return 'stable';
    const rel = t.slope / (Math.abs(U.mean(vals)) || 1);
    if (Math.abs(rel) < 0.01) return 'stable';
    return (dir === 'lower' ? rel < 0 : rel > 0) ? 'mieux' : 'moins-bien';
  }

  // Historique d'un exercice → meilleure perf, dernière perf, tendance, points du graphique.
  // entries : [{ date, sessionId, sets }] dans n'importe quel ordre.
  function historySummary(entries, track, dir) {
    const rows = (entries || []).filter((e) => e && U.isKey(e.date) && Array.isArray(e.sets)).map((e) => {
      const vals = e.sets.map((s) => ({ s, v: perfValue(track, s) })).filter((x) => x.v != null);
      const best = dir && vals.length ? vals.reduce((a, b) => (isBetter(b.v, a.v, dir) ? b : a)) : null;
      return { date: e.date, sessionId: e.sessionId || null, sets: e.sets, best };
    }).filter((r) => r.sets.some((s) => s && s.done !== false))
      .sort((a, b) => a.date.localeCompare(b.date));
    const measured = rows.filter((r) => r.best);
    let best = null;
    for (const r of measured) if (!best || isBetter(r.best.v, best.value, dir)) best = { date: r.date, sessionId: r.sessionId, set: r.best.s, value: r.best.v };
    const lastM = measured[measured.length - 1] || null;
    const first = measured[0];
    return {
      rows,
      best,
      last: rows[rows.length - 1] || null,
      lastMeasured: lastM ? { date: lastM.date, sessionId: lastM.sessionId, set: lastM.best.s, value: lastM.best.v } : null,
      trend: trendOf(measured.slice(-6).map((r) => r.best.v), dir),
      points: first ? measured.map((r) => ({ x: U.daysBetween(first.date, r.date), y: r.best.v })) : [],
    };
  }

  // Historique local (repli si C.metrics manque) : séances terminées contenant l'exercice, plus récentes d'abord.
  function localHistory(sessions, exId, limit = 20) {
    const out = [];
    for (const s of Object.values(sessions || {})) {
      if (!s || s.status !== 'done') continue;
      for (const it of s.exercises || []) {
        if (it.exId !== exId) continue;
        const sets = ((s.log || {})[it.key] || []).filter((x) => x && x.done);
        if (sets.length) out.push({ date: s.date, sessionId: s.id, sets, finishedAt: s.finishedAt || 0 });
      }
    }
    out.sort((a, b) => b.date.localeCompare(a.date) || b.finishedAt - a.finishedAt);
    return out.slice(0, limit).map(({ date, sessionId, sets }) => ({ date, sessionId, sets }));
  }

  // Déplace un élément d'une liste (renvoie une nouvelle liste ; inchangée si hors limites).
  function moveItem(list, i, delta) {
    const j = i + delta;
    if (!Array.isArray(list) || i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
    const out = list.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }

  // Valeurs du formulaire « Créer un exercice » → objet brut (normalisé ensuite par C.data.makeCustomExercise).
  function exerciseInput(v) {
    const list = (x) => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]).map(String);
    const impact = Number(v.impact);
    return {
      name: String(v.name || '').trim().slice(0, 80),
      cat: String(v.cat || ''),
      locs: list(v.locs),
      goals: list(v.goals),
      track: String(v.track || 'reps'),
      defaultSets: U.num(v.sets),
      defaultReps: String(v.reps || '').trim().slice(0, 80),
      defaultRest: v.rest == null || v.rest === '' ? null : U.parseDuration(v.rest),
      impact: [0, 1, 2].includes(impact) ? impact : 0,
      stress: list(v.stress),
      description: String(v.description || '').trim().slice(0, 1000),
      cues: String(v.cues || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12),
    };
  }

  // Exercice perso complet (repli minimal si C.data.makeCustomExercise manque).
  function buildCustomExercise(input, existingId) {
    const raw = existingId ? { ...input, id: existingId } : input;
    if (D().makeCustomExercise) return D().makeCustomExercise(raw);
    return {
      id: existingId || 'perso:' + U.uid(), name: input.name || 'Exercice', short: input.name || 'Exercice', cat: input.cat || 'force',
      goals: input.goals.length ? input.goals : ['general'], locs: input.locs.length ? input.locs : ['maison'], equipment: [],
      track: input.track || 'reps', defaultSets: U.clamp(Math.round(input.defaultSets || 3), 1, 30), defaultReps: input.defaultReps,
      defaultRest: input.defaultRest == null ? 60 : U.clamp(Math.round(input.defaultRest), 0, 1800), impact: input.impact, stress: input.stress,
      apnea: false, description: input.description, cues: input.cues, mistakes: [], safety: [], easier: [], harder: [], alt: [], muscles: [],
      custom: true, createdAt: U.todayKey(),
    };
  }

  // Retire un exercice perso de l'état (et des séances perso). Renvoie le nombre de séances perso touchées.
  function removeExerciseRefs(st, exId) {
    st.customExercises = (st.customExercises || []).filter((e) => e.id !== exId);
    let n = 0;
    for (const cs of st.customSessions || []) {
      const before = cs.exercises.length;
      cs.exercises = cs.exercises.filter((e) => e.exId !== exId);
      if (cs.exercises.length !== before) n++;
    }
    return n;
  }

  // Supprime une séance perso et ses planifications à venir.
  function removeCustomSession(st, csId, today) {
    st.customSessions = (st.customSessions || []).filter((c) => c.id !== csId);
    const ov = (st.plan && st.plan.overrides) || {};
    for (const [d, o] of Object.entries(ov)) if (d >= today && o && o.customSessionId === csId) delete ov[d];
  }

  // Ligne d'exercice d'une séance perso, avec les valeurs par défaut de l'exercice.
  const entryFor = (ex) => ({ exId: ex.id, sets: ex.defaultSets || 3, reps: ex.defaultReps || '', rest: ex.defaultRest != null ? ex.defaultRest : 60, note: '', target: {} });

  const newDraft = () => ({ id: U.uid(), isNew: true, name: '', loc: 'maison', goals: [], intro: '', exercises: [], dirty: false });

  // Brouillon → séance perso enregistrable.
  function customFromDraft(d, today) {
    return {
      id: d.id,
      name: String(d.name || '').trim().slice(0, 80),
      loc: LOC_LABELS[d.loc] ? d.loc : 'maison',
      goals: (d.goals || []).filter((g) => GOAL_OPTS.some((o) => o.value === g && g)),
      intro: String(d.intro || '').trim().slice(0, 1000),
      exercises: (d.exercises || []).filter((e) => e && e.exId).map((e) => ({
        exId: String(e.exId),
        sets: U.clamp(Math.round(U.num(e.sets) || 1), 1, 30),
        reps: String(e.reps || '').trim().slice(0, 80),
        rest: U.clamp(Math.round(U.num(e.rest) || 0), 0, 1800),
        note: String(e.note || '').trim().slice(0, 200),
        target: U.isObj(e.target) ? e.target : {},
      })),
      createdAt: U.isKey(d.createdAt) ? d.createdAt : today,
    };
  }
  function draftError(d) {
    if (!String(d.name || '').trim()) return 'Donne un nom à ta séance.';
    return '';
  }

  // Exercice de séance perso → ExerciseItem (repli si le planificateur manque). Pas de bench : une séance perso
  // n'alimente pas les tests de référence.
  function itemFromEntry(e, i) {
    const ex = getEx(e.exId);
    if (!ex) return null;
    return {
      key: `${ex.id}#${i}`, exId: ex.id, name: ex.name, track: ex.track,
      sets: e.sets || ex.defaultSets || 3, reps: e.reps || ex.defaultReps || '', rest: e.rest != null ? e.rest : ex.defaultRest,
      note: e.note || '', target: e.target || {}, apnea: !!ex.apnea, impact: ex.impact || 0,
    };
  }

  // Durée estimée (min) d'une séance perso : ordre de grandeur, échauffement compris.
  function estimateMinutes(cs) {
    let sec = 0;
    for (const e of (cs && cs.exercises) || []) {
      const ex = getEx(e.exId) || { track: 'reps' };
      const sets = U.num(e.sets) || 1;
      const t = e.target || {};
      let work = 45;
      if (ex.track === 'time') work = U.num(t.sec) || U.parseDuration(String(e.reps || '').replace(/\s/g, '')) || 60;
      else if (ex.track === 'dist') work = U.num(t.m) ? (U.num(t.m) / 25) * 30 : 120;
      else if (ex.track === 'run') work = U.num(t.km) ? U.num(t.km) * 360 : 1800;
      sec += sets * (work + (U.num(e.rest) || 0));
    }
    return sec ? Math.round(sec / 60) + 10 : 0;
  }

  /* ───────── État d'affichage (mémoire, non enregistré) ───────── */

  const lib = { q: '', goal: '', loc: '', cat: '', lowImpact: null, mine: false };
  const pick = { q: '', cat: '', loc: '', lowImpact: false, onPick: null, multi: false, added: new Set() };
  let draft = null;
  let draftFor = null;

  const lowImpactOn = () => (lib.lowImpact == null ? defaultLowImpact(C.state.profile) : lib.lowImpact);

  /* ───────── Rendu : petits éléments ───────── */

  function exMeta(ex) {
    const locs = (ex.locs || []).map((l) => LOC_LABELS[l] || l).join(' · ');
    return [locs, ex.defaultReps].filter(Boolean).join(' · ');
  }

  function exBadges(ex, injured) {
    const warn = (ex.stress || []).filter((z) => injured.includes(z));
    return [
      ex.custom ? '<span class="pill">perso</span>' : '',
      ex.apnea ? '<span class="pill warn" title="Apnée : accompagné seulement">🫧</span>' : '',
      ex.impact === 2 ? '<span class="pill">sauts</span>' : '',
      warn.length ? `<span class="pill warn">⚠ ${esc(warn.map((z) => ZONE_LABELS[z] || z).join(', ').toLowerCase())}</span>` : '',
    ].join('');
  }

  function exRowHTML(ex, injured) {
    const c = catInfo(ex.cat);
    return `<li><a class="lib-row" href="${esc(exHref(ex.id))}">
      <span class="lib-ico" aria-hidden="true">${esc(c.icon)}</span>
      <span class="lib-txt"><b>${esc(ex.name)}</b><small class="muted">${esc(exMeta(ex))}</small></span>
      <span class="lib-badges">${exBadges(ex, injured)}</span><span class="lib-chev" aria-hidden="true">›</span></a></li>`;
  }

  function searchLib() {
    if (!D().searchExercises) return [];
    const opts = { q: lib.q, goal: lib.goal || undefined, loc: lib.loc || undefined, cat: lib.cat || undefined, lowImpact: lowImpactOn() };
    if (lib.mine) opts.available = availableEquipment(C.state.profile, D().EQUIPMENT);
    return safe(() => D().searchExercises(opts), []);
  }

  function resultsHTML(list) {
    const injured = injuredZones(C.state.profile);
    if (!list.length) {
      return C.ui.empty('Aucun exercice ne correspond', 'Essaie un autre mot ou retire un filtre.',
        '<button type="button" class="btn ghost" data-action="biblio.reset">Effacer les filtres</button>');
    }
    if (lib.q) return `<ul class="lib-list">${list.map((e) => exRowHTML(e, injured)).join('')}</ul>`;
    return groupByCat(list, cats()).map((g) => `<section class="lib-group">
      <h3 class="lib-group-t"><span aria-hidden="true">${esc(g.icon)}</span> ${esc(g.label)} <span class="muted small">${esc(g.items.length)}</span></h3>
      <ul class="lib-list">${g.items.map((e) => exRowHTML(e, injured)).join('')}</ul></section>`).join('');
  }

  const countText = (n) => U.plural(n, 'exercice', 'exercices');

  /* ───────── #/bibliotheque ───────── */

  function viewLibrary() {
    const list = searchLib();
    const injured = injuredZones(C.state.profile).filter((z) => z === 'genou' || z === 'cheville');
    const active = lib.q || lib.goal || lib.loc || lib.cat || lib.mine || lowImpactOn() !== defaultLowImpact(C.state.profile);
    const catOpts = Object.entries(cats()).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    const circuits = D().absCircuits && D().circuitSpec && C.timer && typeof C.timer.open === 'function' ? D().absCircuits : [];
    const showCircuits = circuits.length && !lib.q && (!lib.cat || lib.cat === 'gainage');
    return `<header class="top"><h1>Bibliothèque</h1>
        <p class="muted small">Exercices par objectif, avec consignes, erreurs à éviter et ton historique.</p></header>
      <div class="row gap wrap lib-links">
        <a class="btn ghost small" href="#/mes-seances">📋 Mes séances</a>
        <a class="btn ghost small" href="#/exercice/nouveau">+ Créer un exercice</a>
      </div>
      <div class="card lib-filters">
        <input type="search" id="lib-q" class="lib-search" data-input="biblio.q" value="${esc(lib.q)}" placeholder="Chercher : traction, crawl, cheville…"
          aria-label="Chercher un exercice" autocomplete="off" enterkeyhint="search">
        <div class="lib-goal" aria-label="Objectif">${C.ui.segmented('lib-goal', GOAL_OPTS, lib.goal, 'data-change="biblio.filtre" data-f="goal"')}</div>
        <div class="lib-selects">
          <label class="lib-sel"><span class="tiny muted">Lieu</span>
            <select data-change="biblio.filtre" data-f="loc" aria-label="Lieu"><option value="">Tous les lieux</option>
              ${LOC_OPTS.map((o) => `<option value="${esc(o.value)}" ${lib.loc === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
          <label class="lib-sel"><span class="tiny muted">Catégorie</span>
            <select data-change="biblio.filtre" data-f="cat" aria-label="Catégorie"><option value="">Toutes</option>
              ${catOpts.map(([k, c]) => `<option value="${esc(k)}" ${lib.cat === k ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
        </div>
        <label class="check-row"><input type="checkbox" data-change="biblio.filtre" data-f="lowImpact" ${lowImpactOn() ? 'checked' : ''}>
          <span>Sans sauts ni réceptions${injured.length ? ` <span class="muted small">(${esc(injured.map((z) => ZONE_LABELS[z].toLowerCase()).join(', '))} à ménager)</span>` : ''}</span></label>
        <label class="check-row"><input type="checkbox" data-change="biblio.filtre" data-f="mine" ${lib.mine ? 'checked' : ''}>
          <span>Faisable avec mon matériel</span></label>
        ${active ? '<button type="button" class="link small" data-action="biblio.reset">Effacer les filtres</button>' : ''}
      </div>
      <p class="small muted" id="lib-count" aria-live="polite">${esc(countText(list.length))}</p>
      <div id="lib-results">${resultsHTML(list)}</div>
      ${showCircuits ? `<details class="card lib-circuits"><summary><b>Circuits abdos guidés</b> <span class="muted small">voix + bip</span></summary>
        <ul class="lib-list mt">${circuits.map((c) => `<li class="lib-circuit row between gap">
          <span class="lib-txt"><b>${esc(c.name)}</b><small class="muted">${esc(c.level)} · ≈ ${esc(c.minutes)} min</small></span>
          <button type="button" class="btn small" data-action="biblio.circuit" data-id="${esc(c.id)}">▶ Lancer</button></li>`).join('')}</ul></details>` : ''}`;
  }

  /* ───────── #/exercice/:id ───────── */

  function linksHTML(ids) {
    const list = (ids || []).map(getEx).filter(Boolean);
    if (!list.length) return '';
    return `<ul class="lib-links-list">${list.map((e) => `<li><a class="link" href="${esc(exHref(e.id))}">${esc(e.name)}</a></li>`).join('')}</ul>`;
  }

  function historyHTML(ex) {
    const histFn = metricsFn('exerciseHistory');
    let entries = histFn ? safe(() => histFn(ex.id, { limit: 30 }), null) : null;
    if (!Array.isArray(entries) || !entries.length) entries = localHistory(C.state.sessions, ex.id, 30);
    const dir = perfDirection(ex, D().getBenchmark);
    const h = historySummary(entries, ex.track, dir);
    if (!h.rows.length) return '<p class="muted small">Pas encore fait. Ton historique apparaîtra ici.</p>';
    const T = sesT();
    const fmt = (set) => (T ? T.fmtSet(ex.track, { ...set, done: true }) : '');
    const sum = (sets) => (T ? T.summarizeSets(ex.track, sets) : '');
    const stat = (label, v, date) => `<div class="lib-stat"><span class="tiny muted">${esc(label)}</span><b class="num">${esc(v)}</b>${date ? `<span class="tiny muted">${esc(U.fmtShort(date))}</span>` : ''}</div>`;
    const recent = h.rows.slice(-5).reverse();
    return `<div class="lib-stats">
        ${h.best ? stat('Meilleure', fmt(h.best.set), h.best.date) : ''}
        ${h.lastMeasured ? stat('Dernière', fmt(h.lastMeasured.set), h.lastMeasured.date) : stat('Dernière fois', sum(h.last.sets) || 'faite', h.last.date)}
        ${h.trend ? stat('Tendance', TREND_LABELS[h.trend], '') : ''}
      </div>
      ${h.points.length >= 2 ? `<div class="lib-spark">${C.ui.sparkline(h.points, { label: `Évolution : ${ex.name}`, trend: true })}</div>
        <p class="tiny muted">${dir === 'lower' ? 'Plus bas = mieux.' : 'Plus haut = mieux.'}${ex.track === 'load' ? ' Charge comparée en 1RM estimée.' : ''}${ex.track === 'run' ? ' Allure au km.' : ''}</p>` : ''}
      <ul class="lib-hist">${recent.map((r) => `<li><a href="#/seance/${esc(encodeURIComponent(r.sessionId || ''))}" class="row between gap">
        <span class="small">${esc(U.fmtDate(r.date))}</span><span class="small muted">${esc(sum(r.sets) || 'faite')}</span></a></li>`).join('')}</ul>`;
  }

  function viewExercise(params) {
    const id = params.id;
    if (id === 'nouveau') return viewExerciseForm(null, params.depuis ? getEx(params.depuis) : null);
    const ex = getEx(id);
    if (!ex) {
      return `<header class="top"><button type="button" class="back lib-back" data-action="biblio.retour">‹ Retour</button><h1>Exercice</h1></header>
        ${C.ui.empty('Exercice introuvable', 'Il a peut-être été supprimé.', '<a class="btn" href="#/bibliotheque">Bibliothèque</a>')}`;
    }
    if (params.modifier && ex.custom) return viewExerciseForm(ex, null);
    const c = catInfo(ex.cat);
    const injured = injuredZones(C.state.profile);
    const warn = (ex.stress || []).filter((z) => injured.includes(z));
    const eqLabels = (ex.equipment || []).map((k) => ((D().EQUIPMENT || {})[k] || {}).label || k);
    const bench = ex.bench && D().getBenchmark ? safe(() => D().getBenchmark(ex.bench), null) : null;
    const T = sesT();
    const rest = T ? T.fmtRest(ex.defaultRest) : `${ex.defaultRest} s`;
    const presc = [ex.defaultSets > 1 && ex.defaultReps ? `${ex.defaultSets} × ${ex.defaultReps}` : ex.defaultReps || U.plural(ex.defaultSets, 'série', 'séries'), rest ? `repos ${rest}` : ''].filter(Boolean).join(' · ');
    return `<header class="top">
        <button type="button" class="back lib-back" data-action="biblio.retour">‹ Retour</button>
        <h1>${esc(ex.name)}</h1>
        <div class="row wrap gap"><span class="badge"><span aria-hidden="true">${esc(c.icon)}</span> ${esc(c.label)}</span>${C.ui.goalTags(ex.goals)}
          ${ex.custom ? '<span class="pill">perso</span>' : ''}
          <span class="pill ${ex.impact === 2 ? 'warn' : ''}">${esc(IMPACT_OPTS[ex.impact] ? IMPACT_OPTS[ex.impact].label : '')}</span></div>
      </header>
      ${ex.apnea ? '<div class="note danger small">🫧 Apnée : uniquement accompagné (club, binôme ou MNS au bord). Sans accompagnement, la séance la remplace par de la nage en surface.</div>' : ''}
      ${warn.length ? `<div class="note warn small">⚠ Sollicite ${esc(warn.map((z) => ZONE_LABELS[z].toLowerCase()).join(' et '))} : reste sous 3/10 de douleur, sinon passe à une alternative.</div>` : ''}
      <section class="card">
        ${ex.description ? `<p>${esc(ex.description)}</p>` : ''}
        <p class="small muted">Par défaut : ${esc(presc)} · saisie : ${esc((tracks()[ex.track] || {}).label || ex.track)}</p>
        ${ex.cues.length ? `<h4>Consignes</h4><ul class="small">${ex.cues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${ex.mistakes.length ? `<h4>Erreurs fréquentes</h4><ul class="small">${ex.mistakes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${ex.safety.length ? `<h4>Sécurité</h4><div class="note warn small">${ex.safety.map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : ''}
      </section>
      <section class="card"><div class="card-head"><h3>Ton historique</h3>
        ${bench ? `<a class="link small" href="#/progres/${esc(encodeURIComponent(bench.id))}">Test : ${esc(bench.short || bench.name)}</a>` : ''}</div>
        ${historyHTML(ex)}</section>
      <div class="col gap lib-actions">
        <button type="button" class="btn block" data-action="biblio.faire" data-id="${esc(ex.id)}">▶ Faire maintenant</button>
        <button type="button" class="btn ghost block" data-action="biblio.vers-perso-choix" data-id="${esc(ex.id)}">+ Ajouter à une séance perso</button>
      </div>
      ${ex.easier.length || ex.harder.length || ex.alt.length ? `<section class="card">
        ${ex.easier.length ? `<h4>Plus facile</h4>${linksHTML(ex.easier)}` : ''}
        ${ex.harder.length ? `<h4>Plus dur</h4>${linksHTML(ex.harder)}` : ''}
        ${ex.alt.length ? `<h4>Alternatives</h4>${linksHTML(ex.alt)}` : ''}</section>` : ''}
      <section class="card"><dl class="lib-info">
        <div><dt>Lieux</dt><dd>${esc((ex.locs || []).map((l) => LOC_LABELS[l] || l).join(', ') || '—')}</dd></div>
        <div><dt>Objectifs</dt><dd>${esc((ex.goals || []).map((g) => (C.ui.GOALS[g] || {}).label || g).join(', ') || '—')}</dd></div>
        <div><dt>Matériel</dt><dd>${esc(eqLabels.join(', ') || 'Aucun')}</dd></div>
        ${ex.muscles && ex.muscles.length ? `<div><dt>Muscles</dt><dd>${esc(ex.muscles.join(', '))}</dd></div>` : ''}
        ${ex.stress && ex.stress.length ? `<div><dt>Sollicite</dt><dd>${esc(ex.stress.map((z) => (ZONE_LABELS[z] || z).toLowerCase()).join(', '))}</dd></div>` : ''}
      </dl></section>
      <div class="row gap wrap mt">
        ${ex.custom ? `<a class="btn ghost" href="${esc(exHref(ex.id))}?modifier=1">Modifier</a>
          <button type="button" class="btn ghost danger" data-action="biblio.exo-suppr" data-id="${esc(ex.id)}">Supprimer</button>`
          : `<a class="btn ghost small" href="#/exercice/nouveau?depuis=${esc(encodeURIComponent(ex.id))}">Créer ma version</a>`}
      </div>`;
  }

  /* ───────── Créer / modifier un exercice ───────── */

  function checks(name, options, selected) {
    return `<div class="lib-checks">${options.map((o) => `<label class="lib-check"><input type="checkbox" name="${esc(name)}" value="${esc(o.value)}" ${selected.includes(o.value) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>`;
  }

  function viewExerciseForm(ex, from) {
    const src = ex || from || {};
    const isEdit = !!ex;
    const catOpts = Object.entries(cats()).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    const trackOpts = Object.entries(tracks());
    const goalOpts = GOAL_OPTS.filter((o) => o.value);
    const zoneOpts = ['genou', 'cheville', 'epaule', 'dos', 'poignet'].map((z) => ({ value: z, label: ZONE_LABELS[z] }));
    const title = isEdit ? 'Modifier l\'exercice' : from ? 'Ma version de l\'exercice' : 'Créer un exercice';
    return `<header class="top"><button type="button" class="back lib-back" data-action="biblio.retour">‹ Retour</button><h1>${esc(title)}</h1></header>
      <form class="card lib-form" data-form="biblio.exo-save" data-id="${esc(isEdit ? ex.id : '')}">
        <label class="field"><span>Nom</span><input name="name" required maxlength="80" autocomplete="off" value="${esc(isEdit ? src.name : from ? `${from.name} (perso)` : '')}" placeholder="Ex. Tractions prise serrée"></label>
        <div class="lib-two">
          <label class="field"><span>Catégorie</span><select name="cat">${catOpts.map(([k, c]) => `<option value="${esc(k)}" ${(src.cat || 'force') === k ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Type de saisie</span><select name="track">${trackOpts.map(([k, t]) => `<option value="${esc(k)}" ${(src.track || 'reps') === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        </div>
        <div class="field"><span>Lieux</span>${checks('locs', LOC_OPTS, src.locs || ['maison'])}</div>
        <div class="field"><span>Objectifs</span>${checks('goals', goalOpts, src.goals || ['general'])}</div>
        <div class="lib-three">
          <label class="field"><span>Séries</span><input name="sets" type="text" inputmode="numeric" autocomplete="off" value="${esc(src.defaultSets || 3)}"></label>
          <label class="field"><span>Répétitions</span><input name="reps" maxlength="80" autocomplete="off" value="${esc(src.defaultReps || '')}" placeholder="8–12, 30 s…"></label>
          <label class="field"><span>Repos</span>${C.ui.timeInput({ name: 'rest', value: src.defaultRest != null ? src.defaultRest : 60, label: 'Repos entre les séries (minutes:secondes)' })}</label>
        </div>
        <div class="field"><span>Impact</span>${C.ui.segmented('impact', IMPACT_OPTS, src.impact || 0)}</div>
        <div class="field"><span>Sollicite (pour les blessures)</span>${checks('stress', zoneOpts, src.stress || [])}</div>
        <label class="field"><span>Description</span><textarea name="description" rows="3" maxlength="1000">${esc(src.description || '')}</textarea></label>
        <label class="field"><span>Consignes (une par ligne)</span><textarea name="cues" rows="3">${esc((src.cues || []).join('\n'))}</textarea></label>
        <button class="btn block" type="submit">Enregistrer</button>
      </form>`;
  }

  /* ───────── #/mes-seances ───────── */

  function viewCustomList() {
    draft = null; draftFor = null; // repartir d'un brouillon propre en rouvrant une séance
    const list = (C.state.customSessions || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return `<header class="top"><a class="back" href="#/bibliotheque">‹ Bibliothèque</a><h1>Mes séances</h1>
        <p class="muted small">Tes séances à toi : à démarrer quand tu veux ou à placer dans ton plan.</p></header>
      <a class="btn block" href="#/mes-seances/nouvelle">+ Nouvelle séance</a>
      ${list.length ? `<ul class="list mt">${list.map((cs) => {
        const min = estimateMinutes(cs);
        return `<li class="card lib-cs">
          <a class="lib-cs-main" href="#/mes-seances/${esc(encodeURIComponent(cs.id))}">
            <b>${esc(cs.name)}</b>
            <small class="muted">${esc(LOC_LABELS[cs.loc] || 'Autre')} · ${esc(U.plural(cs.exercises.length, 'exercice', 'exercices'))}${min ? ` · ≈ ${esc(min)} min` : ''}</small>
            <span class="row wrap gap">${C.ui.goalTags(cs.goals)}</span></a>
          <button type="button" class="btn small" data-action="biblio.cs-start" data-id="${esc(cs.id)}" ${cs.exercises.length ? '' : 'disabled'}>▶ Démarrer</button></li>`;
      }).join('')}</ul>` : C.ui.empty('Aucune séance perso', 'Compose ta séance avec les exercices de la bibliothèque, puis démarre-la ou planifie-la.')}`;
  }

  /* ───────── #/mes-seances/:id ───────── */

  function loadDraft(id) {
    if (id === 'nouvelle') {
      if (!draft || draftFor !== 'nouvelle') { draft = newDraft(); draftFor = 'nouvelle'; }
      return draft;
    }
    if (draftFor !== id || !draft) {
      const cs = (C.state.customSessions || []).find((x) => x.id === id);
      if (!cs) return null;
      draft = { ...U.clone(cs), isNew: false, dirty: false };
      draftFor = id;
    }
    return draft;
  }

  function draftRowHTML(e, i, n) {
    const ex = getEx(e.exId);
    const name = ex ? ex.name : (D().exerciseName ? D().exerciseName(e.exId) : e.exId);
    return `<li class="card lib-cs-row">
      <div class="row between gap">
        <b class="grow">${ex ? `<a href="${esc(exHref(ex.id))}">${esc(name)}</a>` : `${esc(name)} <span class="pill warn">introuvable</span>`}</b>
        <span class="row gap lib-cs-tools">
          <button type="button" class="icon-btn small" data-action="biblio.cs-move" data-i="${esc(i)}" data-d="-1" aria-label="Monter ${esc(name)}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn small" data-action="biblio.cs-move" data-i="${esc(i)}" data-d="1" aria-label="Descendre ${esc(name)}" ${i === n - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon-btn small" data-action="biblio.cs-del" data-i="${esc(i)}" aria-label="Retirer ${esc(name)}">✕</button>
        </span>
      </div>
      <div class="lib-three">
        <label class="field"><span>Séries</span><input id="cs-${esc(i)}-sets" type="text" inputmode="numeric" autocomplete="off" data-input="biblio.draft-ex" data-i="${esc(i)}" data-f="sets" value="${esc(e.sets)}"></label>
        <label class="field"><span>Répétitions</span><input id="cs-${esc(i)}-reps" type="text" maxlength="80" autocomplete="off" data-input="biblio.draft-ex" data-i="${esc(i)}" data-f="reps" value="${esc(e.reps)}" placeholder="${esc(ex ? ex.defaultReps : '')}"></label>
        <label class="field"><span>Repos</span>${C.ui.timeInput({ id: `cs-${i}-rest`, value: e.rest, label: `Repos, ${name}`, data: { input: 'biblio.draft-ex', i, f: 'rest' } })}</label>
      </div>
      <label class="field lib-cs-note"><span>Note</span><input id="cs-${esc(i)}-note" type="text" maxlength="200" autocomplete="off" data-input="biblio.draft-ex" data-i="${esc(i)}" data-f="note" value="${esc(e.note || '')}" placeholder="Ex. tempo lent, prise serrée…"></label>
    </li>`;
  }

  function viewCustomEdit(params) {
    const d = loadDraft(params.id);
    if (!d) {
      return `<header class="top"><a class="back" href="#/mes-seances">‹ Mes séances</a><h1>Séance perso</h1></header>
        ${C.ui.empty('Séance introuvable', 'Elle a peut-être été supprimée.', '<a class="btn" href="#/mes-seances">Mes séances</a>')}`;
    }
    const today = U.todayKey();
    const n = d.exercises.length;
    const min = estimateMinutes(d);
    const canPlan = C.planner && typeof C.planner.setOverride === 'function';
    return `<header class="top"><button type="button" class="back lib-back" data-action="biblio.cs-retour">‹ Mes séances</button>
        <h1>${d.isNew ? 'Nouvelle séance' : 'Modifier la séance'}</h1></header>
      <div class="card">
        <label class="field"><span>Nom</span><input id="cs-name" type="text" required maxlength="80" autocomplete="off" data-input="biblio.draft" data-f="name" value="${esc(d.name)}" placeholder="Ex. Haut du corps maison"></label>
        <div class="field"><span>Lieu</span>${C.ui.segmented('cs-loc', LOC_OPTS, d.loc, 'data-change="biblio.draft-loc"')}</div>
        <div class="field"><span>Objectifs</span><div class="lib-checks">${GOAL_OPTS.filter((o) => o.value).map((o) => `<label class="lib-check">
          <input type="checkbox" data-change="biblio.draft-goal" value="${esc(o.value)}" ${d.goals.includes(o.value) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div></div>
        <label class="field"><span>Intro (facultatif)</span><textarea id="cs-intro" rows="2" maxlength="1000" data-input="biblio.draft" data-f="intro" placeholder="But de la séance, échauffement…">${esc(d.intro)}</textarea></label>
      </div>
      <h2 class="section">Exercices <span class="muted small">${esc(n)}${min ? ` · ≈ ${esc(min)} min` : ''}</span></h2>
      ${n ? `<ol class="lib-cs-list">${d.exercises.map((e, i) => draftRowHTML(e, i, n)).join('')}</ol>` : '<p class="muted small">Aucun exercice pour l\'instant.</p>'}
      <button type="button" class="btn ghost block" data-action="biblio.cs-pick">+ Ajouter des exercices</button>
      <div class="card mt lib-cs-actions">
        <button type="button" class="btn block" data-action="biblio.cs-save">Enregistrer</button>
        <button type="button" class="btn ghost block" data-action="biblio.cs-start-draft" ${n ? '' : 'disabled'}>▶ Démarrer maintenant</button>
        ${canPlan ? `<div class="lib-plan">
          <label class="field grow"><span>Planifier le</span><input id="cs-date" type="date" min="${esc(today)}" value="${esc(U.addDays(today, 1))}"></label>
          <button type="button" class="btn ghost" data-action="biblio.cs-plan" ${n ? '' : 'disabled'}>Planifier</button></div>` : ''}
        ${!d.isNew ? '<button type="button" class="btn ghost danger block" data-action="biblio.cs-delete">Supprimer cette séance perso</button>' : ''}
      </div>`;
  }

  /* ───────── Sélecteur d'exercices (feuille) ───────── */

  function pickList() {
    if (!D().searchExercises) return [];
    return safe(() => D().searchExercises({ q: pick.q, cat: pick.cat || undefined, loc: pick.loc || undefined, lowImpact: pick.lowImpact }), []);
  }
  function pickResultsHTML(list) {
    const injured = injuredZones(C.state.profile);
    if (!list.length) return '<li class="muted small center">Aucun exercice. Essaie un autre mot ou un autre lieu.</li>';
    return list.slice(0, 80).map((ex) => {
      const added = pick.added.has(ex.id);
      return `<li><button type="button" class="lib-pick-btn ${added ? 'is-added' : ''}" data-action="biblio.pick" data-id="${esc(ex.id)}">
        <span class="lib-ico" aria-hidden="true">${esc(catInfo(ex.cat).icon)}</span>
        <span class="lib-txt"><b>${esc(ex.name)}</b><small class="muted">${esc(exMeta(ex))}</small></span>
        <span class="lib-badges">${exBadges(ex, injured)}</span>
        <span class="lib-plus" aria-hidden="true">${added ? '✓' : '+'}</span></button></li>`;
    }).join('');
  }
  function refreshPick() {
    const list = pickList();
    const zone = document.getElementById('lib-pick-results');
    if (zone) zone.innerHTML = pickResultsHTML(list);
    const count = document.getElementById('lib-pick-count');
    if (count) count.textContent = list.length > 80 ? `80 premiers sur ${list.length} : précise ta recherche` : countText(list.length);
    document.querySelectorAll('#modal [data-action="biblio.pick-cat"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === pick.cat)));
  }

  // Ouvre le sélecteur. opts : { title, loc, multi, onPick(exId), onClose() }.
  function pickExercise(opts = {}) {
    pick.q = ''; pick.cat = '';
    pick.loc = LOC_LABELS[opts.loc] ? opts.loc : '';
    pick.lowImpact = defaultLowImpact(C.state.profile);
    pick.onPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    pick.multi = !!opts.multi;
    pick.added = new Set();
    const list = pickList();
    const catEntries = Object.entries(cats()).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    C.ui.openModal({
      title: opts.title || 'Choisir un exercice',
      onClose: opts.onClose,
      body: `<div class="lib-pick">
        <input type="search" id="lib-pick-q" class="lib-search" data-input="biblio.pick-q" placeholder="Chercher un exercice…" aria-label="Chercher un exercice" autocomplete="off" enterkeyhint="search">
        <div class="lib-chips" role="group" aria-label="Catégorie">
          <button type="button" class="lib-chip" data-action="biblio.pick-cat" data-cat="" aria-pressed="true">Toutes</button>
          ${catEntries.map(([k, c]) => `<button type="button" class="lib-chip" data-action="biblio.pick-cat" data-cat="${esc(k)}" aria-pressed="false"><span aria-hidden="true">${esc(c.icon)}</span> ${esc(c.label)}</button>`).join('')}
        </div>
        <div class="row gap wrap lib-pick-opts">
          <select data-change="biblio.pick-loc" aria-label="Lieu"><option value="">Tous les lieux</option>
            ${LOC_OPTS.map((o) => `<option value="${esc(o.value)}" ${pick.loc === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
          <label class="check-row small"><input type="checkbox" data-change="biblio.pick-impact" ${pick.lowImpact ? 'checked' : ''}> Sans sauts</label>
        </div>
        <p class="tiny muted" id="lib-pick-count" aria-live="polite">${esc(list.length > 80 ? `80 premiers sur ${list.length} : précise ta recherche` : countText(list.length))}</p>
        <ul class="lib-pick-list" id="lib-pick-results">${pickResultsHTML(list)}</ul>
        ${pick.multi ? '<button type="button" class="btn block mt" data-close>Terminé</button>' : ''}
      </div>`,
    });
  }

  /* ───────── Actions ───────── */

  function startCustom(csId) {
    const cs = (C.state.customSessions || []).find((x) => x.id === csId);
    if (!cs) return;
    if (!cs.exercises.length) { C.ui.toast('Ajoute au moins un exercice.'); return; }
    const today = U.todayKey();
    let sid = null;
    if (C.planner && typeof C.planner.instantiate === 'function') {
      sid = safe(() => C.sessions.create(today, { customSessionId: csId, silent: true }), null);
    }
    if (!sid) sid = C.sessions.create(today, { free: true, title: cs.name, loc: cs.loc, silent: true });
    // Repli : le planificateur absent ou muet, on construit les exercices nous-mêmes.
    C.store.update((st) => {
      const s = st.sessions[sid];
      if (!s) return;
      s.source = 'perso'; s.customSessionId = cs.id;
      if (!s.exercises.length) {
        s.exercises = cs.exercises.map(itemFromEntry).filter(Boolean);
        s.goals = cs.goals.slice(); s.intro = cs.intro || ''; s.title = cs.name; s.loc = cs.loc;
      }
    }, { silent: true });
    C.go('#/seance/' + encodeURIComponent(sid));
  }

  function saveDraft() {
    if (!draft) return null;
    const err = draftError(draft);
    if (err) {
      C.ui.toast(err);
      const el = document.getElementById('cs-name');
      if (el) el.focus();
      return null;
    }
    const rec = customFromDraft(draft, U.todayKey());
    C.store.update((st) => {
      const i = st.customSessions.findIndex((x) => x.id === rec.id);
      if (i >= 0) st.customSessions[i] = rec; else st.customSessions.push(rec);
    }, { silent: true });
    draft = { ...U.clone(rec), isNew: false, dirty: false };
    draftFor = rec.id;
    return rec.id;
  }

  function newFreeWith(exId) {
    const ex = getEx(exId);
    if (!ex) return;
    const sid = C.sessions.create(U.todayKey(), { free: true, title: 'Séance libre', loc: (ex.locs || [])[0] || 'autre', silent: true });
    C.sessions.addExercise(sid, exId);
    C.go('#/seance/' + encodeURIComponent(sid));
  }

  function register() {
    C.route('#/bibliotheque', viewLibrary, { tab: '#/plus', title: 'Bibliothèque' });
    C.route('#/exercice/:id', viewExercise, { tab: '#/plus', title: 'Exercice' });
    C.route('#/mes-seances', viewCustomList, { tab: '#/plus', title: 'Mes séances' });
    C.route('#/mes-seances/:id', viewCustomEdit, { tab: '#/plus', title: 'Séance perso' });
    C.menuItem({ hash: '#/bibliotheque', icon: '📚', label: 'Bibliothèque', desc: 'Exercices par objectif, fiches et historique', order: 20 });
    C.menuItem({ hash: '#/mes-seances', icon: '📋', label: 'Mes séances', desc: 'Composer, démarrer et planifier tes séances', order: 21 });

    C.action('biblio.retour', () => C.back('#/bibliotheque'));

    // Recherche : on ne remplace que la liste (le champ garde le focus et le clavier reste ouvert).
    C.onInput('biblio.q', (el) => {
      lib.q = el.value.slice(0, 80);
      const list = searchLib();
      const zone = document.getElementById('lib-results');
      if (zone) zone.innerHTML = resultsHTML(list);
      const count = document.getElementById('lib-count');
      if (count) count.textContent = countText(list.length);
    });
    C.onChange('biblio.filtre', (el) => {
      const f = el.dataset.f;
      if (f === 'lowImpact' || f === 'mine') lib[f] = el.checked;
      else if (f in lib) lib[f] = el.value;
      C.rerender();
    });
    C.action('biblio.reset', () => {
      Object.assign(lib, { q: '', goal: '', loc: '', cat: '', lowImpact: null, mine: false });
      C.rerender();
    });
    C.action('biblio.circuit', (el) => {
      const spec = D().circuitSpec ? D().circuitSpec(el.dataset.id) : null;
      if (!spec || !C.timer || !C.timer.open) { C.ui.toast('Minuteur indisponible'); return; }
      if (C.audio && C.audio.unlock) safe(() => C.audio.unlock());
      C.timer.open(spec);
    });

    // Fiche : faire maintenant (séance libre du jour, ou ajout à la séance en cours du jour).
    C.action('biblio.faire', (el) => {
      const exId = el.dataset.id;
      const ex = getEx(exId);
      if (!ex) return;
      const current = C.sessions.forDate(U.todayKey()).filter((s) => s.status === 'in_progress');
      if (!current.length) { newFreeWith(exId); return; }
      C.ui.openModal({
        title: 'Faire maintenant',
        body: `<p class="small muted">Tu as déjà une séance en cours aujourd'hui.</p><div class="col gap">
          ${current.map((s) => `<button type="button" class="btn block" data-action="biblio.faire-dans" data-ex="${esc(exId)}" data-id="${esc(s.id)}">Ajouter à « ${esc(s.title)} »</button>`).join('')}
          <button type="button" class="btn ghost block" data-action="biblio.faire-libre" data-ex="${esc(exId)}">Nouvelle séance libre</button>
          <button type="button" class="btn ghost block" data-close>Annuler</button></div>`,
      });
    });
    C.action('biblio.faire-dans', (el) => {
      C.ui.closeModal();
      C.sessions.addExercise(el.dataset.id, el.dataset.ex);
      C.go('#/seance/' + encodeURIComponent(el.dataset.id));
    });
    C.action('biblio.faire-libre', (el) => { C.ui.closeModal(); newFreeWith(el.dataset.ex); });

    // Fiche : ajouter à une séance perso
    C.action('biblio.vers-perso-choix', (el) => {
      const exId = el.dataset.id;
      const list = C.state.customSessions || [];
      C.ui.openModal({
        title: 'Ajouter à une séance perso',
        body: `<div class="col gap">${list.map((cs) => `<button type="button" class="btn ghost block lib-left" data-action="biblio.vers-perso" data-cs="${esc(cs.id)}" data-ex="${esc(exId)}">
            ${esc(cs.name)} <span class="muted small">· ${esc(U.plural(cs.exercises.length, 'exercice', 'exercices'))}</span></button>`).join('')}
          <button type="button" class="btn block" data-action="biblio.vers-nouvelle" data-ex="${esc(exId)}">+ Nouvelle séance perso</button></div>`,
      });
    });
    C.action('biblio.vers-perso', (el) => {
      const ex = getEx(el.dataset.ex);
      if (!ex) return;
      let name = '';
      C.store.update((st) => {
        const cs = st.customSessions.find((x) => x.id === el.dataset.cs);
        if (cs) { cs.exercises.push(entryFor(ex)); name = cs.name; }
      }, { silent: true });
      if (draftFor === el.dataset.cs) { draft = null; draftFor = null; } // le brouillon ouvert n'est plus à jour
      C.ui.closeModal();
      C.ui.toast(`Ajouté à « ${name} »`);
    });
    C.action('biblio.vers-nouvelle', (el) => {
      const ex = getEx(el.dataset.ex);
      if (!ex) return;
      draft = newDraft();
      draft.loc = LOC_LABELS[(ex.locs || [])[0]] ? ex.locs[0] : 'maison';
      draft.goals = (ex.goals || []).filter((g) => g !== 'general');
      draft.exercises.push(entryFor(ex));
      draft.dirty = true;
      draftFor = 'nouvelle';
      C.ui.closeModal();
      C.go('#/mes-seances/nouvelle');
    });

    // Exercices perso
    C.onSubmit('biblio.exo-save', (form, fd) => {
      const input = exerciseInput({
        name: fd.get('name'), cat: fd.get('cat'), track: fd.get('track'), locs: fd.getAll('locs'), goals: fd.getAll('goals'),
        sets: fd.get('sets'), reps: fd.get('reps'), rest: fd.get('rest'), impact: fd.get('impact'), stress: fd.getAll('stress'),
        description: fd.get('description'), cues: fd.get('cues'),
      });
      if (!input.name) { C.ui.toast('Donne un nom à l\'exercice.'); return; }
      const editId = form.dataset.id || null;
      const old = editId ? (C.state.customExercises || []).find((e) => e.id === editId) : null;
      const ex = buildCustomExercise(input, editId);
      if (old && old.createdAt) ex.createdAt = old.createdAt;
      C.store.update((st) => {
        const i = st.customExercises.findIndex((e) => e.id === ex.id);
        if (i >= 0) st.customExercises[i] = ex; else st.customExercises.push(ex);
      }, { silent: true });
      C.ui.toast(editId ? 'Exercice modifié' : 'Exercice créé');
      C.go(exHref(ex.id), { replace: true });
    });
    C.action('biblio.exo-suppr', async (el) => {
      const exId = el.dataset.id;
      const ex = getEx(exId);
      if (!ex) return;
      const used = (C.state.customSessions || []).filter((cs) => cs.exercises.some((e) => e.exId === exId)).length;
      const msg = `Supprimer « ${ex.name} » ?${used ? ` Il sera retiré de ${U.plural(used, 'séance perso', 'séances perso')}.` : ''} Les séances déjà faites gardent leur historique.`;
      if (!(await C.ui.ask(msg, 'Supprimer', { danger: true }))) return;
      C.store.update((st) => { removeExerciseRefs(st, exId); }, { silent: true });
      draft = null; draftFor = null;
      C.ui.toast('Exercice supprimé');
      C.go('#/bibliotheque', { replace: true });
    });

    // Séances perso : édition du brouillon (sans re-rendu pendant la frappe)
    C.onInput('biblio.draft', (el) => {
      if (!draft) return;
      draft[el.dataset.f] = el.value;
      draft.dirty = true;
    });
    C.onChange('biblio.draft-loc', (el) => { if (draft) { draft.loc = el.value; draft.dirty = true; } });
    C.onChange('biblio.draft-goal', (el) => {
      if (!draft) return;
      const set = new Set(draft.goals);
      if (el.checked) set.add(el.value); else set.delete(el.value);
      draft.goals = GOAL_OPTS.map((o) => o.value).filter((g) => g && set.has(g));
      draft.dirty = true;
    });
    C.onInput('biblio.draft-ex', (el) => {
      const e = draft && draft.exercises[Number(el.dataset.i)];
      if (!e) return;
      const f = el.dataset.f;
      let v = el.value;
      if (f === 'sets') { v = U.num(v); if (v == null || v < 1 || v > 30) { el.setAttribute('aria-invalid', 'true'); return; } v = Math.round(v); }
      if (f === 'rest') { v = v.trim() ? U.parseDuration(v) : 0; if (v == null) { el.setAttribute('aria-invalid', 'true'); return; } }
      el.removeAttribute('aria-invalid');
      e[f] = v;
      draft.dirty = true;
    });
    C.action('biblio.cs-move', (el) => {
      if (!draft) return;
      draft.exercises = moveItem(draft.exercises, Number(el.dataset.i), Number(el.dataset.d));
      draft.dirty = true;
      C.rerender();
    });
    C.action('biblio.cs-del', (el) => {
      if (!draft) return;
      draft.exercises.splice(Number(el.dataset.i), 1);
      draft.dirty = true;
      C.rerender();
    });
    C.action('biblio.cs-pick', () => {
      if (!draft) return;
      const d = draft;
      pickExercise({
        title: 'Ajouter des exercices', loc: d.loc, multi: true,
        onPick: (exId) => {
          const ex = getEx(exId);
          if (!ex) return;
          d.exercises.push(entryFor(ex));
          d.dirty = true;
        },
        onClose: () => { if (draft === d) C.rerender(); },
      });
    });
    C.action('biblio.cs-save', () => {
      const wasNew = draft && draft.isNew;
      const id = saveDraft();
      if (!id) return;
      C.ui.toast('Séance enregistrée');
      if (wasNew) C.go('#/mes-seances/' + encodeURIComponent(id), { replace: true });
      else C.rerender();
    });
    C.action('biblio.cs-start-draft', () => {
      const id = saveDraft();
      if (id) startCustom(id);
    });
    C.action('biblio.cs-plan', () => {
      const input = document.getElementById('cs-date');
      const date = input && input.value;
      if (!U.isKey(date) || date < U.todayKey()) { C.ui.toast('Choisis une date à venir.'); return; }
      if (!C.planner || typeof C.planner.setOverride !== 'function') { C.ui.toast('Le plan n\'est pas disponible.'); return; }
      const wasNew = draft && draft.isNew;
      const id = saveDraft();
      if (!id) return;
      C.planner.setOverride(date, { customSessionId: id });
      C.ui.toast(`Prévue ${U.fmtDate(date).toLowerCase()}`);
      if (wasNew) C.go('#/mes-seances/' + encodeURIComponent(id), { replace: true });
    });
    C.action('biblio.cs-delete', async () => {
      if (!draft || draft.isNew) return;
      const id = draft.id;
      if (!(await C.ui.ask(`Supprimer la séance perso « ${draft.name} » ? Les séances déjà faites sont gardées.`, 'Supprimer', { danger: true }))) return;
      C.store.update((st) => { removeCustomSession(st, id, U.todayKey()); }, { silent: true });
      draft = null; draftFor = null;
      C.ui.toast('Séance perso supprimée');
      C.go('#/mes-seances', { replace: true });
    });
    C.action('biblio.cs-retour', async () => {
      if (draft && draft.dirty && !(await C.ui.ask('Quitter sans enregistrer tes modifications ?', 'Quitter', { noLabel: 'Rester' }))) return;
      draft = null; draftFor = null;
      C.go('#/mes-seances');
    });
    C.action('biblio.cs-start', (el) => startCustom(el.dataset.id));

    // Sélecteur
    C.onInput('biblio.pick-q', (el) => { pick.q = el.value.slice(0, 80); refreshPick(); });
    C.action('biblio.pick-cat', (el) => { pick.cat = el.dataset.cat || ''; refreshPick(); });
    C.onChange('biblio.pick-loc', (el) => { pick.loc = el.value; refreshPick(); });
    C.onChange('biblio.pick-impact', (el) => { pick.lowImpact = el.checked; refreshPick(); });
    C.action('biblio.pick', (el) => {
      const exId = el.dataset.id;
      const fn = pick.onPick;
      if (!pick.multi) { C.ui.closeModal(); if (fn) fn(exId); return; }
      if (fn) fn(exId);
      pick.added.add(exId);
      el.classList.add('is-added');
      const plus = el.querySelector('.lib-plus');
      if (plus) plus.textContent = '✓';
      const ex = getEx(exId);
      C.ui.toast(`Ajouté : ${ex ? ex.name : 'exercice'}`);
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.libraryUI = {
    pickExercise, startCustom,
    // Fonctions pures (tests)
    _t: {
      injuredZones, defaultLowImpact, availableEquipment, groupByCat, perfDirection, perfValue, trendOf, historySummary,
      localHistory, moveItem, exerciseInput, buildCustomExercise, removeExerciseRefs, removeCustomSession, entryFor,
      newDraft, customFromDraft, draftError, itemFromEntry, estimateMinutes,
    },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
