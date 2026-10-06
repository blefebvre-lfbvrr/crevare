'use strict';
// Tests du pont Apple Santé et de l'export calendrier (js/platform/health.js) : lecture tolérante du texte
// produit par le Raccourci iOS, application à l'état, fichier .ics conforme (CRLF, échappement, repli à 75 octets).
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadCore } = require('./helpers');

const TODAY = '2026-10-06';

function setup(mutate) {
  const C = loadCore(TODAY, mutate);
  load(['js/platform/health.js'], { fresh: false });
  return C;
}

/* ───────── parse ───────── */

test('parse : format documenté, virgule décimale, dates FR', () => {
  const C = setup();
  const p = C.health.parse([
    'poids;2026-10-06;72,4',
    'pas;06/10/2026;8 450',
    'sommeil;05/10/2026;7,2',
    'entrainement;2026-10-05;Course;45;7,8;520;148',
  ].join('\n'));
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.weights, [{ date: '2026-10-06', value: 72.4 }]);
  assert.deepEqual(p.steps, [{ date: '2026-10-06', value: 8450 }]);
  assert.deepEqual(p.sleep, [{ date: '2026-10-05', hours: 7.2 }]);
  assert.deepEqual(p.workouts, [{ date: '2026-10-05', type: 'Course', durationMin: 45, distanceKm: 7.8, kcal: 520, hrAvg: 148 }]);
  assert.equal(p.count, 4);
});

test('parse : tolérance (CRLF, majuscules, accents, unités, tabulations, en-tête, commentaires)', () => {
  const C = setup();
  const p = C.health.parse('type;date;valeur\r\n# commentaire\r\nPOIDS;6 oct. 2026;72.4 kg\r\nNombre de pas\t2026-10-05\t9 120\r\n\r\nEntraînement|hier|Natation|0:40:00|1500 m||');
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.weights, [{ date: '2026-10-06', value: 72.4 }]);
  assert.deepEqual(p.steps, [{ date: '2026-10-05', value: 9120 }]);
  assert.equal(p.workouts.length, 1);
  assert.deepEqual(p.workouts[0], { date: '2026-10-05', type: 'Natation', durationMin: 40, distanceKm: 1.5, kcal: null, hrAvg: null });
});

test('parse : durées de sommeil (heures, h/min, h:mm, minutes, secondes)', () => {
  const C = setup();
  const S = C.health._t.parseSleepHours;
  assert.equal(S('7,2'), 7.2);
  assert.equal(S('7h12'), 7.2);
  assert.equal(S('7 h 12 min'), 7.2);
  assert.equal(S('7:12'), 7.2);
  assert.equal(S('432 min'), 7.2);
  assert.equal(S('432'), 7.2); // nombre > 24 → minutes
  assert.equal(S('25920'), 7.2); // nombre > 1440 → secondes
  assert.equal(S('0'), null);
  assert.equal(S('30 h'), null);
  assert.equal(S('beaucoup'), null);
});

test('parse : dates acceptées et refusées', () => {
  const C = setup();
  const D = (s) => C.health._t.parseDate(s, TODAY);
  assert.equal(D('2026-10-06'), '2026-10-06');
  assert.equal(D('6/10/2026'), '2026-10-06');
  assert.equal(D('06.10.26'), '2026-10-06');
  assert.equal(D('mardi 6 octobre 2026 à 07:30'), '2026-10-06');
  assert.equal(D('1er févr. 2026'), '2026-02-01');
  assert.equal(D("aujourd'hui"), TODAY);
  assert.equal(D('Hier'), '2026-10-05');
  assert.equal(D('31/02/2026'), null); // n'existe pas
  assert.equal(D('2026-13-01'), null);
  assert.equal(D('demain peut-être'), null);
  assert.equal(D(''), null);
});

test('parse : erreurs lisibles avec numéro de ligne, lignes valides conservées', () => {
  const C = setup();
  const p = C.health.parse('poids;2026-10-06;72,4\nfoo;2026-10-06;1\npoids;2026-10-10;70\npoids;2026-10-05;7\nligne sans séparateur\nsommeil;;7\nentrainement;2026-10-05;Course;;5;;\nconstructor;2026-10-06;1');
  assert.equal(p.weights.length, 1);
  const reasons = p.errors.map((e) => `${e.line}:${e.reason}`);
  assert.equal(p.errors.length, 7);
  assert.match(reasons[0], /^2:Type « foo » inconnu/);
  assert.equal(reasons[1], '3:Date dans le futur');
  assert.match(reasons[2], /^4:Poids illisible/);
  assert.equal(reasons[3], '5:Séparateur « ; » manquant');
  assert.equal(reasons[4], '6:Date manquante');
  assert.match(reasons[5], /^7:Durée illisible/);
  assert.match(reasons[6], /^8:Type « constructor » inconnu/);
});

test('parse : une mesure par jour (la dernière gagne), tri par date', () => {
  const C = setup();
  const p = C.health.parse('poids;2026-10-06;72\npoids;2026-10-04;73\npoids;2026-10-06;71,8');
  assert.deepEqual(p.weights, [{ date: '2026-10-04', value: 73 }, { date: '2026-10-06', value: 71.8 }]);
});

test('parse : JSON (objet par type ou tableau typé)', () => {
  const C = setup();
  const a = C.health.parse(JSON.stringify({ poids: [{ date: '2026-10-06', valeur: '72,4' }], sommeil: [['2026-10-05', '7h30']], version: 1,
    entrainements: [{ date: '05/10/2026', type: 'HIIT', duree: 30, kcal: 250, fc: 150 }] }));
  assert.deepEqual(a.errors, []);
  assert.deepEqual(a.weights, [{ date: '2026-10-06', value: 72.4 }]);
  assert.deepEqual(a.sleep, [{ date: '2026-10-05', hours: 7.5 }]);
  assert.equal(a.workouts[0].durationMin, 30);
  const b = C.health.parse('[{"type":"pas","date":"2026-10-06","value":12000},{"type":"truc","date":"2026-10-06"}]');
  assert.deepEqual(b.steps, [{ date: '2026-10-06', value: 12000 }]);
  assert.equal(b.errors.length, 1);
  const c = C.health.parse('{ pas cassé');
  assert.equal(c.errors[0].reason, 'JSON illisible');
});

test('parse : texte vide → rien, sans erreur', () => {
  const C = setup();
  const p = C.health.parse('   \n ');
  assert.equal(p.count, 0);
  assert.deepEqual(p.errors, []);
});

/* ───────── applyTo ───────── */

function sessionOn(C, date, fields = {}) {
  const id = C.util.uid();
  C.state.sessions[id] = { id, date, source: 'plan', title: 'Footing', loc: 'dehors', kind: 'run', exercises: [], log: {}, status: 'done',
    startedAt: null, finishedAt: null, durationMin: null, rpe: 5, pain: {}, notes: '', watch: null, ...fields };
  return id;
}

test('applyTo : poids → body (garde l\'alimentation), sommeil ≥ 7 h → habitude cochée, pas → information', () => {
  const C = setup((s) => { s.body['2026-10-06'] = { food: 'normal' }; });
  const p = C.health.parse('poids;2026-10-06;72,4\nsommeil;2026-10-05;7,5\nsommeil;2026-10-04;6\npas;2026-10-06;8450');
  const res = C.health.applyTo(C.state, p, { now: '2026-10-06T20:00:00.000Z' });
  assert.deepEqual(C.state.body['2026-10-06'], { food: 'normal', weight: 72.4 });
  assert.equal(C.state.habitLog['2026-10-05'].sleep, true);
  assert.equal(C.state.habitLog['2026-10-04'], undefined);
  assert.equal(res.weights, 1);
  assert.equal(res.sleepChecked, 1);
  assert.equal(res.sleepShort, 1);
  assert.equal(res.stepsLast.value, 8450);
  assert.equal(C.state.health.lastImportAt, '2026-10-06T20:00:00.000Z');
  assert.ok(C.health.summaryLines(res).some((l) => /Pas : 8450/.test(l)));
});

test('applyTo : sans habitude sommeil, on le signale', () => {
  const C = setup((s) => { s.habits = s.habits.filter((h) => h.id !== 'sleep'); });
  const res = C.health.applyTo(C.state, C.health.parse('sommeil;2026-10-05;8'));
  assert.equal(res.sleepNoHabit, true);
  assert.deepEqual(C.state.habitLog, {});
});

test('applyTo : entraînement → complète la séance du jour du même type, sinon séance libre terminée', () => {
  const C = setup();
  const run = sessionOn(C, '2026-10-05', { watch: { hrAvg: 150, kcal: null, distanceKm: null } });
  const p = C.health.parse('entrainement;2026-10-05;Course à pied;45;7,8;520;148\nentrainement;2026-10-04;Natation;40;1,5;;');
  const res = C.health.applyTo(C.state, p);
  assert.equal(res.linked, 1);
  assert.equal(res.created, 1);
  const s = C.state.sessions[run];
  assert.deepEqual(s.watch, { hrAvg: 150, kcal: 520, distanceKm: 7.8 }); // la saisie manuelle prime
  assert.equal(s.durationMin, 45); // durée manquante complétée
  const free = Object.values(C.state.sessions).find((x) => x.date === '2026-10-04');
  assert.equal(free.status, 'done');
  assert.equal(free.source, 'libre');
  assert.equal(free.loc, 'piscine');
  assert.equal(free.durationMin, 40);
  assert.equal(C.state.health.workouts.length, 2);
  assert.equal(C.state.health.workouts.find((w) => w.date === '2026-10-05').linkedSessionId, run);
  // Réimporter le même texte ne duplique rien.
  const again = C.health.applyTo(C.state, p);
  assert.equal(again.workoutsDup, 2);
  assert.equal(C.state.health.workouts.length, 2);
  assert.equal(Object.keys(C.state.sessions).length, 2);
});

/* ───────── .ics ───────── */

function icsLines(text) { return text.split('\r\n'); }
const bytes = (s) => Buffer.byteLength(s, 'utf8');

test('buildICS : CRLF partout, lignes ≤ 75 octets repliées, échappement', () => {
  const C = setup();
  const long = 'Séance très longue — natation, apnée ; remorquage du mannequin et 300 m palmes '.repeat(3) + '🏊‍♂️🏊‍♂️🏊‍♂️';
  const text = C.health.buildICS([
    { uid: 'a@crevare', date: '2026-10-07', start: '18:30', end: '20:00', summary: 'Piscine, technique; test', description: `Ligne 1\nLigne 2 \\ fin\n${long}`,
      alarm: { trigger: '-PT1H', text: 'Dans 1 h' } },
    { uid: 'b@crevare', date: '2026-10-08', summary: 'Jalon', alarm: { trigger: 'n importe quoi', text: 'x' } },
  ], { name: 'Crevare', stamp: new Date(Date.UTC(2026, 9, 6, 8, 5, 9)) });
  assert.ok(text.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(text), 'aucun LF seul');
  const lines = icsLines(text.slice(0, -2));
  for (const l of lines) assert.ok(bytes(l) <= 75, `ligne trop longue (${bytes(l)} octets) : ${l}`);
  // Dépliage (RFC 5545 §3.1) : on retrouve la description échappée complète.
  const unfolded = text.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:Piscine\\, technique\\; test\r\n'));
  assert.ok(unfolded.includes('DESCRIPTION:Ligne 1\\nLigne 2 \\\\ fin\\n'));
  assert.ok(unfolded.includes('🏊‍♂️🏊‍♂️🏊‍♂️'), 'emoji intact après dépliage');
  assert.ok(unfolded.includes('DTSTAMP:20261006T080509Z'));
  assert.ok(unfolded.includes('DTSTART:20261007T183000\r\nDTEND:20261007T200000'));
  assert.ok(unfolded.includes('BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Dans 1 h\r\nTRIGGER:-PT1H\r\nEND:VALARM'));
  // Événement sur la journée, rappel invalide ignoré.
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20261008\r\nDTEND;VALUE=DATE:20261009'));
  assert.equal((unfolded.match(/BEGIN:VALARM/g) || []).length, 1);
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, (unfolded.match(/END:VEVENT/g) || []).length);
  assert.ok(lines[0] === 'BEGIN:VCALENDAR' && lines[1] === 'VERSION:2.0');
  assert.equal(lines[lines.length - 1], 'END:VCALENDAR');
});

test('foldLine : ne coupe jamais un caractère multi-octets', () => {
  const C = setup();
  const folded = C.health._t.foldLine('DESCRIPTION:' + 'é'.repeat(100));
  const parts = folded.split('\r\n');
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(bytes(p) <= 75);
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), 'DESCRIPTION:' + 'é'.repeat(100));
});

test('icsForPlan : séances prévues, créneau horaire, jalons et objectifs, UID stables', () => {
  const C = setup((s) => {
    s.goals = [{ id: 'g1', type: 'hyrox', name: 'HYROX Lyon', date: '2026-10-20', status: 'active', priority: 2, details: {},
      milestones: [{ id: 'm1', title: 'Inscription', due: '2026-10-09', done: false }, { id: 'm2', title: 'Fait', due: '2026-10-09', done: true }] }];
  });
  // Planificateur et agenda simulés (écrits par d'autres modules).
  C.planner = { day: (d) => (d === '2026-10-07' ? { date: d, kind: 'session', title: 'Piscine — technique', loc: 'piscine', durationMin: 60, optional: false, reason: '' }
    : d === '2026-10-08' ? { date: d, kind: 'session', title: 'Gainage', loc: 'maison', durationMin: 20, optional: false, reason: '' }
      : d === '2026-10-10' ? { date: d, kind: 'rest', optional: true, title: 'Repos', loc: 'repos' } : null) };
  C.agenda = { trainingSlot: (d, min) => (d === '2026-10-07' ? { start: '19:00', end: '20:00' } : null) };
  const text = C.health.icsForPlan('2026-10-06', '2026-10-31', { stamp: new Date(Date.UTC(2026, 9, 6)) });
  const u = text.replace(/\r\n /g, '');
  assert.equal((u.match(/BEGIN:VEVENT/g) || []).length, 4); // 2 séances + 1 jalon + 1 objectif
  assert.ok(u.includes('UID:seance-2026-10-07@crevare'));
  assert.ok(u.includes('DTSTART:20261007T190000'));
  assert.ok(u.includes('TRIGGER:-PT1H'));
  assert.ok(u.includes('UID:seance-2026-10-08@crevare\r\nDTSTAMP:20261006T000000Z\r\nDTSTART;VALUE=DATE:20261008'));
  assert.ok(u.includes('UID:jalon-g1-m1@crevare'));
  assert.ok(!u.includes('jalon-g1-m2'), 'jalon fait exclu');
  assert.ok(u.includes('UID:objectif-g1@crevare'));
  // Mêmes données → même texte (UID et contenu stables).
  assert.equal(C.health.icsForPlan('2026-10-06', '2026-10-31', { stamp: new Date(Date.UTC(2026, 9, 6)) }), text);
});

test('icsForPlan : sans planificateur, seulement objectifs et jalons', () => {
  const C = setup((s) => { s.goals = [{ id: 'g', type: 'ssa', name: 'SSA', date: '2027-06-30', status: 'active', milestones: [{ id: 'x', title: 'T\'inscrire', due: '2026-11-01', done: false }] }]; });
  delete C.planner;
  const u = C.health.icsForPlan('2026-10-06', '2026-11-30').replace(/\r\n /g, '');
  assert.equal((u.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(u.includes("SUMMARY:📌 T'inscrire"));
});

/* ═════════ Objectifs, réglages, questionnaire (fonctions pures de js/ui/goals.js, settings.js, onboarding.js) ═════════
 * Regroupés ici : ce lot de modules n'a qu'un fichier de tests. */

function setupUI(mutate) {
  const C = loadCore(TODAY, mutate);
  load(['js/ui/components.js', 'js/platform/health.js', 'js/ui/goals.js', 'js/ui/onboarding.js', 'js/ui/settings.js'], { fresh: false });
  C.ui.toast = () => {};
  return { C, G: C.goalsUI._t, S: C.settingsUI._t, O: C.onboardingUI._t };
}
const ms = (id, title, due, done = false, key) => ({ id, title, due, done, doneAt: done ? due : null, note: '', ...(key ? { key } : {}) });

test('objectifs : countdownItems — retards d\'abord, horizon 30 j, 2 à 4 éléments', () => {
  const { G } = setupUI();
  const goals = [
    { id: 'a', type: 'ssa', name: 'SSA', date: '2027-06-30', status: 'active', milestones: [
      ms('1', 'En retard', '2026-10-01'), ms('2', 'Bientôt', '2026-10-10'), ms('3', 'Fait', '2026-10-08', true), ms('4', 'Loin', '2026-12-01'), ms('5', 'Sans date', null)] },
    { id: 'b', type: 'hyrox', name: 'HYROX', date: '2026-10-20', status: 'active', milestones: [ms('6', 'Sac', '2026-10-18')] },
    { id: 'c', type: 'pompier', name: 'Archivé', date: '2026-10-07', status: 'archived', milestones: [ms('7', 'X', '2026-10-07')] },
  ];
  const items = G.countdownItems(goals, TODAY);
  assert.deepEqual(items.map((i) => i.title), ['En retard', 'Bientôt', 'Sac', 'HYROX']);
  assert.equal(items[0].late, true);
  assert.equal(items[0].days, -5);
  assert.equal(items[3].kind, 'goal');
  // Rien à moins de 30 jours : on montre quand même les 2 objectifs les plus proches.
  const far = G.countdownItems([{ id: 'x', type: 'ssa', name: 'SSA', date: '2027-06-30', status: 'active', milestones: [] },
    { id: 'y', type: 'hyrox', name: 'HYROX', date: '2027-05-15', status: 'active', milestones: [] },
    { id: 'z', type: 'pompier', name: 'Pompier', date: '2029-10-01', status: 'active', milestones: [] }], TODAY);
  assert.deepEqual(far.map((i) => i.title), ['HYROX', 'SSA']);
  assert.deepEqual(G.countdownItems([], TODAY), []);
  assert.equal(G.daysBadge(0), "Aujourd'hui");
  assert.equal(G.daysBadge(-3), '3 j de retard');
  assert.equal(G.daysBadge(12), 'J-12');
});

test('objectifs : progressOf et tri des jalons (sans date à la fin)', () => {
  const { G } = setupUI();
  const g = { milestones: [ms('1', 'B', '2026-11-01'), ms('2', 'Sans date', null), ms('3', 'A', '2026-10-01'), ms('4', 'Fait', '2026-09-01', true)] };
  const p = G.progressOf(g, TODAY);
  assert.deepEqual([p.done, p.total, p.late, p.next.title], [1, 4, 1, 'A']);
  assert.deepEqual(G.sortMilestones(g.milestones).map((m) => m.title), ['Fait', 'A', 'B', 'Sans date']);
});

test('objectifs : refreshDues — dates saisies et date de l\'objectif, sans toucher aux jalons faits ni manuels', () => {
  const { C, G } = setupUI();
  const goal = C.data.createGoalFromTemplate('ssa', {}, TODAY);
  const byKey = (list, k) => list.find((m) => m.key === k);
  assert.equal(byKey(goal.milestones, 'test-entree').due, null);
  const inscription = byKey(goal.milestones, 'inscription').due;
  goal.milestones.push({ id: 'manuel', title: 'Acheter des palmes', due: '2026-11-01', done: false, note: '' });
  byKey(goal.milestones, 'attestations').done = true;
  const doneDue = byKey(goal.milestones, 'attestations').due;
  // Dates de la formation saisies → jalons calculés mis à jour.
  goal.details.entryTestDate = '2027-03-01';
  goal.details.trainingStart = '2027-03-08';
  let next = G.refreshDues(goal, TODAY, 'details');
  assert.equal(byKey(next, 'test-entree').due, '2027-03-01');
  assert.equal(byKey(next, 'formation').due, '2027-03-08');
  assert.equal(byKey(next, 'certificat-medical').due, '2027-02-15');
  assert.equal(byKey(next, 'certification').due, '2027-06-30', 'jalon lié à la date de l\'objectif inchangé');
  // Date de l'objectif changée → jalons « N jours avant/après » déplacés ; « dans N jours » et manuels intacts.
  goal.milestones = next;
  goal.date = '2027-07-15';
  next = G.refreshDues(goal, TODAY, 'date');
  assert.equal(byKey(next, 'certification').due, '2027-07-15');
  assert.equal(byKey(next, 'fc-ssa').due, '2028-07-14');
  assert.equal(byKey(next, 'inscription').due, inscription);
  assert.equal(next.find((m) => m.id === 'manuel').due, '2026-11-01');
  assert.equal(byKey(next, 'attestations').due, doneDue);
});

test('objectifs : overridesFromForm (HYROX)', () => {
  const { G } = setupUI();
  const o = G.overridesFromForm('hyrox', { event: 'lyon-2027', division: 'doubles', category: 'men', partner: '  Sam ', name: '' });
  assert.equal(o.date, '2027-05-15');
  assert.deepEqual(o.details, { event: 'lyon-2027', division: 'doubles', category: 'men', partner: 'Sam', raceDate: '2027-05-15' });
  const other = G.overridesFromForm('hyrox', { event: '', date: '2027-09-20', division: 'solo' });
  assert.equal(other.details.event, '');
  assert.equal(other.date, '2027-09-20');
});

test('réglages : champs du profil validés, jours, piscines', () => {
  const { C, S } = setupUI();
  const p = C.state.profile;
  assert.equal(S.applyProfileField(p, 'birthYear', '2006'), true);
  assert.equal(p.birthYear, 2006);
  assert.equal(S.applyProfileField(p, 'birthYear', '20'), false);
  assert.equal(S.applyProfileField(p, 'birthYear', '2030'), false);
  assert.equal(p.birthYear, 2006);
  assert.equal(S.applyProfileField(p, 'sex', 'X'), false);
  assert.equal(S.applyProfileField(p, 'gymHyrox', 'oui'), true);
  assert.equal(p.equipment.gym.hyrox, true);
  assert.equal(S.applyProfileField(p, 'firstName', '  Alex  '), true);
  assert.equal(p.firstName, 'Alex');
  assert.deepEqual(S.toggleDay([1, 3, 5], 0), [0, 1, 3, 5]);
  assert.deepEqual(S.toggleDay([1, 3], 3), [1]);
  assert.deepEqual(S.toggleDay([1], 1), [1], 'au moins un jour');
  assert.deepEqual(S.poolFromForm({ name: '', length: '50', deepM: '3,5', mannequin: 'oui' }), { name: 'Piscine 50 m', length: 50, deepM: 3.5, mannequin: true });
  assert.equal(S.poolFromForm({ name: 'X', length: '40' }), null);
  assert.equal(S.poolFromForm({ name: 'X', length: '25', deepM: 'beaucoup' }), null);
});

test('sauvegarde : rappel d\'export et aperçu avant import', () => {
  const { C, S } = setupUI();
  const s = C.state;
  s.createdAt = '2026-09-01';
  assert.equal(S.needsBackupReminder(s, TODAY), true); // jamais exporté, données de plus de 14 jours
  s.settings.lastExportAt = '2026-10-01T10:00:00.000Z';
  assert.equal(S.daysSinceExport(s, TODAY), 5);
  assert.equal(S.needsBackupReminder(s, TODAY), false);
  s.settings.exportReminderDays = 0;
  s.settings.lastExportAt = null;
  assert.equal(S.needsBackupReminder(s, TODAY), false);
  // Aperçu
  assert.equal(S.backupPreview('').ok, false);
  assert.match(S.backupPreview('{ pas du json').error, /JSON illisible/);
  assert.match(S.backupPreview('{"a":1}').error, /pas une sauvegarde/);
  s.goals = [C.data.createGoalFromTemplate('hyrox', {}, TODAY)];
  const v2 = S.backupPreview(JSON.stringify(s));
  assert.equal(v2.ok, true);
  assert.equal(v2.info.from, 'Crevare v2');
  assert.deepEqual(v2.info.goals, ['HYROX Lyon — Doubles']);
  const v1 = S.backupPreview(JSON.stringify({ version: 1, goals: { ssa: { date: '2027-01-15' } }, startDate: '2026-09-01', benchmarks: { pullups: [{ date: '2026-09-10', value: 1 }] } }));
  assert.equal(v1.ok, true);
  assert.match(v1.info.from, /v1/);
  assert.equal(v1.info.benchmarks, 1);
  assert.equal(S.exportName(TODAY), 'crevare-sauvegarde-2026-10-06.json');
});

test('questionnaire : brouillon par défaut, puis objectifs et tests créés', () => {
  const { C, O } = setupUI();
  const d = O.draftFromState(C.state, TODAY);
  assert.equal(d.step, 0);
  assert.equal(d.redo, false);
  assert.equal(d.start, 'today');
  assert.equal(d.goals.ssa.on, false);
  assert.equal(d.goals.ssa.date, '2027-06-30'); // fin juin de la prochaine saison
  assert.equal(d.goals.hyrox.event, 'lyon-2027');
  assert.equal(d.goals.hyrox.division, 'doubles');
  assert.match(O.stepError({ ...d, birthYear: '1800' }, 0), /Année/);
  d.goals.custom.on = true;
  assert.match(O.stepError(d, 2), /nom/);
  d.goals.custom.on = false;
  d.goals.ssa.on = true; d.goals.hyrox.on = true; d.goals.pompier.on = true;
  d.goals['protection-civile'].on = true; d.goals['protection-civile'].city = 'Montpellier';
  assert.equal(O.stepError(d, 2), '');
  const create = (id, ov, t) => C.data.createGoalFromTemplate(id, ov, t);
  const goals = O.goalsFromDraft(d, [], TODAY, create, C.goalsUI._t.refreshDues);
  assert.deepEqual(goals.map((g) => [g.type, g.date]), [['ssa', '2027-06-30'], ['hyrox', '2027-05-15'], ['pompier', '2029-10-01'], ['custom', null]]);
  assert.equal(goals[1].details.division, 'doubles');
  assert.ok(goals[3].milestones.some((m) => /Montpellier/.test(m.title)));
  // Refaire le questionnaire : pas de doublon, la date change et les jalons suivent.
  C.state.goals = goals;
  const d2 = O.draftFromState(C.state, TODAY);
  assert.equal(d2.goals.hyrox.on, true);
  assert.equal(d2.goals.hyrox.existingId, goals[1].id);
  d2.goals.ssa.date = '2027-07-15';
  const again = O.goalsFromDraft(d2, C.state.goals, TODAY, create, C.goalsUI._t.refreshDues);
  assert.equal(again.length, 4);
  const ssa = again.find((g) => g.type === 'ssa');
  assert.equal(ssa.id, goals[0].id);
  assert.equal(ssa.date, '2027-07-15');
  assert.equal(ssa.milestones.find((m) => m.key === 'certification').due, '2027-07-15');
  // Tests déclarés
  const b = O.benchesFromDraft({ pullups: 1, pushups: 30, plankSec: 60, swim100: null, run5k: null });
  assert.deepEqual(b.map((x) => [x.benchId, x.value]), [['pullups', 1], ['pushups', 30], ['plank', 60]]);
  assert.equal(O.nextMonday(TODAY), '2026-10-12');
  assert.equal(O.runText(3, '7 à 10'), '3 sorties par semaine, 7 à 10 km');
  assert.deepEqual(O.parseRunText('3 sorties par semaine, 7 à 10 km'), { perWeek: 3, km: '7 à 10' });
});

test('questionnaire : données venues de la v1 préremplies, objectifs v1 reconstruits depuis les modèles', () => {
  const v1 = { version: 1, startDate: '2026-09-01', goals: { ssa: { date: '2027-01-15' }, hyrox: { date: '2027-07-03' } },
    workouts: {}, benchmarks: { pullups: [{ date: '2026-09-10', value: 2 }], plank: [{ date: '2026-09-10', value: 75 }] }, habits: [] };
  const { C, O } = setupUI((s, C2) => { Object.assign(s, C2.schema.fromAny(JSON.stringify(v1))); });
  assert.equal(C.state.migratedFrom, 1);
  const d = O.draftFromState(C.state, TODAY);
  assert.equal(d.migrated, true);
  assert.equal(d.goals.ssa.on, true);
  assert.equal(d.goals.ssa.date, '2027-01-15');
  assert.equal(d.goals.hyrox.on, true);
  assert.equal(d.pullups, 2);
  assert.equal(d.plankSec, 75);
  const legacy = C.state.goals.find((g) => g.type === 'ssa');
  assert.equal(O.isLegacyGoal(legacy), true);
  const goals = O.goalsFromDraft(d, C.state.goals, TODAY, (id, ov, t) => C.data.createGoalFromTemplate(id, ov, t), C.goalsUI._t.refreshDues);
  const ssa = goals.find((g) => g.type === 'ssa');
  assert.equal(ssa.id, legacy.id, 'même identifiant');
  assert.equal(ssa.date, '2027-01-15');
  assert.equal(ssa.details.template, 'ssa');
  assert.ok(ssa.milestones.length > 3);
  const hx = goals.find((g) => g.type === 'hyrox');
  assert.equal(hx.details.event, 'lyon-2027'); // la date v1 (juillet, sans course) est remplacée par la course choisie
  assert.equal(goals.length, 2);
});

test('vues : rendu sans erreur, texte de l\'état échappé', () => {
  const { C } = setupUI((s) => { s.profile.onboarded = true; s.profile.firstName = '<img src=x onerror=alert(1)>'; });
  const routes = {};
  C.route = (p, v) => { routes[p] = v; };
  C.action = C.onChange = C.onInput = C.onSubmit = () => {};
  C.menuItem = () => {};
  C.env = { ios: true, standalone: false, embedded: false };
  (C.bootHooks || []).forEach((fn) => fn());
  const g = C.data.createGoalFromTemplate('custom', { name: '<script>x</script>', date: '2026-10-20' }, TODAY);
  C.state.goals = [g, C.data.createGoalFromTemplate('hyrox', {}, TODAY), C.data.createGoalFromTemplate('ssa', {}, TODAY), C.data.createGoalFromTemplate('pompier', {}, TODAY)];
  const html = (o) => (typeof o === 'string' ? o : o.html);
  const pages = [routes['#/objectifs']({}), routes['#/reglages']({}), routes['#/donnees']({}), routes['#/sante']({}), routes['#/bienvenue']({}),
    ...C.state.goals.map((x) => routes['#/objectifs/:id']({ id: x.id })), routes['#/objectifs/:id']({ id: 'inconnu' }), C.goalsUI.countdownCard()].map(html);
  for (const p of pages) {
    assert.ok(p.length > 50);
    assert.ok(!p.includes('<script>x') && !p.includes('<img src=x'), 'texte échappé');
  }
  assert.match(pages[0], /&lt;script&gt;x&lt;\/script&gt;/);
});

test('objectifs : saisie d\'un champ (gestionnaire) — dates SSA, cible en temps, champ inconnu ignoré', () => {
  const { C } = setupUI();
  const handlers = {};
  C.route = () => {}; C.menuItem = () => {};
  C.action = C.onInput = C.onSubmit = () => {};
  C.onChange = (name, fn) => { handlers[name] = fn; };
  C.rerender = () => {};
  (C.bootHooks || []).forEach((fn) => fn());
  const g = C.data.createGoalFromTemplate('ssa', {}, TODAY);
  C.state.goals = [g];
  const fire = (f, value) => handlers['objectif.champ']({ dataset: { id: g.id, f }, value });
  fire('d.entryTestDate', '2027-03-01');
  assert.equal(C.state.goals[0].details.entryTestDate, '2027-03-01');
  assert.equal(C.state.goals[0].milestones.find((m) => m.key === 'test-entree').due, '2027-03-01');
  fire('t.entry', '210'); // saisie rapide → 2:10
  assert.equal(C.state.goals[0].details.targets.entry, 130);
  fire('d.mention', 'constructor');
  assert.equal(C.state.goals[0].details.mention, 'piscine');
  fire('constructor', 'x'); // ne plante pas
  fire('name', '   ');
  assert.equal(C.state.goals[0].name, g.name);
});
