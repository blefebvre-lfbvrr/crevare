'use strict';
// Tests de l'écran de séance (js/ui/session.js) et de la bibliothèque (js/ui/library.js) :
// fonctions pures + rendu des vues en chaîne HTML (sans DOM). Le planificateur et les métriques
// sont retirés pour tester la dégradation propre (ils sont écrits par d'autres modules).
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadCore } = require('./helpers');

const TODAY = '2026-10-06';

function setup(mutate) {
  const C = loadCore(TODAY, mutate);
  load(['js/ui/components.js', 'js/ui/session.js', 'js/ui/library.js'], { fresh: false });
  delete C.planner; delete C.metrics; delete C.timer; // dégradation : modules absents
  C.ui.toast = () => {}; // pas de DOM (le store prévient par un toast quand localStorage manque)
  // Enregistrement des routes sans app.js
  const routes = {}, actions = {};
  C.route = (p, v) => { routes[p] = v; };
  C.action = C.onChange = C.onInput = C.onSubmit = (name, fn) => { actions[name] = fn; };
  C.menuItem = () => {};
  C.go = (h) => { C.lastGo = h; };
  C.rerender = () => {};
  (C.bootHooks || []).forEach((fn) => fn());
  return { C, S: C.sessionUI._t, L: C.libraryUI._t, routes, actions };
}

function session(C, fields) {
  const id = fields.id || C.util.uid();
  const s = {
    id, date: TODAY, source: 'libre', title: 'Séance', loc: 'maison', kind: null, goals: [], plannedMin: null, intro: '', safety: [],
    exercises: [], log: {}, status: 'in_progress', startedAt: null, finishedAt: null, durationMin: null, rpe: null, pain: {},
    feeling: null, notes: '', poolId: null, poolLength: null, watch: null, ...fields,
  };
  C.state.sessions[id] = s;
  return s;
}
const item = (exId, extra = {}) => ({ key: `${exId}#0`, exId, name: exId, track: 'reps', sets: 3, reps: '10', rest: 60, target: {}, ...extra });

/* ───────── Séance : saisie des séries ───────── */

test('parseField : formats, vide, illisible', () => {
  const { S } = setup();
  assert.equal(S.parseField('reps', '12'), 12);
  assert.equal(S.parseField('reps', '10.4'), 10);
  assert.equal(S.parseField('kg', '72,5'), 72.5);
  assert.equal(S.parseField('sec', '345'), 225); // saisie rapide 345 → 3:45
  assert.equal(S.parseField('sec', '3:45'), 225);
  assert.equal(S.parseField('km', ' '), null);
  assert.ok(Number.isNaN(S.parseField('kg', 'abc')));
  assert.ok(Number.isNaN(S.parseField('kg', '-5')));
  assert.equal(S.parseField('cm', '-4'), -4); // souplesse : négatif possible
  assert.ok(Number.isNaN(S.parseField('sec', '3:75')));
});

test('setPatch : série validée sans valeur = faite, non mesurée (jamais la valeur précédente)', () => {
  const { C, S } = setup();
  // Séance précédente avec une vraie mesure
  const prev = session(C, { date: '2026-10-01', status: 'done', exercises: [item('pushup')], log: { 'pushup#0': [{ done: true, measured: true, reps: 30 }] } });
  const cur = session(C, { exercises: [item('pushup')] });
  assert.equal(S.localPrev(C.state.sessions, 'pushup', cur).sets[0].reps, 30);
  const p = S.setPatch('reps', { reps: null }, true);
  assert.deepEqual(p, { done: true, reps: null, measured: false });
  C.sessions.patchSet(cur.id, 'pushup#0', 0, p);
  const set = C.state.sessions[cur.id].log['pushup#0'][0];
  assert.equal(set.reps, null);
  assert.equal(set.measured, false);
  assert.equal(S.summarizeSets('reps', [set]), '1 série non mesurée');
  assert.ok(prev);
});

test('setPatch : mesures, type « check », annulation', () => {
  const { S } = setup();
  assert.deepEqual(S.setPatch('load', { kg: 40, reps: null }, true), { done: true, kg: 40, reps: null, measured: true });
  assert.deepEqual(S.setPatch('check', {}, true), { done: true, measured: true });
  assert.deepEqual(S.setPatch('time', { sec: 95 }, false), { done: false, sec: 95, measured: true });
  assert.deepEqual(S.setPatch('run', { km: NaN, sec: 1800 }, true), { done: true, km: null, sec: 1800, measured: true });
});

test('prescription, repos, longueurs de bassin', () => {
  const { S } = setup();
  assert.equal(S.prescription({ sets: 3, reps: '8–12', rest: 90, target: { kg: 40 } }), '3 × 8–12 · cible 40 kg · repos 1 min 30');
  assert.equal(S.prescription({ sets: 1, reps: '400 m', rest: 0 }), '400 m');
  assert.equal(S.prescription({ sets: 4, reps: '', rest: 45 }), '4 séries · repos 45 s');
  assert.equal(S.fmtRest(120), '2 min');
  assert.equal(S.distanceOf({ reps: '100 m' }), 100);
  assert.equal(S.distanceOf({ reps: '4 × 50 m' }), 50);
  assert.equal(S.distanceOf({ reps: '8–12 m' }), null);
  assert.equal(S.distanceOf({ reps: '', target: { m: 200 } }), 200);
  assert.equal(S.lengthsText(100, 25), '4 longueurs');
  assert.equal(S.lengthsText(100, 50), '2 longueurs');
  assert.equal(S.lengthsText(50, 50), '1 longueur');
  assert.equal(S.lengthsText(25, 50), '½ longueur');
  assert.equal(S.lengthsText(75, 50), '1 longueur ½');
  assert.equal(S.lengthsText(100, null), '');
});

test('séance piscine détectée par le lieu ou les exercices', () => {
  const { C, S } = setup();
  assert.ok(S.isPoolSession(session(C, { loc: 'piscine' })));
  assert.ok(S.isPoolSession(session(C, { loc: 'autre', exercises: [item('swim_crawl_100', { track: 'time' })] })));
  assert.ok(!S.isPoolSession(session(C, { loc: 'salle', exercises: [item('goblet_squat', { track: 'load' })] })));
  // Le lieu décide : un éducatif de natation dans une séance de salle ne déclenche pas le choix de piscine
  assert.ok(!S.isPoolSession(session(C, { loc: 'salle', exercises: [item('swim_drills', { track: 'check' })] })));
});

/* ───────── Sécurité apnée ───────── */

test('apnée non confirmée : remplacée par de la nage en surface, sans test', () => {
  const { C, S } = setup();
  const apnea = item('apnea_dynamic', { track: 'dist', apnea: true, bench: 'apnea_dyn', test: true, reps: '8–12 m' });
  const s = session(C, { loc: 'piscine', exercises: [apnea, item('swim_crawl_100', { key: 'c#1', track: 'time' })] });
  assert.ok(S.hasApnea(s));
  const eff = S.effectiveItems(s);
  assert.equal(eff[0].key, 'apnea_dynamic#0~surface');
  assert.equal(eff[0].replacedReason, 'apnee');
  assert.ok(!eff[0].apnea && !eff[0].bench && !eff[0].test);
  assert.ok(!C.data.getExercise(eff[0].exId).apnea, 'le remplacement n’est pas de l’apnée');
  assert.equal(eff[1], s.exercises[1]);
  // À la fin : le remplacement devient définitif (rien n'alimente le test d'apnée)
  const f = S.finishFields({ duration: '50' }, s, Date.now());
  assert.equal(f.exercises[0].exId, eff[0].exId);
  assert.ok(!f.exercises.some((it) => it.bench === 'apnea_dyn'));
  // Refus explicite : idem
  s.apneaOk = false;
  assert.equal(S.effectiveItems(s)[0].replacedReason, 'apnee');
  // Confirmé : l'exercice reste tel quel
  s.apneaOk = true;
  assert.equal(S.effectiveItems(s)[0], apnea);
  assert.equal(S.finishFields({}, s, Date.now()).exercises, undefined);
});

test('apnée détectée aussi par la bibliothèque (item sans drapeau)', () => {
  const { C, S } = setup();
  const s = session(C, { exercises: [item('duck_dive')] });
  assert.ok(S.isApneaItem(s.exercises[0]));
  assert.ok(S.findItem(s, 'duck_dive#0~surface'));
  assert.equal(S.findItem(s, 'duck_dive#0'), null);
});

/* ───────── Fin de séance ───────── */

test('defaultDuration : début réel plausible, sinon durée prévue', () => {
  const { S } = setup();
  const now = Date.parse('2026-10-06T19:00:00');
  assert.equal(S.defaultDuration({ startedAt: now - 45 * 60000, plannedMin: 60 }, now), 45);
  assert.equal(S.defaultDuration({ startedAt: now - 2 * 60000, plannedMin: 60 }, now), 60);
  assert.equal(S.defaultDuration({ startedAt: now - 30 * 3600000, plannedMin: 60 }, now), 60);
  assert.equal(S.defaultDuration({ startedAt: null, plannedMin: null }, now), null);
  assert.equal(S.defaultDuration({ durationMin: 33, startedAt: now - 45 * 60000 }, now), 33);
});

test('finishFields : RPE sans défaut, douleur, montre, début reconstitué', () => {
  const { C, S } = setup();
  const s = session(C, {});
  const now = Date.parse('2026-10-06T19:00:00');
  const f = S.finishFields({ duration: '60', rpe: null, feeling: 'ok', notes: '  ok  ', pain: { genou: '5', cheville: '' }, hr: '', kcal: '', km: '' }, s, now);
  assert.equal(f.status, 'done');
  assert.equal(f.rpe, null);
  assert.equal(f.durationMin, 60);
  assert.deepEqual(f.pain, { genou: 5 });
  assert.equal(f.watch, null);
  assert.equal(f.notes, 'ok');
  assert.equal(f.startedAt, now - 3600000);
  const g = S.finishFields({ duration: '9999', rpe: '7', feeling: 'nimporte', hr: '152', kcal: '480', km: '7,25' }, { ...s, startedAt: 1 }, now);
  assert.equal(g.durationMin, 600);
  assert.equal(g.rpe, 7);
  assert.equal(g.feeling, null);
  assert.deepEqual(g.watch, { hrAvg: 152, kcal: 480, distanceKm: 7.25 });
  assert.equal(g.startedAt, undefined);
  assert.equal(S.finishFields({ rpe: '0' }, s, now).rpe, null);
});

test('zones de douleur et alerte ≥ 4', () => {
  const { S } = setup();
  const profile = { injuries: [
    { zone: 'cheville', side: 'gauche', active: true }, { zone: 'genou', side: 'gauche', active: true },
    { zone: 'dos', side: '', active: false }, { zone: 'genou', side: 'droit', active: true },
  ] };
  assert.deepEqual(S.painZones(profile), [{ zone: 'cheville', label: 'Cheville gauche' }, { zone: 'genou', label: 'Genou gauche et droit' }]);
  assert.deepEqual(S.painAlert({ genou: 5, cheville: 2 }), { max: 5, zones: [{ zone: 'genou', value: 5 }] });
  assert.equal(S.painAlert({ genou: 3 }), null);
  assert.equal(S.painAlert({}), null);
});

test('version douce conseillée pendant 3 jours après une douleur acceptée', () => {
  const { C, S } = setup();
  session(C, { id: 'a', date: '2026-10-06', status: 'done', pain: { genou: 6 }, softUntil: '2026-10-09' });
  assert.equal(S.softAdvice(C.state.sessions, '2026-10-06', 'x'), null); // pas le jour même
  assert.equal(S.softAdvice(C.state.sessions, '2026-10-07', 'x').until, '2026-10-09');
  assert.equal(S.softAdvice(C.state.sessions, '2026-10-09', 'x').alert.max, 6);
  assert.equal(S.softAdvice(C.state.sessions, '2026-10-10', 'x'), null);
});

test('résumés de séries et progression', () => {
  const { C, S } = setup();
  assert.equal(S.summarizeSets('reps', [{ done: true, reps: 12 }, { done: true, reps: 10 }, { done: true, measured: false }, { done: false, reps: 9 }]),
    '12, 10 reps · 1 série non mesurée');
  assert.equal(S.summarizeSets('load', [{ done: true, kg: 42.5, reps: 8 }]), '42,5 kg × 8');
  assert.equal(S.summarizeSets('run', [{ done: true, km: 8, sec: 2400 }]), '8 km en 40:00 (5:00 /km)');
  assert.equal(S.summarizeSets('check', [{ done: true }, { done: true }]), '2 séries faites');
  assert.equal(S.summarizeSets('time', []), '');
  const s = session(C, { exercises: [item('pushup'), item('plank', { key: 'p#1', track: 'time', sets: 2, skipped: true })],
    log: { 'pushup#0': [{ done: true, reps: 20 }, {}, {}, { done: true }] } });
  assert.deepEqual(S.progressCount(s), { done: 2, total: 4 }); // 4 lignes (une série ajoutée), plank passé
});

test('dernière performance locale : la plus récente, autre séance, pas dans le futur', () => {
  const { C, S } = setup();
  session(C, { id: 'old', date: '2026-09-20', status: 'done', exercises: [item('pushup')], log: { 'pushup#0': [{ done: true, reps: 25 }] } });
  session(C, { id: 'mid', date: '2026-10-01', status: 'done', exercises: [item('pushup')], log: { 'pushup#0': [{ done: true, measured: false }] } });
  session(C, { id: 'new', date: '2026-10-03', status: 'done', exercises: [item('pushup')], log: { 'pushup#0': [{ done: true, reps: 28 }] } });
  session(C, { id: 'fut', date: '2026-10-10', status: 'done', exercises: [item('pushup')], log: { 'pushup#0': [{ done: true, reps: 40 }] } });
  const cur = session(C, { id: 'cur', exercises: [item('pushup')] });
  const p = S.localPrev(C.state.sessions, 'pushup', cur);
  assert.equal(p.sessionId, 'new');
  assert.equal(p.sets[0].reps, 28);
  assert.equal(S.normPrev({ sessionId: 'cur', sets: [{ reps: 1 }] }, cur), null);
});

test('remplacement d’exercice : nouvelle clé, plus de test', () => {
  const { S, C } = setup();
  const it = item('pullup_strict', { bench: 'pullups', test: true, sets: 4 });
  const ex = C.data.getExercise('pullup_band');
  const r = S.replacementItem(it, ex, 'abc');
  assert.equal(r.key, 'pullup_band#rabc');
  assert.equal(r.exId, 'pullup_band');
  assert.equal(r.sets, 4);
  assert.equal(r.bench, undefined);
  assert.equal(r.test, undefined);
});

test('chrono : affichage au dixième', () => {
  const { S } = setup();
  assert.equal(S.fmtMs(83400), '1:23,4');
  assert.equal(S.fmtMs(0), '0:00,0');
});

/* ───────── Rendu des vues (chaînes HTML) ───────── */

test('vue séance en cours : champs, échappement, aide apnée et piscine', () => {
  const { C, routes } = setup((st) => { st.profile.pools = [{ id: 'p1', name: 'Bassin <b>', length: 50 }]; });
  const s = session(C, {
    title: '<img src=x onerror=alert(1)>', loc: 'piscine', poolId: 'p1', poolLength: 50,
    exercises: [item('swim_crawl_100', { track: 'time', reps: '100 m', sets: 2 }), item('apnea_dynamic', { key: 'a#1', track: 'dist', apnea: true })],
  });
  const out = routes['#/seance/:id']({ id: s.id });
  assert.ok(out.html.includes('&lt;img src=x'));
  assert.ok(!out.html.includes('<img src=x'));
  assert.ok(out.html.includes('Bassin &lt;b&gt;'));
  assert.ok(out.html.includes('2 longueurs'));
  assert.ok(out.html.includes('Cette séance contient de l\'apnée'));
  assert.ok(out.html.includes('data-action="seance.chrono"'));
  assert.ok(out.html.includes('a#1~surface'));
  assert.ok(!out.html.includes('Lancer le minuteur'), 'pas de minuteur sans C.timer');
});

test('vue séance terminée et séance introuvable', () => {
  const { C, routes } = setup();
  const s = session(C, { status: 'done', durationMin: 45, rpe: 7, feeling: 'dur', pain: { genou: 2 }, notes: '<script>',
    exercises: [item('pushup')], log: { 'pushup#0': [{ done: true, reps: 20 }, { done: true, measured: false }] } });
  const html = routes['#/seance/:id']({ id: s.id }).html;
  assert.ok(html.includes('45 min'));
  assert.ok(html.includes('7/10 · très dur'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('20 reps · 1 série non mesurée'));
  assert.ok(html.includes('seance.rouvrir'));
  const missing = routes['#/seance/:id']({ id: 'nope' });
  assert.ok((typeof missing === 'string' ? missing : missing.html).includes('Séance introuvable'));
});

/* ───────── Bibliothèque ───────── */

test('filtres par défaut : sans impact si genou ou cheville blessé', () => {
  const { L } = setup();
  assert.equal(L.defaultLowImpact({ injuries: [{ zone: 'cheville', active: true }] }), true);
  assert.equal(L.defaultLowImpact({ injuries: [{ zone: 'genou', active: false }] }), false);
  assert.equal(L.defaultLowImpact({ injuries: [{ zone: 'dos', active: true }] }), false);
});

test('matériel disponible : maison, salle (HYROX seulement si équipée), piscine', () => {
  const { C, L } = setup();
  const EQ = C.data.EQUIPMENT;
  const base = { equipment: { home: ['barre', 'elastiques'], gym: { name: '', hyrox: false } }, pools: [] };
  assert.deepEqual(L.availableEquipment(base, EQ).sort(), ['barre', 'elastiques']);
  const gym = L.availableEquipment({ ...base, equipment: { ...base.equipment, gym: { name: 'Salle', hyrox: false } } }, EQ);
  assert.ok(gym.includes('rameur') && !gym.includes('sled'));
  const hyrox = L.availableEquipment({ ...base, equipment: { ...base.equipment, gym: { name: 'Salle', hyrox: true } } }, EQ);
  assert.ok(hyrox.includes('sled') && hyrox.includes('wall_ball'));
  const pool = L.availableEquipment({ ...base, pools: [{ id: 'p', mannequin: true }], apneaBuddy: 'club' }, EQ);
  assert.ok(pool.includes('palmes') && pool.includes('mannequin') && pool.includes('partenaire'));
});

test('sens de la performance par exercice', () => {
  const { C, L } = setup();
  const dir = (id) => L.perfDirection(C.data.getExercise(id), C.data.getBenchmark);
  assert.equal(dir('plank'), 'higher');
  assert.equal(dir('swim_crawl_100'), 'lower');
  assert.equal(dir('goblet_squat'), 'higher');
  assert.equal(dir('run_easy'), 'lower');
  assert.equal(dir('swim_drills'), null);
  assert.equal(dir('bike_easy'), null);
});

test('historique : meilleure (selon le sens), dernière, tendance, séries non mesurées ignorées', () => {
  const { L } = setup();
  const e = (date, sets) => ({ date, sessionId: date, sets });
  const h = L.historySummary([
    e('2026-09-10', [{ done: true, sec: 120 }]), e('2026-09-17', [{ done: true, sec: 115 }, { done: true, sec: 117 }]),
    e('2026-09-24', [{ done: true, sec: 110 }]), e('2026-10-01', [{ done: true, measured: false }]),
  ], 'time', 'lower');
  assert.equal(h.best.value, 110);
  assert.equal(h.best.date, '2026-09-24');
  assert.equal(h.last.date, '2026-10-01');
  assert.equal(h.lastMeasured.date, '2026-09-24');
  assert.equal(h.trend, 'mieux');
  assert.equal(h.points.length, 3);
  const up = L.historySummary([e('2026-09-01', [{ done: true, sec: 60 }]), e('2026-09-08', [{ done: true, sec: 50 }]), e('2026-09-15', [{ done: true, sec: 40 }])], 'time', 'higher');
  assert.equal(up.best.value, 60);
  assert.equal(up.trend, 'moins-bien');
  const load = L.historySummary([e('2026-09-01', [{ done: true, kg: 40, reps: 10 }, { done: true, kg: 45, reps: 3 }])], 'load', 'higher');
  assert.equal(load.best.set.kg, 40); // 1RM estimée : 40 × 10 > 45 × 3
  assert.equal(L.trendOf([1, 2], 'higher'), null);
  assert.equal(L.trendOf([10, 10, 10], 'higher'), 'stable');
});

test('historique local d’un exercice', () => {
  const { C, L } = setup();
  session(C, { id: 'a', date: '2026-09-01', status: 'done', exercises: [item('pushup')], log: { 'pushup#0': [{ done: true, reps: 20 }] } });
  session(C, { id: 'b', date: '2026-09-08', status: 'in_progress', exercises: [item('pushup')], log: { 'pushup#0': [{ done: true, reps: 99 }] } });
  session(C, { id: 'c', date: '2026-09-15', status: 'done', exercises: [item('pushup')], log: { 'pushup#0': [{ done: false, reps: 5 }] } });
  const h = L.localHistory(C.state.sessions, 'pushup');
  assert.deepEqual(h.map((x) => x.sessionId), ['a']);
});

test('exercice perso : saisie du formulaire → exercice valide', () => {
  const { L } = setup();
  const input = L.exerciseInput({ name: '  Tractions serrées ', cat: 'force', track: 'reps', locs: ['maison'], goals: ['pompier'],
    sets: '4', reps: '5', rest: '130', impact: '0', stress: ['epaule'], description: 'Prise serrée', cues: 'Gainé\n\n Descente lente ' });
  assert.equal(input.defaultRest, 90); // « 130 » saisi en chiffres = 1:30
  assert.deepEqual(input.cues, ['Gainé', 'Descente lente']);
  const ex = L.buildCustomExercise(input);
  assert.ok(ex.id.startsWith('perso:'));
  assert.equal(ex.name, 'Tractions serrées');
  assert.equal(ex.defaultSets, 4);
  assert.equal(ex.track, 'reps');
  assert.deepEqual(ex.goals, ['pompier']);
  const edited = L.buildCustomExercise({ ...input, name: 'Autre' }, ex.id);
  assert.equal(edited.id, ex.id);
});

test('suppression d’un exercice perso et d’une séance perso', () => {
  const { C, L } = setup((st) => {
    st.customExercises = [{ id: 'perso:x', name: 'X' }];
    st.customSessions = [{ id: 'cs1', name: 'A', exercises: [{ exId: 'perso:x' }, { exId: 'pushup' }] }, { id: 'cs2', name: 'B', exercises: [{ exId: 'pushup' }] }];
    st.plan.overrides = { '2026-10-01': { customSessionId: 'cs1' }, '2026-10-08': { customSessionId: 'cs1' }, '2026-10-09': { rest: true } };
  });
  assert.equal(L.removeExerciseRefs(C.state, 'perso:x'), 1);
  assert.equal(C.state.customExercises.length, 0);
  assert.deepEqual(C.state.customSessions[0].exercises, [{ exId: 'pushup' }]);
  L.removeCustomSession(C.state, 'cs1', TODAY);
  assert.deepEqual(C.state.customSessions.map((c) => c.id), ['cs2']);
  assert.deepEqual(Object.keys(C.state.plan.overrides).sort(), ['2026-10-01', '2026-10-09']); // le passé est gardé
});

test('séance perso : brouillon, réordonnancement, nettoyage', () => {
  const { L } = setup();
  assert.deepEqual(L.moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(L.moveItem(['a', 'b'], 0, -1), ['a', 'b']);
  const d = L.newDraft();
  assert.equal(L.draftError(d), 'Donne un nom à ta séance.');
  d.name = ' Haut du corps '; d.loc = 'lune'; d.goals = ['hyrox', 'zzz'];
  d.exercises = [{ exId: 'pushup', sets: '50', reps: ' 10 ', rest: null, note: '' }, { exId: '' }];
  const rec = L.customFromDraft(d, TODAY);
  assert.equal(rec.name, 'Haut du corps');
  assert.equal(rec.loc, 'maison');
  assert.deepEqual(rec.goals, ['hyrox']);
  assert.deepEqual(rec.exercises, [{ exId: 'pushup', sets: 30, reps: '10', rest: 0, note: '', target: {} }]);
  assert.equal(rec.createdAt, TODAY);
  assert.ok(L.estimateMinutes(rec) > 10);
});

test('démarrer une séance perso sans planificateur : séance construite localement', () => {
  const { C } = setup((st) => {
    st.customSessions = [{ id: 'cs1', name: 'Gainage <maison>', loc: 'maison', goals: ['general'], intro: 'Go',
      exercises: [{ exId: 'plank', sets: 3, reps: '45 s', rest: 30, note: '', target: {} }, { exId: 'inconnu' }] }];
  });
  C.libraryUI.startCustom('cs1');
  const sid = decodeURIComponent(C.lastGo.replace('#/seance/', ''));
  const s = C.state.sessions[sid];
  assert.equal(s.source, 'perso');
  assert.equal(s.customSessionId, 'cs1');
  assert.equal(s.title, 'Gainage <maison>');
  assert.equal(s.exercises.length, 1);
  assert.equal(s.exercises[0].exId, 'plank');
  assert.equal(s.exercises[0].track, 'time');
  assert.equal(s.exercises[0].rest, 30);
});

test('vues bibliothèque : liste filtrée, fiche, formulaire, séances perso', () => {
  const { C, routes } = setup((st) => {
    st.profile.injuries = [{ id: 'i', zone: 'cheville', side: 'gauche', active: true }];
    st.customExercises = [{ id: 'perso:z', name: 'Mon <exo>', cat: 'force', locs: ['maison'], goals: ['general'], track: 'reps' }];
  });
  const lib = routes['#/bibliotheque']();
  assert.ok(lib.includes('Mes exercices'));
  assert.ok(lib.includes('Mon &lt;exo&gt;'));
  assert.ok(!lib.includes('href="#/exercice/squat_jump"'), 'sans impact coché par défaut (cheville)');
  assert.ok(lib.includes('cheville à ménager'));
  const fiche = routes['#/exercice/:id']({ id: 'apnea_dynamic' });
  assert.ok(fiche.includes('uniquement accompagné'));
  assert.ok(fiche.includes('Pas encore fait'));
  assert.ok(routes['#/exercice/:id']({ id: 'perso:z' }).includes('biblio.exo-suppr'));
  assert.ok(routes['#/exercice/:id']({ id: 'perso:z', modifier: '1' }).includes('data-form="biblio.exo-save"'));
  assert.ok(routes['#/exercice/:id']({ id: 'nouveau', depuis: 'pushup' }).includes('Pompes (perso)'));
  assert.ok(routes['#/exercice/:id']({ id: 'rien' }).includes('Exercice introuvable'));
  assert.ok(routes['#/mes-seances']().includes('Aucune séance perso'));
  const edit = routes['#/mes-seances/:id']({ id: 'nouvelle' });
  assert.ok(edit.includes('Nouvelle séance'));
  assert.ok(!edit.includes('Planifier le'), 'pas de planification sans C.planner');
});

test('fiche exercice : historique (meilleure et dernière) sans C.metrics', () => {
  const { C, routes } = setup();
  session(C, { id: 'a', date: '2026-09-20', status: 'done', exercises: [item('swim_crawl_100', { track: 'time' })], log: { 'swim_crawl_100#0': [{ done: true, sec: 118 }] } });
  session(C, { id: 'b', date: '2026-10-01', status: 'done', exercises: [item('swim_crawl_100', { track: 'time' })], log: { 'swim_crawl_100#0': [{ done: true, sec: 112 }] } });
  session(C, { id: 'c', date: '2026-10-04', status: 'done', exercises: [item('swim_crawl_100', { track: 'time' })], log: { 'swim_crawl_100#0': [{ done: true, sec: 115 }] } });
  const html = routes['#/exercice/:id']({ id: 'swim_crawl_100' });
  assert.ok(html.includes('Meilleure'));
  assert.ok(html.includes('1:52'));
  assert.ok(html.includes('Dernière'));
  assert.ok(html.includes('1:55'));
  assert.ok(html.includes('Plus bas = mieux'));
});
