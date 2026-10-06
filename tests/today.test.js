'use strict';
// Tests de l'écran « Aujourd'hui » (js/ui/today.js) : fonctions pures (check-in, feu, bonus, rattrapage)
// et rendu de la vue avec le vrai planificateur ; les cartes des autres modules sont facultatives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadCore } = require('./helpers');

const T = '2026-10-06'; // mardi

function scenario(mutate, opts = {}) {
  const C = loadCore(opts.today || T, (s) => {
    s.profile.onboarded = true;
    s.profile.firstName = 'Léo';
    s.profile.sessionsPerWeek = 3;
    s.profile.availableDays = [1, 3, 5];
    s.profile.injuries = [{ id: 'g', zone: 'genou', side: 'gauche', active: true }, { id: 'c', zone: 'cheville', side: 'gauche', active: true }];
    s.profile.pools = [{ id: 'p25', name: 'Piscine 25 m', length: 25 }];
    s.plan.startDate = T;
    s.goals = [
      { id: 'hyrox', type: 'hyrox', name: 'HYROX Lyon — Doubles', date: '2027-05-15', priority: 2, status: 'active', details: { raceDate: '2027-05-15', division: 'doubles', category: 'men', level: 'open' }, milestones: [] },
      { id: 'ssa', type: 'ssa', name: 'SSA', date: '2027-06-30', priority: 1, status: 'active', details: { entryTestDate: '2027-02-15' }, milestones: [] },
    ];
    if (mutate) mutate(s);
  });
  load(['js/ui/components.js', 'js/ui/plan.js', 'js/ui/today.js'], { fresh: false });
  if (C.planner && C.planner.clearCache) C.planner.clearCache();
  const routes = {}, actions = {};
  C.route = (p, v, o) => { routes[p] = { v, o }; };
  C.action = (n, f) => { actions[n] = f; };
  C.onChange = C.onInput = C.onSubmit = () => {};
  C.menuItem = () => {};
  C.go = () => {};
  C.rerender = () => {};
  C.ui.toast = () => {}; // store.update → save() interne → toast si pas de localStorage (Node)
  for (const fn of C.bootHooks || []) fn();
  return { C, routes, actions, t: C.todayUI._t, html: () => C.todayUI.view().html };
}

/* ───────── Fonctions pures ───────── */

test('checkinStatus : rien, commencé, fait', () => {
  const { t } = scenario();
  assert.equal(t.checkinStatus(undefined), 'none');
  assert.equal(t.checkinStatus({}), 'none');
  assert.equal(t.checkinStatus({ sleep: 3 }), 'partial');
  assert.equal(t.checkinStatus({ pain: { genou: 2 } }), 'partial');
  assert.equal(t.checkinStatus({ note: 'nuit coupée' }), 'partial');
  assert.equal(t.checkinStatus({ sleep: 3, energy: 4, soreness: 2 }), 'done');
});

test('checkinMode : replié par défaut, ouvert si commencé, masqué une fois fait', () => {
  const { t } = scenario();
  assert.equal(t.checkinMode('none', null, false), 'closed');
  assert.equal(t.checkinMode('partial', null, false), 'open');
  assert.equal(t.checkinMode('done', null, false), 'hidden');
  assert.equal(t.checkinMode('done', null, true), 'open', 'saisie en cours : reste ouvert');
  assert.equal(t.checkinMode('none', 'open', false), 'open');
  assert.equal(t.checkinMode('done', 'open', false), 'open');
  assert.equal(t.checkinMode('partial', 'closed', true), 'closed');
  assert.equal(t.checkinMode('done', 'closed', false), 'hidden');
});

test('greeting, stripOption, legInjury', () => {
  const { t } = scenario();
  assert.equal(t.greeting('Léo'), 'Salut Léo');
  assert.equal(t.greeting('  '), 'Aujourd\'hui');
  assert.equal(t.greeting(null), 'Aujourd\'hui');
  assert.equal(t.stripOption('Repos. En option : Maison — Abdos (15 min).'), 'Repos.');
  assert.equal(t.stripOption('Repos : veille de la course (HYROX).'), 'Repos : veille de la course (HYROX).');
  assert.equal(t.stripOption(undefined), '');
  assert.equal(t.legInjury({ injuries: [{ zone: 'cheville', active: true }] }), true);
  assert.equal(t.legInjury({ injuries: [{ zone: 'cheville', active: false }] }), false);
  assert.equal(t.legInjury({ injuries: [{ zone: 'epaule', active: true }] }), false);
  assert.equal(t.legInjury({}), false);
});

test('softFrom : douleur notée après une séance → prudence jusqu\'à la date indiquée', () => {
  const { t } = scenario();
  const sessions = {
    a: { id: 'a', date: '2026-10-04', status: 'done', softUntil: '2026-10-07' },
    b: { id: 'b', date: '2026-10-01', status: 'done', softUntil: '2026-10-04' },
    c: { id: 'c', date: '2026-10-05', status: 'in_progress', softUntil: '2026-10-08' },
  };
  assert.deepEqual(t.softFrom(sessions, T), { from: '2026-10-04', until: '2026-10-07' });
  assert.equal(t.softFrom(sessions, '2026-10-08'), null);
  assert.equal(t.softFrom({}, T), null);
});

test('advice : la suggestion la plus prudente gagne', () => {
  const { t } = scenario();
  assert.equal(t.advice(null, null), null);
  assert.equal(t.advice({ level: null, reasons: [], suggestion: 'normal' }, null), null);
  const vert = t.advice({ level: 'vert', reasons: [], suggestion: 'normal' }, null);
  assert.equal(vert.suggestion, 'normal');
  assert.equal(vert.title, 'Feu vert');
  const soft = t.advice({ level: 'orange', reasons: ['Nuit difficile'], suggestion: 'allege' }, { from: '2026-10-04', until: '2026-10-07' });
  assert.equal(soft.suggestion, 'doux');
  assert.equal(soft.reasons.length, 2);
  const onlySoft = t.advice(null, { from: '2026-10-04', until: '2026-10-07' });
  assert.equal(onlySoft.level, 'orange');
  assert.equal(onlySoft.suggestion, 'doux');
  const repos = t.advice({ level: 'rouge', reasons: [], suggestion: 'repos' }, { from: '2026-10-04', until: '2026-10-07' });
  assert.equal(repos.suggestion, 'repos', 'le repos reste plus prudent que la version douce');
});

test('bonusItems : bonus du plan les jours de repos + minuteurs sans doublon', () => {
  const { t } = scenario();
  const rest = { kind: 'rest', bonus: ['home_rehab', 'home_core'] };
  assert.deepEqual(t.bonusItems(rest, { timer: true, leg: true }).map((x) => x.tid || x.preset), ['home_rehab', 'home_core']);
  assert.deepEqual(t.bonusItems({ kind: 'rest', bonus: ['home_core'] }, { timer: true, leg: true }).map((x) => x.tid || x.preset), ['home_core', 'rehab']);
  assert.deepEqual(t.bonusItems({ kind: 'session', bonus: [] }, { timer: true, leg: false }).map((x) => x.preset), ['abdos10']);
  assert.deepEqual(t.bonusItems({ kind: 'session', bonus: ['home_core'] }, { timer: false }), [], 'les bonus du plan ne valent que les jours de repos');
  assert.deepEqual(t.bonusItems(null, {}), []);
});

test('canCatchUp : séance manquée hier, repos libre aujourd\'hui', () => {
  const { t } = scenario();
  assert.equal(t.canCatchUp({ key: 'manque' }, { kind: 'rest', blocked: null }, false), true);
  assert.equal(t.canCatchUp({ key: 'manque' }, { kind: 'rest', blocked: 'veille' }, false), false);
  assert.equal(t.canCatchUp({ key: 'manque' }, { kind: 'session' }, false), false);
  assert.equal(t.canCatchUp({ key: 'fait' }, { kind: 'rest' }, false), false);
  assert.equal(t.canCatchUp({ key: 'manque' }, { kind: 'rest' }, true), false);
  assert.equal(t.canCatchUp(null, { kind: 'rest' }, false), false);
});

/* ───────── Vue ───────── */

test('route #/ enregistrée (onglet Aujourd\'hui) et vue de base', () => {
  const { routes, html, C } = scenario();
  assert.ok(routes['#/']);
  assert.equal(routes['#/'].o.tab, '#/');
  const h = html();
  assert.match(h, /Mardi 6 oct\./);
  assert.match(h, /Salut Léo/);
  assert.match(h, /Reprise en douceur · semaine 1/);
  const dp = C.planner.day(T);
  assert.equal(dp.kind, 'session', 'scénario : séance prévue aujourd\'hui');
  assert.match(h, /data-action="plan.commencer" data-date="2026-10-06"/);
  assert.match(h, /Pas en forme \/ imprévu \?/);
  assert.match(h, /href="#\/jour\/2026-10-06"/);
  assert.match(h, /class="tdy-strip"/);
  assert.equal((h.match(/class="tdy-sd /g) || []).length, 7);
  assert.match(h, /href="#\/progres"/);
});

test('check-in : ligne repliée si rien, carte si commencé, feu dans la carte séance une fois fait', () => {
  const s1 = scenario();
  s1.C.bodyUI = { checkinCard: () => '<section class="card">CHECKIN</section>' };
  let h = s1.html();
  assert.match(h, /tdy-ci-row/);
  assert.doesNotMatch(h, /CHECKIN/);
  s1.actions['today.checkin']({ dataset: { date: T } });
  assert.match(s1.html(), /CHECKIN/);

  const s2 = scenario((s) => { s.checkins[T] = { sleep: 2 }; });
  s2.C.bodyUI = { checkinCard: () => '<section class="card">CHECKIN</section>' };
  assert.match(s2.html(), /CHECKIN/, 'commencé : déplié');

  const s3 = scenario((s) => { s.checkins[T] = { sleep: 1, energy: 2, soreness: 4, pain: {} }; });
  s3.C.bodyUI = { checkinCard: () => '<section class="card">CHECKIN</section>' };
  h = s3.html();
  assert.doesNotMatch(h, /CHECKIN/, 'fait : la carte disparaît');
  assert.doesNotMatch(h, /tdy-ci-row/);
  if (s3.C.metrics && s3.C.metrics.readiness) {
    assert.match(h, /tdy-ready lvl-(orange|rouge)/);
    assert.match(h, /data-action="plan.(version|repos)"/);
  }
});

test('feu : douleur récente → version douce proposée, même sans check-in', () => {
  const { html } = scenario((s) => {
    s.sessions.old = { id: 'old', date: '2026-10-05', status: 'done', softUntil: '2026-10-08', title: 'Course', loc: 'dehors', exercises: [], log: {}, pain: { genou: 5 } };
  });
  const h = html();
  assert.match(h, /version douce conseillée/);
  assert.match(h, /data-action="plan.version" data-date="2026-10-06" data-variant="doux"/);
  assert.match(h, /data-recommend="doux"/);
});

test('séance commencée : Reprendre et progression ; séance faite : Voir', () => {
  const s1 = scenario();
  const id = s1.C.sessions.create(T, { templateId: s1.C.planner.day(T).templateId });
  const key = s1.C.sessions.get(id).exercises[0].key;
  s1.C.sessions.patchSet(id, key, 0, { done: true });
  let h = s1.html();
  assert.match(h, />Reprendre</);
  assert.match(h, /1\/\d+ séries notées/);
  assert.doesNotMatch(h, /plan\.imprevu/, 'séance commencée : plus de « imprévu »');
  s1.C.sessions.patch(id, { status: 'done', durationMin: 52, rpe: 6 });
  h = s1.html();
  assert.match(h, /Séance faite · 52 min · effort 6\/10/);
  assert.match(h, new RegExp(`href="#/seance/${id}"`));
});

test('jour de repos : message, bonus, rattrapage de la séance manquée hier', () => {
  // Mercredi 7 : repos (bonus) ; mardi 6 : séance non faite
  const { html, C } = scenario(null, { today: '2026-10-07' });
  C.timer = { open() {}, getPreset: () => ({}) };
  const dp = C.planner.day('2026-10-07');
  assert.equal(dp.kind, 'rest');
  const h = html();
  assert.match(h, /tdy-rest/);
  assert.match(h, /Bonus facultatif/);
  assert.match(h, /data-action="plan.deplacer-vers" data-date="2026-10-06" data-to="2026-10-07"/);
  assert.match(h, /Faire quand même une séance/);
  if ((dp.bonus || []).length) assert.match(h, /data-action="plan.bonus"/);
});

test('jour J et veille : check-list affichée', () => {
  const eve = scenario(null, { today: '2027-05-14' });
  assert.match(eve.html(), /Demain : HYROX Lyon — Doubles/);
  const race = scenario(null, { today: '2027-05-15' });
  const h = race.html();
  assert.match(h, /tdy-event/);
  assert.match(h, /Noter mon résultat/);
  assert.match(h, /pln-cl-item/);
});

test('cartes des autres modules : affichées si présentes, omises si absentes ou en erreur', () => {
  const { C, html } = scenario();
  C.agendaUI = { todayCard: (d) => `<section id="AGENDA-${d}"></section>` };
  C.habitsUI = { todayCard: () => { throw new Error('boum'); } };
  C.bodyUI = { todayCard: () => '<section id="BODY"></section>' };
  C.goalsUI = { countdownCard: () => '<section id="GOALS"></section>' };
  C.backupUI = { reminderCard: () => 42 }; // pas une chaîne : ignoré
  const errors = console.error;
  console.error = () => {};
  let h;
  try { h = html(); } finally { console.error = errors; }
  assert.match(h, /AGENDA-2026-10-06/);
  assert.match(h, /id="BODY"/);
  assert.match(h, /id="GOALS"/);
  assert.doesNotMatch(h, /42/);
  assert.match(h, /tdy-sess/, 'la séance du jour reste affichée');
  // Ordre : séance, agenda, habitudes, poids, objectifs, semaine
  assert.ok(h.indexOf('tdy-sess') < h.indexOf('AGENDA') && h.indexOf('AGENDA') < h.indexOf('BODY') && h.indexOf('GOALS') < h.indexOf('tdy-week'));
});

test('sans planificateur : la vue s\'affiche quand même', () => {
  const { C, html } = scenario();
  C.planner = undefined;
  const h = html();
  assert.match(h, /Salut Léo/);
  assert.match(h, /Le plan n&#39;est pas disponible|Le plan n'est pas disponible/);
});

test('échappement : prénom et titres venant des données', () => {
  const { html } = scenario((s) => {
    s.profile.firstName = '<img src=x onerror=alert(1)>';
    s.customSessions = [{ id: 'cs1', name: '<script>x</script>', loc: 'maison', exercises: [] }];
    s.plan.overrides[T] = { customSessionId: 'cs1' };
  });
  const h = html();
  assert.doesNotMatch(h, /<img src=x/);
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /&lt;script&gt;x/);
});

test('today.bonus / today.checkin-replier : état de l\'écran', () => {
  const { C, actions, html } = scenario();
  C.timer = { open() {}, getPreset: () => ({}) };
  C.bodyUI = { checkinCard: () => '<section>CHECKIN</section>' };
  assert.doesNotMatch(html(), /tdy-bonus-list/, 'bonus replié les jours de séance');
  actions['today.bonus']({ dataset: { date: T }, getAttribute: () => 'false' });
  assert.match(html(), /tdy-bonus-list/);
  assert.match(html(), /data-preset="abdos10"/);
  assert.match(html(), /data-preset="rehab"/, 'blessure genou/cheville : réhab proposée');
  actions['today.checkin']({ dataset: { date: T } });
  assert.match(html(), /CHECKIN/);
  actions['today.checkin-replier']({ dataset: { date: T } });
  assert.doesNotMatch(html(), /CHECKIN/);
});
