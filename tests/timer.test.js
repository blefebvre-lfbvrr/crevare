// Tests du module chronomètres/minuteurs (js/ui/timer.js) et de la couche son (js/platform/audio.js).
// Lancer : node --test tests/timer.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');

const C = load(['js/core/util.js', 'js/platform/audio.js', 'js/ui/timer.js']);
const E = C.timer.engine;
const S = C.timer.split;
const L = C.timer.leger;
const T = C.timer.tests;

const T0 = 1_800_000_000_000; // instant de départ arbitraire (ms)
const at = (sec) => T0 + Math.round(sec * 1000);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// Interroge le moteur toutes les 100 ms de `from` à `to` (s) et renvoie tous les événements.
function pollRange(run, from, to, opts = {}) {
  const out = [];
  for (let t = from; t <= to + 1e-9; t = Math.round((t + 0.1) * 10) / 10) {
    for (const ev of E.poll(run, at(t), opts)) out.push({ ...ev, t });
  }
  return out;
}

const circuit = {
  name: 'Circuit', prepSec: 10, rounds: 3, restBetweenRoundsSec: 60,
  steps: [{ label: 'Planche', sec: 30, kind: 'work' }, { label: 'Repos', sec: 10, kind: 'rest' }],
};

/* ───────── Séquence ───────── */

test('séquence : préparation + tours, le repos entre tours remplace le repos de fin de tour', () => {
  const segs = E.buildSegments(circuit);
  assert.deepEqual(segs.map((s) => `${s.kind}:${s.sec}`), ['prep:10', 'work:30', 'rest:60', 'work:30', 'rest:60', 'work:30']);
  assert.equal(segs[2].label, 'Repos entre les tours');
  assert.equal(E.totalOf(circuit), 220);
  assert.deepEqual(segs.map((s) => s.start), [0, 10, 40, 100, 130, 190]);
});

test('séquence : sans repos entre tours, seul le repos final est retiré (Tabata = 8 × 20/10)', () => {
  const tabata = C.timer.getPreset('tabata');
  const segs = E.buildSegments(tabata);
  assert.equal(segs.filter((s) => s.kind === 'work').length, 8);
  assert.equal(segs.filter((s) => s.kind === 'rest').length, 7);
  assert.equal(E.totalOf(tabata), 10 + 8 * 30 - 10);
});

test('séquence : {tour} remplacé, étapes invalides ignorées, séquence sans effort = vide', () => {
  const segs = E.buildSegments({ rounds: 2, steps: [{ label: 'Minute {tour}', sec: 60 }, { label: 'x', sec: 0 }, { label: 'y', sec: 'abc' }] });
  assert.deepEqual(segs.map((s) => s.label), ['Minute 1', 'Minute 2']);
  assert.deepEqual(E.buildSegments({ steps: [{ label: 'Repos', sec: 30, kind: 'rest' }] }), []);
  assert.deepEqual(E.buildSegments(null), []);
  assert.equal(E.createRun({ steps: [] }).total, 0);
});

test('préréglages : durées attendues, voix seulement pour abdos et gainage', () => {
  const p = (id) => C.timer.getPreset(id);
  assert.equal(E.totalOf(p('abdos10')), 605); // ≈ 10 min
  assert.equal(E.totalOf(p('emom10')), 610);
  assert.equal(E.totalOf(p('i3030')), 10 + 10 * 60 - 30);
  for (const preset of C.timer.presets) {
    assert.equal(preset.voice, preset.id === 'abdos10' || preset.id === 'gainage6', preset.id);
    assert.ok(E.buildSegments(preset).length > 0, preset.id);
  }
});

/* ───────── Étape courante à un instant donné ───────── */

test('étape courante à t donné (frontières, tours, fin)', () => {
  const run = E.start(E.createRun(circuit), T0);
  const snap = (t) => E.snapshot(run, at(t));
  assert.equal(snap(0).seg.kind, 'prep');
  assert.equal(snap(0).remaining, 10);
  assert.equal(snap(9.9).seg.kind, 'prep');
  let s = snap(10);
  assert.equal(s.seg.label, 'Planche');
  assert.equal(s.round, 1);
  close(s.remaining, 30);
  s = snap(39.5);
  assert.equal(s.seg.label, 'Planche');
  close(s.remaining, 0.5);
  s = snap(40);
  assert.equal(s.seg.label, 'Repos entre les tours');
  assert.equal(s.nextWork.label, 'Planche');
  s = snap(100);
  assert.equal(s.seg.label, 'Planche');
  assert.equal(s.round, 2);
  assert.equal(snap(219).round, 3);
  s = snap(500);
  assert.equal(s.done, true);
  assert.equal(s.remaining, 0);
  assert.equal(s.t, 220);
  assert.equal(E.positionText(run, snap(100).seg), 'Tour 2/3');
  assert.equal(E.positionText(run, snap(0).seg), '3 tours');
  assert.equal(E.positionText(run, snap(40).seg), 'Tour 1/3');
});

test('pause et reprise : le temps en pause ne compte pas', () => {
  const run = E.start(E.createRun(circuit), T0);
  E.pause(run, at(15));
  assert.equal(E.isPaused(run), true);
  assert.equal(E.elapsed(run, at(80)), 15); // figé pendant la pause
  E.resume(run, at(75));
  assert.equal(E.isPaused(run), false);
  close(E.elapsed(run, at(80)), 20);
  E.pause(run, at(90));
  E.resume(run, at(100));
  close(E.elapsed(run, at(110)), 40); // 110 s − 60 s − 10 s de pause
  assert.equal(E.snapshot(run, at(105)).seg.label, 'Planche');
  assert.equal(E.snapshot(run, at(110)).seg.label, 'Repos entre les tours');
});

test('suivant, précédent et +10 s', () => {
  const run = E.start(E.createRun(circuit), T0);
  E.next(run, at(3)); // saute la préparation
  close(E.elapsed(run, at(3)), 10);
  assert.equal(E.snapshot(run, at(3)).seg.label, 'Planche');
  E.prev(run, at(4)); // moins de 2 s dans l'étape → étape précédente
  close(E.elapsed(run, at(4)), 0);
  E.next(run, at(4));
  E.prev(run, at(10)); // 6 s dans l'étape → début de l'étape en cours
  close(E.elapsed(run, at(10)), 10);
  E.addTime(run, at(10), 10);
  const s = E.snapshot(run, at(10));
  close(s.remaining, 40);
  assert.equal(run.total, 230);
  assert.equal(E.snapshot(run, at(50)).seg.label, 'Repos entre les tours');
  E.next(run, at(50)); E.next(run, at(50)); E.next(run, at(50)); E.next(run, at(50)); E.next(run, at(50));
  assert.equal(E.snapshot(run, at(50)).done, true);
});

/* ───────── Événements ───────── */

test('événements : début, fin d’étape, décompte 3-2-1 sans voix, fin — chacun une seule fois', () => {
  const run = E.start(E.createRun(circuit), T0);
  const evs = pollRange(run, 0, 230);
  const starts = evs.filter((e) => e.type === 'start');
  assert.deepEqual(starts.map((e) => e.seg.kind), ['prep', 'work', 'rest', 'work', 'rest', 'work']);
  assert.equal(starts[0].first, true);
  assert.equal(evs.filter((e) => e.type === 'end').length, 5);
  assert.equal(evs.filter((e) => e.type === 'finish').length, 1);
  const counts = evs.filter((e) => e.type === 'count');
  // Préparation 10 s, 3 efforts de 30 s, 2 repos de 60 s : 3, 2, 1 pour chacun.
  assert.equal(counts.length, 6 * 3);
  const firstWork = counts.filter((e) => e.i === 1);
  assert.deepEqual(firstWork.map((e) => e.n), [3, 2, 1]);
  assert.deepEqual(firstWork.map((e) => e.t), [37, 38, 39]);
  // Plus rien après la fin.
  assert.equal(E.poll(run, at(400)).length, 0);
});

test('décompte vocal 5→1 pour les étapes ≥ 15 s, 3→1 entre 8 et 14 s, rien en dessous', () => {
  assert.equal(E.countFrom(45, true), 5);
  assert.equal(E.countFrom(10, true), 3);
  assert.equal(E.countFrom(5, true), 0);
  assert.equal(E.countFrom(45, false), 3);
  assert.equal(E.countFrom(5, false), 0);
  const run = E.start(E.createRun({ steps: [{ label: 'Planche', sec: 45, kind: 'work' }] }), T0);
  const counts = pollRange(run, 0, 50, { voice: true }).filter((e) => e.type === 'count');
  assert.deepEqual(counts.map((e) => e.n), [5, 4, 3, 2, 1]);
  assert.deepEqual(counts.map((e) => e.t), [40, 41, 42, 43, 44]);
});

test('décompte : sondages répétés dans la même seconde → un seul déclenchement', () => {
  const run = E.start(E.createRun({ steps: [{ label: 'A', sec: 20 }] }), T0);
  E.poll(run, at(0));
  let n = 0;
  for (let k = 0; k < 50; k++) n += E.poll(run, at(17.01 + k * 0.01)).filter((e) => e.type === 'count').length;
  assert.equal(n, 1);
});

test('retour après verrouillage : les annonces dépassées ne sont pas rejouées', () => {
  const run = E.start(E.createRun(circuit), T0);
  E.poll(run, at(0));
  const late = E.poll(run, at(75)); // au milieu du 1er repos entre tours
  assert.equal(late.filter((e) => e.type === 'start').length, 0);
  assert.equal(late.filter((e) => e.type === 'end').length, 0);
  assert.equal(late.filter((e) => e.type === 'count').length, 0);
  // Le décompte de ce repos se fait quand même à la fin.
  const counts = pollRange(run, 75.1, 100).filter((e) => e.type === 'count');
  assert.deepEqual(counts.map((e) => e.n), [3, 2, 1]);
  // Retour bien après la fin : un seul événement « fin », marqué en retard.
  const end = E.poll(run, at(1000));
  assert.deepEqual(end.map((e) => e.type), ['finish']);
  assert.equal(end[0].late, true);
});

test('+10 s pendant le décompte : le décompte se refait', () => {
  const run = E.start(E.createRun({ steps: [{ label: 'A', sec: 20 }, { label: 'B', sec: 20 }] }), T0);
  const first = pollRange(run, 0, 18.5).filter((e) => e.type === 'count');
  assert.deepEqual(first.map((e) => e.n), [3, 2]);
  E.addTime(run, at(18.5), 10);
  const again = pollRange(run, 18.6, 30).filter((e) => e.type === 'count' && e.i === 0);
  assert.deepEqual(again.map((e) => e.n), [3, 2, 1]);
});

test('saut manuel : début annoncé (manuel), pas d’événement de fin', () => {
  const run = E.start(E.createRun(circuit), T0);
  E.poll(run, at(0));
  E.next(run, at(2));
  const evs = E.poll(run, at(2));
  assert.deepEqual(evs.map((e) => e.type), ['start']);
  assert.equal(evs[0].manual, true);
  assert.equal(evs[0].seg.label, 'Planche');
});

test('annonces vocales', () => {
  assert.equal(E.durationWords(45), '45 secondes');
  assert.equal(E.durationWords(60), '1 minute');
  assert.equal(E.durationWords(90), '1 minute 30');
  assert.equal(E.durationWords(120), '2 minutes');
  const segs = E.buildSegments(circuit);
  assert.equal(E.announceText(segs[1]), 'Planche, 30 secondes.');
  assert.equal(E.announceText(segs[2], segs[3]), 'Repos entre les tours, 1 minute. Suivant : Planche.');
  assert.equal(E.announceText(segs[0], segs[1]), 'Prépare-toi. Premier exercice : Planche.');
});

/* ───────── Luc Léger ───────── */

test('Luc Léger 1988 : vitesses, durée des navettes, nombre de navettes par palier', () => {
  const s = L.legerSchedule('8.5');
  assert.equal(s.length, 21);
  assert.equal(s[0].speed, 8.5);
  close(s[0].shuttleSec, 72 / 8.5);
  assert.equal(s[1].shuttleSec, 8); // 9 km/h → 20 m en 8 s
  assert.equal(s[7].speed, 12); // palier 8 = 12 km/h
  close(s[7].shuttleSec, 6);
  assert.deepEqual(s.slice(0, 20).map((p) => p.shuttles), [7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12, 13, 13, 13, 14, 14, 15, 15]);
  for (const p of s) assert.ok(p.dur > 57 && p.dur < 65, `palier ${p.palier} ≈ 1 min (${p.dur})`);
});

test('Luc Léger : cumul des temps et des navettes', () => {
  const s = L.legerSchedule('8.5');
  close(s[1].start, 7 * 72 / 8.5);
  close(s[2].start, 7 * 72 / 8.5 + 64);
  for (let i = 1; i < s.length; i++) {
    close(s[i].start, s[i - 1].end);
    assert.equal(s[i].cumBefore, s[i - 1].cumAfter);
  }
  assert.equal(s[1].cumBefore, 7);
  assert.equal(s[2].cumBefore, 15);
  const cues = L.legerCues(s);
  assert.equal(cues.filter((c) => c.kind === 'shuttle' || c.kind === 'palier').length, s[20].cumAfter);
  assert.equal(cues.filter((c) => c.kind === 'palier').length, 21);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].t > cues[i - 1].t);
});

test('Luc Léger version militaire (départ 8 km/h)', () => {
  const s = L.legerSchedule('8');
  assert.equal(s[0].speed, 8);
  assert.equal(s[0].shuttleSec, 9);
  assert.equal(s[0].shuttles, 7);
  assert.equal(s[2].speed, 9);
});

test('Luc Léger : position à l’instant t', () => {
  const s = L.legerSchedule('8.5');
  let p = L.legerAt(s, 0);
  assert.equal(p.palier, 1);
  assert.equal(p.completed, 0);
  assert.equal(p.current, 1);
  p = L.legerAt(s, 3 * 72 / 8.5 + 1); // 3 navettes finies au palier 1
  assert.equal(p.completedInPalier, 3);
  assert.equal(p.current, 4);
  p = L.legerAt(s, s[2].start + 8.5 * 2); // palier 3 (9,5 km/h), 2 navettes finies
  assert.equal(p.palier, 3);
  assert.equal(p.completedInPalier, 2);
  assert.equal(p.completed, 17);
  assert.equal(L.legerAt(s, 99999).ended, true);
});

test('Luc Léger : score en demi-paliers', () => {
  const s = L.legerSchedule('8.5');
  assert.equal(L.legerScore(s, 0).value, 0);
  assert.equal(L.legerScore(s, 3).value, 0);
  assert.equal(L.legerScore(s, 4).value, 0.5); // 4 navettes sur 7 au palier 1
  assert.equal(L.legerScore(s, 7).value, 1);
  assert.equal(L.legerScore(s, 7 + 3).value, 1);
  const half = L.legerScore(s, 7 + 4); // 4 sur 8 au palier 2
  assert.equal(half.value, 1.5);
  assert.equal(half.inPalier, 2);
  assert.equal(half.shuttlesInPalier, 4);
  assert.equal(half.distance, 220);
  const eight = s[7].cumAfter;
  assert.equal(L.legerScore(s, eight).value, 8);
  assert.equal(L.legerScore(s, eight + 5).value, 8.5); // 5 sur 10 au palier 9
  assert.equal(L.legerScore(s, 1e6).value, 21);
  assert.equal(L.legerVma(8, '8.5'), C.util.round((-24.4 + 6 * 12) / 3.5, 1));
  assert.equal(L.legerVma(0, '8.5'), null);
});

/* ───────── Chrono à temps intermédiaires ───────── */

test('chrono par segments : départ, tours, double appui ignoré, total', () => {
  const r = S.createSplit(['A', 'B', 'C']);
  assert.equal(S.splitStatus(r), 'idle');
  assert.equal(S.splitLap(r, at(1)), false); // pas lancé
  S.splitStart(r, at(0));
  assert.equal(S.splitLap(r, at(0.5)), false); // double appui
  assert.equal(S.splitLap(r, at(32.4)), true);
  assert.equal(S.splitLap(r, at(32.9)), false); // double appui
  assert.equal(S.splitLap(r, at(90)), true);
  assert.equal(S.splitStatus(r), 'run');
  assert.equal(S.splitCurrent(r), 2);
  assert.equal(S.splitLap(r, at(150.2)), true);
  assert.equal(S.splitStatus(r), 'done');
  close(S.splitTotal(r), 150.2);
  const times = S.splitTimes(r);
  close(times[0].sec, 32.4);
  close(times[1].sec, 57.6);
  close(times[2].sec, 60.2);
  close(times[2].cum, 150.2);
  assert.equal(S.splitElapsedMs(r, at(999)), 150200); // figé après l'arrivée
});

test('chrono par segments : annulation du dernier temps, pause exclue, relecture', () => {
  const r = S.createSplit(['A', 'B']);
  S.splitStart(r, at(0));
  S.splitLap(r, at(10));
  S.splitLap(r, at(20));
  assert.equal(S.splitStatus(r), 'done');
  assert.equal(S.splitUndo(r), true); // arrivée trop tôt : on continue
  assert.equal(S.splitStatus(r), 'run');
  assert.equal(S.splitElapsedMs(r, at(25)), 25000);
  S.splitPause(r, at(25));
  S.splitResume(r, at(85));
  assert.equal(S.splitElapsedMs(r, at(90)), 30000);
  S.splitLap(r, at(90));
  close(S.splitTotal(r), 30);
  const copy = S.reviveSplit(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(copy.laps, r.laps);
  assert.equal(S.splitStatus(copy), 'done');
  assert.equal(S.reviveSplit({ segments: ['A'], laps: [5, 3], startedAt: 1 }), null); // temps non croissants
  assert.equal(S.reviveSplit('nimporte'), null);
});

/* ───────── Tests chronométrés : verdicts, HYROX ───────── */

test('verdict : éliminatoire, temps, critères à compléter, cible', () => {
  const checks = T.SSA_ENTRY.checks;
  const ref = { official: 165, target: 135 };
  const all = (v) => Object.fromEntries(checks.map((c) => [c.k, v]));
  let v = T.verdict(150, {}, checks, ref);
  assert.equal(v.level, 'incomplet');
  assert.equal(v.pending.length, 3);
  v = T.verdict(150, all('oui'), checks, ref);
  assert.equal(v.level, 'reussi');
  assert.equal(v.valid, true);
  assert.equal(v.context, 'test');
  assert.equal(v.marginTarget, -15);
  assert.equal(T.verdict(130, all('oui'), checks, ref).level, 'cible');
  v = T.verdict(170, all('oui'), checks, ref);
  assert.equal(v.level, 'temps');
  assert.equal(v.valid, false);
  assert.equal(v.context, 'test'); // trop lent mais réglementaire : compte comme test
  v = T.verdict(130, { ...all('oui'), apnee: 'non' }, checks, ref);
  assert.equal(v.level, 'elimine');
  assert.equal(v.context, 'entrainement');
  assert.equal(T.verdict(130, all('oui'), checks, {}).level, 'inconnu');
});

test('HYROX : 16 segments dans l’ordre officiel, 31 avec la Roxzone, totaux par type', () => {
  const base = T.hyroxSegments();
  assert.equal(base.length, 16);
  assert.deepEqual(base.slice(0, 4).map((d) => d.kind), ['run', 'station', 'run', 'station']);
  assert.match(base[1].label, /SkiErg/);
  assert.match(base[15].label, /Wall balls/);
  const rox = T.hyroxSegments({ roxzone: true });
  assert.equal(rox.length, 31);
  assert.equal(rox.filter((d) => d.kind === 'rox').length, 15);
  const secs = base.map((d, i) => (d.kind === 'run' ? 300 + i : 240));
  const sum = T.hyroxSummary(base, secs);
  assert.equal(sum.runs.length, 8);
  assert.equal(sum.station, 8 * 240);
  assert.equal(sum.total, sum.run + sum.station);
  assert.equal(sum.runDrift, 14);
});

test('minuteur perso : contrôle avant enregistrement', () => {
  let r = C.timer.sanitizeTimer({ name: '  ', steps: [] });
  assert.ok(r.errors.length);
  assert.equal(r.timer.name, 'Mon minuteur');
  r = C.timer.sanitizeTimer({ name: 'Jambes', rounds: '3', prepSec: 10, steps: [{ label: 'Squat', sec: 40, kind: 'work' }, { label: '', sec: null, kind: 'rest' }] });
  assert.deepEqual(r.errors, ['Étape 2 : indique une durée.']);
  r = C.timer.sanitizeTimer({ id: 'abc', name: 'Jambes', rounds: 500, voice: true, steps: [{ label: 'Squat', sec: 40, kind: 'work' }, { label: '', sec: 20, kind: 'rest' }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.timer.id, 'abc');
  assert.equal(r.timer.rounds, 99);
  assert.equal(r.timer.voice, true);
  assert.deepEqual(r.timer.steps[1], { label: 'Repos', sec: 20, kind: 'rest' });
  assert.equal(C.timer.timerSummary(r.timer).split(' · ')[0], '99 tours');
});

/* ───────── Son (sans navigateur) ───────── */

test('audio : sans navigateur, tout est sans effet et ne plante pas', () => {
  const A = C.audio;
  assert.equal(A.beep({ freq: 880 }), null);
  assert.equal(A.say('Bonjour'), false);
  assert.equal(A.hasVoice(), false);
  assert.equal(A.vibrate(100), false);
  assert.equal(A.wakeLock.request('x'), false);
  A.wakeLock.release('x');
  assert.equal(A.wakeLock.active(), false);
  A.cancelSpeech();
  A.cancelScheduled();
  assert.equal(A.unlock(), false);
});
