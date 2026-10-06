'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers');

const C = load(['js/core/util.js', 'js/core/legacy-v1.js', 'js/core/schema.js']);
const U = C.util;

test('dates locales : addDays, dow, mondayOf, daysBetween (changement d\'heure)', () => {
  assert.equal(U.addDays('2026-10-24', 2), '2026-10-26'); // passage à l'heure d'hiver le 25/10
  assert.equal(U.addDays('2027-03-27', 2), '2027-03-29'); // passage à l'heure d'été le 28/03
  assert.equal(U.dow('2026-10-06'), 1); // mardi
  assert.equal(U.mondayOf('2026-10-11'), '2026-10-05');
  assert.equal(U.daysBetween('2026-10-06', '2027-05-15'), 221);
  assert.equal(U.weeksBetween('2026-10-06', '2026-10-19'), 2);
});

test('parseDuration : formats acceptés', () => {
  const cases = {
    '3:45': 225, '1:02:30': 3750, '345': 225, '45': 45, '10230': 3750, "3'45": 225, '3\'45"': 225,
    '3m45': 225, '3 min 45': 225, '1h05': 3900, '45s': 45, '90 s': 90, '2 min': 120, '1.30': 90, '1,30': 90, '0:59': 59,
  };
  for (const [input, sec] of Object.entries(cases)) assert.equal(U.parseDuration(input), sec, input);
});

test('parseDuration : refus', () => {
  for (const bad of ['', '-5', '−5', '3:75', 'abc', '1:2:3:4', '75', '3:4x']) assert.equal(U.parseDuration(bad), null, bad);
});

test('formatDuration / digits', () => {
  assert.equal(U.formatDuration(225), '3:45');
  assert.equal(U.formatDuration(3750), '1:02:30');
  assert.equal(U.formatDuration(null), '');
  assert.equal(U.formatDigitsLive('345'), '3:45');
  assert.equal(U.formatDigitsLive('3'), '0:03');
  assert.equal(U.formatDigitsLive('10230'), '1:02:30');
  assert.equal(U.durationToDigits(225), '345');
  assert.equal(U.digitsToDuration(U.durationToDigits(3750)), 3750);
});

test('esc échappe le HTML', () => {
  assert.equal(U.esc('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
  assert.equal(U.esc(null), '');
});

test('num accepte la virgule', () => {
  assert.equal(U.num('72,5'), 72.5);
  assert.equal(U.num(''), null);
  assert.equal(U.num('abc'), null);
});

test('linearTrend', () => {
  const t = U.linearTrend([{ x: 0, y: 10 }, { x: 1, y: 12 }, { x: 2, y: 14 }]);
  assert.equal(t.slope, 2);
  assert.equal(U.linearTrend([{ x: 1, y: 1 }]), null);
});

test('migration v1 → v2', () => {
  const v1 = {
    version: 1, startDate: '2026-10-06',
    goals: { ssa: { name: 'SSA', date: '2026-12-30' }, hyrox: { name: 'Hyrox', date: '2027-07-03' }, pompier: { name: 'P', date: '2028-10-05' } },
    schedule: {}, overrides: { '2026-10-07': 'home_circuit' },
    workouts: { '2026-10-06': { sessionId: 'home_upper', done: true, startedAt: 1, finishedAt: 600001, rpe: 7, notes: 'ok', log: { pullup: [{ reps: '6', done: true }] } } },
    habits: [{ id: 'sleep', name: 'Sommeil', icon: '😴' }], habitLog: { '2026-10-06': { sleep: true } },
    benchmarks: { ssa_test: [{ date: '2026-10-06', value: 250 }], pullups: [{ date: '2026-10-06', value: 6 }], weight: [{ date: '2026-10-06', value: 72 }] },
    settings: { sound: false },
  };
  const s = C.schema.fromAny(JSON.stringify(v1));
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.goals.length, 3);
  const sess = Object.values(s.sessions);
  assert.equal(sess.length, 1);
  assert.equal(sess[0].status, 'done');
  assert.equal(sess[0].durationMin, 10);
  assert.equal(sess[0].title, 'Maison — Haut du corps (barre + élastiques)');
  assert.equal(s.benchmarks.ssa_test_v1[0].context, 'ancien');
  assert.equal(s.benchmarks.pullups[0].value, 6);
  assert.equal(s.body['2026-10-06'].weight, 72);
  assert.equal(s.settings.sound, false);
  assert.equal(s.profile.onboarded, false);
});

test('fromAny rejette les données invalides sans planter', () => {
  assert.throws(() => C.schema.fromAny('pas du json'), /JSON/);
  assert.throws(() => C.schema.fromAny('{"version":1,"goals":{}}') && C.schema.fromAny('{"foo":1}'), /reconnue/);
  const s = C.schema.fromAny({ schemaVersion: 2, goals: [{ id: 'x', type: 'bad', name: '<b>', date: 'nope' }], habits: [{ id: 'h', name: '   ' }], body: { '2026-01-01': { weight: 'abc', food: 'énorme' } } });
  assert.equal(s.goals[0].type, 'custom');
  assert.equal(s.goals[0].date, null);
  assert.equal(s.habits.length, 0);
  assert.equal(s.body['2026-01-01'], undefined);
  assert.ok(s.agenda && Array.isArray(s.agenda.events));
  assert.equal(s.agenda.revision.latestEnd, '22:00');
});

test('sanitize conserve un état valide à l\'identique (idempotence)', () => {
  const a = C.schema.sanitize(C.schema.defaultState('2026-10-06'));
  const b = C.schema.sanitize(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(b, a);
});
