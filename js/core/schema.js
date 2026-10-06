/* Crevare — modèle de données v2 : état par défaut, migration depuis la v1, assainissement.
 * Toute donnée lue (localStorage, import) passe par migrate() puis sanitize() avant usage. */
(function (C) {
  'use strict';
  const U = C.util;

  const VERSION = 2;

  const LOCS = ['maison', 'salle', 'piscine', 'dehors', 'repos', 'autre'];
  const GOAL_TYPES = ['ssa', 'hyrox', 'pompier', 'custom'];
  const BENCH_CONTEXTS = ['test', 'entrainement', 'officiel', 'ancien', 'sante'];
  const FOOD = ['peu', 'normal', 'beaucoup'];
  const HABIT_TYPES = ['check', 'number', 'avoid'];
  const INJURY_ZONES = ['genou', 'cheville', 'epaule', 'dos', 'hanche', 'poignet', 'coude', 'nuque', 'autre'];

  const DEFAULT_HABITS = [
    { id: 'sleep', name: 'Sommeil ≥ 7 h', icon: '😴', type: 'check' },
    { id: 'water', name: 'Eau', icon: '💧', type: 'number', target: 1.5, unit: 'L' },
    { id: 'rehab', name: '10 min cheville / genou', icon: '🦵', type: 'check', cue: 'Après le brossage de dents du soir' },
    { id: 'protein', name: 'Protéines à chaque repas', icon: '🍗', type: 'check' },
  ];

  // Agenda : calendriers importés (cours, Protection civile…) et réglages des révisions.
  // Heures au format "HH:MM" (heure locale). Les événements sont stockés en heure locale "AAAA-MM-JJTHH:MM".
  function defaultAgenda() {
    return {
      sources: [], // {id, name, url, kind:'cours'|'protection-civile'|'perso', color, busy:true, lastSyncAt, lastError, count}
      events: [], // {id, sourceId, uid, title, start, end, allDay, location, categories:[], status}
      revision: {
        enabled: true,
        latestEnd: '22:00', // aucune révision ne finit après cette heure
        weekendStart: '09:00', // début possible le week-end et les jours sans cours
        weekdayStart: '08:00',
        bufferAfterMin: 30, // pause/trajet après un cours ou un événement
        bufferBeforeMin: 30, // marge avant un événement
        blockMin: 50, // durée d'un bloc de révision
        breakMin: 10,
        minSlotMin: 25, // créneau libre minimal utilisable
        maxWeekdayMin: 120, // maximum de révision par jour de semaine
        maxWeekendMin: 240,
        meal: { start: '19:30', end: '20:15' }, // créneau repas protégé (vide = aucun)
        daysOff: [], // jours sans révision (0 = lundi)
        avoidTrainingDays: false, // pas de révision les jours de séance de sport
        spacing: [0, 1, 7, 30], // relectures espacées (jours après le cours)
        horizonDays: 14,
      },
      subjects: [], // {id, name, color, match:[mots-clés], ignore:bool, weight:1-3}
      exams: [], // {id, subjectId, date, title, source:'auto'|'manuel'}
      tasks: {}, // id → {id, subjectId, kind, title, due, durationMin, sourceEventId, done, doneAt, skipped}
      blocks: {}, // id du bloc planifié → {done, doneAt, note} (état des blocs proposés)
    };
  }

  function defaultState(today) {
    const t = today || U.todayKey();
    return {
      schemaVersion: VERSION,
      createdAt: t,
      updatedAt: null,
      profile: {
        onboarded: false,
        firstName: '',
        birthYear: null,
        sex: null, // 'H' | 'F' (catégorie des barèmes officiels)
        department: '',
        futureLocations: '',
        injuries: [], // {id, zone, side, note, active, since}
        equipment: { home: ['barre', 'elastiques'], gym: { name: '', hyrox: false } },
        pools: [], // {id, name, length: 25|50, deepM: number|null, mannequin: bool|null}
        apneaBuddy: '', // club, binôme ou MNS — vide = aucun
        sessionsPerWeek: 3,
        availableDays: [1, 3, 5], // 0 = lundi
        maxSessionMin: 120,
        levels: { swim: 'inconnu', run: '', strength: '' },
      },
      goals: [],
      plan: { startDate: t, overrides: {} },
      sessions: {},
      customExercises: [],
      customSessions: [],
      timers: [],
      habits: DEFAULT_HABITS.map((h) => ({ ...h, createdAt: t, archivedAt: null })),
      habitLog: {},
      body: {},
      checkins: {},
      benchmarks: {},
      health: { lastImportAt: null, workouts: [] },
      agenda: defaultAgenda(),
      settings: { sound: true, voice: true, theme: 'auto', lastExportAt: null, exportReminderDays: 14 },
    };
  }

  /* ───────── Migration v1 → v2 ───────── */

  const V1_BENCH_MAP = {
    ssa_test: 'ssa_test_v1', // ancien format (TASA 100 m < 3:45) : conservé à part, non comparable
    apnea: 'apnea_dyn', swim_100: 'swim_100', swim_300: 'swim_300', pullups: 'pullups', pushups: 'pushups',
    plank: 'plank', leger: 'luc_leger', run_1k: 'run_1k', run_5k: 'run_5k', row_1000: 'row_1000',
  };
  const V1_GOAL_NAMES = { ssa: 'SSA — Surveillant sauveteur aquatique', hyrox: 'HYROX', pompier: 'Sapeur-pompier' };

  function migrateV1(v1) {
    const legacy = C.legacyV1 || { sessions: {}, exercises: {} };
    const t = U.isKey(v1.startDate) ? v1.startDate : U.todayKey();
    const s = defaultState(t);

    // Objectifs : on garde les dates, le questionnaire de départ permettra de les corriger.
    for (const type of ['ssa', 'hyrox', 'pompier']) {
      const g = v1.goals && v1.goals[type];
      if (g && U.isKey(g.date)) {
        s.goals.push({ id: U.uid(), type, name: V1_GOAL_NAMES[type], date: g.date, priority: 2, status: 'active', details: {}, milestones: [], createdAt: t });
      }
    }

    // Séances : workouts[date] → sessions[id] (instantané des exercices tel qu'en v1).
    for (const [date, w] of Object.entries(v1.workouts || {})) {
      if (!U.isKey(date) || !U.isObj(w)) continue;
      const meta = legacy.sessions[w.sessionId] || ['Séance (v1)', 'autre'];
      const exercises = Object.keys(w.log || {}).map((exId) => {
        const e = legacy.exercises[exId] || [exId, 'check'];
        return { key: exId, exId: 'v1:' + exId, name: e[0], track: e[1], sets: (w.log[exId] || []).length || 1, reps: '', rest: 0 };
      });
      const id = U.uid();
      const durationMin = w.startedAt && w.finishedAt ? Math.max(1, Math.round((w.finishedAt - w.startedAt) / 60000)) : null;
      s.sessions[id] = {
        id, date, source: 'v1', templateId: 'v1:' + (w.sessionId || ''), title: meta[0], loc: meta[1], kind: null,
        exercises, log: w.log || {}, status: w.done ? 'done' : 'in_progress',
        startedAt: w.startedAt || null, finishedAt: w.finishedAt || null,
        durationMin: durationMin && durationMin < 600 ? durationMin : null,
        rpe: w.rpe ?? null, pain: {}, notes: w.notes || '',
      };
    }

    // Tests de référence
    for (const [oldId, list] of Object.entries(v1.benchmarks || {})) {
      if (!Array.isArray(list)) continue;
      if (oldId === 'weight') {
        for (const e of list) if (U.isKey(e.date) && U.num(e.value)) s.body[e.date] = { ...(s.body[e.date] || {}), weight: U.num(e.value) };
        continue;
      }
      const newId = V1_BENCH_MAP[oldId] || oldId;
      s.benchmarks[newId] = list.filter((e) => U.isKey(e.date) && U.num(e.value) != null).map((e) => ({
        id: U.uid(), date: e.date, value: U.num(e.value), context: oldId === 'ssa_test' ? 'ancien' : 'test', source: 'v1', note: '',
      }));
    }

    // Habitudes
    if (Array.isArray(v1.habits)) {
      s.habits = v1.habits.filter((h) => h && h.id && h.name).map((h) => ({ id: String(h.id), name: String(h.name), icon: h.icon || '✓', type: 'check', createdAt: t, archivedAt: null }));
    }
    if (U.isObj(v1.habitLog)) s.habitLog = v1.habitLog;
    if (v1.settings && typeof v1.settings.sound === 'boolean') s.settings.sound = v1.settings.sound;
    s.migratedFrom = 1;
    return s;
  }

  function migrate(raw) {
    if (!U.isObj(raw)) return null;
    if (raw.schemaVersion === VERSION) return raw;
    if (raw.version === 1 && U.isObj(raw.goals)) return migrateV1(raw);
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > VERSION) {
      throw new Error('Ces données viennent d\'une version plus récente de Crevare.');
    }
    return null;
  }

  /* ───────── Assainissement ───────── */

  const str = (v, max = 500) => (v == null ? '' : String(v).slice(0, max));
  const bool = (v) => v === true;
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (U.isObj(v) ? v : {});
  const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
  const numOr = (v, dflt) => { const n = U.num(v); return n == null ? dflt : n; };

  // Garantit la forme attendue par l'application, quelles que soient les données reçues.
  // Ne jette jamais : les entrées invalides sont ignorées.
  function sanitize(input) {
    const d = defaultState(U.isKey(input && input.createdAt) ? input.createdAt : undefined);
    const s = obj(input);
    const out = d;
    out.updatedAt = typeof s.updatedAt === 'string' ? s.updatedAt : null;
    if (s.migratedFrom) out.migratedFrom = s.migratedFrom;

    const p = obj(s.profile);
    const dp = out.profile;
    dp.onboarded = bool(p.onboarded);
    dp.firstName = str(p.firstName, 40);
    dp.birthYear = Number.isInteger(p.birthYear) && p.birthYear > 1900 && p.birthYear < 2100 ? p.birthYear : null;
    dp.sex = oneOf(p.sex, ['H', 'F'], null);
    dp.department = str(p.department, 40);
    dp.futureLocations = str(p.futureLocations, 200);
    dp.injuries = arr(p.injuries).filter(U.isObj).map((i) => ({
      id: str(i.id || U.uid(), 80), zone: oneOf(i.zone, INJURY_ZONES, 'autre'), side: str(i.side, 20),
      note: str(i.note, 300), active: i.active !== false, since: U.isKey(i.since) ? i.since : null,
    }));
    const eq = obj(p.equipment);
    dp.equipment = {
      home: arr(eq.home).map((x) => str(x, 40)).filter(Boolean),
      gym: { name: str(obj(eq.gym).name, 80), hyrox: bool(obj(eq.gym).hyrox) },
    };
    if (!Array.isArray(eq.home)) dp.equipment.home = d.profile.equipment.home;
    dp.pools = arr(p.pools).filter(U.isObj).map((pl) => ({
      id: str(pl.id || U.uid(), 80), name: str(pl.name, 60) || 'Piscine', length: [25, 50, 33].includes(+pl.length) ? +pl.length : 25,
      deepM: U.num(pl.deepM), mannequin: typeof pl.mannequin === 'boolean' ? pl.mannequin : null,
    }));
    dp.apneaBuddy = str(p.apneaBuddy, 120);
    dp.sessionsPerWeek = U.clamp(Math.round(numOr(p.sessionsPerWeek, 3)), 1, 7);
    const days = arr(p.availableDays).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    dp.availableDays = days.length ? [...new Set(days)].sort() : d.profile.availableDays;
    dp.maxSessionMin = U.clamp(Math.round(numOr(p.maxSessionMin, 120)), 20, 300);
    dp.levels = { swim: str(obj(p.levels).swim, 40) || 'inconnu', run: str(obj(p.levels).run, 200), strength: str(obj(p.levels).strength, 200) };

    out.goals = arr(s.goals).filter((g) => U.isObj(g) && g.id).map((g) => ({
      id: str(g.id, 80), type: oneOf(g.type, GOAL_TYPES, 'custom'), name: str(g.name, 120) || 'Objectif',
      date: U.isKey(g.date) ? g.date : null, dateEnd: U.isKey(g.dateEnd) ? g.dateEnd : null,
      priority: oneOf(+g.priority, [1, 2, 3], 2), status: oneOf(g.status, ['active', 'done', 'archived'], 'active'),
      details: obj(g.details), note: str(g.note, 1000),
      milestones: arr(g.milestones).filter(U.isObj).map((m) => ({
        id: str(m.id || U.uid(), 80), title: str(m.title, 200), due: U.isKey(m.due) ? m.due : null,
        done: bool(m.done), doneAt: U.isKey(m.doneAt) ? m.doneAt : null, note: str(m.note, 500), key: m.key ? str(m.key, 60) : undefined,
      })).filter((m) => m.title),
      result: U.isObj(g.result) ? g.result : null,
      createdAt: U.isKey(g.createdAt) ? g.createdAt : out.createdAt,
    }));

    const plan = obj(s.plan);
    out.plan = { startDate: U.isKey(plan.startDate) ? plan.startDate : out.createdAt, overrides: {} };
    for (const [k, v] of Object.entries(obj(plan.overrides))) if (U.isKey(k) && U.isObj(v)) out.plan.overrides[k] = v;

    for (const [id, x] of Object.entries(obj(s.sessions))) {
      if (!U.isObj(x) || !U.isKey(x.date)) continue;
      out.sessions[id] = {
        ...x,
        id,
        title: str(x.title, 160) || 'Séance',
        loc: oneOf(x.loc, LOCS, 'autre'),
        exercises: arr(x.exercises).filter(U.isObj),
        log: obj(x.log),
        status: oneOf(x.status, ['in_progress', 'done', 'skipped'], 'in_progress'),
        rpe: x.rpe == null ? null : U.clamp(numOr(x.rpe, 0), 0, 10),
        durationMin: x.durationMin == null ? null : U.clamp(numOr(x.durationMin, 0), 0, 600),
        pain: obj(x.pain),
        notes: str(x.notes, 2000),
      };
    }

    out.customExercises = arr(s.customExercises).filter((e) => U.isObj(e) && e.id && e.name);
    out.customSessions = arr(s.customSessions).filter((e) => U.isObj(e) && e.id && e.name).map((e) => ({ ...e, exercises: arr(e.exercises).filter(U.isObj) }));
    out.timers = arr(s.timers).filter((t) => U.isObj(t) && t.id && Array.isArray(t.steps));

    if (Array.isArray(s.habits)) {
      out.habits = s.habits.filter((h) => U.isObj(h) && h.id && str(h.name).trim()).map((h) => ({
        id: str(h.id, 80), name: str(h.name, 80).trim(), icon: str(h.icon, 16) || '✓', type: oneOf(h.type, HABIT_TYPES, 'check'),
        target: U.num(h.target), unit: str(h.unit, 12), perWeek: U.num(h.perWeek), cue: str(h.cue, 200),
        createdAt: U.isKey(h.createdAt) ? h.createdAt : out.createdAt, archivedAt: U.isKey(h.archivedAt) ? h.archivedAt : null,
      }));
    }
    for (const [k, v] of Object.entries(obj(s.habitLog))) if (U.isKey(k) && U.isObj(v)) out.habitLog[k] = v;
    for (const [k, v] of Object.entries(obj(s.body))) {
      if (!U.isKey(k) || !U.isObj(v)) continue;
      const e = {};
      const w = U.num(v.weight);
      if (w != null && w > 20 && w < 400) e.weight = w;
      if (FOOD.includes(v.food)) e.food = v.food;
      if (Object.keys(e).length) out.body[k] = e;
    }
    for (const [k, v] of Object.entries(obj(s.checkins))) if (U.isKey(k) && U.isObj(v)) out.checkins[k] = v;
    for (const [id, list] of Object.entries(obj(s.benchmarks))) {
      const clean = arr(list).filter((e) => U.isObj(e) && U.isKey(e.date) && U.num(e.value) != null).map((e) => ({
        id: str(e.id || U.uid(), 80), date: e.date, value: U.num(e.value), context: oneOf(e.context, BENCH_CONTEXTS, 'test'),
        source: str(e.source, 120), note: str(e.note, 300),
      }));
      if (clean.length) out.benchmarks[str(id, 80)] = clean.sort((a, b) => a.date.localeCompare(b.date));
    }
    const h = obj(s.health);
    out.health = { lastImportAt: typeof h.lastImportAt === 'string' ? h.lastImportAt : null, workouts: arr(h.workouts).filter((w) => U.isObj(w) && U.isKey(w.date)) };
    const ag = obj(s.agenda);
    const dag = out.agenda;
    dag.sources = arr(ag.sources).filter((x) => U.isObj(x) && x.id).map((x) => ({
      id: str(x.id, 80), name: str(x.name, 60) || 'Calendrier', url: str(x.url, 2000),
      kind: oneOf(x.kind, ['cours', 'protection-civile', 'perso', 'sport'], 'perso'), color: str(x.color, 20),
      busy: x.busy !== false, lastSyncAt: typeof x.lastSyncAt === 'string' ? x.lastSyncAt : null,
      lastError: str(x.lastError, 300), count: U.num(x.count) || 0,
    }));
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    dag.events = arr(ag.events).filter((e) => U.isObj(e) && typeof e.start === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(e.start)).map((e) => ({
      id: str(e.id, 300), sourceId: str(e.sourceId, 80), uid: str(e.uid, 300), title: str(e.title, 300), start: e.start,
      end: typeof e.end === 'string' ? e.end : e.start, allDay: !!e.allDay, location: str(e.location, 300),
      categories: arr(e.categories).map((c) => str(c, 40)), status: str(e.status, 20),
    }));
    const rv = obj(ag.revision);
    for (const [k, v] of Object.entries(dag.revision)) {
      if (!(k in rv)) continue;
      if (typeof v === 'string' && timeRe.test(rv[k])) dag.revision[k] = rv[k];
      else if (typeof v === 'number' && U.num(rv[k]) != null) dag.revision[k] = U.clamp(U.num(rv[k]), 0, 1440);
      else if (typeof v === 'boolean') dag.revision[k] = rv[k] === true;
      else if (Array.isArray(v) && Array.isArray(rv[k])) dag.revision[k] = rv[k].map(Number).filter((n) => isFinite(n));
      else if (U.isObj(v) && U.isObj(rv[k])) dag.revision[k] = { start: timeRe.test(rv[k].start) ? rv[k].start : '', end: timeRe.test(rv[k].end) ? rv[k].end : '' };
    }
    dag.subjects = arr(ag.subjects).filter((x) => U.isObj(x) && x.id && x.name).map((x) => ({
      id: str(x.id, 80), name: str(x.name, 80), color: str(x.color, 20), match: arr(x.match).map((m) => str(m, 80)).filter(Boolean),
      ignore: !!x.ignore, weight: oneOf(+x.weight, [1, 2, 3], 2),
    }));
    dag.exams = arr(ag.exams).filter((x) => U.isObj(x) && x.id && U.isKey(x.date)).map((x) => ({
      id: str(x.id, 80), subjectId: str(x.subjectId, 80), date: x.date, title: str(x.title, 160), source: oneOf(x.source, ['auto', 'manuel'], 'manuel'),
    }));
    for (const [k, v] of Object.entries(obj(ag.tasks))) if (U.isObj(v) && U.isKey(v.due)) dag.tasks[str(k, 300)] = v;
    for (const [k, v] of Object.entries(obj(ag.blocks))) if (U.isObj(v)) dag.blocks[str(k, 300)] = v;

    const st = obj(s.settings);
    out.settings = {
      sound: st.sound !== false, voice: st.voice !== false, theme: oneOf(st.theme, ['auto', 'light', 'dark'], 'auto'),
      lastExportAt: typeof st.lastExportAt === 'string' ? st.lastExportAt : null,
      exportReminderDays: U.clamp(Math.round(numOr(st.exportReminderDays, 14)), 0, 90),
    };
    return out;
  }

  // Lit n'importe quelle sauvegarde (texte JSON ou objet) et renvoie un état v2 valide, ou jette une Error lisible.
  function fromAny(raw) {
    let data = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); } catch (e) { throw new Error('Ce texte n\'est pas une sauvegarde Crevare (JSON illisible).'); }
    }
    const migrated = migrate(data);
    if (!migrated) throw new Error('Ce fichier n\'est pas une sauvegarde Crevare reconnue.');
    return sanitize(migrated);
  }

  C.schema = { defaultAgenda, VERSION, LOCS, GOAL_TYPES, BENCH_CONTEXTS, FOOD, HABIT_TYPES, INJURY_ZONES, DEFAULT_HABITS, defaultState, migrate, sanitize, fromAny };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
