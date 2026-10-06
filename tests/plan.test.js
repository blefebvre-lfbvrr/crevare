'use strict';
// Tests de l'écran plan (js/ui/plan.js) : fonctions pures (état d'un jour, séance principale, déplacements,
// frise), rendu des vues avec le vrai planificateur, actions (commencer, repos, déplacer, changer…).
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadCore } = require('./helpers');

const T = '2026-10-06'; // mardi

function scenario(mutate) {
  const C = loadCore(T, (s) => {
    s.profile.onboarded = true;
    s.profile.firstName = 'Léo';
    s.profile.sessionsPerWeek = 3;
    s.profile.availableDays = [1, 3, 5];
    s.profile.injuries = [{ id: 'g', zone: 'genou', side: 'gauche', active: true }, { id: 'c', zone: 'cheville', side: 'gauche', active: true }];
    s.profile.pools = [{ id: 'p25', name: 'Piscine 25 m', length: 25 }, { id: 'p50', name: 'Piscine 50 m', length: 50 }];
    s.goals = [
      { id: 'hyrox', type: 'hyrox', name: 'HYROX Lyon — Doubles', date: '2027-05-15', priority: 2, status: 'active', details: { raceDate: '2027-05-15', division: 'doubles', category: 'men', level: 'open' }, milestones: [] },
      { id: 'ssa', type: 'ssa', name: 'SSA', date: '2027-06-30', priority: 1, status: 'active', details: { entryTestDate: '2027-02-15' },
        milestones: [{ id: 'm1', title: "S'inscrire à une formation SSA", due: '2026-12-05', done: false }, { id: 'm0', title: 'Jalon oublié', due: '2026-09-01', done: false }] },
      { id: 'pompier', type: 'pompier', name: 'Sapeur-pompier', date: '2029-10-01', priority: 3, status: 'active', details: { path: 'indecis' }, milestones: [] },
    ];
    if (mutate) mutate(s);
  });
  load(['js/ui/components.js', 'js/ui/plan.js', 'js/ui/today.js'], { fresh: false });
  if (C.planner && C.planner.clearCache) C.planner.clearCache();
  // Coquille minimale (app.js n'est pas chargé en test) : routes, actions, navigation, modale.
  const routes = {}, actions = {}, log = { go: [], toasts: [], modal: [] };
  C.route = (p, v) => { routes[p] = v; };
  C.action = (n, f) => { actions[n] = f; };
  C.onChange = C.onInput = C.onSubmit = () => {};
  C.menuItem = () => {};
  C.go = (h) => log.go.push(h);
  C.rerender = () => {};
  C.ui.toast = (m) => log.toasts.push(m);
  C.ui.openModal = (o) => { log.modal.push(o); };
  C.ui.closeModal = () => {};
  C.ui.ask = async () => true;
  for (const fn of C.bootHooks || []) fn();
  return { C, routes, actions, log, t: C.planUI._t };
}

const sess = (o) => ({ id: o.id || 'x', date: o.date || T, status: 'in_progress', log: {}, startedAt: null, exercises: [], ...o });
const el = (dataset) => ({ dataset, setAttribute() {}, getAttribute() { return null; } });

/* ───────── Fonctions pures ───────── */

test('isEmptySession : rien de noté ni démarré', () => {
  const { t } = scenario();
  assert.equal(t.isEmptySession(sess({})), true);
  assert.equal(t.isEmptySession(sess({ startedAt: 123 })), false);
  assert.equal(t.isEmptySession(sess({ log: { a: [{ done: true }] } })), false);
  assert.equal(t.isEmptySession(sess({ log: { a: [{ done: false }] } })), true);
  assert.equal(t.isEmptySession(sess({ status: 'done' })), false);
  assert.equal(t.isEmptySession(null), false);
});

test('pickMain : séance du plan, sinon hors bonus, une séance faite l\'emporte', () => {
  const { t } = scenario();
  const dp = { templateId: 'gym_hybrid', bonus: ['home_core'] };
  const bonus = sess({ id: 'b', templateId: 'home_core' });
  const main = sess({ id: 'm', templateId: 'gym_hybrid' });
  assert.equal(t.pickMain([bonus, main], dp).id, 'm');
  assert.equal(t.pickMain([bonus], dp), null, 'un bonus seul n\'est pas la séance du jour');
  const free = sess({ id: 'f', templateId: null });
  const done = sess({ id: 'd', templateId: 'run_easy', status: 'done' });
  assert.equal(t.pickMain([free, done], dp).id, 'd');
  assert.equal(t.pickMain([sess({ id: 'c', customSessionId: 'cs1' })], { customSessionId: 'cs1' }).id, 'c');
  assert.equal(t.pickMain([sess({ status: 'skipped' })], dp), null);
  assert.equal(t.pickMain([], dp), null);
});

test('openOpts : séance perso, modèle, libre, repos', () => {
  const { t } = scenario();
  assert.deepEqual(t.openOpts({ customSessionId: 'cs', templateId: null }, 'allege'), { customSessionId: 'cs', variant: 'allege' });
  assert.deepEqual(t.openOpts({ templateId: 'run_easy' }, 'nimporte'), { templateId: 'run_easy', variant: 'normal' });
  assert.deepEqual(t.openOpts({ kind: 'session', templateId: null, title: 'Séance libre', loc: 'autre' }), { free: true, title: 'Séance libre', loc: 'autre' });
  assert.equal(t.openOpts({ kind: 'rest', templateId: null }), null);
  assert.equal(t.openOpts(null), null);
});

test('dayState : fait, manqué, aujourd\'hui, prévu, repos, événement, en cours', () => {
  const { t } = scenario();
  const sDay = (date) => ({ date, kind: 'session', templateId: 'run_easy', bonus: [] });
  assert.equal(t.dayState(sDay('2026-10-05'), [], T).key, 'manque');
  assert.equal(t.dayState(sDay(T), [], T).key, 'aujourdhui');
  assert.equal(t.dayState(sDay('2026-10-07'), [], T).key, 'prevu');
  assert.equal(t.dayState(sDay('2026-10-05'), [sess({ date: '2026-10-05', status: 'done', templateId: 'run_easy' })], T).key, 'fait');
  assert.equal(t.dayState(sDay(T), [sess({ startedAt: 1 })], T).key, 'en-cours');
  assert.equal(t.dayState(sDay('2026-10-05'), [sess({ date: '2026-10-05', startedAt: 1 })], T).key, 'a-terminer');
  // Séance ouverte mais vide : toujours « aujourd'hui »
  assert.equal(t.dayState(sDay(T), [sess({})], T).key, 'aujourdhui');
  assert.equal(t.dayState({ date: T, kind: 'event', bonus: [] }, [], T).key, 'evenement');
  const rest = { date: '2026-10-05', kind: 'rest', bonus: ['home_core'] };
  const r = t.dayState(rest, [sess({ date: '2026-10-05', templateId: 'home_core', status: 'done' })], T);
  assert.equal(r.key, 'repos', 'un bonus fait ne transforme pas le repos en séance');
  assert.equal(r.bonusDone, 1);
  const extra = t.dayState(rest, [sess({ date: '2026-10-05', templateId: 'run_easy', status: 'done' })], T);
  assert.equal(extra.key, 'fait');
  assert.equal(extra.extra, true);
});

test('moveTargets : jours restants de la semaine, prolongés en fin de semaine', () => {
  const { t } = scenario();
  // Mardi → mercredi … dimanche (aujourd'hui = mardi)
  assert.deepEqual(t.moveTargets(T, T), ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  // Jeudi vu depuis mardi : mardi, mercredi, vendredi…
  assert.deepEqual(t.moveTargets('2026-10-08', T), [T, '2026-10-07', '2026-10-09', '2026-10-10', '2026-10-11']);
  // Samedi : dimanche + jours suivants (6 jours au plus)
  const sat = t.moveTargets('2026-10-10', '2026-10-10');
  assert.deepEqual(sat, ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  // Dimanche : la semaine suivante
  assert.equal(t.moveTargets('2026-10-11', '2026-10-11')[0], '2026-10-12');
  assert.ok(t.moveTargets('2026-10-11', '2026-10-11').every((d) => d > '2026-10-11'));
  // Jamais dans le passé
  assert.ok(t.moveTargets('2026-10-05', T).every((d) => d >= T));
  assert.deepEqual(t.moveTargets('pas-une-date', T), []);
});

test('weekLabel, eventTime, hm', () => {
  const { t } = scenario();
  assert.equal(t.weekLabel('2026-10-05'), '5 – 11 oct.');
  assert.equal(t.weekLabel('2026-09-28'), '28 sept. – 4 oct.');
  assert.equal(t.eventTime({ start: '2026-10-06T08:30', end: '2026-10-06T10:00' }, T), '08:30–10:00');
  assert.equal(t.eventTime({ allDay: true, start: T }, T), 'Journée');
  assert.equal(t.eventTime({ start: '2026-10-05T22:00', end: '2026-10-06T06:00' }, T), '…–06:00');
  assert.equal(t.hm('2026-10-06T18:30'), '18:30');
  assert.equal(t.hm('18:30'), '18:30');
  assert.equal(t.hm(''), '');
});

test('slotText : créneau et contexte (après les cours, avant, journée libre)', () => {
  const { t } = scenario();
  const info = { events: [{}], firstStart: '08:30', lastEnd: '17:45' };
  assert.equal(t.slotText({ start: '18:30', end: '20:00' }, info, ['cours']), '18:30–20:00 · après tes cours');
  assert.equal(t.slotText({ start: '18:30', end: '20:00' }, info, ['protection-civile']), '18:30–20:00 · après ta Protection civile');
  assert.equal(t.slotText({ start: '06:30', end: '07:30' }, info, ['cours']), '06:30–07:30 · avant tes cours');
  assert.equal(t.slotText({ start: '12:00', end: '13:00' }, info, ['cours']), '12:00–13:00 · entre deux créneaux');
  assert.equal(t.slotText({ start: '10:00', end: '11:30' }, { events: [] }, []), '10:00–11:30 · journée libre');
  assert.equal(t.slotText({ start: '2026-10-06T18:30', end: '2026-10-06T20:00' }, null, []), '18:30–20:00');
  assert.equal(t.slotText(null, info, []), '');
  assert.equal(t.slotText({ start: 'x' }, info, []), '');
});

test('summarize : séances faites hors bonus, minutes', () => {
  const { t } = scenario();
  const days = [
    { date: '2026-10-05', kind: 'session', templateId: 'a', durationMin: 60, bonus: [] },
    { date: '2026-10-06', kind: 'rest', bonus: ['home_core'] },
    { date: '2026-10-07', kind: 'event', bonus: [] },
    { date: '2026-10-08', kind: 'rest', optional: true, bonus: [] },
  ];
  const by = {
    '2026-10-05': [sess({ status: 'done', durationMin: 50 })],
    '2026-10-06': [sess({ status: 'done', templateId: 'home_core', plannedMin: 15 })],
  };
  assert.deepEqual(t.summarize(days, by), { done: 1, planned: 2, minutes: 65, bonus: 1, plannedMin: 60 });
});

test('prescription : séries, charge, repos', () => {
  const { t } = scenario();
  assert.equal(t.prescription({ sets: 3, reps: '8–10', rest: 90, target: { kg: 20 } }), '3 × 8–10 · 20 kg · repos 1:30');
  assert.equal(t.prescription({ sets: 1, reps: '200 m souple', rest: 0, target: { m: 200 } }), '200 m souple');
  assert.equal(t.prescription({ sets: 4, reps: '', track: 'time', rest: 30, target: { sec: 45 } }), '4 séries · 0:45 · repos 30 s');
});

test('blockInfo : un but et un contenu pour chaque bloc', () => {
  const { t } = scenario();
  for (const key of ['reprise', 'base', 'developpement', 'specifique', 'affutage', 'jour-j', 'recuperation', 'entretien', 'inconnu']) {
    for (const scope of ['hyrox', 'ssa', 'pompier', null]) {
      const b = t.blockInfo(key, scope);
      assert.ok(b.goal && b.content, `${key}/${scope}`);
    }
  }
  assert.match(t.blockInfo('specifique', 'pompier').content, /Luc Léger/);
  assert.match(t.blockInfo('entretien', 'pompier').goal, /pompier/);
});

test('lastGoalDate et markersOf : objectifs actifs, épreuves et jalons', () => {
  const { C, t } = scenario();
  assert.equal(t.lastGoalDate(C.state.goals), '2029-10-01');
  assert.equal(t.lastGoalDate([{ status: 'archived', date: '2030-01-01' }]), null);
  const m = t.markersOf(C.state.goals);
  assert.ok(m.some((x) => x.title === "Test d'entrée SSA" && x.date === '2027-02-15' && x.kind === 'goal'));
  assert.ok(m.some((x) => x.kind === 'milestone' && x.date === '2026-12-05'));
  assert.ok(m.some((x) => x.title === 'HYROX Lyon — Doubles' && x.date === '2027-05-15'));
  assert.equal(m.filter((x) => x.date === '2027-05-15').length, 1, 'date de course et date d\'objectif identiques : un seul repère');
  for (let i = 1; i < m.length; i++) assert.ok(m[i - 1].date <= m[i].date, 'triés par date');
});

test('timeline : bloc en cours, jalon en retard, repères rangés', () => {
  const { C, t } = scenario();
  const blocks = C.planner.macro(T, '2029-10-01');
  const rows = t.timeline(blocks, C.state.goals, T);
  assert.ok(rows.length >= 5);
  const cur = rows.filter((r) => r.current);
  assert.equal(cur.length, 1);
  assert.equal(cur[0].weekNow, 1);
  assert.ok(cur[0].progress > 0 && cur[0].progress <= 1);
  assert.ok(rows[0].markers.some((m) => m.title === 'Jalon oublié' && m.late), 'jalon en retard dans le 1er bloc');
  const entry = rows.find((r) => r.markers.some((m) => m.title === "Test d'entrée SSA"));
  assert.ok(entry && entry.start <= '2027-02-15' && entry.end >= '2027-02-15');
  assert.ok(rows.find((r) => r.markers.some((m) => m.date === '2029-10-01')), 'objectif final présent');
  assert.deepEqual(t.timeline([], C.state.goals, T), []);
});

/* ───────── Vues ───────── */

test('vues : semaine, jour, jour J, vue d\'ensemble s\'affichent', () => {
  const { C, routes } = scenario();
  for (const p of ['#/plan', '#/plan/:monday', '#/jour/:date', '#/plan-apercu']) assert.equal(typeof routes[p], 'function', p);
  const week = C.planUI.viewWeek({});
  assert.match(week, /5 – 11 oct\./);
  assert.equal((week.match(/class="pln-day /g) || []).length, 7);
  assert.match(week, /href="#\/jour\/2026-10-06"/);
  assert.match(week, /aria-current="date"/);
  assert.match(week, /#\/bibliotheque/);
  assert.match(week, /#\/mes-seances/);
  assert.match(week, /#\/plan-apercu/);
  // Semaine passée : séance manquée
  const prev = C.planUI.viewWeek({ monday: '2026-10-12' });
  assert.match(prev, /12 – 18 oct\./);
  const day = C.planUI.viewDay({ date: '2026-10-08' });
  assert.match(day, /Au programme/);
  assert.match(day, /class="pln-ex"/);
  assert.match(day, /data-action="plan.variante"/);
  assert.match(day, /data-action="plan.changer"/);
  assert.match(day, /data-action="plan.deplacer"/);
  const race = C.planUI.viewDay({ date: '2027-05-15' });
  assert.match(race, /pln-cl-item/, 'check-list le jour J');
  assert.doesNotMatch(race, /data-action="plan.deplacer"/, 'pas de déplacement d\'un jour d\'épreuve');
  const eve = C.planUI.viewDay({ date: '2027-05-14' });
  assert.match(eve, /Demain : /, 'check-list la veille');
  const ov = C.planUI.viewOverview();
  assert.match(ov, /Tu es ici/);
  assert.match(ov, /pln-blk/);
  assert.match(ov, /Test d&#39;entrée SSA/);
  assert.match(C.planUI.viewDay({ date: 'nimporte' }), /Date invalide/);
});

test('vues : tout texte venant des données est échappé', () => {
  const { C } = scenario((s) => {
    s.goals[0].name = '<script>alert(1)</script>';
    s.goals[1].milestones.push({ id: 'x', title: '<img src=x onerror=alert(2)>', due: '2026-11-01', done: false });
    s.customSessions = [{ id: 'cs"1', name: '<b>perso</b>', loc: 'maison', exercises: [{ exId: 'pushup', sets: 3, reps: '10' }] }];
    s.plan.overrides['2026-10-08'] = { customSessionId: 'cs"1' };
  });
  const html = [C.planUI.viewWeek({}), C.planUI.viewDay({ date: '2026-10-08' }), C.planUI.viewOverview(), C.planUI.viewDay({ date: '2027-05-15' })].join('');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>perso<\/b>/);
  assert.match(html, /&lt;b&gt;perso/);
});

test('vues : sans planificateur, message clair au lieu d\'un plantage', () => {
  const { C } = scenario();
  C.planner = undefined;
  assert.match(C.planUI.viewWeek({}), /Plan indisponible/);
  assert.match(C.planUI.viewDay({ date: T }), /Plan indisponible/);
  assert.match(C.planUI.viewOverview(), /Plan indisponible/);
});

test('agenda (si présent) : événements du jour, révisions et créneau conseillé', () => {
  const { C } = scenario((s) => {
    s.agenda.sources = [{ id: 'epf', name: 'EPF', kind: 'cours' }, { id: 'pc', name: 'Protection civile', kind: 'protection-civile' }];
    s.agenda.subjects = [{ id: 'maths', name: 'Maths' }];
  });
  const events = [
    { id: 'e1', sourceId: 'epf', title: 'TD <Maths>', start: `${T}T08:30`, end: `${T}T12:00`, allDay: false },
    { id: 'e2', sourceId: 'pc', title: 'DPS concert', start: `${T}T13:30`, end: `${T}T17:00`, allDay: false },
  ];
  C.agenda = {
    eventsOn: () => events,
    dayInfo: () => ({ events, busyMin: 420, hasCivilProtection: true, firstStart: '08:30', lastEnd: '17:00' }),
    trainingSlot: () => ({ start: '18:30', end: '19:30' }),
    schedule: () => [{ id: 'b1', date: T, start: '20:30', end: '21:20', subjectId: 'maths', title: 'Relecture', done: false }],
  };
  C.planner.clearCache();
  const html = C.planUI.viewDay({ date: T });
  assert.match(html, /18:30–19:30 · après tes cours/);
  assert.match(html, /TD &lt;Maths&gt;/);
  assert.match(html, /Protection civile/);
  assert.match(html, /Révision · Maths/);
  assert.match(html, /08:30–12:00/);
});

/* ───────── Actions ───────── */

test('plan.commencer : crée la séance du jour une seule fois, puis la rouvre', async () => {
  const { C, actions, log } = scenario();
  await actions['plan.commencer'](el({ date: T, variant: 'normal' }));
  const list = C.sessions.forDate(T);
  assert.equal(list.length, 1);
  assert.equal(list[0].templateId, C.planner.day(T).templateId);
  assert.equal(log.go.pop(), '#/seance/' + list[0].id);
  await actions['plan.commencer'](el({ date: T }));
  assert.equal(C.sessions.forDate(T).length, 1, 'pas de doublon');
  assert.equal(log.go.pop(), '#/seance/' + list[0].id);
});

test('plan.version : séance vide reconstruite dans la version demandée, sans doublon', async () => {
  const { C, actions } = scenario();
  await actions['plan.commencer'](el({ date: T }));
  const id = C.sessions.forDate(T)[0].id;
  const before = C.sessions.get(id).plannedMin;
  await actions['plan.version'](el({ date: T, variant: 'express' }));
  const s = C.sessions.get(id);
  assert.equal(C.sessions.forDate(T).length, 1);
  assert.equal(s.variant, 'express');
  assert.ok(s.plannedMin <= 30 && s.plannedMin <= before);
});

test('plan.version : séance commencée → confirmation, puis séries effacées', async () => {
  const { C, actions } = scenario();
  await actions['plan.commencer'](el({ date: T }));
  const id = C.sessions.forDate(T)[0].id;
  C.sessions.patchSet(id, C.sessions.get(id).exercises[0].key, 0, { done: true });
  let asked = 0;
  C.ui.ask = async () => { asked++; return false; };
  await actions['plan.version'](el({ date: T, variant: 'doux' }));
  assert.equal(asked, 1);
  assert.equal(C.sessions.get(id).variant, 'normal', 'refus : rien ne change');
  C.ui.ask = async () => true;
  await actions['plan.version'](el({ date: T, variant: 'doux' }));
  assert.equal(C.sessions.get(id).variant, 'doux');
  assert.deepEqual(C.sessions.get(id).log, {});
});

test('plan.repos : repos noté, séance vide jetée, séance commencée gardée', async () => {
  const { C, actions } = scenario();
  await actions['plan.commencer'](el({ date: T }));
  await actions['plan.repos'](el({ date: T }));
  assert.deepEqual(C.state.plan.overrides[T], { rest: true });
  assert.equal(C.sessions.forDate(T).length, 0);
  assert.equal(C.planner.day(T).kind, 'rest');
  // Séance commencée un autre jour : gardée
  const d = '2026-10-08';
  await actions['plan.commencer'](el({ date: d }));
  const id = C.sessions.forDate(d)[0].id;
  C.sessions.patch(id, { startedAt: 1 });
  await actions['plan.repos'](el({ date: d }));
  assert.ok(C.sessions.get(id), 'séance commencée conservée');
  assert.deepEqual(C.state.plan.overrides[d], { rest: true });
});

test('plan.deplacer-vers : échange de deux jours ; refusé pour un jour d\'épreuve', async () => {
  const { C, actions, log } = scenario();
  const a = C.planner.day(T), b = C.planner.day('2026-10-07');
  await actions['plan.deplacer-vers'](el({ date: T, to: '2026-10-07' }));
  assert.equal(C.planner.day('2026-10-07').templateId, a.templateId);
  assert.equal(C.planner.day(T).kind, b.kind);
  assert.match(log.toasts.pop(), /mercredi/);
  // Jour d'épreuve
  await actions['plan.deplacer-vers'](el({ date: '2027-05-14', to: '2027-05-15' }));
  assert.match(log.toasts.pop(), /Impossible/);
  // Retour vers « Aujourd'hui »
  await actions['plan.deplacer-vers'](el({ date: '2026-10-10', to: T, retour: 'today' }));
  assert.equal(log.go.pop(), '#/');
});

test('plan.choisir / plan.retablir : changer la séance puis revenir au plan', async () => {
  const { C, actions } = scenario((s) => { s.customSessions = [{ id: 'cs1', name: 'Ma séance', loc: 'maison', exercises: [{ exId: 'pushup', sets: 3, reps: '10' }] }]; });
  const d = '2026-10-08';
  const orig = C.planner.day(d).templateId;
  await actions['plan.choisir'](el({ date: d, tid: 'run_easy' }));
  assert.equal(C.planner.day(d).templateId, 'run_easy');
  assert.equal(C.planner.day(d).overridden, true);
  await actions['plan.choisir'](el({ date: d, cid: 'cs1' }));
  assert.equal(C.planner.day(d).customSessionId, 'cs1');
  await actions['plan.choisir'](el({ date: d, mode: 'free' }));
  assert.equal(C.planner.day(d).title, 'Séance libre');
  await actions['plan.retablir'](el({ date: d }));
  assert.equal(C.planner.day(d).templateId, orig);
  assert.equal(C.planner.day(d).overridden, false);
});

test('plan.changer / plan.imprevu / plan.deplacer : feuilles ouvertes, contenu échappé', async () => {
  const { C, actions, log } = scenario((s) => { s.customSessions = [{ id: 'cs1', name: '<i>x</i>', loc: 'maison', exercises: [] }]; });
  actions['plan.changer'](el({ date: T }));
  const ch = log.modal.pop();
  assert.equal(ch.title, 'Changer la séance');
  assert.match(ch.body, /data-mode="rest"/);
  assert.match(ch.body, /data-mode="free"/);
  assert.match(ch.body, /data-cid="cs1"/);
  assert.match(ch.body, /&lt;i&gt;x/);
  assert.match(ch.body, /<h4>Piscine<\/h4>/);
  actions['plan.imprevu'](el({ date: T, recommend: 'doux' }));
  const im = log.modal.pop();
  for (const v of ['allege', 'express', 'doux']) assert.match(im.body, new RegExp(`data-variant="${v}"`));
  assert.match(im.body, /Conseillé/);
  assert.match(im.body, /plan\.repos/);
  actions['plan.deplacer'](el({ date: T }));
  const mv = log.modal.pop();
  assert.match(mv.body, /data-to="2026-10-07"/);
});

test('plan.bonus : mini-séance séparée de la séance principale', async () => {
  const { C, actions } = scenario();
  await actions['plan.commencer'](el({ date: T }));
  await actions['plan.bonus'](el({ date: T, tid: 'home_core' }));
  await actions['plan.bonus'](el({ date: T, tid: 'home_core' }));
  const list = C.sessions.forDate(T);
  assert.equal(list.length, 2);
  assert.equal(C.planUI._t.pickMain(list, C.planner.day(T)).templateId, C.planner.day(T).templateId);
});

test('check-list : cocher / décocher (mémoire si pas de stockage)', () => {
  const { C, t } = scenario();
  assert.equal(t.isChecked('2027-05-15', 'hyrox-jour-j', 'billet'), false);
  assert.equal(t.toggleCheck('2027-05-15', 'hyrox-jour-j', 'billet'), true);
  assert.equal(t.isChecked('2027-05-15', 'hyrox-jour-j', 'billet'), true);
  assert.match(C.planUI.checklistHTML('2027-05-15', 'hyrox-jour-j'), /aria-checked="true"/);
  assert.equal(t.toggleCheck('2027-05-15', 'hyrox-jour-j', 'billet'), false);
  assert.equal(C.planUI.checklistHTML('2027-05-15', 'inconnue'), '');
});
