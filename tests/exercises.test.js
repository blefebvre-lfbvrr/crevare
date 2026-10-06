'use strict';
// Tests de la bibliothèque d'exercices (js/data/exercises.js).
// Le module ne dépend que de C.util au chargement : on le charge seul, sans le reste du cœur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./helpers');

const C = load(['js/core/util.js', 'js/data/exercises.js']);
const D = C.data;
const byId = new Map(D.exercises.map((e) => [e.id, e]));

/* ───────── Contrat lu dans ARCHITECTURE.md ───────── */

const ARCH = fs.readFileSync(path.join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8');

function section(title) {
  const start = ARCH.indexOf(title);
  assert.ok(start >= 0, `section introuvable : ${title}`);
  const next = ARCH.indexOf('\n## ', start + title.length);
  return ARCH.slice(start, next < 0 ? undefined : next);
}

// Lignes « - `id` — nom — track — lieux — impact [— apnea] ». Lecture depuis la fin :
// un nom contenant « — » ne décale pas les colonnes.
function canonicalList() {
  const out = [];
  for (const line of section('## Liste canonique des identifiants d\'exercices').split('\n')) {
    const m = line.match(/^- `([a-z0-9_]+)` — (.+)$/);
    if (!m) continue;
    const parts = m[2].split(' — ').map((s) => s.trim());
    const apnea = parts[parts.length - 1] === 'apnea';
    if (apnea) parts.pop();
    const impact = Number(parts.pop());
    const locs = parts.pop().split('/');
    const track = parts.pop();
    out.push({ id: m[1], name: parts.join(' — '), track, locs, impact, apnea });
  }
  return out;
}
const CANON = canonicalList();

function benchIds() {
  const sec = section('## Identifiants des tests de référence');
  return new Set([...sec.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]));
}

/* ───────── Liste canonique ───────── */

test('la liste canonique est bien lue dans ARCHITECTURE.md', () => {
  assert.ok(CANON.length >= 120, `seulement ${CANON.length} identifiants lus`);
  assert.equal(new Set(CANON.map((c) => c.id)).size, CANON.length, 'doublon dans la liste canonique');
});

test('chaque identifiant canonique existe avec le bon track, lieux, impact et apnea', () => {
  for (const c of CANON) {
    const e = byId.get(c.id);
    assert.ok(e, `exercice manquant : ${c.id}`);
    assert.equal(e.track, c.track, `${c.id} : track`);
    assert.equal(e.impact, c.impact, `${c.id} : impact`);
    assert.equal(e.apnea, c.apnea, `${c.id} : apnea`);
    assert.deepEqual([...e.locs].sort(), [...c.locs].sort(), `${c.id} : lieux`);
  }
});

test('taille de la bibliothèque : 150 à 180 exercices', () => {
  assert.ok(D.exercises.length >= 150 && D.exercises.length <= 180, `${D.exercises.length} exercices`);
});

/* ───────── Forme et cohérence ───────── */

test('identifiants uniques, en snake_case', () => {
  assert.equal(byId.size, D.exercises.length, 'identifiant en double');
  for (const e of D.exercises) assert.match(e.id, /^[a-z0-9]+(_[a-z0-9]+)*$/, e.id);
});

test('énumérations valides', () => {
  for (const e of D.exercises) {
    assert.ok(D.EXERCISE_CATS[e.cat], `${e.id} : cat ${e.cat}`);
    assert.ok(D.TRACKS[e.track], `${e.id} : track ${e.track}`);
    assert.ok([0, 1, 2].includes(e.impact), `${e.id} : impact`);
    assert.ok(e.goals.length && e.goals.every((g) => D.EXERCISE_GOALS.includes(g)), `${e.id} : goals`);
    assert.ok(e.locs.length && e.locs.every((l) => D.EXERCISE_LOCS.includes(l)), `${e.id} : locs`);
    assert.ok(e.stress.every((z) => D.STRESS_ZONES.includes(z)), `${e.id} : stress`);
    for (const it of e.equipment) assert.ok(D.EQUIPMENT[it], `${e.id} : matériel inconnu ${it}`);
  }
});

test('champs du contrat remplis (textes, séries, consignes)', () => {
  for (const e of D.exercises) {
    assert.ok(e.name && e.description, `${e.id} : nom/description`);
    assert.ok(e.short.length <= 22 && !e.short.endsWith('…'), `${e.id} : short trop long (« ${e.short} »)`);
    assert.ok(Number.isInteger(e.defaultSets) && e.defaultSets >= 1, `${e.id} : defaultSets`);
    assert.ok(typeof e.defaultReps === 'string' && e.defaultReps, `${e.id} : defaultReps`);
    assert.ok(Number.isInteger(e.defaultRest) && e.defaultRest >= 0, `${e.id} : defaultRest`);
    assert.ok(e.cues.length >= 2 && e.cues.length <= 4, `${e.id} : ${e.cues.length} consignes`);
    assert.ok(e.mistakes.length >= 1 && e.mistakes.length <= 3, `${e.id} : ${e.mistakes.length} erreurs`);
    for (const k of ['easier', 'harder', 'alt', 'safety', 'muscles', 'stress', 'equipment', 'cues', 'mistakes']) {
      assert.ok(Array.isArray(e[k]), `${e.id} : ${k} doit être un tableau`);
    }
  }
});

test('références easier / harder / alt existantes et jamais circulaires sur soi', () => {
  for (const e of D.exercises) {
    for (const k of ['easier', 'harder', 'alt']) {
      for (const r of e[k]) {
        assert.ok(byId.has(r), `${e.id}.${k} → ${r} inexistant`);
        assert.notEqual(r, e.id, `${e.id}.${k} se référence lui-même`);
      }
    }
  }
});

test('impact 2 → au moins une alternative d’impact < 2', () => {
  for (const e of D.exercises.filter((x) => x.impact === 2)) {
    assert.ok(e.alt.some((a) => byId.get(a).impact < 2), `${e.id} sans alternative à faible impact`);
  }
});

test('genou / cheville sollicités → au moins une alternative, et une sans impact si l’exercice en a', () => {
  for (const e of D.exercises.filter((x) => x.stress.some((z) => z === 'genou' || z === 'cheville'))) {
    assert.ok(e.alt.length, `${e.id} : aucune alternative`);
    if (e.impact >= 1) assert.ok(e.alt.some((a) => byId.get(a).impact === 0), `${e.id} : pas d’alternative sans impact`);
  }
});

test('progressions demandées (tractions, pompes)', () => {
  const chain = (ids) => ids.slice(1).forEach((id, i) => {
    assert.ok(byId.get(ids[i]).harder.includes(id), `${ids[i]}.harder doit contenir ${id}`);
    assert.ok(byId.get(id).easier.includes(ids[i]), `${id}.easier doit contenir ${ids[i]}`);
  });
  chain(['scap_pullup', 'pullup_negative', 'pullup_band', 'pullup_strict']);
  chain(['pushup_incline', 'pushup', 'pushup_cadence']);
  const p = D.progressionChain('pullup_band');
  for (const id of ['scap_pullup', 'pullup_negative', 'pullup_band', 'pullup_strict']) assert.ok(p.includes(id), id);
  assert.ok(p.indexOf('scap_pullup') < p.indexOf('pullup_strict'));
  assert.deepEqual(D.progressionChain('inconnu'), []);
});

/* ───────── Tests de référence ───────── */

test('exercices de test reliés au bon benchmark', () => {
  const expected = {
    test_chinup_max: 'chinups', ssa_entry_test: 'ssa_entry_test', fins_300: 'ssa_tsa_fins', luc_leger: 'luc_leger',
    run_1k_test: 'run_1k', run_5k_test: 'run_5k', sit_and_reach: 'sit_reach', test_wall_sit_max: 'wall_sit',
    test_plank_max: 'plank', test_pushup_max: 'pushups', test_pullup_max: 'pullups', swim_50_test: 'swim_50',
    ssa_tsa_course: 'ssa_tsa_course',
  };
  for (const [id, bench] of Object.entries(expected)) assert.equal(byId.get(id).bench, bench, id);
});

test('tout bench existe dans la liste des tests de référence, et un seul exercice par bench', () => {
  const known = benchIds();
  const seen = new Map();
  for (const e of D.exercises.filter((x) => x.bench)) {
    assert.ok(known.has(e.bench), `${e.id} → bench inconnu ${e.bench}`);
    assert.ok(!seen.has(e.bench), `${e.bench} utilisé par ${seen.get(e.bench)} et ${e.id}`);
    seen.set(e.bench, e.id);
  }
});

/* ───────── Sécurité et contenu ───────── */

test('apnée : consignes de sécurité complètes et remplacement en surface toujours possible', () => {
  const apnea = D.exercises.filter((e) => e.apnea);
  assert.ok(apnea.length >= 8);
  for (const e of apnea) {
    const s = e.safety.join(' ');
    assert.match(s, /accompagné/, `${e.id} : accompagnement`);
    assert.match(s, /hyperventilation/, `${e.id} : hyperventilation`);
    assert.match(s, /2 fois la durée/, `${e.id} : récupération`);
    assert.match(s, /picotements/, `${e.id} : signes d’arrêt`);
    const alt = D.findAlternative(e.id, { noApnea: true });
    assert.ok(alt && !byId.get(alt).apnea, `${e.id} : aucune alternative sans apnée`);
  }
});

test('épreuves SSA décrites avec les valeurs de la recherche et « à confirmer »', () => {
  const entry = byId.get('ssa_entry_test').description;
  assert.match(entry, /2:45/); assert.match(entry, /15 m/); assert.match(entry, /50 m de crawl/); assert.match(entry, /dos/);
  const tsa = byId.get('ssa_tsa_course').description;
  assert.match(tsa, /2:30/); assert.match(tsa, /1,80 à 2,80 m/); assert.match(tsa, /3 s/);
  const fins = byId.get('fins_300').description;
  assert.match(fins, /4:30/); assert.match(fins, /chaussage compris/);
  for (const id of ['ssa_entry_test', 'ssa_tsa_course', 'fins_300']) assert.match(byId.get(id).description, /à confirmer/i, id);
});

test('standards HYROX présents dans les consignes', () => {
  const bbj = byId.get('burpee_broad_jump');
  assert.match(bbj.cues.join(' '), /30 cm/);
  assert.match(bbj.mistakes.join(' '), /no-rep/);
  assert.match(byId.get('wall_ball').cues.join(' '), /sous le genou/);
  assert.match(byId.get('sandbag_lunge').cues.join(' '), /genou arrière touche le sol/);
});

test('aucune donnée personnelle de l’utilisateur écrite en dur', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/data/exercises.js'), 'utf8');
  assert.doesNotMatch(src, /genou gauche|cheville gauche|fresnes|val-de-marne|montpellier|\b2006\b/i);
});

test('la bibliothèque est gelée (pas de modification accidentelle)', () => {
  const e = byId.get('plank');
  assert.ok(Object.isFrozen(D.exercises) && Object.isFrozen(e) && Object.isFrozen(e.cues));
  assert.throws(() => { e.cues.push('x'); });
});

/* ───────── Accès et recherche ───────── */

test('getExercise : bibliothèque, exercices perso, inconnu', () => {
  C.state = { customExercises: [{ id: 'perso:abc', name: 'Gainage chaise', cat: 'gainage', track: 'time', locs: ['maison'] }] };
  assert.equal(D.getExercise('plank').name, 'Planche');
  const p = D.getExercise('perso:abc');
  assert.equal(p.name, 'Gainage chaise');
  assert.equal(p.custom, true);
  assert.deepEqual(p.cues, []);
  assert.equal(D.getExercise('nexistepas'), null);
  assert.equal(D.getExercise(null), null);
  assert.equal(D.exerciseName('v1:inconnu_truc'), 'inconnu truc');
  delete C.state;
  assert.equal(D.getExercise('perso:abc'), null, 'sans état : pas d’exercice perso, sans erreur');
});

test('searchExercises : texte sans accents, pluriels, plusieurs mots', () => {
  const ids = (o) => D.searchExercises(o).map((e) => e.id);
  assert.ok(ids({ q: 'echauffement' }).includes('swim_warmup'));
  assert.ok(ids({ q: 'ÉCHAUFFEMENT' }).includes('run_warmup'));
  assert.ok(ids({ q: 'retropedalage' }).includes('swim_eggbeater'));
  const tr = D.searchExercises({ q: 'tractions' });
  assert.ok(tr.some((e) => e.id === 'pullup_strict') && tr.some((e) => e.id === 'chinup_strict'));
  assert.match(C.util.normalize(tr[0].name), /traction/, 'les correspondances dans le nom passent en premier');
  const both = ids({ q: 'planche latérale' });
  assert.equal(both[0], 'side_plank');
  assert.ok(ids({ q: 'fessiers' }).includes('glute_bridge'), 'recherche sur les muscles');
  assert.ok(ids({ q: "d'eau" }).length > 0, 'apostrophe droite tolérée');
  assert.deepEqual(ids({ q: 'zzzzzz' }), []);
});

test('searchExercises : filtres', () => {
  const all = D.searchExercises();
  assert.equal(all.length, D.exercises.length);
  for (const e of D.searchExercises({ cat: 'gainage' })) assert.equal(e.cat, 'gainage');
  for (const e of D.searchExercises({ goal: 'ssa', loc: 'piscine' })) assert.ok(e.goals.includes('ssa') && e.locs.includes('piscine'));
  const low = D.searchExercises({ lowImpact: true });
  assert.ok(low.length && low.every((e) => e.impact < 2));
  assert.ok(!low.some((e) => e.id === 'burpee_broad_jump'));
  for (const e of D.searchExercises({ equipment: 'palmes' })) assert.ok(e.equipment.includes('palmes'));
  const home = D.searchExercises({ available: ['barre'] }).map((e) => e.id);
  assert.ok(home.includes('pullup_strict') && home.includes('squat_bw') && home.includes('pushup_incline'));
  assert.ok(!home.includes('pullup_band'), 'élastiques non disponibles');
  const gym = D.searchExercises({ loc: 'salle', cat: 'gainage' }).map((e) => e.id);
  assert.ok(gym.includes('plank') && gym.includes('pallof_press'), 'gainage maison faisable en salle');
  assert.ok(!gym.includes('spanish_squat'));
  assert.ok(!D.searchExercises({ loc: 'salle', strictLoc: true }).some((e) => e.id === 'plank'));
  const multi = D.searchExercises({ cat: ['gainage', 'mobilite'] });
  assert.ok(multi.every((e) => e.cat === 'gainage' || e.cat === 'mobilite'));
});

test('searchExercises : exercices perso inclus en premier, désactivables', () => {
  C.state = { customExercises: [{ id: 'perso:x', name: 'Traction australienne', cat: 'force', track: 'reps' }] };
  assert.equal(D.searchExercises({ q: 'traction' })[0].id, 'perso:x', 'à pertinence égale, le perso passe devant');
  assert.ok(D.searchExercises({ q: 'australienne' }).some((e) => e.id === 'perso:x'));
  assert.equal(D.searchExercises({ cat: 'force' })[0].id, 'perso:x');
  assert.ok(!D.searchExercises({ includeCustom: false }).some((e) => e.id === 'perso:x'));
  delete C.state;
});

/* ───────── Alternatives, exercices perso, circuits ───────── */

test('findAlternative : impact, zones à éviter, apnée, matériel', () => {
  assert.equal(D.findAlternative('burpee_broad_jump', { maxImpact: 1, avoid: ['genou'] }), 'burpee_step_back');
  assert.equal(D.findAlternative('run_easy', { maxImpact: 0 }), 'bike_easy');
  assert.equal(D.findAlternative('apnea_dynamic', { noApnea: true }), 'swim_crawl_easy');
  assert.equal(D.findAlternative('skierg', { available: ['barre', 'elastiques'] }), 'band_straight_arm_pulldown');
  assert.equal(D.findAlternative('inconnu'), null);
  for (const e of D.exercises.filter((x) => x.impact === 2)) {
    assert.ok(D.findAlternative(e.id, { maxImpact: 1 }), `${e.id} : aucun remplacement d’impact ≤ 1`);
  }
});

test('makeCustomExercise : id perso, valeurs assainies, copie non gelée', () => {
  const x = D.makeCustomExercise({ name: 'Mon gainage avec un nom beaucoup trop long', cat: 'nimporte', track: 'zzz', impact: 7, goals: ['ssa', 'xx'], bench: 'plank' });
  assert.ok(x.id.startsWith(D.CUSTOM_PREFIX));
  assert.equal(x.cat, 'force');
  assert.equal(x.track, 'reps');
  assert.equal(x.impact, 0);
  assert.deepEqual(x.goals, ['ssa']);
  assert.ok(x.short.length <= 22);
  assert.equal(x.bench, undefined);
  const copy = D.makeCustomExercise({ ...D.getExercise('plank'), id: undefined });
  assert.ok(!Object.isFrozen(copy.cues));
  copy.cues.push('ok');
  assert.equal(D.getExercise('plank').cues.length + 1, copy.cues.length);
});

test('circuits d’abdos : séquences valides pour le chrono, avec voix', () => {
  assert.ok(D.absCircuits.length >= 3);
  for (const c of D.absCircuits) {
    const spec = D.circuitSpec(c.id);
    assert.ok(spec, c.id);
    assert.equal(spec.voice, true);
    assert.ok(spec.steps.every((s) => s.label && s.sec > 0 && (s.kind === 'work' || s.kind === 'rest')));
    assert.equal(spec.steps[0].kind, 'work');
    assert.equal(spec.steps[spec.steps.length - 1].kind, 'work');
    for (const it of c.items) assert.ok(byId.has(it.exId), `${c.id} → ${it.exId}`);
    assert.ok(c.minutes >= 3 && c.minutes <= 30, `${c.id} : ${c.minutes} min`);
  }
  const s = D.circuitSpec(['side_plank', 'crunch'], { workSec: 30, restSec: 15 });
  assert.deepEqual(s.steps.map((x) => x.label), ['Planche latérale, côté gauche', 'Change de côté', 'Planche latérale, côté droit', 'Repos', 'Crunch']);
  assert.equal(D.circuitDuration({ prepSec: 10, rounds: 2, restBetweenRoundsSec: 60, steps: [{ sec: 30 }, { sec: 10 }] }), 10 + 80 + 60);
  assert.equal(D.circuitSpec('inconnu'), null);
  assert.equal(D.circuitSpec(['nexiste_pas']), null);
});

test('C.data est complété sans écraser les autres modules de données', () => {
  delete globalThis.Crevare;
  globalThis.Crevare = { data: { benchmarks: ['déjà là'] } };
  const C2 = load(['js/core/util.js', 'js/data/exercises.js'], { fresh: false });
  assert.deepEqual(C2.data.benchmarks, ['déjà là']);
  assert.equal(typeof C2.data.getExercise, 'function');
});
