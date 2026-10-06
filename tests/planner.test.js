'use strict';
// Tests du planificateur (js/core/planner.js) et des modèles de séances (js/data/sessions.js).
// Scénario de référence : début le 6 octobre 2026, 3 séances par semaine, genou et cheville gauches blessés,
// HYROX Doubles le 15 mai 2027, SSA le 30 juin 2027 (test d'entrée le 15 février 2027 puis sans date),
// pompier le 1er octobre 2029. Toutes les semaines sont vérifiées jusqu'à fin 2027.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, loadCore, ROOT } = require('./helpers');

const START = '2026-10-06';
const END = '2027-12-31';
const RACE = '2027-05-15';
const ENTRY = '2027-02-15';
const SSA_DATE = '2027-06-30';
const PHASES = ['reprise', 'base', 'developpement', 'specifique', 'affutage', 'jour-j', 'recuperation', 'entretien'];
const VARIANTS = ['normal', 'allege', 'express', 'doux'];

/* ───────── Liste canonique des exercices (docs/ARCHITECTURE.md) ───────── */

const ARCHI = fs.readFileSync(path.join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8');
const CANON = (() => {
  const part = ARCHI.split('## Liste canonique des identifiants d\'exercices')[1].split('## Identifiants des tests de référence')[0];
  const out = {};
  for (const line of part.split('\n')) {
    const m = line.match(/^- `([a-z0-9_]+)` — (.+?) — ([a-z]+) — ([a-z/]+) — (\d)/);
    if (m) out[m[1]] = { id: m[1], name: m[2], track: m[3], locs: m[4].split('/'), impact: +m[5], apnea: /apnea\s*$/.test(line) };
  }
  return out;
})();

// Bibliothèque de remplacement (si js/data/exercises.js manque) : ids canoniques, impact 2 = genou + cheville.
function stubExercises(C) {
  const ALT = { burpee_broad_jump: ['burpee_step_back'], burpee: ['burpee_step_back'], squat_jump: ['squat_bw'], jumping_jack: ['squat_bw'],
    run_shuttle: ['run_3030', 'bike_easy'], luc_leger: ['bike_easy'] };
  const exercises = Object.values(CANON).map((e) => ({ ...e, stress: e.impact >= 1 ? ['genou', 'cheville'] : [], alt: ALT[e.id] || [] }));
  C.data = C.data || {};
  C.data.exercises = exercises;
  C.data.getExercise = (id) => exercises.find((e) => e.id === id) || null;
}

/* ───────── Scénario ───────── */

function scenario(o = {}) {
  const C = loadCore(START, (s) => {
    s.profile.sessionsPerWeek = o.n == null ? 3 : o.n;
    s.profile.availableDays = o.days || [1, 3, 5];
    s.profile.maxSessionMin = o.maxMin || 180;
    s.profile.injuries = o.noInjury ? [] : [
      { id: 'inj-genou', zone: 'genou', side: 'gauche', note: '', active: true, since: null },
      { id: 'inj-cheville', zone: 'cheville', side: 'gauche', note: '', active: true, since: null },
    ];
    s.profile.pools = [{ id: 'p25', name: 'Piscine 25 m', length: 25, deepM: 3.5, mannequin: true }, { id: 'p50', name: 'Piscine 50 m', length: 50, deepM: null, mannequin: null }];
    s.plan.startDate = START;
    s.goals = [
      { id: 'hyrox', type: 'hyrox', name: 'HYROX Lyon — Doubles', date: RACE, dateEnd: null, priority: 2, status: 'active',
        details: { event: 'lyon-2027', raceDate: RACE, division: 'doubles', category: 'men', level: 'open' }, note: '', milestones: [], result: null, createdAt: START },
      { id: 'ssa', type: 'ssa', name: 'SSA', date: SSA_DATE, dateEnd: null, priority: 1, status: 'active',
        details: { entryTestDate: o.noEntry ? null : ENTRY, tsaDate: null, targets: { entry: 135, tsa: 125, fins: 235 } }, note: '', milestones: [], result: null, createdAt: START },
      { id: 'pompier', type: 'pompier', name: 'Sapeur-pompier', date: '2029-10-01', dateEnd: null, priority: 3, status: 'active',
        details: { path: 'indecis' }, note: '', milestones: [], result: null, createdAt: START },
    ];
    if (o.mutate) o.mutate(s);
  });
  if (!C.data || !Array.isArray(C.data.exercises)) stubExercises(C);
  C.planner.clearCache();
  return C;
}

const mondays = (C, from = START, to = END) => {
  const out = [];
  for (let m = C.util.mondayOf(from); m <= to; m = C.util.addDays(m, 7)) out.push(m);
  return out;
};
const sessionsOf = (w) => w.filter((d) => d.kind === 'session');
const minutes = (w) => w.reduce((a, d) => a + (d.kind === 'session' ? d.durationMin || 0 : 0), 0);
const eventish = (w) => w.some((d) => ['event', 'veille', 'apres-course'].includes(d.blocked) || d.kind === 'event');

// Vérifie qu'aucun exercice à impact 2 sollicitant le genou ou la cheville ne reste dans une séance.
function assertNoJumps(C, session, where) {
  for (const it of session.exercises) {
    const ex = C.data.getExercise(it.exId);
    assert.ok(ex, `${where} : exercice inconnu ${it.exId}`);
    if (ex.impact >= 2) {
      const stress = ex.stress && ex.stress.length ? ex.stress : ['genou', 'cheville'];
      assert.ok(!stress.includes('genou') && !stress.includes('cheville'), `${where} : ${it.exId} (impact 2) malgré genou/cheville`);
    }
  }
}

// Forme d'une séance instanciée (contrat C.planner.instantiate).
function assertSessionShape(C, s, where) {
  assert.equal(typeof s.title, 'string', where);
  assert.ok(s.title.length > 0, where);
  assert.ok(['maison', 'salle', 'piscine', 'dehors', 'repos', 'autre'].includes(s.loc), `${where} : loc ${s.loc}`);
  assert.ok(Array.isArray(s.exercises), where);
  assert.ok(Array.isArray(s.safety), where);
  assert.equal(typeof s.intro, 'string', where);
  assert.ok(s.durationMin > 0, `${where} : durée ${s.durationMin}`);
  for (const it of s.exercises) {
    assert.equal(typeof it.exId, 'string', where);
    assert.ok(it.name && typeof it.name === 'string', `${where} : nom manquant (${it.exId})`);
    assert.ok(['reps', 'load', 'time', 'dist', 'run', 'palier', 'cm', 'check'].includes(it.track), `${where} : track ${it.track}`);
    assert.ok(Number.isInteger(it.sets) && it.sets >= 1, `${where} : séries ${it.exId}`);
    assert.equal(typeof it.reps, 'string', where);
    assert.ok(it.rest >= 0, where);
    assert.ok(it.target && typeof it.target === 'object', where);
    assert.equal(it.key, undefined, `${where} : pas de key (ajoutée par C.sessions)`);
    assert.equal(it.estMin, undefined, `${where} : champ interne non retiré`);
    if (it.timer) {
      assert.ok(Array.isArray(it.timer.steps) && it.timer.steps.length, where);
      for (const st of it.timer.steps) assert.ok(st.sec > 0 && ['work', 'rest'].includes(st.kind), where);
    }
    if (it.bench) assert.equal(it.test, true, `${where} : ${it.exId} a un bench sans test:true`);
  }
  if (s.exercises.some((x) => x.apnea)) assert.ok(s.safety.some((t) => /hyperventilation/.test(t)), `${where} : sécurité apnée absente`);
}

/* ───────── Tests ───────── */

test('modèles : identifiants canoniques, toutes combinaisons modèle × phase × variante × bassin', () => {
  const C = scenario();
  const T = C.data.sessionTemplates;
  const ids = Object.keys(T);
  const required = ['gym_hybrid', 'gym_force_lower', 'gym_force_upper', 'gym_hyrox_dev', 'gym_hyrox_sim', 'gym_activation', 'gym_icp',
    'swim_test', 'swim_technique', 'swim_endurance', 'swim_ssa_entry', 'swim_ssa_tsa', 'swim_fins', 'swim_ssa_sim', 'swim_easy',
    'run_easy', 'run_intervals', 'run_tempo', 'run_long', 'run_test', 'run_luc_leger_prep',
    'home_strength', 'home_core', 'home_rehab', 'mobility', 'test_force', 'event_race', 'event_ssa', 'rest'];
  for (const id of required) assert.ok(T[id], `modèle manquant : ${id}`);
  assert.ok(Object.keys(CANON).length > 100, 'liste canonique lue');
  let n = 0;
  for (const id of ids) {
    const t = T[id];
    assert.ok(['swim', 'gym', 'run', 'home', 'rehab', 'test', 'rest', 'event'].includes(t.kind), `${id} : kind ${t.kind}`);
    assert.ok(Array.isArray(t.goals) && typeof t.summary === 'string' && typeof t.title === 'string', id);
    for (const phase of PHASES) for (const variant of VARIANTS) for (const poolLength of [25, 50]) for (const inj of [{}, { genou: true, cheville: true }]) {
      const ctx = { phase, variant, poolLength, injuries: inj, injuryLabels: { genou: 'genou gauche', cheville: 'cheville gauche' }, weekIndex: 9, weekInPhase: 2,
        hyrox: { division: 'doubles', category: 'men', level: 'open' }, ssa: { targets: { entry: 135, tsa: 125, fins: 235 } },
        simStage: ['demi', '3/4', 'complete'][n % 3], simMode: n % 2 ? 'tsa' : 'entry', testRun: n % 2 ? '1k' : '5k', best: () => null };
      const r = t.build(ctx);
      n++;
      assert.ok(r.durationMin > 0 && Array.isArray(r.exercises), `${id}/${phase}/${variant}/${poolLength}`);
      for (const it of r.exercises) {
        assert.ok(CANON[it.exId], `${id} : ${it.exId} n'est pas dans la liste canonique`);
        assert.ok(it.sets >= 1 && typeof it.reps === 'string', `${id} : ${it.exId}`);
      }
    }
  }
  assert.ok(n >= ids.length * 128);
});

test('modèles : appel direct sans contexte et via le planificateur pour chaque phase réelle', () => {
  const C = scenario();
  for (const [id, t] of Object.entries(C.data.sessionTemplates)) {
    const r = t.build();
    assert.ok(r.durationMin > 0, id);
  }
  // Une date par phase du scénario × chaque modèle × variante × bassin, via instantiate (adaptations comprises).
  const dates = ['2026-10-08', '2026-11-12', '2027-01-12', '2027-02-10', ENTRY, '2027-03-02', '2027-04-06', '2027-05-05', RACE, '2027-05-19', '2027-07-15'];
  for (const date of dates) for (const tid of Object.keys(C.data.sessionTemplates)) for (const variant of VARIANTS) for (const poolId of ['p25', 'p50']) {
    const s = C.planner.instantiate(date, { templateId: tid, variant, poolId });
    const where = `${date}/${tid}/${variant}/${poolId}`;
    assertSessionShape(C, s, where);
    assertNoJumps(C, s, where);
    // Express : ≤ 30 min (sauf jour d'épreuve, où la variante n'a pas de sens).
    if (variant === 'express' && s.kind !== 'event') assert.ok(s.durationMin <= 30, `${where} : express ${s.durationMin} min`);
  }
});

test('phases du scénario (avec date du test d\'entrée)', () => {
  const C = scenario();
  const P = C.planner;
  const expect = {
    '2026-10-06': 'reprise', '2026-10-25': 'reprise', '2026-10-26': 'base', '2026-12-15': 'base',
    '2027-01-04': 'specifique', '2027-02-07': 'specifique', '2027-02-08': 'affutage', [ENTRY]: 'jour-j',
    '2027-02-16': 'developpement', '2027-03-21': 'specifique', '2027-05-03': 'affutage', '2027-05-14': 'affutage',
    [RACE]: 'jour-j', '2027-05-16': 'recuperation', '2027-05-22': 'recuperation', '2027-05-23': 'specifique',
    '2027-06-23': 'affutage', [SSA_DATE]: 'jour-j', '2027-07-01': 'entretien', '2028-06-01': 'entretien',
  };
  for (const [d, key] of Object.entries(expect)) assert.equal(P.phase(d).key, key, d);
  assert.equal(P.phase('2027-01-20').goal.id, 'ssa');
  assert.equal(P.phase('2027-04-01').goal.id, 'hyrox');
  assert.equal(P.phase('2027-07-15').goal.id, 'pompier');
  const ph = P.phase('2027-05-05');
  assert.equal(ph.taper, true);
  assert.equal(ph.deload, false);
  assert.ok(ph.label && ph.notes.length);
  assert.equal(P.phase('2026-10-06').weekIndex, 0);
  assert.equal(P.phase('2026-10-06').weekInPhase, 1);
  assert.equal(P.phase('2027-01-20').weekInPhase, 3);
  // Semaine allégée : 1 sur 4 (weekIndex % 4 === 3), jamais pendant la reprise ni l'affûtage.
  for (let d = START; d <= END; d = C.util.addDays(d, 1)) {
    const p = P.phase(d);
    if (p.deload) {
      assert.equal(p.weekIndex % 4, 3, d);
      assert.ok(!['affutage', 'reprise', 'jour-j', 'recuperation'].includes(p.key), d);
    }
  }
  // Frise : segments contigus qui couvrent toute la période.
  const segs = P.macro(START, END);
  assert.equal(segs[0].start, START);
  assert.equal(segs[segs.length - 1].end, END);
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i].start, C.util.addDays(segs[i - 1].end, 1));
  assert.ok(segs.every((s) => s.label && PHASES.includes(s.key)));
});

test('phases sans date de test d\'entrée : un seul jalon SSA (date de l\'objectif)', () => {
  const C = scenario({ noEntry: true });
  const P = C.planner;
  assert.equal(P.phase('2027-01-10').key, 'base'); // pas de priorité SSA en janvier sans test d'entrée daté
  assert.equal(P.phase(ENTRY).key, 'developpement'); // HYROX à moins de 16 semaines
  assert.equal(P.phase('2027-05-25').key, 'specifique');
  assert.equal(P.phase('2027-05-25').goal.id, 'ssa');
  assert.equal(P.phase(SSA_DATE).key, 'jour-j');
  assert.ok(P.phase('2026-11-10').notes.some((n) => /test d'entrée SSA inconnue/.test(n)));
});

// Vérifications complètes sur toutes les semaines jusqu'à fin 2027.
function checkHorizon(C, o) {
  const P = C.planner, U = C.util;
  const N = C.state.profile.sessionsPerWeek;
  const avail = C.state.profile.availableDays;
  const typical = [];
  const where = (m) => `${o.label} semaine du ${m}`;
  for (const m of mondays(C)) {
    const w = P.week(m);
    assert.equal(w.length, 7, where(m));
    // Un seul plan par date, jamais deux séances le même jour ; bonus seulement les jours de repos.
    assert.deepEqual(w.map((d) => d.date), U.weekDays(m), where(m));
    for (const d of w) {
      assert.ok(['session', 'rest', 'event'].includes(d.kind), where(m));
      assert.ok(Array.isArray(d.bonus) && d.bonus.length <= 1, where(m));
      if (d.bonus.length) { assert.equal(d.kind, 'rest', where(m)); assert.equal(d.optional, true, where(m)); }
      if (d.kind === 'session') { assert.ok(d.templateId && C.data.sessionTemplates[d.templateId], where(m)); assert.equal(d.optional, false, where(m)); }
      if (d.date < START) assert.equal(d.kind, 'rest', where(m));
    }
    assert.ok(w.filter((d) => d.bonus.length).length <= 2, where(m));
    // Nombre de séances = min(N, jours disponibles du plan) hors semaines d'épreuve.
    const availDays = w.filter((d, i) => d.date >= START && avail.includes(i)).length;
    if (!eventish(w)) assert.equal(sessionsOf(w).length, Math.min(N, availDays), where(m));
    else assert.ok(sessionsOf(w).length + w.filter((d) => d.kind === 'event').length <= Math.max(N, 1), where(m));
    // Au moins une séance piscine par semaine tant que le SSA est en cours.
    if (m <= SSA_DATE && w.some((d) => d.date >= START)) {
      const pool = w.filter((d) => (d.kind === 'session' || d.kind === 'event') && d.loc === 'piscine').length;
      assert.ok(pool >= 1, `${where(m)} : pas de piscine`);
    }
    // Au moins une séance HYROX ou course tant que la course est à venir.
    if (m < C.util.mondayOf(RACE) && sessionsOf(w).length >= 2) {
      assert.ok(sessionsOf(w).some((d) => d.loc === 'dehors' || /^gym_(hybrid|hyrox|activation)/.test(d.templateId)), `${where(m)} : pas de séance HYROX/course`);
    }
    // Priorité SSA : au moins 2 piscines par semaine pendant la montée en priorité (avec 3 séances ou plus).
    const ph = P.phase(U.addDays(m, 3));
    if (ph.key === 'specifique' && ph.scope === 'ssa' && N >= 3 && sessionsOf(w).length >= 3 && !eventish(w)) {
      assert.ok(sessionsOf(w).filter((d) => d.loc === 'piscine').length >= 2, `${where(m)} : priorité SSA sans 2 piscines`);
    }
    // Contenu : pas de saut avec genou/cheville blessés, exercices connus, durée ≤ maximum.
    for (const d of w) {
      const tids = d.kind === 'rest' ? d.bonus : d.templateId ? [d.templateId] : [];
      for (const tid of tids) {
        for (const variant of o.variants || ['normal']) {
          const s = P.instantiate(d.date, { templateId: tid, variant });
          assertSessionShape(C, s, `${where(m)} ${d.date} ${tid} ${variant}`);
          if (o.injured) assertNoJumps(C, s, `${where(m)} ${d.date} ${tid} ${variant}`);
          for (const it of s.exercises) assert.ok(C.data.exercises.some((e) => e.id === it.exId), `${d.date} : ${it.exId} absent de C.data.exercises`);
          if (d.kind === 'session') assert.ok(s.durationMin <= C.state.profile.maxSessionMin, `${d.date} ${tid} : ${s.durationMin} min`);
        }
      }
    }
    if (!eventish(w) && !w.some((d) => d.date < START) && ['developpement', 'specifique', 'base'].includes(ph.key) && !ph.deload) typical.push(minutes(w));
  }
  // Jour de course = événement ; veille et lendemain = repos.
  assert.equal(P.day(RACE).kind, 'event');
  assert.equal(P.day(RACE).templateId, 'event_race');
  assert.equal(P.day(RACE).event.goalId, 'hyrox');
  assert.equal(P.day(U.addDays(RACE, -1)).kind, 'rest');
  assert.equal(P.day(U.addDays(RACE, 1)).kind, 'rest');
  assert.equal(P.day(SSA_DATE).kind, 'event');
  assert.equal(P.day(U.addDays(SSA_DATE, -1)).kind, 'rest');
  // Semaine d'affûtage HYROX plus légère que la semaine type.
  typical.sort((a, b) => a - b);
  const median = typical[Math.floor(typical.length / 2)];
  const taper = minutes(P.week('2027-05-03'));
  assert.ok(taper < median, `${o.label} : affûtage ${taper} min ≥ semaine type ${median} min`);
  return { median, taper };
}

test('scénario complet : 3 séances, mardi/jeudi/samedi, test d\'entrée le 15 février', () => {
  const C = scenario();
  checkHorizon(C, { label: '[1,3,5]', injured: true, variants: ['normal', 'doux', 'express'] });
  // Jalon SSA : jour d'épreuve, veille au repos.
  assert.equal(C.planner.day(ENTRY).kind, 'event');
  assert.equal(C.planner.day(ENTRY).templateId, 'event_ssa');
  assert.equal(C.planner.instantiate(ENTRY).exercises.find((x) => x.bench === 'ssa_entry_test').exId, 'ssa_entry_test');
  // Semaine d'affûtage SSA plus légère que les semaines de priorité SSA.
  assert.ok(minutes(C.planner.week('2027-02-08')) < minutes(C.planner.week('2027-02-01')));
});

test('scénario complet : lundi/mercredi/samedi, puis sans date de test d\'entrée', () => {
  checkHorizon(scenario({ days: [0, 2, 5] }), { label: '[0,2,5]', injured: true });
  checkHorizon(scenario({ days: [0, 2, 5], noEntry: true }), { label: '[0,2,5] sans test d\'entrée', injured: true });
  checkHorizon(scenario({ noEntry: true }), { label: '[1,3,5] sans test d\'entrée', injured: true, variants: ['normal', 'allege'] });
});

test('2 et 5 séances par semaine (et les extrêmes 1 et 7) fonctionnent', () => {
  checkHorizon(scenario({ n: 2 }), { label: 'N=2', injured: true });
  checkHorizon(scenario({ n: 5, days: [0, 1, 2, 3, 4, 5, 6] }), { label: 'N=5', injured: true });
  const C5 = scenario({ n: 5, days: [1, 3, 5] }); // plus de séances que de jours : 3 par semaine
  assert.equal(sessionsOf(C5.planner.week('2026-11-02')).length, 3);
  const C1 = scenario({ n: 1 });
  for (const m of mondays(C1, '2026-10-12', '2027-04-30')) {
    const w = C1.planner.week(m);
    // Une seule séance ; la semaine d'une épreuve, l'épreuve est la séance.
    assert.equal(sessionsOf(w).length + w.filter((d) => d.kind === 'event').length, 1, m);
  }
  const C7 = scenario({ n: 7, days: [0, 1, 2, 3, 4, 5, 6] });
  for (const m of mondays(C7, '2026-10-12', '2027-08-01')) {
    const w = C7.planner.week(m);
    assert.ok(sessionsOf(w).length <= 7);
    if (m <= SSA_DATE) assert.ok(w.some((d) => d.loc === 'piscine' && d.kind !== 'rest'), m);
  }
  // 5 séances : au moins 2 piscines pendant la priorité SSA.
  const C = scenario({ n: 5, days: [0, 1, 2, 3, 4, 5, 6] });
  assert.ok(sessionsOf(C.planner.week('2027-01-11')).filter((d) => d.loc === 'piscine').length >= 2);
});

test('placement : pas deux séances dures ou deux piscines d\'affilée quand on peut l\'éviter', () => {
  const C = scenario({ n: 4, days: [0, 1, 2, 3, 4, 5, 6] });
  const T = C.data.sessionTemplates;
  for (const m of mondays(C, '2026-10-26', '2027-04-30')) {
    const w = C.planner.week(m);
    for (let i = 0; i < 6; i++) {
      const a = w[i], b = w[i + 1];
      if (a.kind !== 'session' || b.kind !== 'session') continue;
      const ta = T[a.templateId], tb = T[b.templateId];
      assert.ok(!(ta.load >= 2 && tb.load >= 2), `${a.date} ${a.templateId} puis ${b.templateId}`);
      assert.ok(!(ta.loc === 'piscine' && tb.loc === 'piscine'), `${a.date} deux piscines`);
      assert.ok(!(ta.legs >= 2 && tb.intense), `${a.date} jambes lourdes la veille d'une séance intense`);
    }
  }
  // Fonction de pénalité exposée : jambes lourdes puis séance intense = pénalisé.
  const meta = (tid) => ({ tid, load: T[tid].load, legs: T[tid].legs, intense: T[tid].intense, run: T[tid].run, pool: T[tid].loc === 'piscine' });
  const wk = { legInj: false };
  const bad = [meta('gym_force_lower'), meta('run_intervals'), null, null, null, null, null];
  const good = [meta('gym_force_lower'), null, meta('run_intervals'), null, null, null, null];
  assert.ok(C.planner._.scoreWeek(bad, wk) > C.planner._.scoreWeek(good, wk));
});

test('tests natation dans les 2 premières semaines, puis tests de référence réguliers', () => {
  for (const days of [[1, 3, 5], [0, 2, 5], [5, 6]]) {
    const C = scenario({ days });
    const first = [...C.planner.week('2026-10-05'), ...C.planner.week('2026-10-12')];
    assert.ok(first.some((d) => d.templateId === 'swim_test'), `swim_test absent (${days})`);
    const s = C.planner.instantiate(first.find((d) => d.templateId === 'swim_test').date);
    const benches = s.exercises.filter((x) => x.test).map((x) => x.bench);
    for (const b of ['swim_100', 'swim_back_25', 'apnea_dyn', 'duck_depth', 'ssa_tsa_fins']) assert.ok(benches.includes(b), b);
    assert.ok(s.exercises.find((x) => x.bench === 'apnea_dyn').apnea);
  }
  const C = scenario();
  const all = mondays(C).flatMap((m) => C.planner.week(m));
  assert.ok(all.some((d) => d.templateId === 'run_test'), 'test de course');
  assert.ok(all.some((d) => d.bonus.includes('test_force') || d.templateId === 'test_force'), 'bilan force');
  const tf = C.planner.instantiate('2026-10-21', { templateId: 'test_force' });
  for (const b of ['pullups', 'pushups', 'plank', 'wall_sit', 'sit_reach']) assert.ok(tf.exercises.some((x) => x.bench === b && x.test), b);
});

test('simulations : HYROX ½ → ¾ → complète au plus tard à J-21 (Doubles), SSA au plus tard à J-5', () => {
  for (const days of [[1, 3, 5], [0, 2, 5], [0, 1, 2, 3, 4, 5, 6]]) {
    const C = scenario({ days });
    const U = C.util;
    const sims = mondays(C, '2027-03-01', RACE).flatMap((m) => C.planner.week(m)).filter((d) => d.templateId === 'gym_hyrox_sim');
    assert.ok(sims.length >= 3, `${days} : ${sims.length} simulations`);
    const stages = sims.map((d) => C.planner.instantiate(d.date).title);
    assert.ok(/½/.test(stages[0]) && stages.some((t) => /¾/.test(t)) && /complète/.test(stages[stages.length - 1]), stages.join(' / '));
    const full = sims.filter((d) => /complète/.test(C.planner.instantiate(d.date).title));
    assert.ok(full.length >= 1);
    for (const d of full) assert.ok(U.daysBetween(d.date, RACE) >= 21, `simulation complète à J-${U.daysBetween(d.date, RACE)}`);
    // Doubles : 8 × 1 km complets, stations ÷ 2 ; temps total = test de référence.
    const s = C.planner.instantiate(full[0].date);
    assert.equal(s.exercises.filter((x) => x.exId === 'treadmill_1k').length, 8);
    assert.ok(s.exercises.some((x) => x.exId === 'wall_ball' && x.target.reps === 50 && x.target.kg === 6));
    assert.ok(s.exercises.some((x) => x.exId === 'sled_push' && x.target.kg === 152));
    assert.ok(s.exercises.some((x) => x.bench === 'hyrox_sim' && x.test));
    assert.ok(!s.exercises.some((x) => x.exId === 'burpee_broad_jump'), 'BBJ remplacés (genou/cheville)');
    // Simulations SSA : dans les 8 dernières semaines, jamais après J-5.
    for (const [jal, from] of [[ENTRY, '2026-12-14'], [SSA_DATE, '2027-05-03']]) {
      const ss = mondays(C, from, jal).flatMap((m) => C.planner.week(m)).filter((d) => d.templateId === 'swim_ssa_sim' && d.date < jal);
      assert.ok(ss.length >= 2, `${days} : simulations SSA avant ${jal} : ${ss.length}`);
      for (const d of ss) assert.ok(U.daysBetween(d.date, jal) >= 5 && U.daysBetween(d.date, jal) <= 56, `${d.date} → ${jal}`);
    }
  }
});

test('semaine allégée : volumes de course et de natation réduits aussi', () => {
  const C = scenario({ noInjury: true });
  const P = C.planner;
  // 2026-11-23 : semaine allégée (weekIndex 7) ; 2026-11-16 : semaine normale de la même phase.
  assert.equal(P.phase('2026-11-25').deload, true);
  assert.equal(P.phase('2026-11-18').deload, false);
  const runMin = (d) => P.instantiate(d, { templateId: 'run_easy' }).exercises[0].target.sec;
  const swimM = (d) => P.instantiate(d, { templateId: 'swim_endurance' }).exercises.reduce((a, x) => a + (x.sets * (parseInt(x.reps, 10) || 0)), 0);
  assert.ok(runMin('2026-11-26') < runMin('2026-11-19') * 0.8, 'footing réduit');
  assert.ok(swimM('2026-11-26') < swimM('2026-11-19') * 0.85, 'natation réduite');
  assert.ok(minutes(P.week('2026-11-23')) < minutes(P.week('2026-11-16')));
  // Reprise : volumes × 0,7 (séance plus courte que la même séance en base).
  assert.ok(P.instantiate('2026-10-13', { templateId: 'gym_hybrid' }).durationMin < P.instantiate('2026-11-03', { templateId: 'gym_hybrid' }).durationMin);
});

test('variantes : allégée (−⅓), express (≤ 30 min), douce (sans impact)', () => {
  const C = scenario({ noInjury: true });
  const P = C.planner;
  for (const [date, tid] of [['2026-11-03', 'gym_hybrid'], ['2026-11-07', 'run_easy'], ['2027-03-09', 'gym_hyrox_dev'], ['2026-11-05', 'swim_technique'], ['2027-01-05', 'swim_ssa_entry']]) {
    const n = P.instantiate(date, { templateId: tid });
    const a = P.instantiate(date, { templateId: tid, variant: 'allege' });
    const e = P.instantiate(date, { templateId: tid, variant: 'express' });
    assert.ok(a.durationMin < n.durationMin, `${tid} allégée ${a.durationMin} < ${n.durationMin}`);
    assert.ok(e.durationMin <= 30 && e.exercises.length >= 1, `${tid} express ${e.durationMin}`);
    assert.equal(a.variant, 'allege');
  }
  // Douce : plus aucun impact 2, même sans blessure.
  const run = P.instantiate('2027-10-09', { templateId: 'run_luc_leger_prep' });
  assert.ok(run.exercises.some((x) => x.exId === 'run_shuttle'), 'navettes sans blessure');
  const doux = P.instantiate('2027-10-09', { templateId: 'run_luc_leger_prep', variant: 'doux' });
  assert.ok(doux.exercises.every((x) => (C.data.getExercise(x.exId).impact || 0) < 2));
  // Douce avec genou ou cheville douloureux (check-in du jour) : la course passe au vélo ou à la marche.
  C.state.checkins['2026-11-07'] = { pain: { genou: 5 } };
  const easy = P.instantiate('2026-11-07', { templateId: 'run_easy', variant: 'doux' });
  assert.ok(!easy.exercises.some((x) => /^run_/.test(x.exId)), easy.exercises.map((x) => x.exId).join(','));
  assert.ok(easy.exercises.some((x) => /Adapté/.test(x.note)));
});

test('blessures : sauts remplacés, mention « adapté : genou gauche », progression de course plafonnée', () => {
  const C = scenario();
  const P = C.planner;
  const sim = P.instantiate('2027-04-20', { templateId: 'gym_hyrox_sim' });
  const bbj = sim.exercises.find((x) => x.exId === 'burpee_step_back');
  assert.ok(bbj && /Adapté : genou gauche/.test(bbj.note));
  // Filet de sécurité générique : une séance perso avec des squats sautés.
  C.state.customSessions = [{ id: 'cs1', name: 'Mon circuit', loc: 'maison', goals: [], intro: '', exercises: [{ exId: 'squat_jump', sets: 3, reps: '10' }, { exId: 'pushup', sets: 3, reps: '15' }], createdAt: START }];
  const cs = P.instantiate('2026-11-04', { customSessionId: 'cs1' });
  assert.notEqual(cs.exercises[0].exId, 'squat_jump');
  assert.ok(/Adapté : genou gauche/.test(cs.exercises[0].note));
  assertNoJumps(C, cs, 'séance perso');
  // Footing plafonné (blessure) : jamais plus de 50 min, même très tard dans le plan.
  const inj = P.instantiate('2027-12-04', { templateId: 'run_easy' }).exercises[0].target.sec;
  const C2 = scenario({ noInjury: true });
  const free = C2.planner.instantiate('2027-12-04', { templateId: 'run_easy' }).exercises[0].target.sec;
  assert.ok(inj <= 50 * 60 && free > inj, `${inj} / ${free}`);
  // Bonus cheville/genou proposé les jours de repos quand une blessure est active.
  assert.ok(P.week('2026-11-02').some((d) => d.bonus.includes('home_rehab')));
  assert.ok(!C2.planner.week('2026-11-02').some((d) => d.bonus.includes('home_rehab')));
  // Footing : +5 min toutes les 2 semaines.
  const m0 = C2.planner.instantiate('2026-11-03', { templateId: 'run_easy' }).exercises[0].target.sec;
  const m1 = C2.planner.instantiate('2026-11-17', { templateId: 'run_easy' }).exercises[0].target.sec;
  assert.equal(m1 - m0, 300);
});

test('minuteurs : voix uniquement pour les abdos (et la rééducation guidée)', () => {
  const C = scenario();
  const core = C.planner.instantiate('2026-11-06', { templateId: 'home_core' });
  const t = core.exercises.find((x) => x.timer).timer;
  assert.equal(t.voice, true);
  assert.ok(t.steps.length >= 7 && t.rounds >= 2);
  const rehab = C.planner.instantiate('2026-11-04', { templateId: 'home_rehab' });
  assert.equal(rehab.exercises.find((x) => x.timer).timer.voice, true);
  assert.ok(rehab.durationMin >= 15 && rehab.durationMin <= 25, `${rehab.durationMin} min`);
  for (const tid of ['run_intervals', 'swim_ssa_sim']) {
    for (const date of ['2026-10-31', '2027-06-01']) {
      for (const x of C.planner.instantiate(date, { templateId: tid }).exercises) if (x.timer) assert.equal(x.timer.voice, false, tid);
    }
  }
});

test('bassin de 25 ou 50 m : distances et nombre de longueurs', () => {
  const C = scenario();
  const s25 = C.planner.instantiate('2026-11-05', { templateId: 'swim_technique', poolId: 'p25' });
  const s50 = C.planner.instantiate('2026-11-05', { templateId: 'swim_technique', poolId: 'p50' });
  // Distance en clair dans reps (lisible par la séance), en mètres dans target.m, longueurs dans la note.
  const w25 = s25.exercises.find((x) => x.exId === 'swim_warmup');
  const w50 = s50.exercises.find((x) => x.exId === 'swim_warmup');
  assert.equal(w25.target.m, 300);
  assert.match(w25.reps, /^300 m/);
  assert.match(w25.note, /12 longueurs \(bassin de 25 m\)/);
  assert.match(w50.note, /6 longueurs \(bassin de 50 m\)/);
  const d50 = s50.exercises.find((x) => x.exId === 'swim_crawl_50');
  assert.equal(d50.reps, '50 m');
  assert.match(d50.note, /1 longueur \(bassin de 50 m\)/);
  assert.ok(s50.exercises.some((x) => x.exId === 'swim_kick' && /Bassin de 50 m : ½ longueur, arrête-toi à 25 m/.test(x.note)));
  // Distances continues en allers-retours complets (multiples de 2 longueurs).
  for (const s of [s25, s50]) for (const x of s.exercises) if (x.exId === 'swim_warmup' || x.exId === 'swim_cooldown') assert.equal(x.target.m % 50, 0);
  // Sans bassin choisi : le premier bassin du profil ; longueur forcée par poolLength.
  assert.match(C.planner.instantiate('2026-11-05', { templateId: 'swim_technique' }).exercises[0].note, /bassin de 25 m/);
  assert.ok(C.planner.instantiate('2026-11-05', { templateId: 'swim_endurance', poolLength: 50 }).exercises.some((x) => /bassin de 50 m/.test(x.note)));
});

test('déterminisme : deux calculs identiques (cache vidé, puis nouveau chargement)', () => {
  const snap = (C) => JSON.stringify(mondays(C).map((m) => C.planner.week(m)).concat(
    ['2026-10-06', '2027-01-19', '2027-04-20', RACE, '2027-06-22'].map((d) => C.planner.instantiate(d))));
  const C = scenario();
  const a = snap(C);
  C.planner.clearCache();
  const b = snap(C);
  assert.equal(a, b);
  assert.equal(snap(scenario()), a);
  assert.deepEqual(C.planner.macro(START, END), scenario().planner.macro(START, END));
});

test('changements manuels : séance, repos, séance perso, séance libre, échange de jours', () => {
  const C = scenario();
  const P = C.planner;
  const d = '2026-11-03';
  const orig = P.day(d);
  assert.equal(orig.kind, 'session');
  assert.equal(P.setOverride(d, { templateId: 'swim_easy' }), true);
  assert.equal(P.day(d).templateId, 'swim_easy');
  assert.equal(P.day(d).overridden, true);
  assert.equal(P.instantiate(d).templateId, 'swim_easy');
  assert.equal(P.setOverride(d, { rest: true }), true);
  assert.equal(P.day(d).kind, 'rest');
  assert.equal(P.setOverride(d, { free: true }), true);
  assert.equal(P.day(d).kind, 'session');
  assert.equal(P.instantiate(d).exercises.length, 0);
  C.state.customSessions = [{ id: 'cs1', name: 'Natation club', loc: 'piscine', goals: ['ssa'], intro: '', exercises: [{ exId: 'swim_crawl_200', sets: 4, reps: '200 m', rest: 30 }], createdAt: START }];
  assert.equal(P.setOverride(d, { customSessionId: 'cs1' }), true);
  assert.equal(P.day(d).customSessionId, 'cs1');
  assert.equal(P.instantiate(d).title, 'Natation club');
  assert.ok(P.choices(d).some((c) => c.customSessionId === 'cs1' && c.planned));
  assert.equal(P.setOverride(d, { templateId: 'inconnu' }), false, 'modèle inconnu refusé');
  assert.equal(P.day(d).customSessionId, 'cs1', 'rien n\'a changé');
  assert.equal(P.setOverride(d, null), true);
  assert.deepEqual(P.day(d), orig);
  // Échange de deux jours.
  const a = '2026-11-03', b = '2026-11-04';
  const da = P.day(a), db = P.day(b);
  assert.equal(P.swapDays(a, b), true);
  assert.equal(P.day(a).kind, db.kind);
  assert.equal(P.day(b).templateId, da.templateId);
  // Jour d'épreuve : échange refusé ; un override reste prioritaire même le jour de course.
  assert.equal(P.swapDays(RACE, '2027-05-13'), false);
  P.setOverride(RACE, { rest: true });
  assert.equal(P.day(RACE).kind, 'rest');
  // Un identifiant de séance disparu ne casse rien (bug v1 : écran blanc).
  C.state.plan.overrides['2026-11-05'] = { templateId: 'ancienne_seance' };
  assert.equal(P.day('2026-11-05').overridden, false);
  const unknown = P.instantiate('2026-11-05', { templateId: 'ancienne_seance' });
  assert.equal(unknown.exercises.length, 0);
});

test('choices : séance prévue en premier, catalogue complet', () => {
  const C = scenario();
  const list = C.planner.choices('2026-11-03');
  assert.equal(list[0].templateId, C.planner.day('2026-11-03').templateId);
  assert.equal(list[0].planned, true);
  assert.ok(list.length >= 26);
  assert.ok(list.every((c) => c.title && c.loc && c.durationMin > 0 && Array.isArray(c.goals)));
  assert.ok(!list.some((c) => c.templateId === 'event_race'));
  assert.equal(C.planner.choices(RACE)[0].templateId, 'event_race');
});

test('agenda : garde Protection civile ≥ 4 h ou cours après 19 h → la séance va sur un autre jour', () => {
  const C = scenario({ n: 2 });
  C.state.agenda.sources = [{ id: 'pc', name: 'Protection civile', kind: 'protection-civile', busy: true }, { id: 'epf', name: 'Cours', kind: 'cours', busy: true }];
  const events = {
    '2026-11-03': [{ sourceId: 'pc', start: '2026-11-03T08:00', end: '2026-11-03T14:00', allDay: false }],
    '2026-11-10': [{ sourceId: 'epf', start: '2026-11-10T13:30', end: '2026-11-10T19:45', allDay: false }],
    '2026-11-19': [{ sourceId: 'pc', start: '2026-11-19', end: '2026-11-19', allDay: true }],
  };
  C.agenda = { dayInfo: (date) => ({ events: events[date] || [], busyMin: events[date] ? 360 : 0, hasCivilProtection: !!events[date] }) };
  C.planner.clearCache();
  const w1 = C.planner.week('2026-11-02');
  assert.equal(w1[1].kind, 'rest', 'mardi : garde de 6 h');
  assert.match(w1[1].reason, /Protection civile/);
  assert.equal(sessionsOf(w1).length, 2);
  const w2 = C.planner.week('2026-11-09');
  assert.equal(w2[1].kind, 'rest', 'mardi : cours jusqu\'à 19 h 45');
  const w3 = C.planner.week('2026-11-16');
  assert.equal(w3[3].kind, 'rest');
  assert.equal(w3[3].blocked, 'agenda', 'jeudi : Protection civile toute la journée');
  // Sans autre jour disponible, la séance reste (journée chargée signalée).
  const C3 = scenario({ n: 3 });
  C3.state.agenda.sources = C.state.agenda.sources;
  C3.agenda = C.agenda;
  C3.planner.clearCache();
  const w = C3.planner.week('2026-11-02');
  assert.equal(sessionsOf(w).length, 3);
  assert.match(w[1].reason, /Journée chargée/);
  // Garde contre les appels croisés : l'agenda peut lire le plan pendant le calcul.
  const C4 = scenario();
  C4.agenda = { dayInfo: (date) => { C4.planner.day(date); return { events: [], busyMin: 0 }; } };
  C4.planner.clearCache();
  assert.equal(C4.planner.week('2026-11-02').length, 7);
});

test('durée maximale du profil respectée, tests individualisés par les meilleures valeurs', () => {
  const C = scenario({ maxMin: 60 });
  for (const m of mondays(C, '2026-10-05', '2027-07-31')) {
    for (const d of C.planner.week(m)) if (d.kind === 'session') assert.ok(d.durationMin <= 60, `${d.date} ${d.templateId} ${d.durationMin}`);
  }
  // Meilleures valeurs (tests enregistrés) : allures et niveau de tractions.
  const C2 = scenario({ noInjury: true });
  C2.state.benchmarks = {
    run_5k: [{ id: 'a', date: '2026-10-24', value: 1500, context: 'test', source: '', note: '' }],
    pullups: [{ id: 'b', date: '2026-10-21', value: 1, context: 'test', source: '', note: '' }, { id: 'c', date: '2026-10-22', value: 9, context: 'entrainement', source: '', note: '' }],
    pushups: [{ id: 'd', date: '2026-10-21', value: 30, context: 'test', source: '', note: '' }],
  };
  C2.planner.clearCache();
  const run = C2.planner.instantiate('2026-11-07', { templateId: 'run_easy' });
  assert.match(run.exercises[0].note, /6:15 \/km/);
  const hs = C2.planner.instantiate('2026-11-04', { templateId: 'home_strength' });
  assert.match(hs.intro, /Niveau tractions : B/); // 1 traction en test (l'entraînement ne compte pas)
  assert.ok(hs.exercises.some((x) => x.exId === 'pushup' && x.target.reps === 18));
});

test('sans js/data/exercises.js : repli local, ids canoniques, sauts remplacés', () => {
  delete globalThis.Crevare;
  const files = ['js/core/util.js', 'js/core/legacy-v1.js', 'js/core/schema.js', 'js/core/store.js', 'js/data/goals.js', 'js/data/sessions.js', 'js/core/planner.js', 'js/core/sessions.js'];
  const C = load(files);
  C.util.setNow(START + 'T09:00:00');
  C.state = C.schema.defaultState(START);
  C.state.profile.injuries = [{ id: 'g', zone: 'genou', side: 'gauche', active: true }];
  C.state.goals = [{ id: 'hx', type: 'hyrox', name: 'HYROX', date: RACE, priority: 2, status: 'active', details: { division: 'doubles', category: 'men', level: 'open' }, milestones: [] }];
  C.store.save = () => true;
  assert.equal(C.data.getExercise, undefined);
  const s = C.planner.instantiate('2027-04-20', { templateId: 'gym_hyrox_sim' });
  for (const it of s.exercises) assert.ok(CANON[it.exId], it.exId);
  assert.ok(!s.exercises.some((x) => CANON[x.exId].impact >= 2));
  assert.ok(C.planner.week('2026-11-02').some((d) => d.kind === 'session'));
  // C.sessions.build passe par le planificateur.
  const built = C.sessions.build('2026-11-03', {});
  assert.ok(built.exercises.length && built.exercises.every((x) => x.key));
});

test('cas limites : aucun objectif, date de TSA, course pendant la reprise, SSA terminé', () => {
  // Installation neuve : aucun objectif, rien ne casse.
  const C0 = loadCore(START);
  if (!C0.data || !Array.isArray(C0.data.exercises)) stubExercises(C0);
  for (const m of mondays(C0, START, '2027-03-01')) {
    const w = C0.planner.week(m);
    assert.equal(w.length, 7);
    for (const d of w) if (d.kind === 'session') assert.ok(C0.planner.instantiate(d.date).exercises.length > 0, d.date);
  }
  assert.equal(C0.planner.phase('2026-12-01').key, 'entretien');
  assert.deepEqual(C0.planner.macro(START, '2026-12-31').map((s) => s.key), ['reprise', 'entretien']);

  // TSA daté : la date de l'objectif (certification, plus tard) n'est pas une épreuve.
  const C1 = scenario({ mutate: (s) => { s.goals[1].details.tsaDate = '2027-06-12'; } });
  assert.equal(C1.planner.day('2027-06-12').kind, 'event');
  assert.equal(C1.planner.day('2027-06-12').event.kind, 'tsa');
  assert.notEqual(C1.planner.day(SSA_DATE).kind, 'event');
  assert.equal(C1.planner.phase('2027-06-08').key, 'affutage');
  assert.equal(C1.planner.instantiate('2027-06-12').exercises.filter((x) => x.test).length, 2, 'parcours + 300 m palmes');

  // Course dans les 3 premières semaines : l'affûtage et le jour J l'emportent sur la reprise.
  const C2 = scenario({ mutate: (s) => { s.goals = [{ ...s.goals[0], date: '2026-10-24', details: { ...s.goals[0].details, raceDate: '2026-10-24' } }]; } });
  assert.equal(C2.planner.phase('2026-10-13').key, 'affutage');
  assert.equal(C2.planner.day('2026-10-24').kind, 'event');
  assert.equal(C2.planner.phase('2026-10-27').key, 'recuperation');

  // SSA terminé : plus d'obligation de piscine, mais une séance piscine d'entretien reste au programme.
  const C3 = scenario({ mutate: (s) => { s.goals[1].status = 'done'; } });
  assert.ok(!C3.planner.macro(START, END).some((x) => x.goalId === 'ssa'));
  assert.ok(C3.planner.week('2027-08-02').some((d) => d.loc === 'piscine' && d.kind === 'session'));
});
