'use strict';
// Tests de l'agenda (js/core/agenda.js) : lecture iCal, import, créneaux occupés, créneau de sport,
// tâches de révision espacée, planification des révisions, export .ics ; puis rendu de js/ui/agenda.js.
// Fuseau fixe : Europe/Paris (heure d'été jusqu'au 25/10/2026, UTC+2 ; puis UTC+1).
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadCore } = require('./helpers');

const T = '2026-10-06'; // mardi

// Planificateur simulé : séances aux dates données ({ date: minutes }).
function fakePlanner(sessions = {}, calls = { n: 0 }) {
  return {
    day(date) {
      calls.n++;
      return sessions[date] ? { date, kind: 'session', durationMin: sessions[date], title: 'Séance test' } : { date, kind: 'rest', durationMin: 0, title: 'Repos' };
    },
  };
}

function setup(mutate, opts = {}) {
  const C = loadCore(opts.today || T, mutate);
  C.ui = C.ui || {};
  C.ui.toast = () => {};
  C.util.setNow(`${opts.today || T}T${opts.time || '07:00'}:00`);
  C.planner = opts.planner || fakePlanner(opts.sessions || {});
  C.agenda.clearCache();
  return C;
}

const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//FR', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const vev = (...props) => ['BEGIN:VEVENT', ...props, 'END:VEVENT'];
const WIN = { from: '2026-09-01', to: '2027-03-31' };

// Événement stocké directement (heure locale).
let seq = 0;
const E = (sourceId, title, start, end, extra = {}) => ({
  id: `${sourceId}|e${++seq}|${start}`, sourceId, uid: `e${seq}`, title, start, end: end || start, allDay: start.length === 10,
  location: '', categories: [], status: '', ...extra,
});
const SOURCES = [
  { id: 'ecole', name: 'Cours école', url: '', kind: 'cours', color: 'info', busy: true, lastSyncAt: null, lastError: '', count: 0 },
  { id: 'pc', name: 'Protection civile', url: '', kind: 'protection-civile', color: 'accent', busy: true, lastSyncAt: null, lastError: '', count: 0 },
  { id: 'me', name: 'Perso', url: '', kind: 'perso', color: 'loc-repos', busy: true, lastSyncAt: null, lastError: '', count: 0 },
];
const withSources = (events, extra) => (s) => {
  s.agenda.sources = SOURCES.map((x) => ({ ...x }));
  s.agenda.events = events;
  if (extra) extra(s);
};
const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const overlaps = (a1, b1, a2, b2) => a1 < b2 && a2 < b1;

/* ───────── Lecture iCal ───────── */

test('ICS : UTC (Z) converti en heure locale, été comme hiver', () => {
  const C = setup();
  const r = C.agenda.parseICS(cal(
    vev('UID:a', 'DTSTART:20261006T060000Z', 'DTEND:20261006T080000Z', 'SUMMARY:Cours été'),
    vev('UID:b', 'DTSTART:20261210T070000Z', 'DTEND:20261210T083000Z', 'SUMMARY:Cours hiver'),
  ), 'ecole', WIN);
  assert.deepEqual(r.errors, []);
  assert.equal(r.isHTML, false);
  const [a, b] = r.events;
  assert.equal(a.start, '2026-10-06T08:00');
  assert.equal(a.end, '2026-10-06T10:00');
  assert.equal(b.start, '2026-12-10T08:00');
  assert.equal(b.end, '2026-12-10T09:30');
  assert.equal(a.sourceId, 'ecole');
  assert.equal(a.allDay, false);
});

test('ICS : TZID gardé tel quel, journée entière, DURATION, sans fin', () => {
  const C = setup();
  const r = C.agenda.parseICS(cal(
    vev('UID:t', 'DTSTART;TZID=Europe/Paris:20261006T083000', 'DTEND;TZID="Europe/Paris":20261006T120000', 'SUMMARY:TD'),
    vev('UID:d', 'DTSTART;VALUE=DATE:20261010', 'DTEND;VALUE=DATE:20261012', 'SUMMARY:Formation PSE'),
    vev('UID:d1', 'DTSTART;VALUE=DATE:20261015', 'SUMMARY:Journée sans fin'),
    vev('UID:u', 'DTSTART:20261007T140000', 'DURATION:PT1H30M', 'SUMMARY:Durée'),
    vev('UID:n', 'DTSTART:20261008T180000', 'SUMMARY:Sans fin'),
  ), 'x', WIN);
  const by = Object.fromEntries(r.events.map((e) => [e.uid, e]));
  assert.equal(by.t.start, '2026-10-06T08:30');
  assert.equal(by.t.end, '2026-10-06T12:00');
  assert.equal(by.d.allDay, true);
  assert.equal(by.d.start, '2026-10-10');
  assert.equal(by.d.end, '2026-10-11', 'fin incluse (DTEND exclusif)');
  assert.equal(by.d1.end, '2026-10-15');
  assert.equal(by.u.end, '2026-10-07T15:30');
  assert.equal(by.n.end, '2026-10-08T19:00', 'sans fin : 60 min');
});

test('ICS : lignes repliées, échappements, catégories, statut, annulés ignorés', () => {
  const C = setup();
  const text = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:f1', 'DTSTART:20261009T080000', 'DTEND:20261009T100000',
    'SUMMARY:Mécanique des flu', ' ides\\, partie 2\\; TD', '\tA',
    'LOCATION:Bâtiment B\\, salle 204\\nCampus',
    'CATEGORIES:DPS,Secours', 'CATEGORIES:FOR', 'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'DESCRIPTION:Ne pas lire', 'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT', 'UID:x', 'DTSTART:20261009T120000', 'DTEND:20261009T130000', 'SUMMARY:Annulé', 'STATUS:CANCELLED', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');
  const r = C.agenda.parseICS(text, 'pc', WIN);
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.title, 'Mécanique des fluides, partie 2; TDA');
  assert.equal(e.location, 'Bâtiment B, salle 204 Campus');
  assert.deepEqual(e.categories, ['DPS', 'Secours', 'FOR']);
  assert.match(e.status, /tentative/);
  assert.match(e.status, /free/);
  assert.equal(C.agenda.typeLabel(e), 'dispositif prévisionnel de secours');
  assert.equal(C.agenda._t.unescapeText('a\\\\b\\,c\\;d\\ne'), 'a\\b,c;d\ne');
});

test('ICS : RRULE hebdomadaire avec COUNT + EXDATE, BYDAY + UNTIL, INTERVAL', () => {
  const C = setup();
  const r = C.agenda.parseICS(cal(
    // 4 occurrences comptées depuis DTSTART ; l'EXDATE compte dans COUNT.
    vev('UID:w', 'DTSTART;TZID=Europe/Paris:20261006T083000', 'DTEND;TZID=Europe/Paris:20261006T100000', 'RRULE:FREQ=WEEKLY;COUNT=4',
      'EXDATE;TZID=Europe/Paris:20261013T083000', 'SUMMARY:Hebdo'),
    // Lundi et mercredi jusqu'au 21/10 inclus (UNTIL en UTC).
    vev('UID:b', 'DTSTART:20261005T140000', 'DTEND:20261005T160000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261021T235959Z', 'SUMMARY:Lun-Mer'),
    // Une semaine sur deux, 3 fois.
    vev('UID:i', 'DTSTART:20261007T100000', 'DTEND:20261007T110000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3', 'SUMMARY:Bimensuel'),
    vev('UID:dly', 'DTSTART;VALUE=DATE:20261101', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Stage'),
    vev('UID:m', 'DTSTART:20261102T190000', 'DTEND:20261102T210000', 'RRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=3', 'SUMMARY:Réunion mensuelle'),
  ), 'x', WIN);
  const dates = (uid) => r.events.filter((e) => e.uid === uid).map((e) => e.start);
  assert.deepEqual(dates('w'), ['2026-10-06T08:30', '2026-10-20T08:30', '2026-10-27T08:30']);
  assert.deepEqual(dates('b'), ['2026-10-05T14:00', '2026-10-07T14:00', '2026-10-12T14:00', '2026-10-14T14:00', '2026-10-19T14:00', '2026-10-21T14:00']);
  assert.deepEqual(dates('i'), ['2026-10-07T10:00', '2026-10-21T10:00', '2026-11-04T10:00']);
  assert.deepEqual(dates('dly'), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.deepEqual(dates('m'), ['2026-11-02T19:00', '2026-12-07T19:00', '2027-01-04T19:00']);
  // Les identifiants sont stables d'une lecture à l'autre.
  const again = C.agenda.parseICS(cal(vev('UID:w', 'DTSTART;TZID=Europe/Paris:20261006T083000', 'DTEND;TZID=Europe/Paris:20261006T100000',
    'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=Europe/Paris:20261013T083000', 'SUMMARY:Hebdo')), 'x', WIN);
  assert.deepEqual(again.events.map((e) => e.id), r.events.filter((e) => e.uid === 'w').map((e) => e.id));
});

test('ICS : RECURRENCE-ID remplace une occurrence (déplacée ou annulée)', () => {
  const C = setup();
  const r = C.agenda.parseICS(cal(
    vev('UID:s', 'DTSTART:20261006T063000Z', 'DTEND:20261006T080000Z', 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Physique'),
    // Occurrence du 13/10 (08:30 local) déplacée au 14/10 10:00.
    vev('UID:s', 'RECURRENCE-ID;TZID=Europe/Paris:20261013T083000', 'DTSTART;TZID=Europe/Paris:20261014T100000',
      'DTEND;TZID=Europe/Paris:20261014T113000', 'SUMMARY:Physique (déplacé)'),
    // Occurrence du 20/10 annulée (RECURRENCE-ID en UTC).
    vev('UID:s', 'RECURRENCE-ID:20261020T063000Z', 'DTSTART:20261020T063000Z', 'DTEND:20261020T080000Z', 'STATUS:CANCELLED', 'SUMMARY:Physique'),
  ), 'x', WIN);
  assert.deepEqual(r.events.map((e) => `${e.start} ${e.title}`), [
    '2026-10-06T08:30 Physique',
    '2026-10-14T10:00 Physique (déplacé)',
    '2026-10-27T07:30 Physique', // règle en UTC : 06:30 UTC = 07:30 après le passage à l'heure d'hiver
  ]);
});

test('ICS : page web (HTML) détectée, texte vide ou quelconque refusé, fenêtre −30 j / +180 j', () => {
  const C = setup();
  const html = C.agenda.parseICS('<!DOCTYPE html>\n<html><head><title>eProtec</title></head><body>Connexion</body></html>', 'pc', { kind: 'protection-civile' });
  assert.equal(html.isHTML, true);
  assert.equal(html.events.length, 0);
  assert.match(html.errors[0], /page web, pas un calendrier/);
  assert.match(html.errors[0], /eProtec/);
  assert.match(html.errors[0], /iCal \(\.ics\)/);
  assert.match(C.agenda.parseICS('<html><body>x</body></html>', 'x').errors[0], /eProtec/, 'message par défaut');
  assert.equal(C.agenda.parseICS('', 'x').errors[0], 'Le texte est vide.');
  assert.match(C.agenda.parseICS('bonjour', 'x').errors[0], /ne ressemble pas/);
  // Fenêtre par défaut autour d'aujourd'hui (06/10/2026).
  const r = C.agenda.parseICS(cal(
    vev('UID:old', 'DTSTART:20260801T080000', 'DTEND:20260801T090000', 'SUMMARY:Trop ancien'),
    vev('UID:ok', 'DTSTART:20260910T080000', 'DTEND:20260910T090000', 'SUMMARY:Dans la fenêtre'),
    vev('UID:far', 'DTSTART:20270601T080000', 'DTEND:20270601T090000', 'SUMMARY:Trop loin'),
  ), 'x');
  assert.deepEqual(r.events.map((e) => e.uid), ['ok']);
});

/* ───────── Plusieurs calendriers collés (Raccourci) ───────── */

const ICS_COURS = cal(
  vev('UID:c1', 'DTSTART;TZID=Europe/Paris:20261005T083000', 'DTEND;TZID=Europe/Paris:20261005T103000', 'SUMMARY:CM Mathématiques (MAT201)'),
  vev('UID:c2', 'DTSTART;TZID=Europe/Paris:20261006T083000', 'DTEND;TZID=Europe/Paris:20261006T120000', 'SUMMARY:TD Thermodynamique - Gr 2'),
);
const ICS_PC = cal(vev('UID:p1', 'DTSTART:20261010T120000Z', 'DTEND:20261010T180000Z', 'SUMMARY:DPS Concert', 'CATEGORIES:DPS'));

test('parseBundle : blocs --CREVARE-SOURCE, contenu sur la même ligne, sans marqueur', () => {
  const C = setup();
  const parts = C.agenda.parseBundle(`--CREVARE-SOURCE cours Cours école\r\n${ICS_COURS}\r\n--CREVARE-SOURCE protection-civile Protection civile\n${ICS_PC}\n`);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => [p.kind, p.name]), [['cours', 'Cours école'], ['protection-civile', 'Protection civile']]);
  assert.ok(parts.every((p) => p.text.startsWith('BEGIN:VCALENDAR') && p.text.trim().endsWith('END:VCALENDAR')));
  const inline = C.agenda.parseBundle(`--CREVARE-SOURCE cours École BEGIN:VCALENDAR\nEND:VCALENDAR`);
  assert.equal(inline[0].name, 'École');
  assert.ok(inline[0].text.startsWith('BEGIN:VCALENDAR'));
  assert.deepEqual(C.agenda.parseBundle('--CREVARE-SOURCE Mon club\nBEGIN:VCALENDAR').map((p) => [p.kind, p.name]), [['perso', 'Mon club']]);
  const empty = C.agenda.importText(`--CREVARE-SOURCE cours Mes cours\n\n--CREVARE-SOURCE protection-civile Protection civile\n${ICS_PC}`);
  assert.equal(empty.results[0].ok, false);
  assert.match(empty.results[0].error, /Rien reçu/);
  assert.equal(empty.results[1].ok, true);
  const single = C.agenda.parseBundle(ICS_PC);
  assert.equal(single.length, 1);
  assert.equal(single[0].kind, null);
});

test('importText : crée les sources, les retrouve ensuite (même type/nom), remplace les événements', () => {
  const C = setup();
  const bundle = `--CREVARE-SOURCE cours Cours école\n${ICS_COURS}\n--CREVARE-SOURCE protection-civile Protection civile\n${ICS_PC}`;
  const r1 = C.agenda.importText(bundle);
  assert.equal(r1.ok, true);
  const ag = C.state.agenda;
  assert.deepEqual(ag.sources.map((s) => [s.name, s.kind, s.count, s.url]), [['Cours école', 'cours', 2, ''], ['Protection civile', 'protection-civile', 1, '']]);
  assert.ok(ag.sources.every((s) => s.lastSyncAt && !s.lastError));
  assert.ok(ag.subjects.some((s) => s.name === 'Mathématiques'));
  assert.ok(Object.keys(ag.tasks).length > 0, 'tâches créées après import');
  // Deuxième import : mêmes sources, événements remplacés (un cours en moins).
  const fewer = bundle.replace(/BEGIN:VEVENT\r\nUID:c2[\s\S]*?END:VEVENT\r\n/, '');
  C.agenda.importText(fewer);
  assert.equal(ag.sources.length, 2);
  assert.equal(ag.sources[0].count, 1);
  assert.equal(ag.events.filter((e) => e.sourceId === ag.sources[0].id).length, 1);
  // Source renommée par l'utilisateur : la seule source « cours » est reprise.
  ag.sources[0].name = 'École 2A';
  C.agenda.importText(bundle);
  assert.equal(ag.sources.length, 2);
  assert.equal(ag.sources[0].count, 2);
  // Un bloc qui renvoie une page web : erreur claire, anciens événements gardés.
  const r2 = C.agenda.importText(`--CREVARE-SOURCE protection-civile Protection civile\n<!doctype html><html><body>Connexion</body></html>`);
  assert.equal(r2.ok, false);
  assert.equal(r2.results[0].isHTML, true);
  assert.match(ag.sources[1].lastError, /eProtec/);
  assert.equal(ag.events.filter((e) => e.sourceId === ag.sources[1].id).length, 1);
  // Un seul calendrier dans une source précise.
  const id = C.agenda.addSource({ name: 'Club', kind: 'perso', url: 'webcal://exemple.org/cal.ics' });
  assert.equal(ag.sources.find((s) => s.id === id).url, 'https://exemple.org/cal.ics');
  C.agenda.importText(cal(vev('UID:z', 'DTSTART:20261008T190000', 'DTEND:20261008T200000', 'SUMMARY:Entraînement')), id);
  assert.equal(ag.events.filter((e) => e.sourceId === id).length, 1);
  assert.equal(ag.events.length, 4);
  // Sans source ni marqueur : nouvelle source au type deviné (codes eProtec).
  const r3 = C.agenda.importText(cal(vev('UID:g', 'DTSTART:20261012T080000', 'DTEND:20261012T120000', 'SUMMARY:GAR Poste de secours')));
  assert.equal(ag.sources.find((s) => s.id === r3.results[0].sourceId).kind, 'protection-civile');
});

test('sync : fetch sans cache ; échec (CORS) → message Raccourci ; erreur HTTP ; succès', async () => {
  const C = setup();
  const id = C.agenda.addSource({ name: 'Cours école', kind: 'cours', url: 'https://exemple.org/ical.php?v1=abc' });
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push([url, opts]); throw new TypeError('Failed to fetch'); };
  const r1 = await C.agenda.sync(id);
  assert.equal(r1.ok, false);
  assert.equal(r1.cors, true);
  assert.match(r1.error, /Raccourci iOS/);
  assert.equal(calls[0][0], 'https://exemple.org/ical.php?v1=abc');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.match(C.state.agenda.sources[0].lastError, /Raccourci/);
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  assert.match((await C.agenda.sync(id)).error, /404/);
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => ICS_COURS });
  const r3 = await C.agenda.sync(id);
  assert.equal(r3.ok, true);
  assert.equal(r3.count, 2);
  assert.equal(C.state.agenda.sources[0].lastError, '');
  const noUrl = C.agenda.addSource({ name: 'Vide', kind: 'perso' });
  assert.match((await C.agenda.sync(noUrl)).error, /lien/);
  delete globalThis.fetch;
});

/* ───────── Journée : occupation ───────── */

test('busyIntervals : événements occupants, marges, journées entières, sport', () => {
  const D = '2026-10-08';
  const C = setup(withSources([
    E('ecole', 'TD Maths', `${D}T08:30`, `${D}T12:00`),
    E('pc', 'DPS', `${D}T14:00`, `${D}T19:00`),
    E('ecole', 'Vacances de la Toussaint', D, D), // journée de cours : informative
    E('me', 'Anniversaire', `${D}T21:00`, `${D}T21:30`, { status: 'free' }), // perso transparent : libre
  ]), { sessions: { [D]: 60 } });
  assert.deepEqual(C.agenda.busyIntervals(D, { sport: false }).map((x) => `${x.start}-${x.end} ${x.kind}`), ['08:30-12:00 cours', '14:00-19:00 protection-civile']);
  assert.deepEqual(C.agenda.busyIntervals(D, { sport: false, margins: true }).map((x) => `${x.start}-${x.end}`), ['08:00-12:30', '13:30-19:30']);
  // Séance de sport prévue : créneau ajouté (après la garde, hors repas).
  const all = C.agenda.busyIntervals(D);
  const sport = all.find((x) => x.kind === 'sport');
  assert.ok(sport, 'séance de sport présente');
  assert.ok(toMin(sport.start) >= toMin('19:30') && toMin(sport.end) <= toMin('22:00'), JSON.stringify(sport));
  // Événements du jour : les 4, journée d'abord.
  const evs = C.agenda.eventsOn(D);
  assert.equal(evs.length, 4);
  assert.equal(evs[0].allDay, true);
  assert.equal(evs[0].busy, false);
  assert.equal(evs.find((e) => e.title === 'Anniversaire').busy, false);
  // Garde toute la journée (Protection civile) : occupe la journée ; perso OPAQUE aussi.
  const C2 = setup(withSources([E('pc', 'Formation PSE2', '2026-10-09', '2026-10-10'), E('me', 'Mariage', '2026-10-11', '2026-10-11', { status: 'busy' })]));
  assert.deepEqual(C2.agenda.busyIntervals('2026-10-10', { sport: false }).map((x) => `${x.start}-${x.end}`), ['00:00-24:00']);
  assert.equal(C2.agenda.busyIntervals('2026-10-11', { sport: false }).length, 1);
  // Source marquée « ne bloque pas ».
  const C3 = setup(withSources([E('ecole', 'TD', `${D}T08:30`, `${D}T12:00`)], (s) => { s.agenda.sources[0].busy = false; }));
  assert.equal(C3.agenda.busyIntervals(D, { sport: false }).length, 0);
});

test('dayInfo : résumé du jour, sans jamais appeler le planificateur', () => {
  const D = '2026-10-10';
  const calls = { n: 0 };
  const C = setup(withSources([
    E('ecole', 'TD', `${D}T08:30`, `${D}T12:00`),
    E('pc', 'DPS Concert', `${D}T13:30`, `${D}T19:00`, { categories: ['DPS'] }),
    E('pc', 'Débrief', `${D}T18:30`, `${D}T19:30`),
  ]), { planner: { day() { calls.n++; throw new Error('ne doit pas être appelé'); } } });
  const info = C.agenda.dayInfo(D);
  assert.equal(calls.n, 0);
  assert.equal(info.events.length, 3);
  assert.equal(info.busyMin, 210 + 360, 'union des créneaux');
  assert.equal(info.hasCivilProtection, true);
  assert.equal(info.pcMin, 360);
  assert.equal(info.firstStart, '08:30');
  assert.equal(info.lastEnd, '19:30');
  assert.equal(info.freeEveningFrom, '20:00');
  assert.equal(info.coursEnd, '12:00');
  assert.equal(info.events[1].typeCode, 'DPS');
  const empty = C.agenda.dayInfo('2026-10-12');
  assert.equal(empty.busyMin, 0);
  assert.equal(empty.hasCivilProtection, false);
  assert.equal(empty.freeEveningFrom, null);
  assert.equal(calls.n, 0);
});

/* ───────── Créneau de sport ───────── */

test('trainingSlot : après les cours, avant 21:00 si possible, jamais après 22:00', () => {
  const C = setup(withSources([
    E('ecole', 'TD', '2026-10-07T08:30', '2026-10-07T12:00'),
    E('ecole', 'TP', '2026-10-07T13:30', '2026-10-07T17:00'),
    E('ecole', 'CM', '2026-10-08T08:30', '2026-10-08T12:00'),
    E('ecole', 'TP long', '2026-10-08T13:30', '2026-10-08T19:45'),
  ]), { sessions: { '2026-10-09': 75 } });
  assert.deepEqual(C.agenda.trainingSlot('2026-10-07', 60), { start: '17:30', end: '18:30' });
  const late = C.agenda.trainingSlot('2026-10-08', 60);
  assert.ok(late && toMin(late.end) <= toMin('22:00'), JSON.stringify(late));
  assert.ok(toMin(late.start) >= toMin('20:15'), 'après le repas et la marge');
  assert.equal(C.agenda.trainingSlot('2026-10-08', 120), null, 'pas de place pour 2 h');
  assert.deepEqual(C.agenda.trainingSlot('2026-10-12', 60), { start: '17:00', end: '18:00' }, 'journée libre');
  // Sans durée : celle de la séance prévue ; jour de repos → null.
  assert.deepEqual(C.agenda.trainingSlot('2026-10-09'), { start: '17:00', end: '18:15' });
  assert.equal(C.agenda.trainingSlot('2026-10-10'), null);
  // Heure de fin max plus tôt.
  C.state.agenda.revision.latestEnd = '21:00';
  const l2 = C.agenda.trainingSlot('2026-10-08', 30);
  assert.ok(!l2 || toMin(l2.end) <= toMin('21:00'));
});

/* ───────── Matières et examens ───────── */

test('subjectsFromEvents : titres nettoyés, fusion par mots-clés, sport ignoré', () => {
  const C = setup(withSources([
    E('ecole', 'CM Mathématiques (MAT201)', '2026-10-05T08:30', '2026-10-05T10:30'),
    E('ecole', 'Maths - TD - Salle B204', '2026-10-06T08:30', '2026-10-06T10:30'),
    E('ecole', 'MAT-201 Mathématiques - CM', '2026-10-07T08:30', '2026-10-07T10:30'),
    E('ecole', 'TD Mécanique des fluides Gr2', '2026-10-05T13:30', '2026-10-05T15:30'),
    E('ecole', 'Mécanique du solide', '2026-10-06T13:30', '2026-10-06T15:30'),
    E('ecole', 'THERMODYNAMIQUE TP', '2026-10-07T13:30', '2026-10-07T15:30'),
    E('ecole', 'Sport', '2026-10-08T15:30', '2026-10-08T17:30'),
    E('ecole', 'Anglais', '2026-10-08T10:00', '2026-10-08T12:00'),
    E('ecole', 'Partiel Mathématiques', '2026-10-20T08:30', '2026-10-20T10:30'),
    E('pc', 'Réunion de secteur', '2026-10-08T19:00', '2026-10-08T20:00'),
  ]));
  const list = C.agenda.subjectsFromEvents();
  const names = list.map((s) => s.name).sort();
  assert.deepEqual(names, ['Anglais', 'Mathématiques', 'Mécanique des fluides', 'Mécanique du solide', 'Sport', 'Thermodynamique']);
  const maths = list.find((s) => s.name === 'Mathématiques');
  assert.equal(maths.count, 3);
  assert.ok(maths.match.includes('maths'));
  assert.equal(list.find((s) => s.name === 'Sport').ignore, true);
  assert.equal(list.find((s) => s.name === 'Anglais').weight, 1);
  assert.ok(list.every((s) => s.isNew && C.agenda.COLORS.includes(s.color)));
  assert.equal(new Set(list.map((s) => s.color)).size, list.length, 'couleurs différentes');
  // Les matières enregistrées gardent les réglages de l'utilisateur.
  C.state.agenda.subjects = [{ id: 'm-maths', name: 'Analyse', color: 'warn', match: ['math'], ignore: false, weight: 3 }];
  const l2 = C.agenda.subjectsFromEvents();
  assert.equal(l2[0].name, 'Analyse');
  assert.equal(l2[0].count, 3);
  assert.ok(!l2.some((s) => s.isNew && /math/i.test(s.name)));
  assert.equal(C.agenda.cleanTitle('TD Mécanique des fluides (Gr 2)'), 'Mécanique des fluides');
  assert.equal(C.agenda.cleanTitle('CM'), '');
});

test('detectExams : Examen, Partiel, DS, Contrôle, CC, Évaluation, Soutenance', () => {
  const titles = ['Examen final Physique', 'Partiel Mathématiques', 'DS Thermodynamique', 'Contrôle continu Anglais', 'CC Chimie',
    'Évaluation Électronique', 'Soutenance de projet', 'Évaluation des risques - CM', 'TD Physique', 'Cours de dessin'];
  const C = setup(withSources(titles.map((t, i) => E('ecole', t, `2026-10-${String(10 + i).padStart(2, '0')}T08:30`, `2026-10-${String(10 + i).padStart(2, '0')}T10:30`))));
  const ex = C.agenda.detectExams();
  assert.deepEqual(ex.map((x) => x.title), titles.slice(0, 7));
  assert.ok(ex.every((x) => x.source === 'auto' && x.id.startsWith('auto:') && x.subjectId));
  assert.equal(ex[1].subjectId, 'm-mathematiques');
});

/* ───────── Tâches de révision ───────── */

const COURSE_DAY = '2026-10-04'; // dimanche (cours fictif pour le test)
function courseScenario(extra, opts) {
  return setup(withSources([
    E('ecole', 'CM Maths', `${COURSE_DAY}T08:30`, `${COURSE_DAY}T10:30`),
    E('ecole', 'TD Maths', `${COURSE_DAY}T13:30`, `${COURSE_DAY}T15:30`),
    E('ecole', 'TP Physique', '2026-10-05T08:30', '2026-10-05T10:00'),
  ], (s) => {
    s.agenda.subjects = [
      { id: 'maths', name: 'Maths', color: 'info', match: ['maths'], ignore: false, weight: 2 },
      { id: 'phys', name: 'Physique', color: 'warn', match: ['physique'], ignore: false, weight: 2 },
    ];
    if (extra) extra(s);
  }), opts);
}

test('buildTasks : relectures espacées J0, J+1, J+7, J+30, regroupées par matière et par jour', () => {
  const C = courseScenario();
  const res = C.agenda.buildTasks(T);
  const tasks = C.state.agenda.tasks;
  assert.equal(res.total, 8);
  const m = (j) => tasks[`rev|maths|${COURSE_DAY}|J${j}`];
  assert.ok(m(0) && m(1) && m(7) && m(30), 'une tâche par écart, pas une par heure de cours');
  assert.deepEqual([m(0).due, m(1).due, m(7).due, m(30).due], ['2026-10-04', '2026-10-05', '2026-10-11', '2026-11-03']);
  assert.deepEqual([m(0).kind, m(1).kind, m(7).kind, m(30).kind], ['relecture', 'relecture', 'exercices', 'synthese']);
  assert.deepEqual([m(0).durationMin, m(1).durationMin, m(7).durationMin, m(30).durationMin], [30, 20, 50, 30], '4 h de cours : versions longues');
  const p = (j) => tasks[`rev|phys|2026-10-05|J${j}`];
  assert.deepEqual([p(0).durationMin, p(1).durationMin, p(7).durationMin, p(30).durationMin], [20, 15, 40, 30]);
  assert.equal(m(0).availableAt, `${COURSE_DAY}T15:30`, 'relecture après le dernier cours du jour');
  assert.ok(Object.values(tasks).every((t) => t.durationMin >= 15 && t.durationMin <= 50));
});

test('buildTasks : idempotent, tâches faites conservées, cours supprimé ou matière ignorée', () => {
  const C = courseScenario();
  C.agenda.buildTasks(T);
  const snap = JSON.stringify(C.state.agenda.tasks);
  C.agenda.buildTasks(T);
  assert.equal(JSON.stringify(C.state.agenda.tasks), snap, 'deux appels → même résultat');
  const ag = C.state.agenda;
  ag.tasks[`rev|maths|${COURSE_DAY}|J0`].done = true;
  ag.tasks[`rev|maths|${COURSE_DAY}|J0`].doneAt = COURSE_DAY;
  // Le cours de maths disparaît du calendrier : seules les tâches faites restent.
  ag.events = ag.events.filter((e) => !/Maths/.test(e.title));
  C.agenda.clearCache();
  C.agenda.buildTasks(T);
  const maths = Object.keys(ag.tasks).filter((k) => k.startsWith('rev|maths'));
  assert.deepEqual(maths, [`rev|maths|${COURSE_DAY}|J0`]);
  assert.equal(ag.tasks[maths[0]].done, true);
  // Matière ignorée : plus de tâches à faire.
  ag.subjects[1].ignore = true;
  C.agenda.buildTasks(T);
  assert.ok(!Object.keys(ag.tasks).some((k) => k.startsWith('rev|phys')));
  // Écarts personnalisés.
  const C2 = courseScenario((s) => { s.agenda.revision.spacing = [0, 2, 5]; });
  C2.agenda.buildTasks(T);
  assert.deepEqual(Object.keys(C2.state.agenda.tasks).filter((k) => k.startsWith('rev|phys')).sort(), ['rev|phys|2026-10-05|J0', 'rev|phys|2026-10-05|J2', 'rev|phys|2026-10-05|J5']);
});

test('buildTasks : préparation d\'examen croissante sur les 14 jours avant (selon le poids)', () => {
  const EXAM = '2026-10-26';
  const C = courseScenario((s) => { s.agenda.exams = [{ id: 'x1', subjectId: 'maths', date: EXAM, title: 'Partiel Maths', source: 'manuel' }]; });
  C.agenda.buildTasks(T);
  const prep = Object.values(C.state.agenda.tasks).filter((t) => t.examId === 'x1').sort((a, b) => a.due.localeCompare(b.due));
  assert.equal(prep.length, 8, 'poids normal : 8 blocs');
  assert.ok(prep.every((t) => t.kind === 'examen' && t.durationMin === 50 && t.until === '2026-10-25'));
  assert.equal(prep[0].due, '2026-10-12');
  assert.equal(prep[prep.length - 1].due, '2026-10-25');
  const gaps = prep.slice(1).map((t, i) => C.util.daysBetween(prep[i].due, t.due));
  assert.ok(gaps.every((g, i) => i === 0 || g <= gaps[i - 1]), `plus fréquent à l'approche : ${gaps}`);
  // Poids fort : plus de blocs ; examen supprimé : préparation retirée.
  C.state.agenda.subjects[0].weight = 3;
  C.agenda.buildTasks(T);
  assert.equal(Object.values(C.state.agenda.tasks).filter((t) => t.examId === 'x1').length, 13);
  C.state.agenda.exams = [];
  C.agenda.buildTasks(T);
  assert.equal(Object.values(C.state.agenda.tasks).filter((t) => t.examId === 'x1').length, 0);
});

/* ───────── Planification ───────── */

// Deux semaines chargées : cours, garde de 6 h le samedi, repas, séance de sport le jeudi.
function busyWeeks(extra, opts = {}) {
  const ev = [];
  for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
    ev.push(E('ecole', 'CM Maths', `${d}T08:30`, `${d}T10:30`));
    ev.push(E('ecole', 'TD Physique', `${d}T10:45`, `${d}T12:15`));
    ev.push(E('ecole', 'TP Chimie', `${d}T13:45`, `${d}T17:15`));
  }
  ev.push(E('ecole', 'Projet tardif', '2026-10-13T17:30', '2026-10-13T20:30'));
  ev.push(E('pc', 'DPS Match', '2026-10-10T13:00', '2026-10-10T19:00', { categories: ['DPS'] }));
  ev.push(E('pc', 'GAR Nuit', '2026-10-17T20:00', '2026-10-18T02:00', { categories: ['GAR'] }));
  ev.push(E('pc', 'Formation PSE2', '2026-10-11', '2026-10-11'));
  return setup(withSources(ev, (s) => {
    s.agenda.subjects = [
      { id: 'maths', name: 'Maths', color: 'info', match: ['maths'], ignore: false, weight: 2 },
      { id: 'phys', name: 'Physique', color: 'warn', match: ['physique'], ignore: false, weight: 2 },
      { id: 'chim', name: 'Chimie', color: 'ok', match: ['chimie'], ignore: false, weight: 2 },
    ];
    if (extra) extra(s);
  }), { sessions: { '2026-10-08': 60, '2026-10-15': 90 }, ...opts });
}

function checkPlan(C, blocks) {
  const rv = C.agenda.revision();
  const perDay = {};
  for (const b of blocks) {
    const s = toMin(b.start), e = toMin(b.end);
    assert.ok(e > s, `${b.id} durée positive`);
    assert.ok(e <= toMin(rv.latestEnd), `${b.id} finit après ${rv.latestEnd}`);
    assert.ok(!rv.daysOff.includes(C.util.dow(b.date)), `${b.id} jour sans révision`);
    // Hors événements (avec marges), repas et créneau de sport.
    for (const x of C.agenda.busyIntervals(b.date, { margins: true })) {
      assert.ok(!overlaps(s, e, toMin(x.start), x.end === '24:00' ? 1440 : toMin(x.end)), `${b.id} chevauche ${x.title} ${x.start}-${x.end}`);
    }
    for (const [a, z] of C.agenda._t.mealCuts(rv)) assert.ok(!overlaps(s, e, a, z), `${b.id} chevauche un repas`);
    perDay[b.date] = (perDay[b.date] || []).concat([[s, e]]);
  }
  for (const [date, list] of Object.entries(perDay)) {
    list.sort((p, q) => p[0] - q[0]);
    for (let i = 1; i < list.length; i++) assert.ok(list[i][0] >= list[i - 1][1], `${date} blocs qui se chevauchent`);
    const total = list.reduce((n, [s, e]) => n + e - s, 0);
    const weekend = C.util.dow(date) >= 5;
    let limit = weekend ? rv.maxWeekendMin : rv.maxWeekdayMin;
    const long = (x) => (Date.parse(x.end) - Date.parse(x.start)) / 60000 >= 240;
    if (C.agenda.eventsOn(date).some((x) => x.kind === 'protection-civile' && x.busy && !x.allDay && long(x))) limit = Math.floor(limit / 2);
    assert.ok(total <= limit, `${date} : ${total} min > limite ${limit}`);
  }
  return perDay;
}

test('schedule : jamais après 22:00, hors cours/gardes/repas/sport, limite quotidienne, gardes ≥ 4 h', () => {
  const C = busyWeeks();
  C.agenda.buildTasks(T);
  const blocks = C.agenda.schedule(T, '2026-10-19');
  assert.ok(blocks.length >= 10, `assez de blocs (${blocks.length})`);
  const perDay = checkPlan(C, blocks);
  assert.ok(!perDay['2026-10-11'], 'formation PC toute la journée : pas de révision');
  const sat = (perDay['2026-10-10'] || []).reduce((n, [s, e]) => n + e - s, 0);
  assert.ok(sat <= 120, 'samedi avec DPS de 6 h : limite divisée par deux');
  assert.ok(blocks.every((b) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\|/.test(b.id) && b.id === `${b.date}T${b.start}|${b.subjectId || 'libre'}`));
  assert.ok(blocks.every((b) => b.taskIds.length && b.title && b.minutes === toMin(b.end) - toMin(b.start)));
  // Heure de fin personnalisée.
  C.state.agenda.revision.latestEnd = '20:30';
  checkPlan(C, C.agenda.schedule(T, '2026-10-19'));
});

test('schedule : jours sans révision, pas de révision les jours de sport (option)', () => {
  const C = busyWeeks((s) => { s.agenda.revision.daysOff = [2, 6]; });
  C.agenda.buildTasks(T);
  const blocks = C.agenda.schedule(T, '2026-10-19');
  assert.ok(blocks.length > 0);
  assert.ok(!blocks.some((b) => [2, 6].includes(C.util.dow(b.date))));
  const C2 = busyWeeks((s) => { s.agenda.revision.avoidTrainingDays = true; });
  const b2 = C2.agenda.schedule(T, '2026-10-19');
  assert.ok(!b2.some((b) => b.date === '2026-10-08' || b.date === '2026-10-15'));
  assert.ok(b2.some((b) => b.date === '2026-10-09'));
  const C3 = busyWeeks((s) => { s.agenda.revision.enabled = false; });
  assert.equal(C3.agenda.schedule(T, '2026-10-19').length, 0);
});

test('schedule : déterministe, indépendant de la période demandée', () => {
  const C = busyWeeks();
  C.agenda.buildTasks(T);
  const a = C.agenda.schedule(T, '2026-10-19');
  const b = C.agenda.schedule(T, '2026-10-19');
  assert.deepEqual(a, b);
  const day = '2026-10-09';
  assert.deepEqual(C.agenda.schedule(day, day), a.filter((x) => x.date === day));
  assert.deepEqual(C.agenda.schedule(T, T), a.filter((x) => x.date === T));
  // Un autre chargement des mêmes données donne les mêmes blocs.
  const C2 = busyWeeks();
  C2.agenda.buildTasks(T);
  assert.deepEqual(C2.agenda.schedule(T, '2026-10-19').map((x) => x.id), a.map((x) => x.id));
});

test('schedule : un examen proche passe en premier', () => {
  const C = setup(withSources([
    E('ecole', 'CM Physique', '2026-10-05T08:30', '2026-10-05T10:30'),
    E('ecole', 'CM Maths', '2026-09-20T08:30', '2026-09-20T10:30'),
  ], (s) => {
    s.agenda.subjects = [
      { id: 'maths', name: 'Maths', color: 'info', match: ['maths'], ignore: false, weight: 2 },
      { id: 'phys', name: 'Physique', color: 'warn', match: ['physique'], ignore: false, weight: 2 },
    ];
    s.agenda.exams = [{ id: 'x', subjectId: 'maths', date: '2026-10-08', title: 'DS Maths', source: 'manuel' }];
    s.agenda.revision.maxWeekdayMin = 50; // un seul bloc par jour
  }));
  C.agenda.buildTasks(T);
  const today = C.agenda.schedule(T, T);
  assert.equal(today.length, 1);
  assert.equal(today[0].subjectId, 'maths', 'DS dans 2 jours avant la relecture J+1 de physique');
  assert.equal(today[0].kind, 'examen');
});

test('schedule : rien dans le passé ; bloc en cours gardé à sa place, blocs manqués replacés', () => {
  const C = busyWeeks();
  C.agenda.buildTasks(T);
  const morning = C.agenda.schedule(T, '2026-10-19');
  const todayMorning = morning.filter((b) => b.date === T);
  assert.ok(todayMorning.length >= 2);
  // 15:00 : les blocs finis avant 15:00 ne sont plus proposés aujourd'hui.
  C.util.setNow(`${T}T15:00:00`);
  const later = C.agenda.schedule('2026-10-01', '2026-10-19');
  assert.ok(!later.some((b) => b.date < T), 'aucun bloc non fait dans les jours passés');
  for (const b of later.filter((x) => x.date === T)) assert.ok(toMin(b.end) > toMin('15:00'), `${b.id} déjà fini`);
  checkPlan(C, later);
  const missed = todayMorning.filter((b) => toMin(b.end) <= toMin('15:00')).flatMap((b) => b.taskIds);
  const placed = new Set(later.flatMap((b) => b.taskIds));
  const pool = C.agenda._t.taskPool(C.state.agenda, T, '2026-10-19').map((t) => t.id);
  for (const id of missed) assert.ok(placed.has(id) || pool.includes(id), `${id} replacé ou toujours à faire`);
  // Bloc en cours : même identifiant, même horaire.
  const first = todayMorning[todayMorning.length - 1];
  const mid = toMin(first.start) + 5;
  C.util.setNow(`${T}T${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}:00`);
  const now = C.agenda.schedule(T, T);
  assert.ok(now.some((b) => b.id === first.id && b.start === first.start), 'bloc en cours conservé');
  assert.ok(now.every((b) => toMin(b.end) > mid));
});

test('markBlock : fait → tâches faites et bloc figé ; pas fait → annulé ; reporter → demain', () => {
  const C = busyWeeks();
  C.agenda.buildTasks(T);
  const b = C.agenda.schedule(T, T)[0]; // calculé à 07:00
  assert.ok(b);
  C.util.setNow(`${T}T${b.end}:00`);
  assert.equal(C.agenda.markBlock(b.id, true), true);
  const ag = C.state.agenda;
  assert.equal(ag.blocks[b.id].done, true);
  assert.ok(b.taskIds.every((id) => ag.tasks[id] && ag.tasks[id].done));
  const again = C.agenda.schedule(T, T);
  const pinned = again.find((x) => x.id === b.id);
  assert.ok(pinned && pinned.done && pinned.start === b.start);
  assert.ok(!again.some((x) => x !== pinned && x.taskIds.some((id) => b.taskIds.includes(id))), 'tâches pas replacées');
  // Le lendemain, le bloc fait reste visible (jour passé).
  C.util.setNow('2026-10-07T09:00:00');
  assert.ok(C.agenda.schedule(T, T).some((x) => x.id === b.id && x.done));
  C.util.setNow(`${T}T${b.end}:00`);
  // Annuler.
  assert.equal(C.agenda.markBlock(b.id, false), true);
  assert.equal(ag.blocks[b.id], undefined);
  assert.ok(b.taskIds.every((id) => !ag.tasks[id].done));
  // Bloc fini et pas coché : proposé « Fait ? » ; « pas fait » l'écarte, ses tâches restent à faire.
  assert.ok(C.agenda.missedBlocks().some((x) => x.id === b.id && x.missed));
  assert.ok(!C.agenda.schedule(T, T).some((x) => x.id === b.id), 'plus dans le planning (déjà fini)');
  assert.equal(C.agenda.markBlock(b.id, false), true);
  assert.equal(ag.blocks[b.id].dismissed, true);
  assert.ok(!C.agenda.missedBlocks().some((x) => x.id === b.id));
  const pool = C.agenda._t.taskPool(ag, T, '2026-10-19').map((t) => t.id);
  assert.ok(b.taskIds.every((id) => pool.includes(id)), 'tâches toujours à faire');
  // Coché en avance : daté de maintenant.
  C.util.setNow(`${T}T07:00:00`);
  const next = C.agenda.schedule(T, T).find((x) => toMin(x.start) > toMin('07:30'));
  if (next) {
    C.util.setNow(`${T}T07:40:00`);
    C.agenda.markBlock(next.id, true);
    assert.equal(ag.blocks[next.id].end, '07:40');
  }
  // Reporter : plus rien aujourd'hui pour ces tâches.
  C.util.setNow(`${T}T07:00:00`);
  const r = C.agenda.schedule(T, T).find((x) => !x.done);
  assert.ok(r);
  assert.equal(C.agenda.postponeBlock(r.id), true);
  assert.ok(r.taskIds.every((id) => ag.tasks[id].notBefore === '2026-10-07'));
  assert.ok(!C.agenda.schedule(T, T).some((x) => x.taskIds.some((id) => r.taskIds.includes(id))));
  const stats = C.agenda.weekStats(T);
  assert.ok(stats.plannedMin >= stats.doneMin && stats.doneMin > 0);
});

test('icsForRevisions : un événement par bloc à venir, heure UTC, rappel 10 min avant', () => {
  const C = busyWeeks();
  C.agenda.buildTasks(T);
  const blocks = C.agenda.schedule(T, '2026-10-12').filter((b) => !b.done);
  const ics = C.agenda.icsForRevisions(T, '2026-10-12');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, blocks.length);
  assert.equal((ics.match(/TRIGGER:-PT10M/g) || []).length, blocks.length);
  const b = blocks[0];
  const [h, m] = b.start.split(':').map(Number);
  const utc = `${b.date.replace(/-/g, '')}T${String(h - 2).padStart(2, '0')}${String(m).padStart(2, '0')}00Z`;
  assert.ok(ics.includes(`DTSTART:${utc}`), `DTSTART:${utc}`);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  // Relu par notre propre lecteur : mêmes horaires.
  const back = C.agenda.parseICS(ics, 'x', WIN);
  assert.equal(back.events.length, blocks.length);
  assert.equal(back.events[0].start, `${b.date}T${b.start}`);
});

/* ───────── Écrans (js/ui/agenda.js) ───────── */

function uiScenario(mutate, opts) {
  const C = setup(mutate, opts);
  load(['js/ui/components.js', 'js/ui/agenda.js'], { fresh: false });
  const routes = {}, actions = {}, changes = {}, submits = {}, menu = [];
  const log = { toasts: [], modals: [] };
  C.route = (p, v, o) => { routes[p] = { v, o }; };
  C.action = (n, f) => { actions[n] = f; };
  C.onChange = (n, f) => { changes[n] = f; };
  C.onInput = () => {};
  C.onSubmit = (n, f) => { submits[n] = f; };
  C.menuItem = (m) => menu.push(m);
  C.go = () => {};
  C.rerender = () => {};
  C.ui.toast = (m) => log.toasts.push(m);
  C.ui.openModal = (o) => { log.modals.push(o); return null; };
  C.ui.closeModal = () => {};
  C.ui.ask = async () => true;
  for (const fn of C.bootHooks || []) fn();
  return { C, routes, actions, changes, submits, menu, log };
}
const el = (dataset = {}, extra = {}) => ({ dataset, ...extra });

test('UI : routes, menu, écran d\'accueil sans calendrier, carte d\'invitation', () => {
  const { C, routes, menu } = uiScenario();
  assert.deepEqual(Object.keys(routes).sort(), ['#/agenda', '#/agenda-reglages', '#/agenda/:date']);
  assert.equal(routes['#/agenda'].o.tab, '#/agenda');
  assert.equal(routes['#/agenda'].o.title, 'Agenda');
  assert.deepEqual(menu.map((m) => [m.hash, m.label, m.order]), [['#/agenda-reglages', 'Agenda & révisions', 15]]);
  const html = routes['#/agenda'].v({});
  assert.match(html, /Ajouter mes calendriers/);
  assert.match(html, /Raccourci iOS/);
  assert.match(html, /jamais après 22 h/);
  assert.match(C.agendaUI.todayCard(T), /Ajouter mes calendriers/);
});

test('UI : vue jour (frise, révisions à cocher, sport), texte échappé', () => {
  const D = '2026-10-07';
  const { C, routes } = uiScenario(withSources([
    E('ecole', 'TD <b>Maths</b> "groupe"', `${D}T08:30`, `${D}T12:00`),
    E('ecole', 'CM Physique', `${D}T13:30`, `${D}T16:00`),
    E('pc', 'DPS Concert', `${D}T19:00`, `${D}T23:30`, { categories: ['DPS'] }),
    E('ecole', 'Journée portes ouvertes', D, D),
  ], (s) => { s.agenda.subjects = [{ id: 'phys', name: 'Physique', color: 'warn', match: ['physique'], ignore: false, weight: 2 }]; }),
  { sessions: { [D]: 60 } });
  const html = routes['#/agenda/:date'].v({ date: D });
  assert.match(html, /TD &lt;b&gt;Maths&lt;\/b&gt; &quot;groupe&quot;/);
  assert.ok(!/<b>Maths<\/b>/.test(html), 'aucun HTML injecté');
  assert.match(html, /agd-tl/);
  assert.match(html, />7:00</);
  assert.match(html, />23:00</);
  assert.match(html, /Révisions cette semaine/);
  assert.match(html, /Journée portes ouvertes/);
  assert.match(html, /href="#\/jour\/2026-10-07"/, 'séance de sport conseillée');
  assert.match(html, /Grosse journée Protection civile/);
  assert.match(html, /data-action="agenda.bloc"/);
  assert.match(html, /Fin des révisions 22:00/);
  const week = routes['#/agenda/:date'].v({ date: D, vue: 'semaine' });
  assert.equal((week.match(/class="card agd-wday/g) || []).length, 7);
  assert.match(week, /Semaine du 5 oct\./);
  const card = C.agendaUI.todayCard(T);
  assert.match(card, /Agenda/);
});

test('UI : cocher un bloc, feuille du bloc, reporter', async () => {
  const { C, actions, log } = uiScenario(withSources([E('ecole', 'CM Physique', `${T}T08:30`, `${T}T10:00`)], (s) => {
    s.agenda.subjects = [{ id: 'phys', name: 'Physique', color: 'warn', match: ['physique'], ignore: false, weight: 2 }];
  }));
  const html = C.agendaUI.viewDay({ date: T });
  const id = /data-action="agenda.cocher" data-id="([^"]+)"/.exec(html)[1].replace(/&#39;/g, '\'');
  const b = C.agenda.schedule(T, T).find((x) => x.id === id);
  C.util.setNow(`${T}T${b.end}:00`);
  actions['agenda.cocher'](el({ id, done: '1' }));
  assert.equal(C.state.agenda.blocks[id].done, true);
  assert.match(log.toasts.pop(), /Révision faite/);
  actions['agenda.bloc'](el({ id }));
  assert.match(log.modals.pop().body, /Pas fait finalement/);
  actions['agenda.cocher'](el({ id, done: '0' }));
  assert.equal(C.state.agenda.blocks[id], undefined);
  C.util.setNow(`${T}T07:00:00`);
  const next = C.agenda.schedule(T, T)[0];
  actions['agenda.bloc'](el({ id: next.id }));
  assert.match(log.modals.pop().body, /Reporter à demain/);
  actions['agenda.bloc-reporter'](el({ id: next.id }));
  assert.ok(next.taskIds.every((t) => C.state.agenda.tasks[t].notBefore === '2026-10-07'));
});

test('UI : coller (sans presse-papiers → zone de texte), un seul calendrier → choix de la source', () => {
  const { C, actions, log } = uiScenario();
  const saved = globalThis.navigator;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    actions['agenda.coller'](el());
    assert.equal(C.agendaUI._t.ui.pasteOpen, true);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: saved, configurable: true, writable: true });
  }
  // Un seul calendrier : la feuille propose les sources.
  C.agendaUI._t.handleText(cal(vev('UID:a', 'DTSTART:20261008T080000', 'DTEND:20261008T090000', 'SUMMARY:Club')));
  assert.match(log.modals.pop().body, /Nouveau : Protection civile/);
  actions['agenda.destination'](el({ kind: 'perso' }));
  assert.deepEqual(C.state.agenda.sources.map((s) => [s.kind, s.count]), [['perso', 1]]);
  // Le texte du Raccourci : import direct, résumé affiché dans les réglages.
  C.agendaUI._t.handleText(`--CREVARE-SOURCE cours Mes cours\n${ICS_COURS}\n--CREVARE-SOURCE protection-civile Protection civile\n${ICS_PC}`);
  assert.equal(C.state.agenda.sources.length, 3);
  const settings = C.agendaUI.viewSettings();
  assert.match(settings, /✓ Mes cours : 2 événements/);
  // Une page web : message clair, rien d'importé.
  C.agendaUI._t.handleText('<!doctype html><html><body>Connexion eProtec</body></html>');
  assert.match(C.agendaUI._t.ui.result[0], /page web/);
});

test('UI : réglages (sources, guide Raccourci, matières, règles) et modifications', async () => {
  const { C, changes, actions, submits } = uiScenario(withSources([E('ecole', 'CM Physique', `${T}T08:30`, `${T}T10:00`)], (s) => {
    s.agenda.sources[0].url = 'https://exemple.org/ical.php?v1="x"&y=<z>';
    s.agenda.subjects = [{ id: 'phys', name: 'Physique', color: 'warn', match: ['physique'], ignore: false, weight: 2 }];
  }));
  const html = C.agendaUI.viewSettings();
  assert.match(html, /value="https:\/\/exemple\.org\/ical\.php\?v1=&quot;x&quot;&amp;y=&lt;z&gt;"/);
  for (const step of ['Obtenir le contenu de l', 'Copier dans le presse-papiers', 'Ouvrir les URL', 'Automatisation', '--CREVARE-SOURCE cours Cours école', '--CREVARE-SOURCE protection-civile Protection civile']) {
    assert.ok(html.includes(step.replace(/'/g, '&#39;')), step);
  }
  assert.match(html, /type="time" value="22:00" data-change="agenda.regle" data-key="latestEnd"/);
  assert.match(html, /Physique/);
  changes['agenda.regle'](el({ key: 'latestEnd' }, { type: 'time', value: '21:30' }));
  assert.equal(C.agenda.revision().latestEnd, '21:30');
  changes['agenda.regle'](el({ key: 'latestEnd' }, { type: 'time', value: '01:00' }));
  assert.equal(C.agenda.revision().latestEnd, '21:30', 'heure de fin avant midi refusée');
  changes['agenda.regle'](el({ key: 'maxWeekdayMin' }, { type: 'text', value: '90' }));
  assert.equal(C.agenda.revision().maxWeekdayMin, 90);
  changes['agenda.regle'](el({ key: 'avoidTrainingDays' }, { type: 'checkbox', checked: true }));
  assert.equal(C.agenda.revision().avoidTrainingDays, true);
  actions['agenda.jour-off'](el({ day: '2' }));
  assert.deepEqual(C.agenda.revision().daysOff, [2]);
  actions['agenda.jour-off'](el({ day: '2' }));
  assert.deepEqual(C.agenda.revision().daysOff, []);
  changes['agenda.repas'](el({ part: 'start' }, { value: '19:00' }));
  assert.equal(C.agenda.revision().meal.start, '19:00');
  changes['agenda.matiere'](el({ id: 'phys', field: 'ignore' }, { type: 'checkbox', checked: true }));
  assert.equal(C.state.agenda.subjects[0].ignore, true);
  changes['agenda.matiere'](el({ id: 'phys', field: 'weight' }, { value: '3' }));
  assert.equal(C.state.agenda.subjects[0].weight, 3);
  changes['agenda.source'](el({ id: 'ecole', field: 'url' }, { value: ' webcal://exemple.org/a.ics ' }));
  assert.equal(C.state.agenda.sources[0].url, 'https://exemple.org/a.ics');
  const fd = (o) => ({ get: (k) => o[k] });
  submits['agenda.examen-ajout'](null, fd({ title: 'DS Physique', subjectId: 'phys', date: '2026-10-20' }));
  assert.ok(C.state.agenda.exams.some((x) => x.title === 'DS Physique' && x.source === 'manuel'));
  submits['agenda.source-ajout'](null, fd({ name: 'Club', kind: 'sport', url: '' }));
  assert.ok(C.state.agenda.sources.some((s) => s.name === 'Club' && s.kind === 'sport'));
  await actions['agenda.source-suppr'](el({ id: 'me' }));
  assert.ok(!C.state.agenda.sources.some((s) => s.id === 'me'));
});

test('UI : disposition en colonnes de la frise', () => {
  const { C } = uiScenario();
  const out = C.agendaUI._t.layoutColumns([{ s: 480, e: 600 }, { s: 540, e: 660 }, { s: 700, e: 760 }, { s: 500, e: 520 }]);
  const by = (s) => out.find((x) => x.s === s);
  assert.equal(by(480).cols, 2, 'deux colonnes suffisent (500–520 libère la sienne avant 540)');
  assert.equal(by(700).cols, 1);
  assert.notEqual(by(480).col, by(500).col);
  assert.equal(by(540).col, by(500).col);
  assert.equal(C.agendaUI._t.fmtMin(100), '1 h 40');
  assert.equal(C.agendaUI._t.fmtMin(45), '45 min');
});
