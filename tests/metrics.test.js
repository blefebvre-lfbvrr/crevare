'use strict';
// Tests de js/core/metrics.js (C.metrics). Chargement isolé : util + schema + store + metrics,
// avec des doublures pour C.data (tests et exercices) et C.planner. Un dernier test vérifie
// l'intégration avec le cœur complet quand les autres modules sont présents.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadCore } = require('./helpers');

const TODAY = '2026-10-06'; // mardi

// Doublures : quelques tests de référence et exercices (forme du contrat d'ARCHITECTURE.md).
const BENCH = {
  swim_100: { id: 'swim_100', unit: 'time', lower: true, step: 1, target: { value: 100 } },
  pullups: { id: 'pullups', unit: 'reps', lower: false, step: 1 },
  apnea_dyn: { id: 'apnea_dyn', unit: 'm', lower: false, step: 0.5, target: { value: 18 } },
  plank: { id: 'plank', unit: 'time', lower: false, step: 1 },
};
const EX = {
  swim_crawl_100: { id: 'swim_crawl_100', track: 'time', cat: 'natation', bench: 'swim_100' },
  test_pullup_max: { id: 'test_pullup_max', track: 'reps', cat: 'test', bench: 'pullups' },
  run_easy: { id: 'run_easy', track: 'run', cat: 'course' },
  goblet_squat: { id: 'goblet_squat', track: 'load', cat: 'force', muscles: ['quadriceps', 'fessiers'] },
  db_press: { id: 'db_press', track: 'load', cat: 'force', muscles: ['épaules', 'triceps'] },
  pullup_negative: { id: 'pullup_negative', track: 'reps', cat: 'force' },
  pushup: { id: 'pushup', track: 'reps', cat: 'force', harder: ['pushup_cadence'] },
  pushup_cadence: { id: 'pushup_cadence', name: 'Pompes en cadence', track: 'reps', cat: 'force' },
  plank: { id: 'plank', track: 'time', cat: 'gainage' },
  apnea_dynamic: { id: 'apnea_dynamic', track: 'dist', cat: 'apnee', apnea: true, bench: 'apnea_dyn' },
};

function fresh(mutate) {
  const C = load(['js/core/util.js', 'js/core/legacy-v1.js', 'js/core/schema.js', 'js/core/store.js', 'js/core/metrics.js']);
  C.util.setNow(TODAY + 'T09:00:00');
  C.data = { getBenchmark: (id) => BENCH[id] || null, getExercise: (id) => EX[id] || null, formatBench: (id, v) => String(v) };
  C.state = C.schema.defaultState(TODAY);
  C.state.habits = [];
  if (mutate) mutate(C.state, C);
  return C;
}
const entry = (date, value, context, extra = {}) => ({ id: `${date}-${value}-${context}`, date, value, context, source: '', note: '', ...extra });
const set = (fields, extra = {}) => ({ done: true, measured: true, ...fields, ...extra });
function session(id, date, fields = {}) {
  return { id, date, status: 'done', title: 'Séance', loc: 'maison', kind: 'home', exercises: [], log: {}, pain: {}, rpe: null, durationMin: null, finishedAt: 0, ...fields };
}

/* ───────── Tests de référence ───────── */

test('benchBest / benchLast / benchTrend : plus bas = mieux (temps)', () => {
  const C = fresh((s) => {
    s.benchmarks.swim_100 = [
      entry('2026-07-15', 112, 'test'),
      entry('2026-08-10', 99, 'entrainement'), // meilleur chiffre, mais à l'entraînement : pas un « meilleur test »
      entry('2026-09-01', 104, 'test'),
      entry('2026-10-01', 100, 'entrainement'),
      entry('2026-10-05', 90, 'ancien'), // ancien format : jamais pris en compte
    ];
  });
  const M = C.metrics;
  assert.equal(M.benchBest('swim_100').value, 104);
  assert.equal(M.benchBest('swim_100').date, '2026-09-01');
  assert.equal(M.benchLast('swim_100').value, 100);
  assert.equal(M.benchLast('swim_100').date, '2026-10-01');
  const t = M.benchTrend('swim_100');
  assert.equal(t.n, 4);
  assert.equal(t.direction, 'mieux');
  assert.ok(t.perMonth < -2 && t.perMonth > -8, `perMonth = ${t.perMonth}`);
  assert.match(M.fmtTrend('swim_100', t), /^−[\d,]+ s\/mois$/);
  // contextes filtrés
  assert.equal(M.benchEntries('swim_100', { contexts: ['test'] }).length, 2);
  assert.equal(M.benchEntries('swim_100').length, 5);
});

test('benchBest : le résultat officiel compte, plus haut = mieux (répétitions)', () => {
  const C = fresh((s) => {
    s.benchmarks.pullups = [
      entry('2026-08-01', 1, 'test'),
      entry('2026-08-20', 2, 'entrainement'),
      entry('2026-09-10', 3, 'test'),
      entry('2026-09-25', 6, 'entrainement'),
      entry('2026-09-30', 4, 'officiel'),
      entry('2026-10-02', 9, 'ancien'),
    ];
  });
  const M = C.metrics;
  assert.equal(M.benchBest('pullups').value, 4);
  assert.equal(M.benchBest('pullups').context, 'officiel');
  assert.equal(M.benchLast('pullups').value, 4);
  const t = M.benchTrend('pullups');
  assert.equal(t.direction, 'mieux');
  assert.ok(t.perMonth > 0);
  assert.match(M.fmtTrend('pullups', t), /^\+[\d,]+ reps?\/mois$/);
});

test('benchTrend : null sous 3 points (ancien exclu), hors fenêtre de 90 jours, stable et en baisse', () => {
  const C = fresh((s) => {
    s.benchmarks.swim_100 = [entry('2026-09-01', 104, 'test'), entry('2026-09-15', 103, 'test'), entry('2026-09-20', 90, 'ancien'), entry('2026-09-25', 80, 'ancien')];
    s.benchmarks.pullups = [entry('2026-03-01', 1, 'test'), entry('2026-04-01', 2, 'test'), entry('2026-09-01', 3, 'test')];
    s.benchmarks.plank = [entry('2026-09-01', 60, 'test'), entry('2026-09-10', 60, 'test'), entry('2026-09-20', 60, 'entrainement')];
    s.benchmarks.apnea_dyn = [entry('2026-09-01', 15, 'test'), entry('2026-09-10', 13, 'test'), entry('2026-09-20', 11, 'test')];
  });
  const M = C.metrics;
  assert.equal(M.benchTrend('swim_100'), null);
  assert.equal(M.benchTrend('pullups'), null, 'seuls les 90 derniers jours comptent');
  assert.equal(M.benchTrend('plank').direction, 'stable');
  assert.equal(M.benchTrend('apnea_dyn').direction, 'moins-bien');
  assert.equal(M.benchTrend('inconnu'), null);
});

test('addBench : remplace même source + même date, ajoute sinon ; update / remove', () => {
  const C = fresh();
  const M = C.metrics;
  const a = M.addBench('swim_100', { date: '2026-10-01', value: 110, context: 'test', source: 'chrono' });
  M.addBench('swim_100', { date: '2026-10-01', value: 108, context: 'test', source: 'chrono' });
  assert.equal(C.state.benchmarks.swim_100.length, 1);
  assert.equal(C.state.benchmarks.swim_100[0].value, 108);
  assert.equal(C.state.benchmarks.swim_100[0].id, a.id, 'l\'identifiant est conservé');
  M.addBench('swim_100', { date: '2026-10-02', value: 107, context: 'test', source: 'chrono' });
  M.addBench('swim_100', { date: '2026-10-02', value: 106, context: 'entrainement' }); // sans source : jamais remplacée
  M.addBench('swim_100', { date: '2026-10-02', value: 105, context: 'entrainement' });
  assert.equal(C.state.benchmarks.swim_100.length, 4);
  assert.equal(M.addBench('swim_100', { date: '2026-10-02', value: 'abc' }), null);
  assert.equal(M.addBench('plank', { value: 60 }).date, TODAY, 'date par défaut : aujourd\'hui');
  const e = C.state.benchmarks.swim_100[0];
  M.updateBench('swim_100', e.id, { value: 101, note: 'corrigé', context: 'officiel' });
  assert.equal(M.benchEntries('swim_100').find((x) => x.id === e.id).value, 101);
  assert.equal(M.benchBest('swim_100').value, 101);
  assert.ok(M.removeBench('swim_100', e.id));
  assert.equal(C.state.benchmarks.swim_100.length, 3);
});

test('recordsFromSession : meilleure série mesurée, test prioritaire, measured:false ignoré, idempotent', () => {
  const C = fresh((s) => {
    s.benchmarks.swim_100 = [entry('2026-10-01', 120, 'test', { source: 'manuel:x' })];
    s.sessions.S1 = session('S1', '2026-10-01', {
      exercises: [
        { key: 'a', exId: 'swim_crawl_100', track: 'time', bench: 'swim_100', test: true },
        { key: 'b', exId: 'swim_crawl_100', track: 'time', bench: 'swim_100' }, // même test, à l'entraînement
        { key: 'c', exId: 'test_pullup_max', track: 'reps', bench: 'pullups', test: true },
        { key: 'd', exId: 'run_easy', track: 'run' }, // pas de test lié
        { key: 'e', exId: 'test_pullup_max', track: 'reps' }, // test déduit de l'exercice (cat 'test')
      ],
      log: {
        a: [set({ sec: 109 }), set({ sec: 105 }), { done: true, measured: false, sec: 80 }, { done: false, measured: true, sec: 70 }],
        b: [set({ sec: 101 })],
        c: [set({ reps: 2 }), set({ reps: 0 })],
        d: [set({ km: 8, sec: 2700 })],
        e: [set({ reps: 3 })],
      },
    });
  });
  const M = C.metrics;
  const recs = M.recordsFromSession(C.state.sessions.S1);
  assert.equal(recs.length, 2);
  const swim = C.state.benchmarks.swim_100.filter((e) => e.source === 'seance:S1');
  assert.equal(swim.length, 1);
  assert.equal(swim[0].value, 105, 'meilleure série mesurée de l\'item test (80 non mesuré ignoré, 101 d\'entraînement ignoré)');
  assert.equal(swim[0].context, 'test');
  assert.equal(C.state.benchmarks.pullups[0].value, 3);
  assert.equal(C.state.benchmarks.pullups[0].context, 'test');
  assert.equal(C.state.benchmarks.swim_100.length, 2, 'l\'entrée manuelle du même jour est gardée');

  // Réenregistrer : rien ne double ; une séance corrigée remplace
  M.recordsFromSession(C.state.sessions.S1);
  assert.equal(C.state.benchmarks.swim_100.length, 2);
  C.state.sessions.S1.log.a = [set({ sec: 103 })];
  M.recordsFromSession(C.state.sessions.S1);
  const after = C.state.benchmarks.swim_100.filter((e) => e.source === 'seance:S1');
  assert.equal(after.length, 1);
  assert.equal(after[0].value, 103);
  assert.equal(after[0].id, swim[0].id, 'identifiant stable');

  // Séance rouverte puis réécrite sans mesure : les mesures de cette séance disparaissent
  C.state.sessions.S1.status = 'in_progress';
  M.recordsFromSession(C.state.sessions.S1);
  assert.equal(C.state.benchmarks.swim_100.length, 1);
  assert.equal(C.state.benchmarks.pullups, undefined);
});

test('recordsFromSession : séance du jour J → officiel ; entraînement seul → entrainement ; forgetSession', () => {
  const C = fresh((s) => {
    s.sessions.EV = session('EV', '2026-10-03', { kind: 'event', exercises: [{ key: 'a', exId: 'swim_crawl_100', track: 'time', bench: 'swim_100', test: true }], log: { a: [set({ sec: 98 })] } });
    s.sessions.TR = session('TR', '2026-10-04', { exercises: [{ key: 'a', exId: 'swim_crawl_100', track: 'time' }], log: { a: [set({ sec: 110 }), set({ sec: 108 })] } });
  });
  const M = C.metrics;
  M.recordsFromSession(C.state.sessions.EV);
  M.recordsFromSession(C.state.sessions.TR);
  const list = M.benchEntries('swim_100');
  assert.deepEqual(list.map((e) => [e.date, e.value, e.context]), [['2026-10-03', 98, 'officiel'], ['2026-10-04', 108, 'entrainement']]);
  M.forgetSession('EV');
  assert.equal(M.benchEntries('swim_100').length, 1);
});

/* ───────── Exercices ───────── */

test('exerciseHistory / lastPerformance : ordre, date exclue, séries non mesurées', () => {
  const C = fresh((s) => {
    s.sessions.A = session('A', '2026-09-20', { exercises: [{ key: 'k', exId: 'goblet_squat', track: 'load' }], log: { k: [set({ kg: 16, reps: 10 })] } });
    s.sessions.B = session('B', '2026-09-27', { exercises: [{ key: 'k', exId: 'goblet_squat', track: 'load' }], log: { k: [{ done: true, measured: false }] } });
    s.sessions.C = session('C', '2026-10-04', { status: 'in_progress', exercises: [{ key: 'k', exId: 'goblet_squat', track: 'load' }], log: { k: [set({ kg: 20, reps: 8 })] } });
  });
  const M = C.metrics;
  const h = M.exerciseHistory('goblet_squat');
  assert.deepEqual(h.map((x) => x.sessionId), ['B', 'A'], 'séances terminées seulement, plus récentes d\'abord');
  assert.equal(M.exerciseHistory('goblet_squat', { limit: 1 }).length, 1);
  const last = M.lastPerformance('goblet_squat', '2026-10-06');
  assert.equal(last.sessionId, 'A', 'B n\'a aucune série mesurée');
  assert.equal(M.lastPerformance('goblet_squat', '2026-09-20'), null, 'la date donnée est exclue');
});

function withHistory(exId, rows, mutate) {
  return fresh((s, C) => {
    rows.forEach(([date, sets, extra], i) => {
      s.sessions['H' + i] = session('H' + i, date, { exercises: [{ key: 'k', exId, track: EX[exId].track }], log: { k: sets }, ...(extra || {}) });
    });
    if (mutate) mutate(s, C);
  });
}

test('suggestNext : double progression (+5 kg bas du corps, +2,5 kg haut), sinon +1 rep', () => {
  let C = withHistory('goblet_squat', [['2026-10-01', [set({ kg: 20, reps: 12 }), set({ kg: 20, reps: 12 }), set({ kg: 20, reps: 12 })]]]);
  let r = C.metrics.suggestNext({ exId: 'goblet_squat', track: 'load', sets: 3, reps: '8–12' });
  assert.deepEqual(r.target, { kg: 25, reps: 8 });
  assert.match(r.text, /25 kg/);

  C = withHistory('db_press', [['2026-10-01', [set({ kg: 14, reps: 10 }), set({ kg: 14, reps: 10 })]]]);
  r = C.metrics.suggestNext({ exId: 'db_press', track: 'load', sets: 2, reps: '6-10' });
  assert.deepEqual(r.target, { kg: 16.5, reps: 6 });

  C = withHistory('goblet_squat', [['2026-10-01', [set({ kg: 20, reps: 12 }), set({ kg: 20, reps: 10 }), set({ kg: 20, reps: 9 })]]]);
  r = C.metrics.suggestNext({ exId: 'goblet_squat', track: 'load', sets: 3, reps: '8–12' });
  assert.deepEqual(r.target, { kg: 20, reps: 10 });
});

test('suggestNext : jamais d\'augmentation si douleur ≥ 4 à la dernière séance', () => {
  const C = withHistory('goblet_squat', [['2026-10-01', [set({ kg: 20, reps: 12 }), set({ kg: 20, reps: 12 })], { pain: { genou: 5 } }]]);
  const r = C.metrics.suggestNext({ exId: 'goblet_squat', track: 'load', sets: 2, reps: '8–12' });
  assert.equal(r.target.kg, 20);
  assert.match(r.text, /Douleur/);
  // douleur notée lors d'une autre séance, plus récente
  const C2 = withHistory('plank', [['2026-10-01', [set({ sec: 40 })]], ['2026-10-03', [], { pain: { cheville: 4 } }]]);
  assert.equal(C2.metrics.suggestNext({ exId: 'plank', track: 'time', sets: 1 }).target.sec, 40);
});

test('suggestNext : tractions négatives → élastique ; gainage +5/+10 s ; pompes vers la variante plus dure', () => {
  let C = withHistory('pullup_negative', [['2026-10-01', [set({ reps: 3 }), set({ reps: 3 }), set({ reps: 3 })]]]);
  let r = C.metrics.suggestNext({ exId: 'pullup_negative', track: 'reps', sets: 3, reps: '2–3' });
  assert.equal(r.next, 'pullup_band');
  C = withHistory('pullup_negative', [['2026-10-01', [set({ reps: 2 }), set({ reps: 2 })]]]);
  r = C.metrics.suggestNext({ exId: 'pullup_negative', track: 'reps', sets: 3, reps: '2–3' });
  assert.equal(r.next, undefined);
  assert.equal(r.target.reps, 3);

  C = withHistory('plank', [['2026-10-01', [set({ sec: 40 }), set({ sec: 35 })]]]);
  assert.equal(C.metrics.suggestNext({ exId: 'plank', track: 'time', sets: 2 }).target.sec, 40);
  C = withHistory('plank', [['2026-10-01', [set({ sec: 60 }), set({ sec: 65 })]]]);
  assert.equal(C.metrics.suggestNext({ exId: 'plank', track: 'time', sets: 2 }).target.sec, 70);

  C = withHistory('pushup', [['2026-10-01', [set({ reps: 15 }), set({ reps: 15 }), set({ reps: 16 })]]]);
  r = C.metrics.suggestNext({ exId: 'pushup', track: 'reps', sets: 3, reps: '10–15' });
  assert.equal(r.next, 'pushup_cadence');
});

test('suggestNext : course +5 min au plus toutes les 2 semaines ; apnée plafonnée ; séries non mesurées ignorées', () => {
  let C = withHistory('run_easy', [['2026-09-01', [set({ km: 7, sec: 2400 })]], ['2026-09-15', [set({ km: 7, sec: 2400 })]], ['2026-10-01', [set({ km: 7, sec: 2400 })]]]);
  assert.equal(C.metrics.suggestNext({ exId: 'run_easy', track: 'run', sets: 1 }).target.sec, 2700);
  C = withHistory('run_easy', [['2026-09-10', [set({ km: 7, sec: 2400 })]], ['2026-09-25', [set({ km: 8, sec: 2700 })]], ['2026-10-01', [set({ km: 8, sec: 2700 })]]]);
  const r = C.metrics.suggestNext({ exId: 'run_easy', track: 'run', sets: 1 });
  assert.equal(r.target.sec, 2700, 'hausse il y a moins de 2 semaines : on garde');
  assert.match(r.text, /9 oct/);

  C = withHistory('apnea_dynamic', [['2026-09-20', [set({ m: 12 })]], ['2026-10-01', [set({ m: 12.5 })]]]);
  assert.equal(C.metrics.suggestNext({ exId: 'apnea_dynamic', track: 'dist', sets: 1, apnea: true }).target.m, 14.5);
  C = withHistory('apnea_dynamic', [['2026-10-01', [set({ m: 18 })]]]);
  assert.equal(C.metrics.suggestNext({ exId: 'apnea_dynamic', track: 'dist', sets: 1, apnea: true }).target.m, 18);

  C = withHistory('plank', [['2026-10-01', [{ done: true, measured: false }]]]);
  assert.equal(C.metrics.suggestNext({ exId: 'plank', track: 'time', sets: 1 }), null);
  assert.equal(C.metrics.suggestNext({ exId: 'plank', track: 'check' }), null);
});

test('parseRange', () => {
  const { parseRange } = fresh().metrics._t;
  assert.deepEqual(parseRange('8–12'), [8, 12]);
  assert.deepEqual(parseRange('6-10 par jambe'), [6, 10]);
  assert.deepEqual(parseRange('10 par jambe'), [10, 10]);
  assert.equal(parseRange('max'), null);
  assert.equal(parseRange('30 s'), null);
  assert.deepEqual(parseRange('', { reps: 5 }), [5, 5]);
});

/* ───────── Charge, semaine, régularité ───────── */

// Planificateur factice : séances lundi, mercredi, vendredi ; bonus « home_core » le dimanche.
function stubPlanner(C) {
  C.planner = {
    week: (monday) => C.util.weekDays(monday).map((date, i) => ([0, 2, 4].includes(i)
      ? { date, kind: 'session', templateId: 'tpl', optional: false, bonus: [] }
      : { date, kind: 'rest', templateId: null, optional: i === 6, bonus: i === 6 ? ['home_core'] : [] })),
  };
}

test('sessionLoad / weekSummary : charge sRPE, minutes par type, bonus et séances sans effort noté', () => {
  const C = fresh((s, C) => {
    stubPlanner(C);
    s.sessions.a = session('a', '2026-10-05', { loc: 'piscine', kind: 'swim', durationMin: 60, rpe: 6 });
    s.sessions.b = session('b', '2026-10-06', { loc: 'dehors', kind: 'run', durationMin: 45, rpe: null });
    s.sessions.c = session('c', '2026-10-11', { loc: 'maison', kind: 'home', durationMin: 20, rpe: 4, templateId: 'home_core' });
    s.sessions.d = session('d', '2026-10-07', { loc: 'salle', kind: 'gym', durationMin: 90, rpe: 7, status: 'skipped' });
    s.health.workouts = [{ id: 'w', date: '2026-10-08', type: 'Course à pied', durationMin: 30 }, { id: 'w2', date: '2026-10-05', type: 'Natation', durationMin: 55 }];
  });
  const M = C.metrics;
  assert.equal(M.sessionLoad(C.state.sessions.a), 360);
  assert.equal(M.sessionLoad(C.state.sessions.b), null);
  const w = M.weekSummary('2026-10-07');
  assert.equal(w.monday, '2026-10-05');
  assert.equal(w.planned, 3);
  assert.equal(w.done, 2);
  assert.equal(w.bonus, 1);
  assert.equal(w.load, 440);
  assert.equal(w.unrated, 1);
  assert.equal(w.byKind.piscine, 60, 'séance de la montre du même type et du même jour : pas comptée deux fois');
  assert.equal(w.byKind.course, 75);
  assert.equal(w.byKind.maison, 20);
  assert.equal(w.healthMin, 30);
  assert.equal(w.minutes, 155);
  assert.equal(M.weekLoad('2026-10-05'), 440);
  delete C.planner;
  assert.equal(M.weekSummary('2026-10-05').planned, null);
});

test('regularity : jours passés, depuis plan.startDate, bonus exclus, compensation dans la semaine', () => {
  const done = ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-19', // S1 : 3/3 (+1 en trop, non compté)
    '2026-09-21', '2026-09-24', // S2 : 2/3 (jeudi compense mercredi)
    '2026-09-28', '2026-10-04', // S3 : 1/3 (dimanche = bonus « home_core », exclu)
    '2026-10-05']; // S4 : lundi fait ; mercredi et vendredi à venir
  const C = fresh((s, C) => {
    stubPlanner(C);
    s.plan.startDate = '2026-09-14';
    done.forEach((d, i) => { s.sessions['s' + i] = session('s' + i, d, d === '2026-10-04' ? { templateId: 'home_core' } : {}); });
    s.sessions.sk = session('sk', '2026-09-25', { status: 'skipped' });
  });
  const M = C.metrics;
  assert.deepEqual(M.regularityDetail(4), { done: 7, planned: 10, pct: 70 });
  assert.equal(M.regularity(4), 70);
  assert.deepEqual(M.regularityDetail(1), { done: 1, planned: 1, pct: 100 });
  C.state.plan.startDate = '2026-10-01';
  assert.deepEqual(M.regularityDetail(4), { done: 1, planned: 2, pct: 50 }, 'vendredi 2 manqué, lundi 5 fait');
  C.state.plan.startDate = '2026-10-07';
  assert.equal(M.regularity(4), null, 'plan qui commence demain');
  // aujourd'hui prévu et pas encore fait : ne compte pas
  C.state.plan.startDate = '2026-09-14';
  C.util.setNow('2026-10-07T09:00:00');
  assert.deepEqual(M.regularityDetail(1), { done: 1, planned: 1, pct: 100 });
  delete C.planner;
  assert.equal(M.regularity(4), null);
});

/* ───────── Habitudes ───────── */

function habitState(habit, days) {
  return fresh((s) => {
    s.habits = [{ id: 'h', name: 'H', icon: '✓', type: 'check', target: null, unit: '', perWeek: null, cue: '', createdAt: '2026-09-01', archivedAt: null, ...habit }];
    for (const [d, v] of Object.entries(days)) s.habitLog[d] = { h: v };
  });
}

test('habitStreak tolérante : un trou isolé, deux trous, aujourd\'hui pas encore coché', () => {
  // 1 trou (le 3) : la série continue ; deux trous (29 et 30 sept.) la cassent.
  let C = habitState({}, { '2026-10-05': true, '2026-10-04': true, '2026-10-02': true, '2026-10-01': true, '2026-09-28': true });
  assert.equal(C.metrics.habitStreak('h'), 4);
  // 2 trous de suite juste avant : seule la journée d'avant compte
  C = habitState({}, { '2026-10-05': true, '2026-10-02': true, '2026-10-01': true });
  assert.equal(C.metrics.habitStreak('h'), 1);
  // aujourd'hui pas encore coché : ni compté ni manqué
  C = habitState({}, { '2026-10-05': true, '2026-10-04': true, '2026-10-03': true });
  assert.equal(C.metrics.habitStreak('h'), 3);
  C.state.habitLog['2026-10-06'] = { h: true };
  assert.equal(C.metrics.habitStreak('h'), 4);
  // aujourd'hui non coché + hier manqué : la série tient encore
  C = habitState({}, { '2026-10-04': true, '2026-10-03': true });
  assert.equal(C.metrics.habitStreak('h'), 2);
  // aujourd'hui non coché + hier et avant-hier manqués : cassée
  C = habitState({}, { '2026-10-03': true, '2026-10-02': true });
  assert.equal(C.metrics.habitStreak('h'), 0);
  assert.equal(C.metrics.habitStreak('inconnue'), 0);
});

test('habitStreak : habitude à éviter (jours sans), chiffrée (cible), x fois par semaine', () => {
  // À éviter : true = écart. Créée le 27 sept. : 10 jours dont 1 écart isolé → 9 jours sans.
  let C = habitState({ type: 'avoid', createdAt: '2026-09-27' }, { '2026-10-02': true });
  assert.equal(C.metrics.habitStreak('h'), 9);
  C = habitState({ type: 'avoid', createdAt: '2026-09-27' }, { '2026-10-02': true, '2026-10-03': true });
  assert.equal(C.metrics.habitStreak('h'), 3, 'deux écarts de suite : on repart du 4');
  // Chiffrée : cible 1,5 L (1 L ne suffit pas)
  C = habitState({ type: 'number', target: 1.5, unit: 'L' }, { '2026-10-05': 1.5, '2026-10-04': 1, '2026-10-03': 2 });
  assert.equal(C.metrics.habitStreak('h'), 2);
  // 2 fois par semaine : semaines du 7 (2), 14 (1, manquée), 21 (2), 28 (3) ; semaine en cours pas finie.
  C = habitState({ perWeek: 2, createdAt: '2026-09-07' }, {
    '2026-09-08': true, '2026-09-10': true, '2026-09-15': true, '2026-09-22': true, '2026-09-26': true,
    '2026-09-28': true, '2026-09-30': true, '2026-10-02': true,
  });
  assert.equal(C.metrics.habitStreak('h'), 3);
  assert.equal(C.metrics.habitInfo('h').unit, 'semaines');
  assert.equal(C.metrics.habitInfo('h').weekDone, 0);
});

test('habitRate : calculé depuis createdAt seulement', () => {
  const C = habitState({ createdAt: '2026-10-01' }, { '2026-10-01': true, '2026-10-02': true, '2026-10-04': true });
  const M = C.metrics;
  assert.equal(M.habitRate('h', 28), 60, '3 sur 5 jours (du 1er au 5, aujourd\'hui en cours)');
  assert.equal(M.habitRate('h', 0), 60);
  assert.equal(M.habitRate('h', 3), 50, 'fenêtre de 3 jours : le 4 (fait) et le 5 (manqué)');
  C.state.habitLog['2026-10-06'] = { h: true };
  assert.equal(M.habitRate('h', 28), 67);
  const info = M.habitInfo('h');
  assert.equal(info.total, 4);
  assert.equal(info.milestone, 66);
  assert.equal(info.sinceDays, 6);
  // créée aujourd'hui, pas encore cochée : aucun jour ne compte
  C.state.habits[0].createdAt = TODAY;
  C.state.habitLog = {};
  assert.equal(M.habitRate('h', 28), null);
});

/* ───────── Corps et forme du jour ───────── */

test('weightSeries : moyenne sur 7 jours glissants (jours sans poids ignorés)', () => {
  const C = fresh((s) => {
    s.body = { '2026-09-20': { weight: 69 }, '2026-10-01': { weight: 70 }, '2026-10-02': { weight: 71, food: 'normal' }, '2026-10-03': { food: 'peu' }, '2026-10-05': { weight: 72 }, '2026-10-09': { weight: 99 } };
  });
  const M = C.metrics;
  assert.deepEqual(M.weightSeries(10), [
    { date: '2026-10-01', weight: 70, avg7: 70 },
    { date: '2026-10-02', weight: 71, avg7: 70.5 },
    { date: '2026-10-05', weight: 72, avg7: 71 },
  ]);
  const all = M.weightSeries(0);
  assert.equal(all.length, 4, 'date future exclue');
  assert.deepEqual(all[0], { date: '2026-09-20', weight: 69, avg7: 69 });
});

test('readiness : feu et suggestion selon le check-in', () => {
  const C = fresh();
  const M = C.metrics;
  const ci = (v) => { C.state.checkins[TODAY] = v; return M.readiness(TODAY); };
  assert.deepEqual(M.readiness(TODAY), { level: null, reasons: [], suggestion: 'normal' });
  assert.equal(ci({ sleep: 4, energy: 4, soreness: 2, pain: { genou: 1 } }).level, 'vert');
  let r = ci({ sleep: 4, energy: 4, soreness: 2, pain: { genou: 5, cheville: 0 } });
  assert.equal(r.level, 'orange');
  assert.equal(r.suggestion, 'doux');
  assert.match(r.reasons.join(' '), /genou/);
  r = ci({ sleep: 2, energy: 2, soreness: 2 });
  assert.equal(r.suggestion, 'allege');
  assert.equal(r.level, 'orange');
  assert.equal(ci({ sleep: 2, energy: 3, soreness: 3 }).suggestion, 'normal', 'un seul signal bas : normal');
  r = ci({ sleep: 1, energy: 2, soreness: 5 });
  assert.equal(r.suggestion, 'repos');
  assert.equal(r.level, 'rouge');
  r = ci({ sleep: 2, energy: 2, soreness: 2, pain: { cheville: 4 } });
  assert.equal(r.suggestion, 'doux', 'doux l\'emporte sur allégé');
  assert.ok(r.reasons.includes('Douleur à la cheville (4/10)'));
  assert.equal(ci({ sleep: 4, energy: 4, pain: { genou: 8 } }).suggestion, 'repos');
  assert.equal(ci({ sleep: 4, energy: 4, pain: { epaule: 5 } }).suggestion, 'allege');
});

test('benchProjection : seulement si tendance favorable et au moins 4 points', () => {
  const C = fresh((s) => {
    s.benchmarks.swim_100 = [entry('2026-08-01', 120, 'test'), entry('2026-08-20', 117, 'entrainement'), entry('2026-09-10', 113, 'test'), entry('2026-10-01', 110, 'test')];
  });
  const M = C.metrics;
  const p = M.benchProjection('swim_100', 100);
  assert.ok(p && p.date > TODAY && p.days > 30, JSON.stringify(p));
  assert.deepEqual(M.benchProjection('swim_100', 115), { reached: true });
  C.state.benchmarks.swim_100.pop();
  assert.equal(M.benchProjection('swim_100', 100), null, '3 points seulement');
  C.state.benchmarks.swim_100 = [entry('2026-08-01', 100, 'test'), entry('2026-08-20', 104, 'test'), entry('2026-09-10', 108, 'test'), entry('2026-10-01', 112, 'test')];
  assert.equal(M.benchProjection('swim_100', 90), null, 'tendance défavorable');
});

/* ───────── Intégration avec le cœur complet (si les autres modules sont présents) ───────── */

test('intégration : cœur complet (planificateur, données)', () => {
  const C = loadCore(TODAY, (s) => {
    s.benchmarks.pullups = [entry('2026-09-01', 1, 'test')];
  });
  assert.ok(C.metrics, 'metrics chargé');
  assert.equal(C.metrics.benchBest('pullups').value, 1);
  const w = C.metrics.weekSummary(TODAY);
  assert.equal(typeof w.minutes, 'number');
  if (C.planner) assert.equal(typeof w.planned, 'number');
  if (C.planner && C.planner.best) assert.ok(true);
  assert.ok(['number', 'object'].includes(typeof C.metrics.regularity(4)));
});

/* ───────── Écrans (fonctions pures et rendu sans navigateur) ───────── */

function loadUI(mutate) {
  const C = loadCore(TODAY, mutate);
  load(['js/ui/components.js', 'js/ui/progress.js', 'js/ui/habits.js'], { fresh: false });
  return C;
}

test('habitudes : icône (emoji composés jamais coupés), pas du +/−, formulaire', () => {
  const C = loadUI();
  const T = C.habitsUI._t;
  assert.equal(T.clipIcon('💧'), '💧');
  assert.equal(T.clipIcon('  abcdefghijk '), 'abcdefgh', '8 caractères au plus');
  const family = '👨‍👩‍👧‍👦';
  assert.equal(T.clipIcon(family + family + '📵'), family, 'pas de coupure au milieu d\'un emoji, ≤ 16 unités');
  assert.equal(T.clipIcon('🇫🇷🚒'), '🇫🇷🚒');
  // repli sans Intl.Segmenter
  assert.deepEqual(T.graphemesFallback(family + '🇫🇷👍🏽1️⃣a'), [family, '🇫🇷', '👍🏽', '1️⃣', 'a']);
  assert.equal(T.stepFor({ target: 1.5 }), 0.25);
  assert.equal(T.stepFor({ target: 8000 }), 1000);
  assert.equal(T.stepFor({ target: 7 }), 1);
  assert.equal(T.stepFor({}), 1);
  let r = T.habitFromForm({ name: '  Eau ', icon: '💧', type: 'number', target: '1,5', unit: 'L', freq: 'day', cue: 'Après le réveil' }, null, TODAY);
  assert.equal(r.habit.target, 1.5);
  assert.equal(r.habit.cue, 'le réveil');
  assert.equal(r.habit.perWeek, null);
  assert.equal(r.habit.createdAt, TODAY);
  assert.match(T.habitFromForm({ name: '', type: 'check' }).error, /nom/);
  assert.match(T.habitFromForm({ name: 'Eau', type: 'number', target: '' }).error, /cible/);
  r = T.habitFromForm({ name: 'Mobilité', type: 'check', freq: 'week', perWeek: '3', createdAt: '2026-09-01' }, { id: 'x', createdAt: '2026-08-01', archivedAt: null }, TODAY);
  assert.equal(r.habit.id, 'x');
  assert.equal(r.habit.perWeek, 3);
  assert.equal(r.habit.createdAt, '2026-09-01');
  assert.equal(T.habitFromForm({ name: 'Alcool', type: 'avoid', freq: 'week', perWeek: '3' }).habit.perWeek, null, 'à éviter : quotidien');
  assert.equal(T.habitFromForm({ name: 'A', type: 'check', createdAt: '2030-01-01' }, null, TODAY).habit.createdAt, TODAY, 'pas de date future');
  assert.equal(T.parseWeight('72,4'), 72.4);
  assert.equal(T.parseWeight('72.4 kg'), 72.4);
  assert.equal(T.parseWeight('7'), null);
  assert.deepEqual(T.gridDays(TODAY).slice(0, 1).concat(T.gridDays(TODAY).slice(-1)), ['2026-09-14', '2026-10-11']);
  assert.deepEqual(T.painZones({ injuries: [{ zone: 'genou', side: 'gauche', active: true }, { zone: 'cheville', side: 'gauche' }, { zone: 'dos', active: false }] }).map((z) => z.label), ['Genou gauche', 'Cheville gauche']);
});

test('progrès : écart à la cible et lecture des valeurs', () => {
  const C = loadUI();
  const T = C.progressUI._t;
  const swim = { unit: 'time', lower: true };
  const reps = { unit: 'reps', lower: false };
  assert.equal(T.gapText(swim, 105, 100), 'encore 5 s à gagner');
  assert.equal(T.gapText(swim, 165, 100), 'encore 1:05 à gagner');
  assert.equal(T.gapText(swim, 99, 100), 'cible atteinte');
  assert.equal(T.gapText(reps, 1, 10), 'encore 9 reps');
  assert.equal(T.gapText(reps, 9, 10), 'encore 1 rep');
  assert.equal(T.fmtVal(reps, 1), '1 rep');
  assert.equal(T.readValue(swim, '345'), 225);
  assert.equal(T.readValue(swim, '0'), null);
  assert.equal(T.readValue({ unit: 'cm' }, '-3,5'), -3.5);
  assert.equal(T.readValue(reps, '-2'), null);
  assert.equal(T.loadJump([0, 0, 100, 100, 100, 100, 200]), 2);
  assert.equal(T.loadJump([0, 0, 0, 100, 100, 100, 200]), null, '4 semaines pleines exigées');
});

test('rendu des écrans sans erreur, texte de l\'utilisateur échappé', () => {
  const C = loadUI((s) => {
    s.profile.injuries = [{ id: 'i', zone: 'genou', side: 'gauche', active: true }];
    s.habits.push({ id: 'evil', name: '<img src=x onerror=alert(1)>', icon: '<b>', type: 'avoid', createdAt: '2026-09-01', archivedAt: null, cue: '"><script>' });
    s.body['2026-10-05'] = { weight: 72.4, food: 'peu' };
    s.body['2026-10-01'] = { weight: 73, food: 'normal' };
    s.checkins[TODAY] = { sleep: 2, energy: 2, soreness: 3, pain: { genou: 5 }, note: '<i>stress</i>' };
    s.benchmarks.swim_100 = [entry('2026-09-01', 110, 'test', { note: '<u>x</u>' }), entry('2026-10-01', 104, 'test')];
    s.goals = [{ id: 'g', type: 'ssa', name: 'SSA <test>', date: '2027-06-15', priority: 1, status: 'active', details: {}, milestones: [] }];
  });
  const html = [
    C.progressUI.viewProgress(), C.progressUI.viewBench({ benchId: 'swim_100' }), C.progressUI.viewBench({ benchId: 'nope' }),
    C.habitsUI.view(), C.habitsUI.todayCard(TODAY), C.bodyUI.view(), C.bodyUI.todayCard(TODAY), C.bodyUI.checkinCard(TODAY),
  ].join('\n');
  assert.ok(!/<img src=x/.test(html) && !/<script>/.test(html) && !/<u>x<\/u>/.test(html) && !/<i>stress/.test(html) && !/SSA <test>/.test(html), 'tout est échappé');
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /Feu orange/);
  assert.match(html, /100 m crawl/);
});
