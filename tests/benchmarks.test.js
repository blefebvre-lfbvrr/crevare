'use strict';
// Tests des tests de référence, barèmes pompier et modèles d'objectifs (js/data/benchmarks.js, js/data/goals.js).
// Chargement isolé (util + schema + ces deux fichiers) : ne dépend pas des modules écrits en parallèle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./helpers');

const TODAY = '2026-10-06';
const C = load(['js/core/util.js', 'js/core/legacy-v1.js', 'js/core/schema.js', 'js/data/benchmarks.js', 'js/data/goals.js']);
C.util.setNow(TODAY + 'T09:00:00');
const U = C.util;
const D = C.data;

// Identifiants canoniques lus dans ARCHITECTURE.md (source de vérité du contrat).
const ARCH = fs.readFileSync(path.join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8');
const benchSection = ARCH.split('## Identifiants des tests de référence (benchmarks)')[1] || '';
const CANON_BENCH = [...benchSection.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]);
const exSection = ARCH.split('## Liste canonique des identifiants d\'exercices')[1].split('## Identifiants des tests')[0];
// Exercices connus : liste canonique + bibliothèque complète (les exercices de test dédiés n'y figurent pas tous).
const LIB_EX = (() => { const L = load(['js/core/util.js', 'js/data/exercises.js']); return L.data.exercises.map((e) => e.id); })();
const CANON_EX = new Set([...[...exSection.matchAll(/^- `([a-z0-9_]+)`/gm)].map((m) => m[1]), ...LIB_EX]);

const UNITS = ['time', 'reps', 'm', 'cm', 'kg', 'palier', 'km'];
const GOALS = ['ssa', 'hyrox', 'pompier', 'general'];
const CONF = ['élevée', 'moyenne', 'faible'];
const ME = { birthYear: 2006, sex: 'H' }; // profil de test : 20 ans en 2026, catégorie hommes
const NO_GOALS = { goals: [] };

test('ARCHITECTURE.md : la liste canonique est bien lue', () => {
  assert.ok(CANON_BENCH.length >= 25, `ids lus : ${CANON_BENCH.length}`);
  assert.ok(CANON_BENCH.includes('ssa_entry_test') && CANON_BENCH.includes('ssa_test_v1'));
  assert.ok(CANON_EX.size > 100);
});

test('tous les identifiants canoniques existent, avec une forme valide', () => {
  for (const id of CANON_BENCH) {
    const b = D.getBenchmark(id);
    assert.ok(b, `benchmark manquant : ${id}`);
    assert.equal(b.id, id);
    assert.ok(b.name && typeof b.name === 'string', `${id} : name`);
    assert.ok(UNITS.includes(b.unit), `${id} : unit ${b.unit}`);
    assert.equal(typeof b.lower, 'boolean', `${id} : lower`);
    assert.ok(GOALS.includes(b.goal), `${id} : goal`);
    assert.ok(b.cat, `${id} : cat`);
    assert.ok(typeof b.protocol === 'string' && b.protocol.length > 20, `${id} : protocol`);
    if (b.official) {
      assert.ok(Number.isFinite(b.official.value) && b.official.label, `${id} : official`);
      assert.ok(CONF.includes(b.official.confidence), `${id} : confidence`);
      assert.match(b.official.source, /^https:\/\//, `${id} : source`);
    } else assert.equal(b.official, null, `${id} : official null`);
    if (b.target) assert.ok(Number.isFinite(b.target.value) && b.target.label, `${id} : target`);
    else assert.equal(b.target, null, `${id} : target null`);
    if (b.exId) assert.ok(CANON_EX.has(b.exId), `${id} : exId inconnu ${b.exId}`);
  }
  assert.ok(D.getBenchmark('ssa_test_v1').archived, 'ancien test archivé');
  assert.equal(D.getBenchmark('leger').id, 'luc_leger', 'alias v1');
  assert.equal(D.getBenchmark('nope'), null);
});

test('cohérence official / target selon lower (cible plus exigeante que le seuil)', () => {
  let n = 0;
  for (const b of D.benchmarks) {
    if (!b.official || !b.target) continue;
    n++;
    if (b.lower) assert.ok(b.target.value < b.official.value, `${b.id} : cible ${b.target.value} ≥ seuil ${b.official.value}`);
    else assert.ok(b.target.value > b.official.value, `${b.id} : cible ${b.target.value} ≤ seuil ${b.official.value}`);
  }
  assert.ok(n >= 10, `paires vérifiées : ${n}`);
});

test('SSA : seuils officiels et cibles avec vraie marge', () => {
  const v = (id) => [D.getBenchmark(id).official.value, D.getBenchmark(id).target.value];
  assert.deepEqual(v('ssa_entry_test'), [165, 135]); // 2:45 → 2:15
  assert.deepEqual(v('ssa_tsa_course'), [150, 125]); // 2:30 → 2:05
  assert.deepEqual(v('ssa_tsa_fins'), [270, 235]); // 4:30 → 3:55
  assert.deepEqual(v('apnea_dyn'), [15, 18]); // marge prudente (syncope)
  assert.deepEqual(v('duck_depth'), [2.8, 3]);
  assert.equal(D.getBenchmark('swim_100').target.value, 100);
  // Les cibles par défaut de l'objectif SSA suivent les tests de référence.
  const t = D.goalTemplates.ssa.details.targets;
  assert.deepEqual([t.entry, t.tsa, t.fins], [135, 125, 235]);
});

test('HYROX : repères indicatifs, sans seuil officiel', () => {
  for (const id of ['run_1k', 'run_5k', 'run_10k', 'row_1000', 'skierg_1000', 'wall_balls_100', 'hyrox_sim', 'hyrox_race']) {
    const b = D.getBenchmark(id);
    assert.equal(b.official, null, id);
    assert.ok(b.target && b.target.indicative, `${id} : repère indicatif`);
    assert.match(b.target.label, /indicatif/i, id);
  }
});

test('ageBand : tranches ICP à une date', () => {
  assert.equal(D.ageBand(2006, TODAY), '<29');
  assert.equal(D.ageBand(2006, '2035-01-01'), '<29'); // 29 ans
  assert.equal(D.ageBand(2006, '2036-01-01'), '30-39');
  assert.equal(D.ageBand(1980, TODAY), '40-49');
  assert.equal(D.ageBand(1970, TODAY), '50+');
  assert.equal(D.ageBand(null, TODAY), null);
  assert.equal(D.ageBand(2030, TODAY), null);
});

test('withMargin : +20 % sans jamais perdre de marge, arrondi au pas de mesure', () => {
  assert.equal(D.withMargin(7, false, 'reps'), 9); // 8,4 → 9
  assert.equal(D.withMargin(8, false, 'palier'), 10); // 9,6 → 10 (demi-palier au-dessus)
  assert.equal(D.withMargin(100, false, 'time'), 120);
  assert.equal(D.withMargin(75, true, 'time'), 60);
  assert.equal(D.withMargin(105, true, 'time'), 84);
  assert.equal(D.withMargin(5, false, 'reps'), 6); // pas d'erreur d'arrondi flottant
  assert.equal(D.withMargin(null, false, 'reps'), null);
});

test('targetFor (20 ans, H, barème par défaut) : minimum du barème + 20 %', () => {
  const expected = { chinups: [7, 9], luc_leger: [8, 10], pushups: [13, 16], wall_sit: [100, 120], swim_50: [75, 60] };
  for (const [id, [off, tgt]] of Object.entries(expected)) {
    const r = D.targetFor(id, ME, { ...NO_GOALS, atDate: TODAY });
    assert.equal(r.ageBand, '<29', id);
    assert.equal(r.sex, 'H');
    assert.equal(r.bareme.id, 'sdis91');
    assert.equal(r.official.value, off, `${id} : seuil`);
    assert.equal(r.target.value, tgt, `${id} : cible`);
    const b = D.getBenchmark(id);
    if (b.lower) assert.ok(r.target.value <= off * 0.8 && r.target.value > off * 0.8 - b.step, id);
    else assert.ok(r.target.value >= off * 1.2 && r.target.value < off * 1.2 + b.step, id);
    assert.match(r.official.label, /vérifier/);
    assert.deepEqual(r.assumed, []);
  }
  // Valeur ICP standard renvoyée quand elle est connue.
  assert.equal(D.targetFor('chinups', ME, NO_GOALS).icp.value, 15);
  assert.equal(D.targetFor('pushups', ME, NO_GOALS).icp.value, 20);
  // Pas de seuil de recrutement connu → niveau ICP standard comme cible.
  const plank = D.targetFor('plank', ME, NO_GOALS);
  assert.equal(plank.official, null);
  assert.equal(plank.target.value, 120);
});

test('targetFor : la tranche d\'âge se calcule à la date de candidature de l\'objectif pompier', () => {
  const goals = [{ type: 'pompier', status: 'active', date: '2040-10-01', details: { applyDate: '2040-10-01', bareme: 'sdis91' } }];
  const r = D.targetFor('chinups', ME, { goals });
  assert.equal(r.ageBand, '30-39');
  assert.equal(r.official.value, 6);
  assert.equal(r.target.value, 8); // 7,2 → 8
});

test('targetFor : chaque valeur de chaque barème donne une cible plus exigeante que le seuil', () => {
  let n = 0;
  for (const bar of D.baremes) {
    for (const [benchId, bySex] of Object.entries(bar.values)) {
      const b = D.getBenchmark(benchId);
      assert.ok(b, `${bar.id} : test inconnu ${benchId}`);
      for (const [sex, byBand] of Object.entries(bySex)) {
        assert.ok(['H', 'F'].includes(sex), `${bar.id}.${benchId} : sexe ${sex}`);
        for (const [band, v] of Object.entries(byBand)) {
          assert.ok(D.AGE_BANDS.includes(band), `${bar.id} : tranche ${band}`);
          const birthYear = { '<29': 2006, '30-39': 1991, '40-49': 1981, '50+': 1970 }[band];
          const r = D.targetFor(benchId, { birthYear, sex }, { ...NO_GOALS, bareme: bar.id, atDate: TODAY });
          assert.equal(r.official.value, v, `${bar.id}.${benchId}.${sex}.${band}`);
          assert.ok(b.lower ? r.target.value < v : r.target.value > v, `${bar.id}.${benchId}.${sex}.${band}`);
          n++;
        }
      }
    }
  }
  assert.ok(n > 40, `valeurs vérifiées : ${n}`);
});

test('barèmes : SDIS 91, ICP, SDIS 34 à compléter sans valeur inventée', () => {
  for (const bar of D.baremes) {
    assert.ok(bar.id && bar.label && bar.note, bar.id);
    assert.ok(CONF.includes(bar.confidence), `${bar.id} : confiance`);
    assert.ok('source' in bar && 'date' in bar, `${bar.id} : source/date`);
  }
  assert.ok(D.getBareme('sdis91') && D.getBareme('icp') && D.getBareme('bspp') && D.getBareme('bmpm'));
  const s34 = D.getBareme('sdis34');
  assert.ok(s34.toComplete);
  assert.deepEqual(s34.values, {});
  // Avec le SDIS 34 choisi : cible appuyée sur l'exemple SDIS 91, clairement signalée.
  const goals = [{ type: 'pompier', status: 'active', date: '2029-10-01', details: { department: '34' } }];
  const r = D.targetFor('luc_leger', ME, { goals });
  assert.equal(r.bareme.id, 'sdis34');
  assert.equal(r.bareme.fallback, true);
  assert.equal(r.official.baremeId, 'sdis91');
  assert.match(r.official.label, /en attendant/);
  // Voie réserve BSPP → barème BSPP (pas de test physique connu) → même repli.
  const bspp = D.targetFor('chinups', ME, { goals: [{ type: 'pompier', status: 'active', date: '2029-10-01', details: { path: 'bspp', bareme: '' } }] });
  assert.equal(bspp.bareme.id, 'bspp');
  assert.equal(bspp.official.value, 7);
});

test('targetFor : profil incomplet → hypothèses signalées ; cibles personnelles prioritaires', () => {
  const r = D.targetFor('chinups', {}, NO_GOALS);
  assert.deepEqual(r.assumed.sort(), ['sexe', 'âge'].sort());
  const ssaGoal = { type: 'ssa', status: 'active', details: { targets: { entry: 140 } } };
  assert.equal(D.targetFor('ssa_entry_test', ME, { goals: [ssaGoal] }).target.value, 140);
  assert.equal(D.targetFor('ssa_entry_test', ME, NO_GOALS).target.value, 135);
  const perso = { type: 'custom', status: 'active', name: '10 km < 50', details: { benchId: 'run_10k', targetValue: 3000 } };
  assert.equal(D.targetFor('run_10k', ME, { goals: [perso] }).target.value, 3000);
  const hx = { type: 'hyrox', status: 'active', details: { division: 'doubles', category: 'men' } };
  const race = D.targetFor('hyrox_race', ME, { goals: [hx] });
  assert.equal(race.target.value, 4740);
  assert.ok(race.target.indicative);
  assert.equal(D.targetFor('hyrox_sim', { sex: 'F' }, NO_GOALS).target.value, 7800);
  assert.equal(D.targetFor('inconnu', ME), null);
});

test('formatBench, isBetter, benchStatus', () => {
  assert.equal(D.formatBench('ssa_entry_test', 165), '2:45');
  assert.equal(D.formatBench('luc_leger', 9.5), 'palier 9,5');
  assert.equal(D.formatBench('duck_depth', 2.8), '2,8 m');
  assert.equal(D.formatBench('sit_reach', 26), '26 cm');
  assert.equal(D.formatBench('chinups', null), '—');
  assert.ok(D.isBetter('run_5k', 1400, 1500));
  assert.ok(D.isBetter('chinups', 5, 4));
  const ref = D.targetFor('chinups', ME, NO_GOALS); // seuil 7, cible 9
  assert.equal(D.benchStatus('chinups', 9, ref).level, 'cible');
  assert.equal(D.benchStatus('chinups', 7, ref).level, 'reussi');
  assert.equal(D.benchStatus('chinups', 1, ref).level, 'loin');
  assert.equal(D.benchStatus('ssa_entry_test', 170, D.targetFor('ssa_entry_test', ME, NO_GOALS)).level, 'proche');
  assert.equal(D.benchStatus('chinups', null, ref).level, null);
  assert.equal(D.legerSpeed(8), 12);
  assert.equal(D.legerSpeed(8, '8'), 11.5);
});

/* ───────── Objectifs ───────── */

function checkGoal(g, label) {
  assert.ok(g.id, `${label} : id`);
  assert.ok(C.schema.GOAL_TYPES.includes(g.type), `${label} : type`);
  assert.ok(g.date === null || U.isKey(g.date), `${label} : date`);
  assert.equal(g.status, 'active');
  assert.equal(g.createdAt, TODAY);
  assert.ok([1, 2, 3].includes(g.priority));
  const ids = new Set();
  let prev = '';
  let seenNull = false;
  for (const m of g.milestones) {
    assert.ok(m.id && !ids.has(m.id), `${label} : id de jalon unique`);
    ids.add(m.id);
    assert.ok(m.title && typeof m.title === 'string', `${label} : titre`);
    assert.equal(m.done, false);
    assert.equal(typeof m.note, 'string');
    if (m.due === null) { seenNull = true; continue; }
    assert.ok(U.isKey(m.due), `${label} : échéance ${m.due}`);
    assert.ok(!seenNull, `${label} : jalon daté après un jalon sans date`);
    assert.ok(m.due >= prev, `${label} : jalons non triés (${prev} > ${m.due})`);
    assert.ok(m.due >= TODAY, `${label} : échéance dans le passé ${m.due}`);
    prev = m.due;
  }
}

test('createGoalFromTemplate : dates valides et jalons triés pour chaque modèle', () => {
  assert.deepEqual(D.listGoalTemplates().map((t) => t.id), ['ssa', 'hyrox', 'pompier', 'protection-civile', 'custom']);
  for (const tpl of D.listGoalTemplates()) {
    assert.ok(tpl.name && tpl.icon && tpl.description, tpl.id);
    assert.ok(['ssa', 'hyrox', 'pompier', 'custom'].includes(tpl.type), tpl.id);
    const g = D.createGoalFromTemplate(tpl.id, {}, TODAY);
    checkGoal(g, tpl.id);
    assert.equal(g.details.template, tpl.id);
    // Passe l'assainissement du schéma sans perte.
    const s = C.schema.sanitize({ schemaVersion: 2, goals: [g] });
    assert.equal(s.goals[0].milestones.length, g.milestones.length, `${tpl.id} : jalons conservés`);
    assert.deepEqual(s.goals[0].milestones.map((m) => m.key), g.milestones.map((m) => m.key));
    assert.deepEqual(s.goals[0].details, g.details);
  }
});

test('SSA : fin juin 2027, inscription dans les 2 mois, dates à saisir', () => {
  const g = D.createGoalFromTemplate('ssa', {}, TODAY);
  assert.equal(g.date, '2027-06-30');
  assert.equal(g.priority, 1);
  const m = Object.fromEntries(g.milestones.map((x) => [x.key, x]));
  assert.equal(m.inscription.due, U.addDays(TODAY, 60));
  assert.equal(m['test-entree'].due, null);
  assert.equal(m.tsa.due, null);
  assert.ok(m['mention-littoral'] && m['pse2-fc'] && m['certificat-medical'] && m.attestations && m.formation);
  assert.match(m['test-entree'].note, /2:15/);
  // Dates de stage connues → certificat médical calé ≤ 3 mois avant, TSA daté.
  const g2 = D.createGoalFromTemplate('ssa', { details: { trainingStart: '2027-02-15', tsaDate: '2027-04-10', entryTestDate: '2027-02-15' } }, TODAY);
  const m2 = Object.fromEntries(g2.milestones.map((x) => [x.key, x]));
  assert.equal(m2['certificat-medical'].due, '2027-01-25');
  assert.ok(U.daysBetween(m2['certificat-medical'].due, '2027-02-15') <= 90);
  assert.equal(m2.tsa.due, '2027-04-10');
  checkGoal(g2, 'ssa+dates');
});

test('HYROX : Lyon (samedi 15 mai 2027), Doubles hommes Open, jalons de simulation', () => {
  const g = D.createGoalFromTemplate('hyrox', {}, TODAY);
  assert.equal(g.date, '2027-05-15');
  assert.equal(g.details.raceDate, '2027-05-15');
  assert.equal(g.details.event, 'lyon-2027');
  assert.deepEqual([g.details.division, g.details.category, g.details.level], ['doubles', 'men', 'open']);
  assert.match(g.name, /Lyon/);
  const m = Object.fromEntries(g.milestones.map((x) => [x.key, x]));
  assert.equal(m['simulation-complete'].due, U.addDays('2027-05-15', -21));
  assert.ok(m.billetterie.due < m.inscription.due);
  assert.match(m.billetterie.note, /vérifi/);
  // Course choisie trop proche → prochaine course française à plus de 8 semaines.
  const late = D.createGoalFromTemplate('hyrox', { details: { event: 'nice-2026' } }, TODAY);
  assert.notEqual(late.details.event, 'nice-2026');
  assert.ok(U.daysBetween(TODAY, late.date) >= 56);
  // Date forcée : respectée ; les jalons d'entraînement déjà passés sont omis.
  const soon = D.createGoalFromTemplate('hyrox', { date: '2026-10-20' }, TODAY);
  assert.equal(soon.date, '2026-10-20');
  assert.ok(!soon.milestones.some((x) => x.key === 'simulation-complete'));
  checkGoal(soon, 'hyrox proche');
  // Événements : samedi par défaut, statut de billetterie daté.
  const lyon = D.hyroxEvent('lyon-2027');
  assert.equal(lyon.defaultDay, '2027-05-15');
  assert.ok(lyon.ticketStatus && U.isKey(lyon.checkedAt));
  assert.equal(D.hyroxEvent('paris-gp-2027').start, '2027-04-08');
});

test('Pompier : candidature 1er oct. 2029, tests ICP trimestriels, choix de voie avant mi-2029', () => {
  const g = D.createGoalFromTemplate('pompier', {}, TODAY);
  assert.equal(g.date, '2029-10-01');
  assert.equal(g.details.applyDate, '2029-10-01');
  assert.equal(g.details.path, 'indecis');
  const voie = g.milestones.find((x) => x.key === 'choisir-voie');
  assert.ok(voie.due <= '2029-07-01');
  const icp = g.milestones.filter((x) => x.key.startsWith('test-icp-'));
  assert.ok(icp.length >= 10, `tests ICP : ${icp.length}`);
  for (let i = 1; i < icp.length; i++) assert.equal(U.daysBetween(icp[i - 1].due, icp[i].due), 91);
  assert.ok(icp[icp.length - 1].due <= U.addDays('2029-10-01', -14));
});

test('Protection civile : objectif custom (kind), lié à la date de l\'objectif SSA', () => {
  const ssa = D.createGoalFromTemplate('ssa', {}, TODAY);
  const g = D.createGoalFromTemplate('protection-civile', { details: { city: 'Ville-test' }, goals: [ssa] }, TODAY);
  assert.equal(g.type, 'custom');
  assert.equal(g.details.kind, 'protection-civile');
  assert.equal(g.date, null);
  assert.equal(g.milestones.find((x) => x.key === 'ssa').due, ssa.date);
  assert.match(g.milestones.find((x) => x.key === 'contact-antenne').title, /Ville-test/);
});

test('custom : discipline + test lié, overrides respectés', () => {
  const g = D.createGoalFromTemplate('custom', { name: '10 km sous 50 min', details: { benchId: 'run_10k', targetValue: 3000 }, priority: 1 }, TODAY);
  assert.equal(g.name, '10 km sous 50 min');
  assert.equal(g.priority, 1);
  assert.equal(g.details.benchId, 'run_10k');
  assert.equal(g.date, U.addDays(TODAY, 84));
  assert.equal(D.createGoalFromTemplate('inconnu', {}, TODAY).type, 'custom');
});

test('recomputeMilestones : complète les dates saisies après coup, sans toucher aux jalons faits', () => {
  const g = D.createGoalFromTemplate('ssa', {}, TODAY);
  g.details.tsaDate = '2027-05-20';
  g.milestones.find((x) => x.key === 'inscription').done = true;
  const before = g.milestones.find((x) => x.key === 'inscription').due;
  const ms = D.recomputeMilestones(g, TODAY);
  assert.equal(ms.find((x) => x.key === 'tsa').due, '2027-05-20');
  assert.equal(ms.find((x) => x.key === 'inscription').due, before);
  assert.equal(g.milestones.find((x) => x.key === 'tsa').due, null, 'pas de mutation');
  // Date d'objectif changée + force : les jalons relatifs suivent.
  const h = D.createGoalFromTemplate('hyrox', {}, TODAY);
  h.date = '2027-04-10';
  const ms2 = D.recomputeMilestones(h, TODAY, { force: true });
  assert.equal(ms2.find((x) => x.key === 'simulation-complete').due, U.addDays('2027-04-10', -21));
});

test('hyroxStandards : division × catégorie × niveau, règle Doubles, incertitudes signalées', () => {
  const S = D.hyroxStandards;
  const dm = S.doubles.men.open;
  assert.deepEqual([dm.sledPushKg, dm.sledPullKg, dm.farmersKg, dm.sandbagKg, dm.wallBallKg, dm.wallBallTargetM, dm.wallBallReps], [152, 103, 24, 20, 6, 3, 100]);
  assert.match(dm.label, /Doubles/);
  assert.match(dm.rule, /ensemble/i);
  assert.match(dm.rule, /10 s/);
  assert.equal(dm.stations.length, 8);
  assert.equal(S.solo.men.pro.sledPushKg, 202);
  assert.equal(S.solo.women.open.sledPushKg, 102);
  assert.ok(S.solo.women.open.uncertain.some((t) => /75/.test(t)), 'wall balls femmes Open : incertain');
  assert.ok(S.solo.women.pro.uncertain.length > 0, 'cible femmes Pro : incertaine');
  assert.ok(S.doubles.men.pro.notes.some((t) => /vérifier/.test(t)));
  assert.equal(S.doubles.mixed.open.sledPushKg, 152);
  assert.equal(S.doubles.mixed.pro, null);
  assert.ok(S.relay.mixed.open.perSex.F.sledPushKg === 102 && S.relay.mixed.open.perSex.H.sledPushKg === 152);
  assert.equal(S.solo.mixed.open, null);
  assert.equal(D.hyroxLoads('doubles', 'men', 'open').label, dm.label);
  assert.equal(S.stations.map((s) => s.id).join(','), 'skierg,sled_push,sled_pull,burpee_broad_jump,row,farmers_carry,sandbag_lunge,wall_ball');
  for (const s of S.stations) assert.ok(CANON_EX.has(s.exId), `station ${s.id} : exId ${s.exId}`);
});

test('check-lists : 4 listes, groupes connus, identifiants uniques', () => {
  for (const id of ['hyrox-jour-j', 'ssa-test', 'ssa-tsa', 'pompier-tests']) {
    const list = D.checklists[id];
    assert.ok(Array.isArray(list) && list.length >= 6, id);
    assert.ok(D.checklistMeta[id] && D.checklistMeta[id].title, `${id} : titre`);
    const ids = new Set(list.map((x) => x.id));
    assert.equal(ids.size, list.length, `${id} : ids uniques`);
    for (const it of list) {
      assert.ok(D.CHECKLIST_GROUPS[it.group], `${id}.${it.id} : groupe ${it.group}`);
      assert.ok(it.text.length > 10);
    }
    for (const g of ['papiers', 'materiel', 'reglement']) assert.ok(list.some((x) => x.group === g), `${id} : groupe ${g}`);
  }
});

test('aucune donnée personnelle en dur dans les fichiers de données', () => {
  for (const f of ['js/data/benchmarks.js', 'js/data/goals.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/2006|Fresnes|Val-de-Marne|Montpellier/.test(src), `${f} contient une donnée du profil`);
  }
});
