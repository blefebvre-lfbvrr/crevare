/* Crevare — chronomètres et minuteurs : onglet « Chrono » (#/chrono, #/chrono/:mode) et C.timer.
 *
 * Organisation du fichier :
 *  1. Moteur de séquence (pur, testable) : préparation, étapes, tours, repos entre tours, pause,
 *     étape suivante/précédente, +10 s, événements (début, décompte, fin d'étape, fin).
 *  2. Chrono à temps intermédiaires (pur) : tests SSA, TSA, HYROX.
 *  3. Luc Léger (pur) : calendrier des navettes, position à l'instant t, score en demi-paliers.
 *  4. Données (pur) : préréglages, définitions des tests, verdicts, contrôle d'un minuteur perso.
 *  5. Mémoire locale des chronos en cours (rechargement sans perte).
 *  6. Minuteur plein écran (C.timer.open) et barre de repos (C.timer.rest).
 *  7. Écrans de l'onglet Chrono.
 *  8. Enregistrement des routes et actions.
 *
 * Durées en secondes, instants en millisecondes. On mesure avec Date.now() : l'horloge continue
 * pendant la veille de l'iPhone (performance.now() peut s'arrêter), et la position dans la séquence
 * est toujours recalculée à partir des instants (robuste aux onglets ralentis et à l'écran verrouillé). */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;
  const hasDoc = typeof document !== 'undefined';
  const nowMs = () => Date.now();

  /* ═════════════════ 1. Moteur de séquence (pur) ═════════════════ */

  const LATE_SEC = 1.5; // un début d'étape découvert plus tard que ça (écran verrouillé) n'est pas annoncé
  const MAX_ROUNDS = 99;
  const COUNT_WORDS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq'];

  const toInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? U.clamp(n, lo, hi) : dflt;
  };

  // TimerSpec → forme sûre. Les étapes sans durée valable sont ignorées.
  function normSpec(spec) {
    const s = U.isObj(spec) ? spec : {};
    const steps = [];
    for (const st of Array.isArray(s.steps) ? s.steps : []) {
      if (!U.isObj(st)) continue;
      const sec = Math.round(Number(st.sec));
      if (!(sec > 0)) continue;
      const kind = st.kind === 'rest' ? 'rest' : 'work';
      steps.push({
        label: String(st.label ?? '').trim().slice(0, 80) || (kind === 'rest' ? 'Repos' : 'Effort'),
        sec: Math.min(sec, 6 * 3600), kind, exId: st.exId || null,
      });
    }
    return {
      name: String(s.name ?? '').trim().slice(0, 80) || 'Minuteur',
      voice: s.voice === true,
      prepSec: toInt(s.prepSec, 0, 600, 0),
      rounds: toInt(s.rounds, 1, MAX_ROUNDS, 1),
      restBetweenRoundsSec: toInt(s.restBetweenRoundsSec, 0, 3600, 0),
      steps,
    };
  }

  // Pose start/end sur chaque segment ; renvoie la durée totale.
  function layout(segs) {
    let t = 0;
    for (const g of segs) { g.start = t; t += g.sec; g.end = t; }
    return t;
  }

  /* Séquence complète = préparation + tours × étapes (+ repos entre les tours).
   * Les repos en fin de tour sont retirés quand un repos entre tours les remplace, et à la toute fin
   * (rien à récupérer après le dernier effort). « {tour} » dans un libellé = numéro du tour. */
  function buildSegments(spec) {
    const s = normSpec(spec);
    if (!s.steps.some((st) => st.kind === 'work')) return [];
    const segs = [];
    if (s.prepSec > 0) segs.push({ kind: 'prep', label: 'Préparation', sec: s.prepSec, round: 1, step: -1, exId: null });
    for (let r = 1; r <= s.rounds; r++) {
      const list = s.steps.map((st, k) => ({ kind: st.kind, label: st.label.replace(/\{tour\}/g, String(r)), sec: st.sec, round: r, step: k, exId: st.exId }));
      const last = r === s.rounds;
      const roundRest = !last && s.restBetweenRoundsSec > 0;
      if (last || roundRest) while (list.length && list[list.length - 1].kind === 'rest') list.pop();
      segs.push(...list);
      if (roundRest) segs.push({ kind: 'rest', label: 'Repos entre les tours', sec: s.restBetweenRoundsSec, round: r, step: -1, exId: null, roundRest: true });
    }
    layout(segs);
    return segs;
  }

  const totalOf = (spec) => { const segs = buildSegments(spec); return segs.length ? segs[segs.length - 1].end : 0; };

  // Décompte de fin d'étape : avec voix « 5…1 » (si l'étape est assez longue pour l'annonce),
  // sans voix, bips à 3, 2, 1.
  function countFrom(sec, voice) {
    if (voice) return sec >= 15 ? 5 : sec >= 8 ? 3 : 0;
    return sec >= 6 ? 3 : 0;
  }

  function createRun(spec) {
    const s = normSpec(spec);
    const segs = buildSegments(s);
    return {
      spec: s, segs, total: segs.length ? segs[segs.length - 1].end : 0, rounds: s.rounds,
      startedAt: null, pausedAt: null, pausedMs: 0, shift: 0, fired: {}, lastIdx: -1, manual: false,
    };
  }

  // Temps écoulé (s) dans la séquence, non borné.
  function rawElapsed(run, now) {
    if (run.startedAt == null) return run.shift;
    const ref = run.pausedAt != null ? run.pausedAt : now;
    return (ref - run.startedAt - run.pausedMs) / 1000 + run.shift;
  }
  const elapsed = (run, now) => U.clamp(rawElapsed(run, now), 0, run.total);

  function start(run, now) { if (run.startedAt == null) run.startedAt = now; return run; }
  function pause(run, now) { if (run.startedAt != null && run.pausedAt == null) run.pausedAt = now; return run; }
  function resume(run, now) {
    if (run.pausedAt != null) { run.pausedMs += now - run.pausedAt; run.pausedAt = null; }
    return run;
  }
  const isPaused = (run) => run.pausedAt != null;

  // Segment en cours à t (une frontière appartient au segment suivant ; t = total → dernier).
  function indexAt(segs, t) {
    for (let i = 0; i < segs.length; i++) if (t < segs[i].end) return i;
    return segs.length - 1;
  }

  function snapshot(run, now) {
    const t = elapsed(run, now);
    const segs = run.segs;
    if (!segs.length) {
      return { t: 0, i: -1, seg: null, nextSeg: null, nextWork: null, remaining: 0, inSeg: 0, segProgress: 1, total: 0, totalRemaining: 0, progress: 1, round: 0, rounds: run.rounds, done: true, paused: false, started: run.startedAt != null };
    }
    const i = indexAt(segs, t);
    const seg = segs[i];
    const done = t >= run.total;
    let nextWork = null;
    for (let k = i + 1; k < segs.length; k++) if (segs[k].kind === 'work') { nextWork = segs[k]; break; }
    return {
      t, i, seg, nextSeg: segs[i + 1] || null, nextWork,
      remaining: done ? 0 : Math.max(0, seg.end - t),
      inSeg: t - seg.start,
      segProgress: seg.sec ? U.clamp((t - seg.start) / seg.sec, 0, 1) : 1,
      total: run.total, totalRemaining: Math.max(0, run.total - t), progress: run.total ? t / run.total : 1,
      round: seg.round, rounds: run.rounds, done, paused: run.pausedAt != null, started: run.startedAt != null,
    };
  }

  // Déplace la position (s) ; les événements des étapes suivantes pourront se redéclencher.
  function seek(run, now, target) {
    const t = U.clamp(target, 0, run.total);
    run.shift += t - rawElapsed(run, now);
    const i = indexAt(run.segs, t);
    for (const k of Object.keys(run.fired)) {
      const m = /^c(\d+)_/.exec(k);
      if (k === 'finish' ? t < run.total : m && Number(m[1]) >= i) delete run.fired[k];
    }
    run.lastIdx = -2;
    run.manual = true;
    return run;
  }
  function next(run, now) {
    const s = snapshot(run, now);
    if (!s.seg) return run;
    return seek(run, now, s.nextSeg ? s.nextSeg.start : run.total);
  }
  // Précédent : revient au début de l'étape en cours (après 2 s), sinon à l'étape d'avant.
  function prev(run, now) {
    const s = snapshot(run, now);
    if (!s.seg) return run;
    return seek(run, now, s.inSeg > 2 || s.i === 0 ? s.seg.start : run.segs[s.i - 1].start);
  }
  // Ajoute du temps à l'étape en cours (le décompte de cette étape pourra se refaire).
  function addTime(run, now, sec = 10) {
    const s = snapshot(run, now);
    if (s.done || !s.seg) return run;
    s.seg.sec += sec;
    run.total = layout(run.segs);
    for (const k of Object.keys(run.fired)) if (k.startsWith(`c${s.i}_`)) delete run.fired[k];
    return run;
  }

  /* Événements à jouer depuis le dernier appel. Chaque événement n'est émis qu'une fois.
   *  { type:'end', i, seg, to }         fin naturelle d'une étape (bip long)
   *  { type:'start', i, seg, next, nextWork, manual, first }  début d'étape (annonce)
   *  { type:'count', i, n, seg }        décompte (n = 5…1)
   *  { type:'finish', late }            fin de la séquence
   * Après une longue absence (écran verrouillé), les événements dépassés ne sont pas rejoués. */
  function poll(run, now, opts = {}) {
    const ev = [];
    if (!run.segs.length || run.startedAt == null) return ev;
    const s = snapshot(run, now);
    if (s.done) {
      if (!run.fired.finish) {
        run.fired.finish = true;
        ev.push({ type: 'finish', late: rawElapsed(run, now) - run.total > LATE_SEC });
      }
      return ev;
    }
    if (s.i !== run.lastIdx) {
      const before = run.lastIdx;
      const manual = run.manual;
      run.lastIdx = s.i;
      run.manual = false;
      const fresh = s.inSeg <= LATE_SEC;
      if (fresh && !manual && before >= 0 && s.i === before + 1) ev.push({ type: 'end', i: before, seg: run.segs[before], to: s.seg });
      if (fresh) ev.push({ type: 'start', i: s.i, seg: s.seg, next: s.nextSeg, nextWork: s.nextWork, manual, first: before === -1 });
    }
    const from = countFrom(s.seg.sec, !!opts.voice);
    const n = Math.ceil(s.remaining - 1e-6);
    if (from && n >= 1 && n <= from) {
      const key = `c${s.i}_${n}`;
      if (!run.fired[key]) {
        for (let k = n; k <= from; k++) run.fired[`c${s.i}_${k}`] = true;
        ev.push({ type: 'count', i: s.i, n, seg: s.seg });
      }
    }
    return ev;
  }

  // « 45 secondes », « 1 minute 30 », « 2 minutes »
  function durationWords(sec) {
    const s = Math.max(0, Math.round(sec));
    if (s < 60) return s <= 1 ? `${s} seconde` : `${s} secondes`;
    const m = Math.floor(s / 60), r = s % 60;
    const mm = m === 1 ? '1 minute' : `${m} minutes`;
    return r ? `${mm} ${r}` : mm;
  }
  // Phrase dite au début d'une étape.
  function announceText(seg, nextWork) {
    if (!seg) return '';
    if (seg.kind === 'prep') return nextWork ? `Prépare-toi. Premier exercice : ${nextWork.label}.` : 'Prépare-toi.';
    const head = `${seg.label}, ${durationWords(seg.sec)}.`;
    if (seg.kind === 'rest') return nextWork ? `${head} Suivant : ${nextWork.label}.` : head;
    return head;
  }
  // « Tour 2/3 · Exercice 4/6 »
  function positionText(run, seg) {
    if (!seg) return '';
    if (seg.kind === 'prep') return run.rounds > 1 ? `${run.rounds} tours` : '';
    const parts = [];
    if (run.rounds > 1) parts.push(`Tour ${seg.round}/${run.rounds}`);
    const works = run.spec.steps.filter((st) => st.kind === 'work');
    if (works.length > 1 && seg.kind === 'work' && seg.step >= 0) {
      const k = run.spec.steps.slice(0, seg.step + 1).filter((st) => st.kind === 'work').length;
      parts.push(`Exercice ${k}/${works.length}`);
    }
    return parts.join(' · ') || (seg.kind === 'rest' ? 'Récupération' : '');
  }

  /* ═════════════════ 2. Chrono à temps intermédiaires (pur) ═════════════════ */

  const MIN_LAP_MS = 1000; // deux appuis à moins d'1 s = double appui involontaire

  function createSplit(segments, opts = {}) {
    return { id: opts.id || U.uid(), segments: (segments || []).map((x) => String(x)), startedAt: null, pausedAt: null, pausedMs: 0, laps: [], finishedAt: null };
  }
  function splitStatus(r) {
    if (r.startedAt == null) return 'idle';
    if (r.finishedAt != null) return 'done';
    return r.pausedAt != null ? 'pause' : 'run';
  }
  function splitElapsedMs(r, now) {
    if (r.startedAt == null) return 0;
    const ref = r.finishedAt != null ? r.finishedAt : r.pausedAt != null ? r.pausedAt : now;
    return Math.max(0, ref - r.startedAt - r.pausedMs);
  }
  function splitStart(r, now) { if (r.startedAt == null && r.segments.length) r.startedAt = now; return r; }
  // Fin du segment en cours. Renvoie false si ignoré (pas lancé, en pause, double appui).
  function splitLap(r, now) {
    if (splitStatus(r) !== 'run') return false;
    const ms = splitElapsedMs(r, now);
    const before = r.laps.length ? r.laps[r.laps.length - 1] : 0;
    if (ms - before < MIN_LAP_MS) return false;
    r.laps.push(ms);
    if (r.laps.length >= r.segments.length) r.finishedAt = now;
    return true;
  }
  // Annule le dernier temps (le chrono continue depuis le départ réel).
  function splitUndo(r) {
    if (!r.laps.length) return false;
    r.laps.pop();
    r.finishedAt = null;
    return true;
  }
  function splitPause(r, now) { if (splitStatus(r) === 'run') r.pausedAt = now; return r; }
  function splitResume(r, now) {
    if (r.pausedAt != null) { r.pausedMs += now - r.pausedAt; r.pausedAt = null; }
    return r;
  }
  // [{ label, i, sec (durée du segment), cum (cumul) }] ; null tant que le segment n'est pas fini.
  function splitTimes(r) {
    return r.segments.map((label, i) => {
      const cum = r.laps[i];
      if (cum == null) return { label, i, sec: null, cum: null };
      return { label, i, sec: (cum - (i ? r.laps[i - 1] : 0)) / 1000, cum: cum / 1000 };
    });
  }
  const splitTotal = (r) => (r.laps.length >= r.segments.length && r.segments.length ? r.laps[r.segments.length - 1] / 1000 : null);
  const splitCurrent = (r) => Math.min(r.laps.length, Math.max(0, r.segments.length - 1));

  // Relit un chrono sauvegardé (données locales potentiellement abîmées).
  function reviveSplit(o) {
    if (!U.isObj(o) || !Array.isArray(o.segments) || !o.segments.length) return null;
    const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    const laps = Array.isArray(o.laps) ? o.laps.filter((x) => typeof x === 'number' && isFinite(x) && x >= 0) : [];
    for (let i = 1; i < laps.length; i++) if (laps[i] < laps[i - 1]) return null;
    const segments = o.segments.slice(0, 60).map((x) => String(x).slice(0, 120));
    const r = {
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 80) : U.uid(), segments,
      startedAt: n(o.startedAt), pausedAt: n(o.pausedAt), pausedMs: Math.max(0, n(o.pausedMs) || 0),
      laps: laps.slice(0, segments.length), finishedAt: n(o.finishedAt),
    };
    if (r.startedAt == null) Object.assign(r, { laps: [], finishedAt: null, pausedAt: null, pausedMs: 0 });
    if (r.laps.length >= r.segments.length) {
      r.pausedAt = null;
      if (r.finishedAt == null) r.finishedAt = r.startedAt + r.pausedMs + r.laps[r.laps.length - 1];
    } else r.finishedAt = null;
    return r;
  }

  /* ═════════════════ 3. Luc Léger (pur) ═════════════════
   * Navettes de 20 m, paliers d'environ 1 min, +0,5 km/h par palier.
   * Durée d'une navette = 20 m ÷ vitesse = 72 / v (s). Nombre de navettes d'un palier = arrondi(60 s ÷ durée),
   * soit 7 au palier 1 (8,5 km/h), 8 au palier 2… ; le palier dure donc environ 1 min. */

  const LEGER_VERSIONS = {
    '8.5': { id: '8.5', start: 8.5, short: 'bande 1988 (départ 8,5 km/h)', label: 'Version 1988 (Léger et al.) : départ à 8,5 km/h, +0,5 km/h par palier d’environ 1 min, navettes de 20 m.' },
    '8': { id: '8', start: 8, short: 'bande militaire (départ 8 km/h)', label: 'Version « militaire » : départ à 8 km/h, +0,5 km/h par palier d’environ 1 min, navettes de 20 m.' },
  };
  const LEGER_MAX = 21;

  function legerSchedule(version = '8.5', maxPaliers = LEGER_MAX) {
    const v0 = (LEGER_VERSIONS[version] || LEGER_VERSIONS['8.5']).start;
    const out = [];
    let t = 0, cum = 0;
    for (let p = 1; p <= maxPaliers; p++) {
      const speed = v0 + 0.5 * (p - 1);
      const shuttleSec = 72 / speed;
      const shuttles = Math.round((speed * 60) / 72 + 1e-9);
      const dur = shuttles * shuttleSec;
      out.push({ palier: p, speed, shuttleSec, shuttles, start: t, dur, end: t + dur, cumBefore: cum, cumAfter: cum + shuttles });
      t += dur;
      cum += shuttles;
    }
    return out;
  }

  // Où en est-on à t secondes du départ ?
  function legerAt(schedule, t) {
    const last = schedule[schedule.length - 1];
    if (t >= last.end) {
      return { t, palier: last.palier, speed: last.speed, shuttles: last.shuttles, shuttleSec: last.shuttleSec, completedInPalier: last.shuttles, completed: last.cumAfter, current: last.shuttles, shuttleProgress: 1, timeToBeep: 0, ended: true };
    }
    const p = t <= 0 ? schedule[0] : schedule.find((x) => t < x.end);
    const inP = Math.max(0, t - p.start);
    const k = Math.min(p.shuttles - 1, Math.floor(inP / p.shuttleSec + 1e-9));
    const into = inP - k * p.shuttleSec;
    return {
      t, palier: p.palier, speed: p.speed, shuttles: p.shuttles, shuttleSec: p.shuttleSec,
      completedInPalier: k, completed: p.cumBefore + k, current: k + 1,
      shuttleProgress: U.clamp(into / p.shuttleSec, 0, 1), timeToBeep: p.shuttleSec - into, ended: false,
    };
  }

  // Score : dernier palier terminé, + 0,5 si au moins la moitié des navettes du palier suivant sont faites.
  function legerScore(schedule, completed) {
    const done = Math.max(0, Math.floor(Number(completed) || 0));
    let finished = 0;
    for (const p of schedule) {
      if (done >= p.cumAfter) { finished = p.palier; continue; }
      const k = done - p.cumBefore;
      const half = k >= Math.ceil(p.shuttles / 2);
      return { value: finished + (half ? 0.5 : 0), palierDone: finished, half, inPalier: p.palier, shuttlesInPalier: k, shuttlesOfPalier: p.shuttles, distance: done * 20, completed: done };
    }
    const last = schedule[schedule.length - 1];
    return { value: last.palier, palierDone: last.palier, half: false, inPalier: last.palier, shuttlesInPalier: last.shuttles, shuttlesOfPalier: last.shuttles, distance: done * 20, completed: done };
  }

  // Signaux sonores (t en s depuis le départ) : 3 bips de préparation, départ, fin de chaque navette.
  function legerCues(schedule) {
    const cues = [{ t: -3, kind: 'tick' }, { t: -2, kind: 'tick' }, { t: -1, kind: 'tick' }, { t: 0, kind: 'go' }];
    for (const p of schedule) {
      for (let k = 1; k <= p.shuttles; k++) cues.push({ t: p.start + k * p.shuttleSec, kind: k === p.shuttles ? 'palier' : 'shuttle', palier: p.palier, k });
    }
    return cues;
  }
  // Annonces vocales des paliers.
  const legerSpeech = (schedule) => schedule.map((p) => ({ t: p.start + 0.6, text: `Palier ${p.palier}` })); // après le bip de changement

  // VMA estimée (km/h) : VO2max = −24,4 + 6 × V ; VMA ≈ VO2max / 3,5 (estimation prudente).
  function legerVma(score, version) {
    if (!(score >= 1)) return null;
    if (C.data && typeof C.data.legerVma === 'function') {
      try { const v = C.data.legerVma(score, version); if (v != null) return v; } catch (e) { /* calcul local */ }
    }
    const start = (LEGER_VERSIONS[version] || LEGER_VERSIONS['8.5']).start;
    return U.round((-24.4 + 6 * (start + 0.5 * (score - 1))) / 3.5, 1);
  }

  /* ═════════════════ 4. Données (pur) ═════════════════ */

  const W = (label, sec, exId) => ({ label, sec, kind: 'work', exId: exId || null });
  const R = (sec, label = 'Repos') => ({ label, sec, kind: 'rest' });

  // Préréglages (non modifiables ; « Copier et modifier » en fait un minuteur perso).
  const PRESETS = [
    {
      id: 'abdos10', name: 'Abdos 10 min', voice: true, prepSec: 10, rounds: 2, restBetweenRoundsSec: 45, group: 'abdos',
      desc: 'Voix : annonce de chaque exercice et décompte « 5, 4, 3, 2, 1 ».',
      steps: [W('Planche', 40, 'plank'), R(15), W('Crunch', 30, 'crunch'), R(15), W('Hollow hold', 30, 'hollow_hold'), R(15),
        W('Rotations russes', 30, 'russian_twist'), R(15), W('Relevés de jambes', 30, 'leg_raise_floor'), R(15), W('Dead bug', 40, 'dead_bug')],
    },
    {
      id: 'gainage6', name: 'Gainage 6 exercices', voice: true, prepSec: 10, rounds: 2, restBetweenRoundsSec: 60, group: 'abdos',
      desc: 'Planche, planche latérale (2 côtés), hollow, bird dog, superman, dead bug. Avec la voix.',
      steps: [W('Planche', 45, 'plank'), R(15), W('Planche latérale, côté gauche', 30, 'side_plank'), R(5, 'Change de côté'),
        W('Planche latérale, côté droit', 30, 'side_plank'), R(15), W('Hollow hold', 30, 'hollow_hold'), R(15),
        W('Bird dog', 40, 'bird_dog'), R(15), W('Superman', 30, 'superman'), R(15), W('Dead bug', 40, 'dead_bug')],
    },
    {
      id: 'tabata', name: 'Tabata 8 × 20/10', voice: false, prepSec: 10, rounds: 8, restBetweenRoundsSec: 0,
      desc: '20 s à fond, 10 s de repos, 8 fois. Bips seulement.',
      steps: [W('Effort', 20), R(10)],
    },
    {
      id: 'emom10', name: 'EMOM 10 min', voice: false, prepSec: 10, rounds: 10, restBetweenRoundsSec: 0,
      desc: 'Au début de chaque minute : tes répétitions, puis repos jusqu’au bip.',
      steps: [W('Minute {tour}', 60)],
    },
    {
      id: 'i3030', name: '30/30 × 10', voice: false, prepSec: 10, rounds: 10, restBetweenRoundsSec: 0,
      desc: '30 s vite, 30 s lent. Course, rameur, vélo ou SkiErg.',
      steps: [W('Vite', 30), R(30, 'Lent')],
    },
    {
      id: 'rehab', name: 'Réhab cheville / genou', voice: false, prepSec: 10, rounds: 1, restBetweenRoundsSec: 0,
      desc: 'Équilibre, mobilité, mollets, tibial, squat espagnol, descente de marche, extension du genou.',
      note: 'Sans douleur : reste sous 3/10. Si ça fait plus mal, arrête et parles-en à un professionnel de santé.',
      steps: [W('Équilibre, jambe gauche', 30, 'single_leg_balance'), R(5, 'Change de jambe'), W('Équilibre, jambe droite', 30, 'single_leg_balance'), R(10),
        W('Genou au mur (mobilité cheville)', 45, 'ankle_knee_to_wall'), R(10), W('Mollets excentriques', 45, 'calf_raise_eccentric'), R(15),
        W('Relevés de pointe de pied', 40, 'tibialis_raise'), R(15), W('Squat espagnol (tenue)', 45, 'spanish_squat'), R(15),
        W('Descente de marche, jambe gauche', 40, 'step_down'), R(5, 'Change de jambe'), W('Descente de marche, jambe droite', 40, 'step_down'), R(15),
        W('Extension du genou à l’élastique', 45, 'tke_band')],
    },
  ];
  const getPreset = (id) => PRESETS.find((p) => p.id === id) || null;

  // Résumé d'un minuteur : « 2 tours · 6 exercices · 10:05 »
  function timerSummary(spec) {
    const s = normSpec(spec);
    const works = s.steps.filter((st) => st.kind === 'work').length;
    const parts = [];
    if (s.rounds > 1) parts.push(U.plural(s.rounds, 'tour', 'tours'));
    parts.push(U.plural(works, 'exercice', 'exercices'));
    parts.push(U.formatDuration(totalOf(s)));
    return parts.join(' · ');
  }

  // Contrôle d'un minuteur perso avant enregistrement → { timer, errors }.
  function sanitizeTimer(d) {
    const src = U.isObj(d) ? d : {};
    const errors = [];
    const raw = Array.isArray(src.steps) ? src.steps : [];
    raw.forEach((st, i) => { if (!U.isObj(st) || !(Math.round(Number(st.sec)) > 0)) errors.push(`Étape ${i + 1} : indique une durée.`); });
    const s = normSpec(src);
    if (!raw.length) errors.push('Ajoute au moins une étape.');
    else if (!s.steps.some((st) => st.kind === 'work')) errors.push('Ajoute au moins une étape de travail.');
    const timer = {
      id: typeof src.id === 'string' && src.id ? src.id : U.uid(),
      name: String(src.name ?? '').trim().slice(0, 80) || 'Mon minuteur',
      voice: s.voice, rounds: s.rounds, prepSec: s.prepSec, restBetweenRoundsSec: s.restBetweenRoundsSec,
      steps: s.steps.map((st) => (st.exId ? { label: st.label, sec: st.sec, kind: st.kind, exId: st.exId } : { label: st.label, sec: st.sec, kind: st.kind })),
    };
    return { timer, errors };
  }

  /* Tests chronométrés. Valeurs officielles relevées chez des organismes de formation
   * (circulaire SSA non lue) : C.data.targetFor() est prioritaire quand il existe. */
  const SSA_ENTRY = {
    key: 'ssa-entree', benchId: 'ssa_entry_test', title: "Test d'entrée SSA", pool: true,
    segments: ['Plongeon + 25 m (dont ≥ 15 m en immersion)', '50 m crawl', '25 m dos, mains hors de l’eau'],
    startLabel: 'Départ (plongeon)',
    taps: ['Fin du 25 m plongé', 'Fin du 50 m crawl', 'Arrivée'],
    checks: [
      { k: 'apnee', label: 'Au moins 15 m en immersion complète après le plongeon', fail: 'moins de 15 m en immersion' },
      { k: 'appui', label: 'Aucun appui pour se reposer (bord, ligne d’eau, fond)', fail: 'appui pendant le test' },
      { k: 'mains', label: 'Au dos : les deux mains hors de l’eau jusqu’au bout', fail: 'mains dans l’eau pendant le dos' },
    ],
    fallback: { official: 165, target: 135 },
  };
  const TSA_COURSE = {
    key: 'ssa-tsa.course', benchId: 'ssa_tsa_course', title: 'TSA — parcours de sauvetage', pool: true,
    segments: ['Plongeon + 15 m en immersion + 10 m de nage', '25 m crawl', '15 m en immersion + 10 m de nage', 'Approche, canard et saisie du mannequin', 'Remorquage jusqu’au bord de départ'],
    startLabel: 'Départ (plongeon)',
    taps: ['Fin : 1re apnée + 10 m', 'Fin du 25 m crawl', 'Fin : 2e apnée + 10 m', 'Mannequin saisi', 'Arrivée au bord'],
    checks: [
      { k: 'apnee1', label: '1re apnée : 15 m en immersion complète', fail: '1re apnée trop courte' },
      { k: 'apnee2', label: '2e apnée : 15 m en immersion complète', fail: '2e apnée trop courte' },
      { k: 'visage', label: 'Visage du mannequin jamais immergé plus de 3 s de suite', fail: 'visage du mannequin immergé plus de 3 s' },
      { k: 'voies', label: 'Voies aériennes du mannequin dégagées pendant le remorquage', fail: 'voies aériennes du mannequin non dégagées' },
      { k: 'appui', label: 'Aucun appui pour se reposer', fail: 'appui pendant le parcours' },
    ],
    fallback: { official: 150, target: 125 },
  };
  const TSA_FINS = {
    key: 'ssa-tsa.fins', benchId: 'ssa_tsa_fins', title: 'TSA — 300 m palmes', pool: true,
    segments: ['Chaussage des palmes', '1er 100 m', '2e 100 m', '3e 100 m'],
    startLabel: 'Signal : départ (palmes à la main)',
    taps: ['Palmes chaussées, dans l’eau', '100 m', '200 m', 'Arrivée 300 m'],
    checks: [
      { k: 'depart', label: 'Départ au bord, palmes pas encore chaussées', fail: 'palmes chaussées avant le signal' },
      { k: 'ventral', label: 'Nage ventrale tout du long', fail: 'nage non ventrale' },
      { k: 'equip', label: 'Aucune perte de palme ni de matériel', fail: 'perte de palme ou de matériel' },
    ],
    fallback: { official: 270, target: 235 },
  };
  const HYROX_STATIONS = ['SkiErg 1000 m', 'Sled push 50 m', 'Sled pull 50 m', 'Burpee broad jumps 80 m', 'Rameur 1000 m', 'Farmers carry 200 m', 'Fentes sandbag 100 m', 'Wall balls 100'];
  const HYROX = {
    key: 'hyrox', benchId: 'hyrox_sim', title: 'Simulation HYROX', pausable: true,
    checks: [{ k: 'complet', label: 'Distances et charges de ta division (simulation complète)', fail: 'simulation partielle' }],
    startLabel: 'Départ',
  };

  // Segments HYROX : 8 × (1 km + station), Roxzone facultative (entrée et sortie de chaque station).
  function hyroxSegments(opts = {}) {
    const out = [];
    for (let k = 0; k < 8; k++) {
      out.push({ kind: 'run', label: `Course ${k + 1} (1 km)` });
      if (opts.roxzone) out.push({ kind: 'rox', label: `Roxzone (entrée ${k + 1})` });
      out.push({ kind: 'station', label: `${k + 1}. ${HYROX_STATIONS[k]}` });
      if (opts.roxzone && k < 7) out.push({ kind: 'rox', label: `Roxzone (sortie ${k + 1})` });
    }
    return out;
  }
  // Totaux par type, km le plus lent, écart entre le 1er et le dernier km.
  function hyroxSummary(defs, secs) {
    const sum = { run: 0, station: 0, rox: 0, total: 0, runs: [], stations: [] };
    defs.forEach((d, i) => {
      const v = secs[i];
      if (v == null || !isFinite(v)) return;
      sum[d.kind] += v;
      sum.total += v;
      if (d.kind === 'run') sum.runs.push(v);
      if (d.kind === 'station') sum.stations.push({ label: d.label, sec: v });
    });
    sum.runAvg = sum.runs.length ? sum.run / sum.runs.length : null;
    sum.runDrift = sum.runs.length >= 2 ? sum.runs[sum.runs.length - 1] - sum.runs[0] : null;
    sum.slowestRun = sum.runs.length ? Math.max(...sum.runs) : null;
    sum.longestStation = sum.stations.reduce((a, b) => (!a || b.sec > a.sec ? b : a), null);
    return sum;
  }

  /* Verdict d'un test chronométré.
   * answers : { [k]: 'oui' | 'non' } ; checks : [{ k, label, fail }] ; ref : { official, target } en secondes (null = inconnu).
   * level : 'elimine' (critère non respecté) · 'temps' (au-dessus du seuil) · 'incomplet' (critères à cocher)
   *         · 'cible' (seuil + marge) · 'reussi' (seuil seulement) · 'inconnu' (pas de seuil).
   * context : 'test' si toutes les règles sont respectées, sinon 'entrainement' (ne compte pas comme meilleur temps). */
  function verdict(totalSec, answers, checks, ref) {
    const a = answers || {};
    const list = checks || [];
    const failed = list.filter((c) => a[c.k] === 'non').map((c) => c.fail || c.label);
    const pending = list.filter((c) => a[c.k] !== 'oui' && a[c.k] !== 'non').map((c) => c.label);
    const off = ref && ref.official != null ? ref.official : null;
    const tgt = ref && ref.target != null ? ref.target : null;
    const timeOk = off == null || totalSec == null ? null : totalSec <= off;
    const targetOk = tgt == null || totalSec == null ? null : totalSec <= tgt;
    let level;
    if (failed.length) level = 'elimine';
    else if (timeOk === false) level = 'temps';
    else if (pending.length) level = 'incomplet';
    else if (targetOk) level = 'cible';
    else if (timeOk) level = 'reussi';
    else level = 'inconnu';
    return {
      level, failed, pending, timeOk, targetOk, rulesOk: !failed.length && !pending.length,
      valid: !failed.length && !pending.length && timeOk !== false,
      context: failed.length ? 'entrainement' : 'test',
      marginOfficial: off != null && totalSec != null ? off - totalSec : null,
      marginTarget: tgt != null && totalSec != null ? tgt - totalSec : null,
    };
  }

  /* ═════════════════ 5. Mémoire locale des chronos en cours ═════════════════
   * Clé séparée de l'état principal : enregistrée à chaque appui, sans re-rendre l'écran,
   * pour reprendre un test ou un chrono après un rechargement de la page. Reste sur l'appareil. */

  const LS_KEY = 'crevare.v2.chrono';
  let mem = null;

  const newSw = () => ({ startedAt: null, acc: 0, laps: [] });
  const numOrNull = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

  function loadMem() {
    if (mem) return mem;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { raw = null; }
    mem = { v: 1, sw: newSw(), tests: {}, history: {}, prefs: {} };
    if (!U.isObj(raw)) return mem;
    if (U.isObj(raw.sw)) {
      const laps = Array.isArray(raw.sw.laps) ? raw.sw.laps.filter((x) => typeof x === 'number' && isFinite(x) && x >= 0).slice(0, 500) : [];
      mem.sw = { startedAt: numOrNull(raw.sw.startedAt), acc: Math.max(0, numOrNull(raw.sw.acc) || 0), laps };
    }
    if (U.isObj(raw.tests)) for (const [k, v] of Object.entries(raw.tests)) if (U.isObj(v)) mem.tests[k] = v;
    if (U.isObj(raw.history)) {
      for (const [k, list] of Object.entries(raw.history)) {
        if (!Array.isArray(list)) continue;
        mem.history[k] = list.filter((h) => U.isObj(h) && U.isKey(h.date) && Array.isArray(h.splits)).slice(-10)
          .map((h) => ({ date: h.date, id: String(h.id || ''), total: numOrNull(h.total), splits: h.splits.map(numOrNull) }));
      }
    }
    if (U.isObj(raw.prefs)) mem.prefs = { minVoice: raw.prefs.minVoice === true };
    return mem;
  }
  function saveMem() {
    if (!mem) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(mem)); } catch (e) { /* stockage plein ou bloqué : on continue en mémoire */ }
  }

  // Test à temps intermédiaires : { run, answers, pool, savedAt }
  function reviveTest(o, segments, checks) {
    const src = U.isObj(o) ? o : {};
    let run = reviveSplit(src.run);
    if (!run || run.segments.length !== segments.length) run = createSplit(segments);
    else run.segments = segments.slice();
    const answers = {};
    const a = U.isObj(src.answers) ? src.answers : {};
    for (const c of checks || []) if (a[c.k] === 'oui' || a[c.k] === 'non') answers[c.k] = a[c.k];
    return { run, answers, pool: typeof src.pool === 'string' ? src.pool.slice(0, 80) : null, savedAt: numOrNull(src.savedAt) };
  }

  // Objets déjà relus et validés depuis le stockage (on ne les relit qu'une fois).
  const live = new WeakSet();

  function hyroxState() {
    const m = loadMem();
    if (U.isObj(m.tests.hyrox) && live.has(m.tests.hyrox)) return m.tests.hyrox;
    const o = U.isObj(m.tests.hyrox) ? m.tests.hyrox : {};
    let doubles = o.doubles;
    if (typeof doubles !== 'boolean') {
      const g = (C.state && Array.isArray(C.state.goals) ? C.state.goals : []).find((x) => x.type === 'hyrox' && x.status !== 'archived');
      doubles = !!(g && g.details && g.details.division === 'doubles');
    }
    const roxzone = o.roxzone === true;
    const labels = hyroxSegments({ roxzone }).map((d) => d.label);
    const t = { ...reviveTest(o, labels, HYROX.checks), doubles, roxzone };
    live.add(t);
    m.tests.hyrox = t;
    return t;
  }
  function tsaState() {
    const m = loadMem();
    if (U.isObj(m.tests['ssa-tsa']) && live.has(m.tests['ssa-tsa'])) return m.tests['ssa-tsa'];
    const o = U.isObj(m.tests['ssa-tsa']) ? m.tests['ssa-tsa'] : {};
    const t = {
      phase: ['course', 'recup', 'palmes'].includes(o.phase) ? o.phase : 'course',
      course: reviveTest(o.course, TSA_COURSE.segments, TSA_COURSE.checks),
      fins: reviveTest(o.fins, TSA_FINS.segments, TSA_FINS.checks),
      recupStart: numOrNull(o.recupStart), recupBeeped: o.recupBeeped === true,
    };
    live.add(t);
    m.tests['ssa-tsa'] = t;
    return t;
  }

  // Un « emplacement » de test : la config et l'objet { run, answers, pool, savedAt } à jour.
  function slot(key) {
    const m = loadMem();
    if (key === 'ssa-entree') {
      if (!(U.isObj(m.tests[key]) && live.has(m.tests[key]))) {
        m.tests[key] = reviveTest(m.tests[key], SSA_ENTRY.segments, SSA_ENTRY.checks);
        live.add(m.tests[key]);
      }
      return { key, cfg: SSA_ENTRY, obj: m.tests[key] };
    }
    if (key === 'ssa-tsa.course') return { key, cfg: TSA_COURSE, obj: tsaState().course };
    if (key === 'ssa-tsa.fins') return { key, cfg: TSA_FINS, obj: tsaState().fins };
    if (key === 'hyrox') {
      const h = hyroxState();
      return { key, cfg: { ...HYROX, segments: h.run.segments, taps: h.run.segments.map((l) => `Fin : ${l}`) }, obj: h };
    }
    return null;
  }

  /* ═════════════════ 6. Minuteur plein écran et barre de repos ═════════════════ */

  // Accès défensif à C.audio (le module peut manquer dans un contexte réduit).
  const sound = {
    call(name, ...args) {
      const a = C.audio;
      if (!a || typeof a[name] !== 'function') return null;
      try { return a[name](...args); } catch (e) { return null; }
    },
    beep(o) { return this.call('beep', o); },
    say(text, o) { return this.call('say', text, o) === true; },
    cancel() { this.call('cancelSpeech'); },
    hasVoice() { const v = this.call('hasVoice'); return v === undefined ? false : v; },
    vibrate(p) { this.call('vibrate', p); },
    unlock() { this.call('unlock'); },
    lock(owner) { const a = C.audio; try { if (a && a.wakeLock) a.wakeLock.request(owner); } catch (e) { /* sans écran allumé */ } },
    release(owner) { const a = C.audio; try { if (a && a.wakeLock) a.wakeLock.release(owner); } catch (e) { /* ignoré */ } },
  };
  const voiceSetting = () => !(C.state && C.state.settings && C.state.settings.voice === false);
  const soundSetting = () => !(C.state && C.state.settings && C.state.settings.sound === false);

  // Sons : décompte, début d'effort, début de repos, fin, appui chrono.
  const TONES = {
    tick: { freq: 880, ms: 110 },
    work: { freq: 1320, ms: 480 },
    rest: { freq: 660, ms: 480 },
    finish: { freq: 1046, ms: 200, count: 3, gap: 90 },
    lap: { freq: 1200, ms: 70 },
    shuttle: { freq: 988, ms: 170 },
    palier: { freq: 1320, ms: 120, count: 3, gap: 70 },
    go: { freq: 1320, ms: 500 },
  };

  const byId = (id) => (hasDoc ? document.getElementById(id) : null);
  function setText(id, text) {
    const el = byId(id);
    if (el && el.textContent !== text) el.textContent = text;
  }
  function host(id) {
    let el = byId(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      (byId('timer-root') || document.body).appendChild(el);
    }
    return el;
  }
  const toast = (msg) => { if (C.ui && C.ui.toast) C.ui.toast(msg); };
  const fmtClock = (sec) => U.formatDuration(Math.max(0, Math.ceil(sec - 1e-6)));
  function fmtTenths(sec) {
    if (sec == null || !isFinite(sec)) return '—';
    const t = Math.max(0, Math.round(sec * 10));
    return `${U.formatDuration(Math.floor(t / 10))},${t % 10}`;
  }
  const fmtMs = (ms) => fmtTenths(ms / 1000);

  /* ───────── Minuteur plein écran ───────── */

  let full = null; // { run, voice, onFinish, done, result, speakT, returnFocus }

  const voiceActive = () => !!(full && full.voice && voiceSetting() && sound.hasVoice() !== false);

  function open(spec) {
    if (!hasDoc) return null;
    const run = createRun(spec);
    if (!run.segs.length) { toast('Ce minuteur est vide : ajoute au moins un exercice avec une durée.'); return null; }
    closeFull(true);
    sound.unlock();
    full = {
      run, voice: run.spec.voice, onFinish: spec && typeof spec.onFinish === 'function' ? spec.onFinish : null,
      sourceSpec: spec, done: false, result: null, speakT: null, returnFocus: document.activeElement,
    };
    start(run, nowMs());
    sound.lock('timer');
    renderFull();
    ensureLoop();
    tickFull();
    const btn = byId('tmr-f-toggle');
    if (btn) try { btn.focus({ preventScroll: true }); } catch (e) { /* ignoré */ }
    return { close: () => closeFull(), isOpen: () => !!full };
  }

  function resultOf(completed) {
    const r = full.run;
    const t = elapsed(r, nowMs());
    const s = snapshot(r, nowMs());
    return {
      completed, aborted: !completed, name: r.spec.name, elapsedSec: Math.round(t), plannedSec: Math.round(r.total),
      rounds: r.rounds, roundsDone: completed ? r.rounds : Math.max(0, (s.round || 1) - 1),
    };
  }

  function closeFull(silent) {
    if (!full) return;
    const f = full;
    const partial = f.done ? null : resultOf(false);
    clearTimeout(f.speakT);
    sound.cancel();
    sound.release('timer');
    full = null;
    const h = byId('tmr-full-host');
    if (h) h.innerHTML = '';
    document.body.classList.remove('tmr-lock');
    if (!silent && !f.done && f.onFinish) {
      try { f.onFinish(partial); } catch (e) { console.error(e); }
    }
    if (f.returnFocus && f.returnFocus.focus && document.contains(f.returnFocus)) {
      try { f.returnFocus.focus({ preventScroll: true }); } catch (e) { /* ignoré */ }
    }
  }

  function renderFull() {
    if (!full) return;
    const h = host('tmr-full-host');
    document.body.classList.add('tmr-lock');
    const v = full.voice;
    const body = full.done
      ? `<div class="tmr-full-done">
          <p class="tmr-full-label">Terminé, bravo !</p>
          <p class="tmr-full-total num">Durée : ${esc(U.formatDuration(full.result ? full.result.elapsedSec : 0))}</p>
          <div class="tmr-full-done-btns">
            <button type="button" class="btn" data-action="chrono.t-again">↺ Recommencer</button>
            <button type="button" class="btn ghost" data-action="chrono.t-close">Fermer</button>
          </div></div>`
      : `<div class="tmr-full-body">
          <p class="tmr-full-round" id="tmr-f-round"></p>
          <p class="tmr-full-label" id="tmr-f-label"></p>
          <div class="tmr-full-digits num" id="tmr-f-time" role="timer" aria-live="off"></div>
          <div class="tmr-bar" aria-hidden="true"><span id="tmr-f-bar"></span></div>
          <p class="tmr-full-next" id="tmr-f-next"></p>
          <p class="tmr-full-total num" id="tmr-f-total"></p>
        </div>
        <div class="tmr-full-ctrl">
          <button type="button" class="tmr-ctl" data-action="chrono.t-prev"><span aria-hidden="true">⏮</span><small>Précédent</small></button>
          <button type="button" class="tmr-ctl tmr-ctl-main" data-action="chrono.t-toggle" id="tmr-f-toggle"><span aria-hidden="true" id="tmr-f-tg-ico">⏸</span><small id="tmr-f-tg-txt">Pause</small></button>
          <button type="button" class="tmr-ctl" data-action="chrono.t-next"><span aria-hidden="true">⏭</span><small>Suivant</small></button>
          <button type="button" class="tmr-ctl" data-action="chrono.t-add"><span>+10 s</span><small>Ajouter</small></button>
        </div>`;
    h.innerHTML = `<div class="tmr-full" id="tmr-full" role="dialog" aria-modal="true" aria-labelledby="tmr-f-name" data-kind="${full.done ? 'done' : 'work'}">
      <div class="tmr-full-top">
        <p class="tmr-full-name" id="tmr-f-name">${esc(full.run.spec.name)}</p>
        <button type="button" class="tmr-ico" data-action="chrono.t-voice" aria-pressed="${v ? 'true' : 'false'}" aria-label="Voix">${v ? '🔊' : '🔈'}<small>${v ? 'Voix' : 'Bips'}</small></button>
        <button type="button" class="tmr-ico" data-action="${full.done ? 'chrono.t-close' : 'chrono.t-stop'}" aria-label="${full.done ? 'Fermer' : 'Arrêter le minuteur'}">✕</button>
      </div>
      ${body}
      <p class="tmr-sr" aria-live="polite" id="tmr-f-live"></p>
    </div>`;
    paintFull();
  }

  function paintFull() {
    if (!full || full.done) return;
    const r = full.run;
    const s = snapshot(r, nowMs());
    if (!s.seg) return;
    const el = byId('tmr-full');
    if (el) {
      const kind = s.paused ? 'pause' : s.seg.kind;
      if (el.dataset.kind !== kind) el.dataset.kind = kind;
    }
    setText('tmr-f-time', fmtClock(s.remaining));
    setText('tmr-f-label', s.seg.label);
    setText('tmr-f-round', positionText(r, s.seg));
    setText('tmr-f-next', s.nextSeg ? `Ensuite : ${s.nextSeg.label} · ${U.formatDuration(s.nextSeg.sec)}` : 'Dernière étape');
    setText('tmr-f-total', `Reste ${fmtClock(s.totalRemaining)} sur ${U.formatDuration(Math.round(s.total))}`);
    setText('tmr-f-tg-ico', s.paused ? '▶' : '⏸');
    setText('tmr-f-tg-txt', s.paused ? 'Reprendre' : 'Pause');
    const bar = byId('tmr-f-bar');
    if (bar) bar.style.width = `${(s.segProgress * 100).toFixed(1)}%`;
  }

  function tickFull() {
    if (!full || full.done) return;
    const now = nowMs();
    const evs = poll(full.run, now, { voice: voiceActive() });
    for (const ev of evs) handleEvent(ev);
    if (full && !full.done) paintFull();
  }

  function speakLater(text, delay) {
    if (!full) return;
    clearTimeout(full.speakT);
    full.speakT = setTimeout(() => { if (full && !isPaused(full.run)) sound.say(text); }, delay);
  }

  function handleEvent(ev) {
    const live = byId('tmr-f-live');
    if (ev.type === 'end') {
      const tone = ev.to && ev.to.kind === 'work' ? TONES.work : TONES.rest;
      sound.beep(tone);
      sound.vibrate(200);
    } else if (ev.type === 'start') {
      const text = announceText(ev.seg, ev.nextWork);
      if (live) live.textContent = text;
      // Passage manuel : bip court. Tout premier effort (sans préparation) : bip de départ.
      // Passage naturel : le bip long vient de l'événement 'end'. On parle juste après le bip.
      if (ev.manual) sound.beep(TONES.tick);
      else if (ev.first && ev.seg.kind === 'work') sound.beep(TONES.work);
      const beeped = !(ev.first && ev.seg.kind === 'prep');
      if (voiceActive()) speakLater(text, beeped ? 420 : 0);
    } else if (ev.type === 'count') {
      if (voiceActive()) {
        sound.say(COUNT_WORDS[ev.n] || String(ev.n));
        // Liste des voix pas encore connue (chargement asynchrone) : bips en plus, au cas où.
        if (ev.n <= 3 && sound.hasVoice() === null) sound.beep(TONES.tick);
      } else if (ev.n <= 3) sound.beep(TONES.tick);
    } else if (ev.type === 'finish') {
      finishFull();
    }
  }

  function finishFull() {
    if (!full || full.done) return;
    sound.beep(TONES.finish);
    sound.vibrate([200, 100, 200, 100, 400]);
    if (voiceActive()) speakLater('Terminé, bravo !', 650);
    full.done = true;
    full.result = resultOf(true);
    sound.release('timer');
    const cb = full.onFinish;
    const result = full.result;
    renderFull();
    const live = byId('tmr-f-live');
    if (live) live.textContent = 'Terminé, bravo !';
    const b = document.querySelector('#tmr-full [data-action="chrono.t-close"].btn');
    if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* ignoré */ }
    if (cb) { try { cb(result); } catch (e) { console.error(e); } }
  }

  async function askStopFull() {
    if (!full || full.done) { closeFull(true); return; }
    const wasPaused = isPaused(full.run);
    pause(full.run, nowMs());
    sound.cancel();
    paintFull();
    const ok = C.ui && C.ui.ask ? await C.ui.ask('Arrêter le minuteur ? Ta progression dans la séquence sera perdue.', 'Arrêter', { danger: true, title: 'Arrêter', noLabel: 'Continuer' }) : true;
    if (!full) return;
    if (ok) { closeFull(false); return; }
    if (!wasPaused) resume(full.run, nowMs());
    paintFull();
  }

  /* ───────── Barre de repos (entre deux séries) ───────── */

  let rest = null; // { endAt, totalSec, label, voice, fired, doneAt }

  function startRest(sec, label, opts = {}) {
    const s = Math.round(Number(sec));
    if (!hasDoc || !(s > 0)) return null;
    sound.unlock();
    rest = { endAt: nowMs() + s * 1000, totalSec: s, label: String(label || 'Repos').slice(0, 120), voice: opts.voice === true, fired: {}, doneAt: null };
    sound.lock('rest');
    renderRest();
    ensureLoop();
    return { stop: stopRest, add: addRest };
  }
  function stopRest() {
    rest = null;
    sound.release('rest');
    const h = byId('tmr-rest-host');
    if (h) h.innerHTML = '';
    document.body.classList.remove('tmr-resting');
  }
  function addRest(sec = 15) {
    if (!rest) return;
    if (rest.doneAt) { rest.endAt = nowMs() + sec * 1000; rest.doneAt = null; sound.lock('rest'); } else rest.endAt += sec * 1000;
    rest.totalSec += sec;
    rest.fired = {};
    renderRest();
  }
  function renderRest() {
    if (!rest) return;
    const h = host('tmr-rest-host');
    document.body.classList.add('tmr-resting');
    h.innerHTML = `<div class="tmr-rest" role="region" aria-label="Minuteur de repos" id="tmr-rest">
      <div class="tmr-rest-main">
        <span class="tmr-rest-label" id="tmr-r-label">${esc(rest.label)}</span>
        <span class="tmr-rest-time num" id="tmr-r-time" role="timer" aria-live="off"></span>
      </div>
      <div class="tmr-rest-btns">
        <button type="button" class="tmr-rest-btn" data-action="chrono.r-add">+15 s</button>
        <button type="button" class="tmr-rest-btn" data-action="chrono.r-skip">${rest.doneAt ? 'Fermer' : 'Passer'}</button>
      </div>
      <div class="tmr-rest-bar" aria-hidden="true"><span id="tmr-r-bar"></span></div>
      <p class="tmr-sr" aria-live="polite" id="tmr-r-live"></p>
    </div>`;
    paintRest();
  }
  function paintRest() {
    if (!rest) return;
    const left = (rest.endAt - nowMs()) / 1000;
    setText('tmr-r-time', rest.doneAt ? 'C’est reparti !' : fmtClock(left));
    const bar = byId('tmr-r-bar');
    if (bar) bar.style.width = `${(U.clamp(1 - left / rest.totalSec, 0, 1) * 100).toFixed(1)}%`;
    const el = byId('tmr-rest');
    if (el) el.classList.toggle('is-done', !!rest.doneAt);
  }
  function tickRest() {
    if (!rest) return;
    const now = nowMs();
    const left = (rest.endAt - now) / 1000;
    if (rest.doneAt) {
      if (now - rest.doneAt > 4000) stopRest();
      return;
    }
    if (left > 0) {
      const n = Math.ceil(left - 1e-6);
      if (n <= 3 && rest.totalSec >= 6 && !rest.fired[n]) {
        for (let k = n; k <= 3; k++) rest.fired[k] = true;
        sound.beep(TONES.tick);
      }
      paintRest();
      return;
    }
    rest.doneAt = now;
    sound.release('rest');
    if (-left < 30) {
      sound.beep({ ...TONES.work, count: 2, gap: 120 });
      sound.vibrate([250, 120, 250]);
      if (rest.voice && voiceSetting()) sound.say('Repos terminé.');
    }
    const live = byId('tmr-r-live');
    if (live) live.textContent = 'Repos terminé.';
    renderRest();
  }

  /* ───────── Boucle d'affichage unique ───────── */

  let loopId = null;
  function ensureLoop() {
    if (!hasDoc || loopId) return;
    loopId = setInterval(loop, 100);
  }
  function loop() {
    let active = false;
    const guard = (fn) => { try { fn(); } catch (e) { console.error(e); } };
    if (full && !full.done) { guard(tickFull); active = true; }
    if (rest) { guard(tickRest); active = true; }
    if (lgActive()) { guard(legerTick); active = true; }
    if (tsaRecupActive()) { guard(tsaTick); active = true; }
    if (pageLive()) { guard(paintPage); active = true; }
    if (!active && loopId) { clearInterval(loopId); loopId = null; }
  }

  /* ═════════════════ 7. Écrans de l'onglet Chrono ═════════════════ */

  const onChrono = () => {
    const r = C.currentRoute ? C.currentRoute() : '';
    return typeof r === 'string' && r.startsWith('#/chrono');
  };
  // Re-rend la vue seulement si on est sur un écran Chrono.
  const refresh = () => { if (onChrono() && C.rerender) C.rerender(); };

  const head = (title, sub, back = '#/chrono', backLabel = 'Chrono') => `<header class="top">
    <a class="back" href="${esc(back)}">‹ ${esc(backLabel)}</a><h1>${esc(title)}</h1>${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}</header>`;

  // Seuil et cible (C.data.targetFor si disponible, sinon valeurs de repli).
  function refFor(benchId, fallback = {}) {
    const out = { official: fallback.official ?? null, target: fallback.target ?? null, officialLabel: '', targetLabel: '', indicative: false };
    try {
      const r = C.data && typeof C.data.targetFor === 'function' ? C.data.targetFor(benchId, C.state && C.state.profile) : null;
      if (r) {
        if (r.official && isFinite(r.official.value)) { out.official = r.official.value; out.officialLabel = r.official.label || ''; }
        if (r.target && isFinite(r.target.value)) { out.target = r.target.value; out.targetLabel = r.target.label || ''; out.indicative = !!r.target.indicative; }
      }
    } catch (e) { /* valeurs de repli */ }
    return out;
  }
  // Meilleur, dernier, tendance (C.metrics si disponible).
  function benchMeta(benchId) {
    const m = C.metrics;
    const val = (x) => (x == null ? null : typeof x === 'number' ? x : U.isObj(x) ? U.num(x.value) : null);
    const out = { best: null, last: null, lastDate: null, trend: null };
    if (!m) return out;
    try { if (typeof m.benchBest === 'function') out.best = val(m.benchBest(benchId)); } catch (e) { /* ignoré */ }
    try {
      if (typeof m.benchLast === 'function') { const l = m.benchLast(benchId); out.last = val(l); out.lastDate = U.isObj(l) && U.isKey(l.date) ? l.date : null; }
    } catch (e) { /* ignoré */ }
    try { if (typeof m.benchTrend === 'function') out.trend = m.benchTrend(benchId); } catch (e) { /* ignoré */ }
    return out;
  }
  // Valeur courte pour les cartes : temps « 2:45 », palier « 7,5 » (l'unité est dans l'intitulé).
  function fmtBench(unit, v) {
    if (v == null || !isFinite(v)) return '—';
    if (unit === 'time') return fmtTenths(v).replace(/,0$/, '');
    if (unit === 'palier') return U.fmtNum(v, 1);
    return C.ui && C.ui.fmtValue ? C.ui.fmtValue(unit, v) : String(v);
  }
  const TREND = { mieux: '↗ en progrès', 'moins-bien': '↘ en baisse', stable: '→ stable' };

  function refCard(benchId, ref, unit = 'time') {
    const meta = benchMeta(benchId);
    const u = unit === 'palier' ? ' (palier)' : '';
    const cell = (label, value, extra = '') => `<div class="tmr-ref"><small>${esc(label + u)}</small><b class="num">${esc(value)}</b>${extra}</div>`;
    const trend = meta.trend && TREND[meta.trend.direction] ? `<span class="tiny muted">${esc(TREND[meta.trend.direction])}</span>` : '';
    return `<div class="tmr-refs">
      ${ref.official != null ? cell('Seuil officiel', fmtBench(unit, ref.official), '<span class="tiny muted">à confirmer</span>') : ''}
      ${cell(ref.indicative ? 'Repère' : 'Ta cible', fmtBench(unit, ref.target))}
      ${cell('Meilleur', fmtBench(unit, meta.best))}
      ${cell('Dernier', fmtBench(unit, meta.last), meta.lastDate ? `<span class="tiny muted">${esc(U.fmtShort(meta.lastDate))}</span>${trend}` : trend)}
    </div>
    ${ref.targetLabel ? `<p class="tiny muted">${esc(ref.targetLabel)}</p>` : ''}`;
  }

  // Enregistre un test (C.metrics.addBench). Renvoie true si c'est fait.
  function saveBench(benchId, entry) {
    if (!C.metrics || typeof C.metrics.addBench !== 'function') {
      toast('Enregistrement des tests indisponible pour l’instant.');
      return false;
    }
    try {
      const saved = C.metrics.addBench(benchId, { date: U.todayKey(), source: 'chrono', note: '', context: 'test', ...entry });
      if (saved === null) { toast('Valeur invalide : rien n’a été enregistré.'); return false; }
      return true;
    } catch (e) {
      toast('⚠️ ' + (e && e.message ? e.message : 'Enregistrement impossible'));
      return false;
    }
  }
  function pushHistory(key, entry) {
    const m = loadMem();
    const list = (m.history[key] || []).filter((h) => h.id !== entry.id);
    list.push(entry);
    m.history[key] = list.slice(-10);
    saveMem();
  }
  // Dernier essai enregistré comparable (même nombre de segments, autre essai).
  function previousAttempt(key, run) {
    const list = loadMem().history[key] || [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id !== run.id && list[i].splits.length === run.segments.length) return list[i];
    return null;
  }

  function poolOptions() {
    const pools = C.state && C.state.profile && Array.isArray(C.state.profile.pools) ? C.state.profile.pools : [];
    if (pools.length) return pools.map((p) => ({ value: String(p.id), label: `${p.name} · ${p.length} m`, text: `${p.name} (${p.length} m)` }));
    return [{ value: 'l25', label: 'Bassin de 25 m', text: 'bassin de 25 m' }, { value: 'l50', label: 'Bassin de 50 m', text: 'bassin de 50 m' }];
  }

  /* ───────── Accueil #/chrono ───────── */

  function inProgress() {
    const m = loadMem();
    const out = [];
    const sw = m.sw;
    if (sw.startedAt != null || sw.acc > 0) out.push({ href: '#/chrono/chrono', label: sw.startedAt != null ? 'Chronomètre en marche' : 'Chronomètre arrêté', time: fmtMs(swElapsed(nowMs())) });
    const sE = slot('ssa-entree');
    if (sE && splitStatus(sE.obj.run) !== 'idle' && !sE.obj.savedAt) out.push({ href: '#/chrono/ssa-entree', label: "Test d'entrée SSA en cours" });
    const tsa = tsaState();
    if (!tsa.fins.savedAt && (tsa.phase !== 'course' || splitStatus(tsa.course.run) !== 'idle')) out.push({ href: '#/chrono/ssa-tsa', label: 'TSA en cours' });
    const hx = hyroxState();
    if (splitStatus(hx.run) !== 'idle' && !hx.savedAt) out.push({ href: '#/chrono/hyrox', label: 'Simulation HYROX en cours' });
    if (lg.status === 'prep' || lg.status === 'run') out.push({ href: '#/chrono/luc-leger', label: 'Luc Léger en cours' });
    return out;
  }

  function viewHome() {
    const cur = inProgress();
    const cat = (href, icon, title, text) => `<a class="tmr-cat" href="${href}"><span class="tmr-cat-ico" aria-hidden="true">${icon}</span><b>${esc(title)}</b><small class="muted">${esc(text)}</small></a>`;
    const test = (href, icon, title, text) => `<li><a class="menu-item" href="${href}"><span class="menu-icon" aria-hidden="true">${icon}</span>
      <span class="menu-text"><b>${esc(title)}</b><small class="muted">${esc(text)}</small></span><span aria-hidden="true">›</span></a></li>`;
    const quick = PRESETS.filter((p) => p.group === 'abdos');
    return {
      html: `<header class="top"><h1>Chrono</h1><p class="muted small">Chronomètre, minuteurs et tests chronométrés.</p></header>
      ${cur.length ? `<div class="card tmr-now"><h2 class="small">En cours</h2><ul class="list">${cur.map((c) => `<li><a class="btn ghost block" href="${c.href}">${esc(c.label)}${c.time ? ` · <span class="num">${esc(c.time)}</span>` : ''} ›</a></li>`).join('')}</ul></div>` : ''}
      <div class="tmr-cats">
        ${cat('#/chrono/chrono', '⏱', 'Chronomètre', 'Tours, gros affichage, enregistrer un temps')}
        ${cat('#/chrono/minuteur', '⏲', 'Minuteur', '30 s, 1, 2, 3, 5 min ou ta durée')}
        ${cat('#/chrono/intervalles', '🔁', 'Intervalles', 'Abdos avec voix, Tabata, EMOM, tes minuteurs')}
      </div>
      <div class="tmr-quick">${quick.map((p) => `<button type="button" class="btn ghost tmr-quick-btn" data-action="chrono.iv-go" data-preset="${esc(p.id)}">▶ ${esc(p.name)}<small class="muted">avec la voix · ${esc(U.formatDuration(totalOf(p)))}</small></button>`).join('')}</div>
      <h2 class="section">Tests chronométrés</h2>
      <ul class="menu">
        ${test('#/chrono/ssa-entree', '🏊', "Test d'entrée SSA", "100 m en 3 parties, critères éliminatoires, verdict")}
        ${test('#/chrono/ssa-tsa', '🛟', 'TSA (SSA)', 'Parcours de sauvetage, 10 min de récup, 300 m palmes')}
        ${test('#/chrono/hyrox', '🏋️', 'Simulation HYROX', '8 × (1 km + station), temps par segment')}
        ${test('#/chrono/luc-leger', '🏃', 'Luc Léger', 'Bande sonore générée, palier et navette')}
      </ul>
      <p class="tiny muted mt">Sur iPhone, le bouton silencieux peut couper les bips : désactive-le pendant tes minuteurs. L'écran reste allumé pendant un minuteur quand le téléphone le permet.</p>`,
      after: () => { if (cur.length) ensureLoop(); },
    };
  }

  /* ───────── Chronomètre ───────── */

  function swElapsed(now) {
    const sw = loadMem().sw;
    return sw.acc + (sw.startedAt != null ? Math.max(0, now - sw.startedAt) : 0);
  }

  function viewStopwatch() {
    const sw = loadMem().sw;
    const running = sw.startedAt != null;
    const el = swElapsed(nowMs());
    const laps = sw.laps.map((cum, i) => ({ n: i + 1, cum, split: cum - (sw.laps[i - 1] || 0) }));
    let best = null, worst = null;
    if (laps.length >= 3) {
      best = laps.reduce((a, b) => (b.split < a.split ? b : a)).n;
      worst = laps.reduce((a, b) => (b.split > a.split ? b : a)).n;
    }
    return {
      html: `${head('Chronomètre')}
      <section class="tmr-sw" aria-label="Chronomètre">
        <div class="tmr-sw-time num" id="tmr-sw-time" role="timer" aria-live="off">${esc(fmtMs(el))}</div>
        <p class="tmr-sw-cur num muted" id="tmr-sw-cur">${laps.length ? esc(`Tour ${laps.length + 1} : ${fmtMs(el - sw.laps[sw.laps.length - 1])}`) : ''}</p>
        <div class="tmr-sw-btns">
          ${running
            ? '<button type="button" class="btn ghost tmr-sw-btn" data-action="chrono.sw-lap" data-tmr-tap>Tour</button>'
            : `<button type="button" class="btn ghost tmr-sw-btn" data-action="chrono.sw-reset" ${el ? '' : 'disabled'}>Effacer</button>`}
          <button type="button" class="btn tmr-sw-btn ${running ? 'tmr-stop' : ''}" data-action="chrono.sw-toggle" data-tmr-tap>${running ? 'Arrêter' : el ? 'Reprendre' : 'Démarrer'}</button>
        </div>
        ${!running && el >= 1000 ? '<button type="button" class="btn ghost block" data-action="chrono.sw-save">Enregistrer comme test</button>' : ''}
      </section>
      ${laps.length ? `<ol class="tmr-laps" reversed>${laps.slice().reverse().map((l) => `<li class="${l.n === best ? 'is-best' : l.n === worst ? 'is-worst' : ''}">
        <span>Tour ${esc(l.n)}${l.n === best ? ' · le plus rapide' : l.n === worst ? ' · le plus lent' : ''}</span><span class="num">${esc(fmtMs(l.split))}</span><span class="num muted">${esc(fmtMs(l.cum))}</span></li>`).join('')}</ol>` : ''}`,
      after: () => { if (running) { sound.lock('sw'); ensureLoop(); } },
    };
  }

  function swSaveSheet() {
    const sw = loadMem().sw;
    const total = swElapsed(nowMs());
    const D = C.data || {};
    const list = (Array.isArray(D.benchmarks) ? D.benchmarks : []).filter((b) => b.unit === 'time' && !/_v1$/.test(b.id));
    if (!list.length) { toast('Liste des tests indisponible pour l’instant.'); return; }
    const goals = (C.ui && C.ui.GOALS) || {};
    const groups = {};
    for (const b of list) (groups[b.goal || 'general'] ||= []).push(b);
    const opts = Object.entries(groups).map(([g, items]) => `<optgroup label="${esc((goals[g] && goals[g].label) || g)}">${items.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</optgroup>`).join('');
    const choices = [{ value: 'total', label: `Temps total · ${fmtMs(total)}` }].concat(sw.laps.map((cum, i) => ({ value: String(i), label: `Tour ${i + 1} · ${fmtMs(cum - (sw.laps[i - 1] || 0))}` })));
    C.ui.openModal({
      title: 'Enregistrer comme test',
      body: `<form data-form="chrono.sw-save" class="tmr-form">
        <div class="field"><span>Quel temps ?</span>
          <div class="tmr-radios">${choices.map((c, i) => `<label class="check-row"><input type="radio" name="which" value="${esc(c.value)}" ${i === 0 ? 'checked' : ''}> <span class="num">${esc(c.label)}</span></label>`).join('')}</div></div>
        <label class="field"><span>Test</span><select name="bench" required>${opts}</select></label>
        <div class="field"><span>Type de mesure</span>${C.ui.segmented('ctx', [{ value: 'test', label: 'Test (compte pour le meilleur)' }, { value: 'entrainement', label: 'Entraînement' }], 'test')}</div>
        <label class="field"><span>Bassin (natation)</span><select name="pool"><option value="">—</option>${poolOptions().map((p) => `<option value="${esc(p.value)}">${esc(p.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Note (facultatif)</span><input name="note" maxlength="200" autocomplete="off" placeholder="Ex. départ dans l'eau, vent"></label>
        <button class="btn block" type="submit">Enregistrer</button>
      </form>`,
    });
  }

  /* ───────── Minuteur simple ───────── */

  const MIN_PRESETS = [30, 60, 120, 180, 300];
  function minuteurSpec(sec) {
    const voice = loadMem().prefs.minVoice === true;
    return { name: `Minuteur ${U.formatDuration(sec)}`, voice, prepSec: 0, rounds: 1, restBetweenRoundsSec: 0, steps: [{ label: 'Minuteur', sec, kind: 'work' }] };
  }
  function viewMinuteur() {
    const voice = loadMem().prefs.minVoice === true;
    return `${head('Minuteur', 'Compte à rebours en plein écran.')}
      <div class="tmr-min-grid">${MIN_PRESETS.map((s) => `<button type="button" class="tmr-min-btn" data-action="chrono.min-go" data-sec="${esc(s)}"><span class="num">${esc(s < 60 ? `${s} s` : `${s / 60} min`)}</span></button>`).join('')}</div>
      <form class="card tmr-min-form" data-form="chrono.min-custom">
        <label class="field"><span>Autre durée (tape 130 pour 1:30)</span>${C.ui.timeInput({ name: 'sec', placeholderText: 'm:ss', label: 'Durée du minuteur' })}</label>
        <button class="btn" type="submit">▶ Lancer</button>
      </form>
      <label class="check-row"><input type="checkbox" data-change="chrono.min-voice" ${voice ? 'checked' : ''}> Voix : décompte « 5, 4, 3, 2, 1 » (sinon, bips)</label>`;
  }

  /* ───────── Intervalles ───────── */

  function stepsPreview(spec) {
    const s = normSpec(spec);
    return `<details class="tmr-steps"><summary>Voir les étapes</summary><ol>${s.steps.map((st) => `<li class="${st.kind === 'rest' ? 'muted' : ''}"><span>${esc(st.label.replace(/\{tour\}/g, 'n'))}</span><span class="num">${esc(U.formatDuration(st.sec))}</span></li>`).join('')}</ol>
      ${s.rounds > 1 ? `<p class="tiny muted">${esc(U.plural(s.rounds, 'tour', 'tours'))}${s.restBetweenRoundsSec ? `, ${esc(U.formatDuration(s.restBetweenRoundsSec))} de repos entre les tours` : ''}.</p>` : ''}</details>`;
  }
  function timerCard(t, isPreset) {
    const voiceTag = t.voice ? '<span class="pill ok">🔊 Voix</span>' : '<span class="pill">Bips</span>';
    const btns = isPreset
      ? `<button type="button" class="btn small" data-action="chrono.iv-go" data-preset="${esc(t.id)}">▶ Lancer</button>
         <a class="btn ghost small" href="#/chrono/edition/preset-${esc(t.id)}">Copier et modifier</a>`
      : `<button type="button" class="btn small" data-action="chrono.iv-go" data-id="${esc(t.id)}">▶ Lancer</button>
         <a class="btn ghost small" href="#/chrono/edition/${esc(encodeURIComponent(t.id))}">Modifier</a>
         <button type="button" class="btn ghost small" data-action="chrono.iv-dup" data-id="${esc(t.id)}">Dupliquer</button>
         <button type="button" class="btn ghost small danger" data-action="chrono.iv-del" data-id="${esc(t.id)}">Supprimer</button>`;
    return `<li class="card tmr-item">
      <div class="tmr-item-head"><h3>${esc(t.name)}</h3>${voiceTag}</div>
      ${t.desc ? `<p class="small muted">${esc(t.desc)}</p>` : ''}
      ${t.note ? `<p class="note warn small">${esc(t.note)}</p>` : ''}
      <p class="small num">${esc(timerSummary(t))}</p>
      ${stepsPreview(t)}
      <div class="row gap wrap mt">${btns}</div></li>`;
  }
  function viewIntervals() {
    const mine = (C.state && Array.isArray(C.state.timers) ? C.state.timers : []);
    return `${head('Intervalles', 'Voix pour les abdos et le gainage, bips ailleurs. Réglable pour chaque minuteur.')}
      <h2 class="section">Préréglages</h2>
      <ul class="list">${PRESETS.map((p) => timerCard(p, true)).join('')}</ul>
      <h2 class="section">Mes minuteurs</h2>
      ${mine.length ? `<ul class="list">${mine.map((t) => timerCard(t, false)).join('')}</ul>` : '<p class="muted small">Aucun pour l’instant. Crée le tien ou copie un préréglage.</p>'}
      <a class="btn block mt" href="#/chrono/edition/nouveau">+ Créer un minuteur</a>`;
  }

  /* ───────── Éditeur de minuteur ───────── */

  let draft = null; // { key, timer, isNew }

  function draftFor(id) {
    if (draft && draft.key === id) return draft;
    let t = null;
    let isNew = true;
    if (id === 'nouveau') {
      t = { id: null, name: '', voice: false, prepSec: 10, rounds: 3, restBetweenRoundsSec: 60, steps: [{ label: 'Exercice 1', sec: 40, kind: 'work' }, { label: 'Repos', sec: 20, kind: 'rest' }, { label: 'Exercice 2', sec: 40, kind: 'work' }] };
    } else if (id.startsWith('preset-')) {
      const p = getPreset(id.slice(7));
      if (p) t = { ...U.clone(p), id: null, name: `${p.name} (perso)` };
    } else {
      const ex = (C.state.timers || []).find((x) => x.id === id);
      if (ex) { t = U.clone(ex); isNew = false; }
    }
    if (!t) return null;
    delete t.desc; delete t.note; delete t.group;
    draft = { key: id, timer: t, isNew };
    return draft;
  }

  // Recopie le formulaire dans le brouillon (avant toute modification de structure).
  function readEditor(form) {
    if (!draft || !form) return;
    const t = draft.timer;
    const q = (n) => form.elements.namedItem(n);
    const read = (n) => (q(n) && C.ui.readTime ? C.ui.readTime(q(n)) : null);
    if (q('name')) t.name = q('name').value;
    if (q('voice')) t.voice = q('voice').checked;
    t.prepSec = read('prepSec') ?? 0;
    t.rounds = q('rounds') ? parseInt(q('rounds').value, 10) || 1 : t.rounds;
    t.restBetweenRoundsSec = read('restBetweenRoundsSec') ?? 0;
    t.steps = t.steps.map((st, k) => {
      const kind = form.querySelector(`input[name="kind-${k}"]:checked`);
      return { ...st, label: q(`label-${k}`) ? q(`label-${k}`).value : st.label, sec: q(`sec-${k}`) ? read(`sec-${k}`) : st.sec, kind: kind ? kind.value : st.kind };
    });
  }
  function editorTotal() {
    if (!draft) return '';
    const s = normSpec(draft.timer);
    const total = totalOf(s);
    return total ? `${U.formatDuration(total)} · ${U.plural(s.rounds, 'tour', 'tours')}` : '—';
  }

  function viewEditor(params) {
    const d = draftFor(params.id);
    if (!d) return `${head('Minuteur introuvable', '', '#/chrono/intervalles', 'Intervalles')}${C.ui.empty('Ce minuteur n’existe plus.', '', '<a class="btn" href="#/chrono/intervalles">Retour</a>')}`;
    const t = d.timer;
    const KIND = [{ value: 'work', label: 'Travail' }, { value: 'rest', label: 'Repos' }];
    const steps = t.steps.map((st, k) => `<li class="tmr-ed-step" data-kind="${st.kind === 'rest' ? 'rest' : 'work'}">
        <div class="tmr-ed-row">
          <span class="tmr-ed-num num" aria-hidden="true">${esc(k + 1)}</span>
          <input name="label-${k}" class="grow" value="${esc(st.label)}" maxlength="80" autocomplete="off" aria-label="Nom de l'étape ${esc(k + 1)}" placeholder="${st.kind === 'rest' ? 'Repos' : 'Exercice'}">
          ${C.ui.timeInput({ name: `sec-${k}`, value: st.sec, label: `Durée de l'étape ${k + 1}` })}
        </div>
        <div class="tmr-ed-row">
          ${C.ui.segmented(`kind-${k}`, KIND, st.kind === 'rest' ? 'rest' : 'work')}
          <span class="grow"></span>
          <button type="button" class="tmr-ed-btn" data-action="chrono.ed-move" data-k="${esc(k)}" data-d="-1" ${k === 0 ? 'disabled' : ''} aria-label="Monter l'étape ${esc(k + 1)}">↑</button>
          <button type="button" class="tmr-ed-btn" data-action="chrono.ed-move" data-k="${esc(k)}" data-d="1" ${k === t.steps.length - 1 ? 'disabled' : ''} aria-label="Descendre l'étape ${esc(k + 1)}">↓</button>
          <button type="button" class="tmr-ed-btn danger-text" data-action="chrono.ed-del" data-k="${esc(k)}" aria-label="Supprimer l'étape ${esc(k + 1)}">✕</button>
        </div></li>`).join('');
    return `${head(d.isNew ? 'Nouveau minuteur' : 'Modifier le minuteur', '', '#/chrono/intervalles', 'Intervalles')}
      <form class="tmr-ed" id="tmr-ed" data-form="chrono.ed-save" data-input="chrono.ed-input" data-change="chrono.ed-input" novalidate>
        <label class="field"><span>Nom</span><input name="name" value="${esc(t.name)}" maxlength="80" autocomplete="off" placeholder="Ex. Circuit jambes"></label>
        <label class="check-row"><input type="checkbox" name="voice" ${t.voice ? 'checked' : ''}> Voix : annonce de chaque exercice et décompte « 5, 4, 3, 2, 1 »</label>
        <div class="tmr-ed-grid">
          <label class="field"><span>Préparation</span>${C.ui.timeInput({ name: 'prepSec', value: t.prepSec, placeholder: 0, label: 'Durée de préparation' })}</label>
          <label class="field"><span>Tours</span><input name="rounds" type="number" inputmode="numeric" min="1" max="${MAX_ROUNDS}" value="${esc(t.rounds || 1)}" class="tmr-ed-rounds"></label>
          <label class="field"><span>Repos entre tours</span>${C.ui.timeInput({ name: 'restBetweenRoundsSec', value: t.restBetweenRoundsSec, placeholder: 0, label: 'Repos entre les tours' })}</label>
        </div>
        <h2 class="section">Étapes d'un tour</h2>
        ${t.steps.length ? `<ol class="tmr-ed-steps">${steps}</ol>` : '<p class="muted small">Aucune étape : ajoute un exercice.</p>'}
        <div class="row gap wrap">
          <button type="button" class="btn ghost small" data-action="chrono.ed-add" data-kind="work">+ Exercice</button>
          <button type="button" class="btn ghost small" data-action="chrono.ed-add" data-kind="rest">+ Repos</button>
        </div>
        <p class="tmr-ed-total">Durée totale : <b class="num" id="tmr-ed-total">${esc(editorTotal())}</b></p>
        <p class="danger-text small" id="tmr-ed-err" role="alert"></p>
        <div class="row gap wrap">
          <button type="submit" class="btn">Enregistrer</button>
          <button type="button" class="btn ghost" data-action="chrono.ed-try">▶ Essayer</button>
          ${d.isNew ? '' : '<button type="button" class="btn ghost danger" data-action="chrono.ed-remove">Supprimer</button>'}
        </div>
      </form>`;
  }

  /* ───────── Bloc commun des tests à temps intermédiaires ───────── */

  function splitBlock(sl) {
    const { key, cfg, obj } = sl;
    const r = obj.run;
    const st = splitStatus(r);
    const now = nowMs();
    const ms = splitElapsedMs(r, now);
    const cur = splitCurrent(r);
    const n = r.segments.length;
    const lastLap = r.laps.length ? r.laps[r.laps.length - 1] : 0;
    const prevAtt = previousAttempt(key, r);
    const times = splitTimes(r);
    const tapLabel = st === 'idle' ? cfg.startLabel || 'Départ' : (cfg.taps && cfg.taps[cur]) || `Fin : ${r.segments[cur]}`;
    const status = st === 'idle' ? 'Prêt : appuie au signal de départ.' : st === 'done' ? 'Terminé.' : `${st === 'pause' ? 'En pause · ' : ''}${cur + 1}/${n} : ${r.segments[cur]}`;
    const rows = times.map((x) => {
      const isCur = st !== 'idle' && st !== 'done' && x.i === cur;
      let delta = '';
      if (x.sec != null && prevAtt && prevAtt.splits[x.i] != null) {
        const d = x.sec - prevAtt.splits[x.i];
        delta = `<span class="tmr-delta ${d <= 0 ? 'ok-text' : 'danger-text'} num">${d <= 0 ? '−' : '+'}${esc(fmtTenths(Math.abs(d)))}</span>`;
      }
      return `<li class="${isCur ? 'is-current' : ''} ${x.sec == null && !isCur ? 'muted' : ''}">
        <span class="tmr-split-label">${esc(x.label)}</span>
        <span class="num">${x.sec != null ? esc(fmtTenths(x.sec)) : isCur ? '…' : ''}</span>${delta}
        <span class="num muted tmr-split-cum">${x.cum != null ? esc(fmtTenths(x.cum)) : ''}</span></li>`;
    }).join('');
    return `<section class="card tmr-st" id="tmr-st" data-key="${esc(key)}" aria-label="Chronomètre du test">
      <p class="small muted tmr-st-status">${esc(status)}</p>
      <div class="tmr-st-total num" id="tmr-st-total" role="timer" aria-live="off">${esc(fmtMs(ms))}</div>
      <p class="tmr-st-seg num muted" id="tmr-st-seg">${st === 'run' || st === 'pause' ? esc(`Segment : ${fmtMs(ms - lastLap)}`) : ''}</p>
      ${st !== 'done' ? `<button type="button" class="tmr-tap ${st === 'idle' ? 'is-start' : ''}" data-action="chrono.st-tap" data-key="${esc(key)}" data-tmr-tap ${st === 'pause' ? 'disabled' : ''}>${esc(tapLabel)}</button>` : ''}
      <div class="row gap wrap tmr-st-tools">
        ${r.laps.length ? `<button type="button" class="btn ghost small" data-action="chrono.st-undo" data-key="${esc(key)}">↶ Annuler le dernier temps</button>` : ''}
        ${cfg.pausable && (st === 'run' || st === 'pause') ? `<button type="button" class="btn ghost small" data-action="chrono.st-pause" data-key="${esc(key)}">${st === 'pause' ? '▶ Reprendre' : '⏸ Pause'}</button>` : ''}
        ${st !== 'idle' ? `<button type="button" class="btn ghost small" data-action="chrono.st-reset" data-key="${esc(key)}">Recommencer</button>` : ''}
      </div>
      ${st === 'idle' && !cfg.pausable ? '<p class="tiny muted">Gros bouton : ton binôme peut chronométrer depuis le bord du bassin.</p>' : ''}
      <ol class="tmr-splits">${rows}</ol>
      ${prevAtt ? `<p class="tiny muted">Écarts comparés à ton essai du ${esc(U.fmtShort(prevAtt.date))}.</p>` : ''}
    </section>`;
  }

  const VERDICT_CLS = { cible: 'ok', reussi: 'ok', temps: 'danger', elimine: 'danger', incomplet: 'warn', inconnu: '' };
  function verdictText(v, total, ref) {
    const off = ref.official != null ? fmtTenths(ref.official).replace(/,0$/, '') : null;
    const tgt = ref.target != null ? fmtTenths(ref.target).replace(/,0$/, '') : null;
    switch (v.level) {
      case 'elimine': return `✗ Non validé : ${v.failed.join(' ; ')}.`;
      case 'temps': return `✗ Non validé : ${fmtTenths(-v.marginOfficial)} au-dessus de ${off}.${v.pending.length ? ' Réponds aussi aux critères ci-dessus.' : ''}`;
      case 'incomplet': return `Temps sous le seuil${off ? ` de ${off}` : ''}. Réponds aux critères pour avoir le verdict.`;
      case 'cible': return `✓ Validé, avec ta marge (cible ${tgt} atteinte).`;
      case 'reussi': return `✓ Validé (sous ${off})${tgt ? `, mais pas encore ta cible de ${tgt} : encore ${fmtTenths(-v.marginTarget)} à gagner` : ''}.`;
      default: return `Temps : ${fmtTenths(total)}.`;
    }
  }

  // Résultat d'un test fini : critères, bassin, verdict, enregistrement.
  function resultBlock(sl, ref) {
    const { key, cfg, obj } = sl;
    const total = splitTotal(obj.run);
    const v = verdict(total, obj.answers, cfg.checks, ref);
    const pools = cfg.pool ? poolOptions() : [];
    const needPool = cfg.pool && !obj.pool;
    const canSave = !v.pending.length && !needPool;
    const ans = (c) => C.ui.segmented(`ans-${key}-${c.k}`, [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }], obj.answers[c.k] || '',
      `data-change="chrono.st-answer" data-key="${esc(key)}" data-k="${esc(c.k)}"`);
    return `<section class="card tmr-res" aria-label="Résultat">
      <h2>Résultat : <span class="num">${esc(fmtTenths(total))}</span></h2>
      ${cfg.checks.length ? `<h3>Critères éliminatoires</h3><ul class="tmr-checks">${cfg.checks.map((c) => `<li><span>${esc(c.label)}</span>${ans(c)}</li>`).join('')}</ul>` : ''}
      ${cfg.pool ? `<h3>Bassin</h3>${C.ui.segmented(`pool-${key}`, pools, obj.pool || '', `data-change="chrono.st-pool" data-key="${esc(key)}"`)}` : ''}
      <p class="tmr-verdict ${esc(VERDICT_CLS[v.level] || '')}" role="status">${esc(verdictText(v, total, ref))}</p>
      ${v.failed.length ? '<p class="tiny muted">Un critère non respecté : l’essai est enregistré comme entraînement (il ne compte pas comme meilleur temps).</p>' : ''}
      ${obj.savedAt
        ? '<p class="ok-text small">✓ Enregistré dans tes tests.</p>'
        : `<button type="button" class="btn block" data-action="chrono.st-save" data-key="${esc(key)}" ${canSave ? '' : 'disabled'}>Enregistrer ${v.context === 'test' ? 'comme test' : 'comme entraînement'}</button>
           ${canSave ? '' : `<p class="tiny muted">Pour enregistrer : ${esc([needPool ? 'choisis le bassin' : '', v.pending.length ? 'réponds aux critères' : ''].filter(Boolean).join(' et '))}.</p>`}`}
    </section>`;
  }

  // Note enregistrée avec le test (≤ 300 caractères).
  function splitNote(sl, v) {
    const { cfg, obj } = sl;
    const times = splitTimes(obj.run).map((x) => fmtTenths(x.sec));
    const parts = [`Segments : ${times.join(' / ')}`];
    if (cfg.pool && obj.pool) { const p = poolOptions().find((x) => x.value === obj.pool); if (p) parts.push(p.text); }
    if (v.failed.length) parts.push(`non validé : ${v.failed.join(', ')}`);
    else if (v.level === 'temps') parts.push('au-dessus du seuil');
    return parts.join(' · ').slice(0, 300);
  }

  // Test lancé (en cours ou en pause) : écran compact, le gros bouton reste visible sans défiler.
  const isBusy = (sl) => !!sl && ['run', 'pause'].includes(splitStatus(sl.obj.run));

  function afterSplit(sl) {
    return () => {
      if (!sl) return;
      const st = splitStatus(sl.obj.run);
      if (st === 'run' || st === 'pause') { sound.lock('test'); ensureLoop(); }
    };
  }

  /* ───────── Test d'entrée SSA ───────── */

  const APNEA_NOTE = "Apnée : jamais seul (binôme, club ou MNS qui te regarde), pas d'hyperventilation avant de plonger. Arrête au moindre signe (picotements, vision qui se rétrécit).";

  function viewSsaEntry() {
    const sl = slot('ssa-entree');
    const ref = refFor(SSA_ENTRY.benchId, SSA_ENTRY.fallback);
    const done = splitStatus(sl.obj.run) === 'done';
    const running = isBusy(sl);
    return {
      html: `${head("Test d'entrée SSA", running ? '' : "100 m sans arrêt : départ plongé avec au moins 15 m en immersion, 50 m crawl, 25 m sur le dos mains hors de l'eau.")}
      ${running ? '' : `${refCard(SSA_ENTRY.benchId, ref)}<p class="note warn small">${esc(APNEA_NOTE)}</p>`}
      ${splitBlock(sl)}
      ${done ? resultBlock(sl, ref) : ''}
      <p class="tiny muted">Valeurs relevées chez plusieurs organismes de formation ; le texte officiel n'a pas pu être lu : fais-les confirmer par ton organisme.</p>`,
      after: afterSplit(sl),
    };
  }

  /* ───────── TSA ───────── */

  const RECUP_SEC = 600;
  const tsaRecupActive = () => {
    const t = mem && U.isObj(mem.tests['ssa-tsa']) ? mem.tests['ssa-tsa'] : null;
    return !!(t && t.phase === 'recup' && t.recupStart != null && !t.recupBeeped);
  };
  function tsaTick() {
    const t = tsaState();
    if (t.phase !== 'recup' || t.recupStart == null || t.recupBeeped) return;
    const left = RECUP_SEC - (nowMs() - t.recupStart) / 1000;
    if (left > 0) return;
    t.recupBeeped = true;
    saveMem();
    sound.release('test');
    if (-left < 60) { sound.beep({ ...TONES.work, count: 3, gap: 150 }); sound.vibrate([300, 150, 300]); }
    refresh();
  }

  function viewTsa() {
    const t = tsaState();
    const phases = [['course', '1. Parcours'], ['recup', '2. Récupération'], ['palmes', '3. 300 m palmes']];
    const idx = phases.findIndex((p) => p[0] === t.phase);
    const stepper = `<ol class="tmr-phases">${phases.map(([k, label], i) => `<li class="${i < idx ? 'is-done' : i === idx ? 'is-current' : ''}" ${i === idx ? 'aria-current="step"' : ''}>${esc(label)}</li>`).join('')}</ol>`;
    let body = '';
    let after = null;
    const busyNow = (t.phase === 'course' && isBusy(slot('ssa-tsa.course'))) || (t.phase === 'palmes' && isBusy(slot('ssa-tsa.fins')));
    if (t.phase === 'course') {
      const sl = slot('ssa-tsa.course');
      const ref = refFor(TSA_COURSE.benchId, TSA_COURSE.fallback);
      const st = splitStatus(sl.obj.run);
      body = `<h2 class="section">Épreuve 1 : parcours de sauvetage (100 m)</h2>
        ${isBusy(sl) ? '' : `<p class="small muted">Plongeon, 15 m en immersion + 10 m, 25 m crawl, 15 m en immersion + 10 m, approche tête hors de l'eau, canard jusqu'au mannequin (1,80 à 2,80 m), remorquage jusqu'au bord de départ.</p>
        ${refCard(TSA_COURSE.benchId, ref)}
        <p class="note warn small">${esc(APNEA_NOTE)}</p>`}
        ${splitBlock(sl)}
        ${st === 'done' ? resultBlock(sl, ref) : ''}
        ${st === 'done' ? '<button type="button" class="btn block mt" data-action="chrono.tsa-phase" data-to="recup">Lancer les 10 min de récupération ›</button>' : ''}
        ${st === 'idle' ? '<button type="button" class="link" data-action="chrono.tsa-phase" data-to="palmes">Faire seulement le 300 m palmes ›</button>' : ''}`;
      after = afterSplit(sl);
    } else if (t.phase === 'recup') {
      const left = t.recupStart != null ? RECUP_SEC - (nowMs() - t.recupStart) / 1000 : RECUP_SEC;
      body = `<h2 class="section">Récupération</h2>
        <section class="card tmr-recup">
          <div class="tmr-st-total num" id="tmr-tsa-recup" role="timer" aria-live="off">${esc(left > 0 ? fmtClock(left) : '0:00')}</div>
          <p class="small center">${left > 0 ? 'Au moins 10 min entre les deux épreuves. Prépare tes palmes au bord, sans les chausser.' : 'C’est l’heure : place-toi au bord, palmes à la main.'}</p>
          <button type="button" class="btn block" data-action="chrono.tsa-phase" data-to="palmes">Passer au 300 m palmes ›</button>
        </section>`;
      after = () => { if (left > 0) { sound.lock('test'); ensureLoop(); } };
    } else {
      const sl = slot('ssa-tsa.fins');
      const ref = refFor(TSA_FINS.benchId, TSA_FINS.fallback);
      const st = splitStatus(sl.obj.run);
      body = `<h2 class="section">Épreuve 2 : 300 m palmes</h2>
        ${isBusy(sl) ? '' : `<p class="small muted">Tu attends au bord, palmes à la main. Le chrono part au signal, AVANT le chaussage : le chaussage compte. Nage ventrale ; lunettes, masque et tuba autorisés.</p>
        ${refCard(TSA_FINS.benchId, ref)}`}
        ${splitBlock(sl)}
        ${st === 'done' ? resultBlock(sl, ref) : ''}`;
      after = afterSplit(sl);
    }
    return {
      html: `${head('TSA (SSA)', busyNow ? '' : 'Test de sauvetage aquatique : parcours de sauvetage, au moins 10 min de récupération, puis 300 m palmes (chaussage compris).')}
        ${stepper}${body}
        <div class="row gap wrap mt"><button type="button" class="btn ghost small" data-action="chrono.tsa-reset">Recommencer tout le TSA</button></div>
        <p class="tiny muted">Valeurs relevées chez plusieurs organismes ; le texte officiel n'a pas pu être lu : fais-les confirmer par ton organisme.</p>`,
      after,
    };
  }

  /* ───────── Simulation HYROX ───────── */

  function hyroxLoadsCard(doubles) {
    const D = C.data || {};
    if (typeof D.hyroxLoads !== 'function') return '';
    const g = (C.state && Array.isArray(C.state.goals) ? C.state.goals : []).find((x) => x.type === 'hyrox' && x.status !== 'archived');
    const d = (g && g.details) || {};
    const sex = C.state && C.state.profile && C.state.profile.sex;
    const category = d.category || (sex === 'F' ? 'women' : 'men');
    let std = null;
    try { std = D.hyroxLoads(doubles ? 'doubles' : 'solo', category, d.level || 'open'); } catch (e) { std = null; }
    if (!std || !Array.isArray(std.stations)) return '';
    return `<details class="card tmr-hx-loads"><summary>Charges : ${esc(std.label || '')}</summary>
      <ol class="small">${std.stations.map((s) => `<li><b>${esc(s.name)}</b> · ${esc(s.amount)}${s.load ? ` · ${esc(s.load)}` : ''}</li>`).join('')}</ol>
      ${(std.notes || []).map((n) => `<p class="tiny muted">${esc(n)}</p>`).join('')}</details>`;
  }

  function hyroxResult(sl, ref) {
    const h = sl.obj;
    const defs = hyroxSegments({ roxzone: h.roxzone });
    const times = splitTimes(h.run).map((x) => x.sec);
    const sum = hyroxSummary(defs, times);
    const v = verdict(sum.total, h.answers, HYROX.checks, { official: null, target: null });
    const ans = (c) => C.ui.segmented(`ans-hyrox-${c.k}`, [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }], h.answers[c.k] || '',
      `data-change="chrono.st-answer" data-key="hyrox" data-k="${esc(c.k)}"`);
    const row = (label, sec) => `<li><span>${esc(label)}</span><b class="num">${esc(sec == null ? '—' : U.formatDuration(sec))}</b></li>`;
    return `<section class="card tmr-res" aria-label="Résultat">
      <h2>Total : <span class="num">${esc(U.formatDuration(sum.total))}</span>${h.doubles ? ' <span class="pill">Doubles</span>' : ''}</h2>
      <ul class="tmr-sum">
        ${row('Course (8 km)', sum.run)}${row('Stations', sum.station)}${h.roxzone ? row('Roxzone', sum.rox) : ''}
        ${row('Km moyen', sum.runAvg)}
        ${sum.runDrift != null ? `<li><span>Dernier km vs premier</span><b class="num ${sum.runDrift > 30 ? 'warn-text' : ''}">${sum.runDrift >= 0 ? '+' : '−'}${esc(U.formatDuration(Math.abs(sum.runDrift)))}</b></li>` : ''}
        ${sum.longestStation ? `<li><span>Station la plus longue</span><b>${esc(sum.longestStation.label.replace(/^\d+\. /, ''))} · <span class="num">${esc(U.formatDuration(sum.longestStation.sec))}</span></b></li>` : ''}
      </ul>
      ${ref.target != null ? `<p class="small muted">Repère indicatif : ${esc(U.formatDuration(ref.target))}. Objectif : finir, sans te blesser.</p>` : ''}
      <h3>Simulation</h3><ul class="tmr-checks">${HYROX.checks.map((c) => `<li><span>${esc(c.label)}</span>${ans(c)}</li>`).join('')}</ul>
      ${h.answers.complet === 'non' ? '<p class="tiny muted">Simulation partielle : enregistrée comme entraînement (non comparable à une course).</p>' : ''}
      ${h.savedAt ? '<p class="ok-text small">✓ Enregistré dans tes tests.</p>'
        : `<button type="button" class="btn block" data-action="chrono.st-save" data-key="hyrox" ${v.pending.length ? 'disabled' : ''}>Enregistrer</button>
           ${v.pending.length ? '<p class="tiny muted">Réponds à la question pour enregistrer.</p>' : ''}`}
    </section>`;
  }

  function viewHyrox() {
    const sl = slot('hyrox');
    const h = sl.obj;
    const st = splitStatus(h.run);
    const ref = refFor(HYROX.benchId, {});
    const rules = C.data && C.data.hyroxStandards && C.data.hyroxStandards.rules ? C.data.hyroxStandards.rules : {};
    const doublesNote = rules.doubles || 'En Doubles, vous courez les 8 km ensemble et vous vous partagez librement les stations.';
    const running = isBusy(sl);
    return {
      html: `${head('Simulation HYROX', running ? '' : '8 × (1 km de course + 1 station), dans l’ordre officiel. Appuie à la fin de chaque segment.')}
      ${running ? '' : refCard(HYROX.benchId, ref)}
      ${st === 'idle' ? `<section class="card">
        <h2 class="small">Format</h2>
        ${C.ui.segmented('hx-format', [{ value: 'solo', label: 'Solo' }, { value: 'doubles', label: 'Doubles' }], h.doubles ? 'doubles' : 'solo', 'data-change="chrono.hx-opt" data-o="format"')}
        ${h.doubles ? `<p class="note small mt">${esc(doublesNote)} Stations partagées : note qui a fait quoi pour caler votre répartition.</p>` : ''}
        <label class="check-row mt"><input type="checkbox" data-change="chrono.hx-opt" data-o="roxzone" ${h.roxzone ? 'checked' : ''}> Chronométrer la Roxzone (entrée et sortie de chaque station)</label>
        <p class="tiny muted">Sans Roxzone, la transition est comptée dans la station.</p>
      </section>${hyroxLoadsCard(h.doubles)}` : `<p class="small">${h.doubles ? '<span class="pill">Doubles</span> stations partagées' : '<span class="pill">Solo</span>'}${h.roxzone ? ' · Roxzone chronométrée' : ''}</p>`}
      ${splitBlock(sl)}
      ${st === 'done' ? hyroxResult(sl, ref) : ''}
      <p class="tiny muted">Ton chrono est gardé sur ce téléphone à chaque appui : tu peux recharger la page sans le perdre. La pause n'existe pas en course.</p>`,
      after: afterSplit(sl),
    };
  }

  /* ───────── Luc Léger ───────── */

  const lg = { status: 'idle', version: '8.5', voice: true, schedule: null, cues: null, speech: null, nextCue: 0, nextSpeech: 0, startWall: 0, startCtx: null, stopAt: null, completed: 0, id: null, savedAt: null, noAudio: false };
  const lgActive = () => lg.status === 'prep' || lg.status === 'run';

  function legerStart() {
    sound.unlock();
    lg.schedule = legerSchedule(lg.version);
    lg.cues = legerCues(lg.schedule);
    lg.speech = legerSpeech(lg.schedule);
    lg.nextCue = 0;
    lg.nextSpeech = 0;
    lg.id = U.uid();
    lg.savedAt = null;
    lg.stopAt = null;
    lg.completed = 0;
    lg.startWall = nowMs() + 5000;
    const ctx = sound.call('context');
    lg.startCtx = ctx ? ctx.currentTime + 5 : null;
    lg.noAudio = !ctx;
    lg.status = 'prep';
    sound.lock('leger');
    if (lg.voice && voiceSetting()) sound.say('Prêt ? Départ dans cinq secondes.');
    ensureLoop();
  }

  function playCue(cue, at) {
    const tone = cue.kind === 'tick' ? TONES.tick : cue.kind === 'go' ? TONES.go : cue.kind === 'palier' ? TONES.palier : TONES.shuttle;
    sound.beep({ ...tone, at });
  }

  // Programme les bips à venir sur l'horloge audio (fenêtre de 1,2 s), annonce les paliers, fin automatique.
  function legerTick() {
    if (!lgActive()) return;
    const t = (nowMs() - lg.startWall) / 1000;
    if (lg.status === 'prep' && t >= 0) { lg.status = 'run'; refresh(); }
    const ctx = sound.call('context');
    if (ctx && lg.startCtx != null && ctx.state === 'running') {
      // L'horloge audio s'est arrêtée (interruption iOS) : on recale et on reprogramme.
      if (Math.abs(ctx.currentTime - (lg.startCtx + t)) > 0.25) {
        sound.call('cancelScheduled');
        lg.startCtx = ctx.currentTime - t;
        lg.nextCue = lg.cues.findIndex((c) => c.t > t);
        if (lg.nextCue < 0) lg.nextCue = lg.cues.length;
      }
      while (lg.nextCue < lg.cues.length && lg.cues[lg.nextCue].t <= t + 1.2) {
        const cue = lg.cues[lg.nextCue++];
        if (cue.t >= t - 0.15) playCue(cue, lg.startCtx + cue.t);
      }
    }
    while (lg.nextSpeech < lg.speech.length && lg.speech[lg.nextSpeech].t <= t) {
      const sp = lg.speech[lg.nextSpeech++];
      if (t - sp.t < 1.5 && lg.voice && voiceSetting()) sound.say(sp.text);
    }
    const last = lg.schedule[lg.schedule.length - 1];
    if (t >= last.end + 0.3) { legerStop(nowMs(), true); return; }
    paintLeger(t);
  }

  function paintLeger(t) {
    if (!byId('tmr-lg')) return;
    if (t < 0) {
      setText('tmr-lg-state', `Départ dans ${Math.ceil(-t)}…`);
      return;
    }
    const pos = legerAt(lg.schedule, t);
    setText('tmr-lg-state', 'En cours');
    setText('tmr-lg-p', String(pos.palier));
    setText('tmr-lg-k', `${pos.current}/${pos.shuttles}`);
    setText('tmr-lg-v', `${U.fmtNum(pos.speed, 1)} km/h`);
    setText('tmr-lg-d', `${pos.completed * 20} m`);
    setText('tmr-lg-t', U.formatDuration(Math.floor(t)));
    const bar = byId('tmr-lg-bar');
    if (bar) bar.style.width = `${(pos.shuttleProgress * 100).toFixed(1)}%`;
  }

  function legerStop(at, auto) {
    if (!lgActive()) return;
    const t = (at - lg.startWall) / 1000;
    sound.call('cancelScheduled');
    sound.cancel();
    sound.release('leger');
    if (t < 0) { lg.status = 'idle'; refresh(); return; }
    const pos = legerAt(lg.schedule, t);
    lg.stopAt = t;
    lg.completed = pos.completed;
    lg.status = 'done';
    sound.beep(auto ? TONES.finish : TONES.tick);
    if (auto && lg.voice && voiceSetting()) sound.say('Fin de la bande. Bravo !');
    refresh();
  }

  function injuryWarning() {
    const inj = C.state && C.state.profile && Array.isArray(C.state.profile.injuries) ? C.state.profile.injuries : [];
    const z = inj.filter((i) => i && i.active !== false && (i.zone === 'cheville' || i.zone === 'genou'));
    if (!z.length) return '';
    const what = z.map((i) => `${i.zone}${i.side ? ` ${i.side}` : ''}`).join(', ');
    return `<p class="note danger small">Tu as signalé une gêne (${esc(what)}) : fais ce test seulement sans douleur, jamais le lendemain d'une séance dure, et arrête-toi dès que ça tire.</p>`;
  }

  function legerTable(schedule) {
    return `<details class="card tmr-lg-table"><summary>Tableau des paliers</summary>
      <table><thead><tr><th>Palier</th><th>Vitesse</th><th>Navettes</th><th>1 navette</th><th>Début</th></tr></thead>
      <tbody>${schedule.map((p) => `<tr><td class="num">${esc(p.palier)}</td><td class="num">${esc(U.fmtNum(p.speed, 1))} km/h</td><td class="num">${esc(p.shuttles)}</td><td class="num">${esc(U.fmtNum(p.shuttleSec, 2))} s</td><td class="num">${esc(U.formatDuration(p.start))}</td></tr>`).join('')}</tbody></table>
      <p class="tiny muted">Nombre de navettes par palier = arrondi(60 s ÷ durée d'une navette), pour des paliers d'environ 1 min. Peut différer d'une navette d'une bande officielle à l'autre.</p></details>`;
  }

  function viewLeger() {
    const ver = LEGER_VERSIONS[lg.version] || LEGER_VERSIONS['8.5'];
    const ref = refFor('luc_leger', {});
    const soundOff = !soundSetting();
    const intro = `${head('Luc Léger', 'Course navette de 20 m au rythme des bips. Bande sonore générée par l’app.')}
      <p class="note small"><b>Version utilisée :</b> ${esc(ver.label)}</p>`;
    if (lgActive()) {
      return {
        html: `${intro}
        <section class="tmr-lg" id="tmr-lg" aria-label="Test en cours">
          <p class="tmr-lg-state" id="tmr-lg-state">${lg.status === 'prep' ? 'Départ dans 5…' : 'En cours'}</p>
          <div class="tmr-lg-palier"><small>Palier</small><b class="num" id="tmr-lg-p">1</b></div>
          <div class="tmr-lg-grid">
            <div><small>Navette</small><b class="num" id="tmr-lg-k">—</b></div>
            <div><small>Vitesse</small><b class="num" id="tmr-lg-v">—</b></div>
            <div><small>Distance</small><b class="num" id="tmr-lg-d">0 m</b></div>
            <div><small>Temps</small><b class="num" id="tmr-lg-t">0:00</b></div>
          </div>
          <div class="tmr-bar" aria-hidden="true"><span id="tmr-lg-bar"></span></div>
          ${lg.noAudio ? '<p class="note danger small">Son indisponible sur cet appareil : suis la barre (elle se remplit à chaque navette).</p>' : ''}
          <button type="button" class="tmr-tap tmr-lg-stop" data-action="chrono.lg-stop" data-tmr-tap>Stop</button>
          <button type="button" class="btn ghost small block" data-action="chrono.lg-cancel">Annuler sans enregistrer</button>
        </section>`,
        after: () => { ensureLoop(); paintLeger((nowMs() - lg.startWall) / 1000); },
      };
    }
    if (lg.status === 'done') {
      const sc = legerScore(lg.schedule, lg.completed);
      const vma = legerVma(sc.value, lg.version);
      const total = lg.schedule[lg.schedule.length - 1].cumAfter;
      const status = C.data && C.data.benchStatus ? C.data.benchStatus('luc_leger', sc.value, { official: ref.official != null ? { value: ref.official } : null, target: ref.target != null ? { value: ref.target } : null }) : null;
      return {
        html: `${intro}
        <section class="card tmr-res" aria-label="Résultat">
          <h2>Résultat</h2>
          <p>Arrêt à <span class="num">${esc(U.formatDuration(Math.floor(lg.stopAt || 0)))}</span>, pendant le palier ${esc(sc.inPalier)} (${esc(U.plural(sc.shuttlesInPalier, 'navette faite', 'navettes faites'))} sur ${esc(sc.shuttlesOfPalier)}).</p>
          <div class="tmr-lg-adj">
            <button type="button" class="tmr-ed-btn" data-action="chrono.lg-adj" data-d="-1" ${lg.completed <= 0 ? 'disabled' : ''} aria-label="Une navette de moins">−</button>
            <div class="center"><b class="num">${esc(lg.completed)}</b><small class="muted"> navettes terminées</small></div>
            <button type="button" class="tmr-ed-btn" data-action="chrono.lg-adj" data-d="1" ${lg.completed >= total ? 'disabled' : ''} aria-label="Une navette de plus">+</button>
          </div>
          <p class="tiny muted center">Corrige si la dernière navette n'a pas été finie à temps.</p>
          <p class="tmr-verdict ${status && (status.level === 'cible' || status.level === 'reussi') ? 'ok' : ''}">Score : palier ${esc(U.fmtNum(sc.value, 1))}</p>
          <p class="small muted">${esc(U.plural(sc.palierDone, 'palier terminé', 'paliers terminés'))}${sc.half ? ` + au moins la moitié du palier ${esc(sc.inPalier)} (demi-palier)` : ''}. Distance : ${esc(sc.distance)} m.${vma ? ` VMA estimée ≈ ${esc(U.fmtNum(vma, 1))} km/h (estimation).` : ''}</p>
          ${status && status.text ? `<p class="small">${esc(status.text)}${ref.official != null ? ` Seuil : palier ${esc(U.fmtNum(ref.official, 1))}.` : ''}</p>` : ''}
          ${lg.savedAt ? '<p class="ok-text small">✓ Enregistré dans tes tests.</p>' : `<button type="button" class="btn block" data-action="chrono.lg-save" ${sc.value > 0 ? '' : 'disabled'}>Enregistrer</button>`}
          <button type="button" class="btn ghost block mt" data-action="chrono.lg-reset">Nouveau test</button>
        </section>`,
      };
    }
    const sched = legerSchedule(lg.version);
    return {
      html: `${intro}
      ${refCard('luc_leger', ref, 'palier')}
      ${soundOff ? '<div class="note danger small">Le son est coupé dans les réglages : la bande ne s’entendra pas. <button type="button" class="link" data-action="chrono.sound-on">Activer le son</button></div>' : ''}
      <p class="note warn small">Les demi-tours sollicitent chevilles et genoux : échauffe-toi 10 min, freine sur 2 ou 3 pas avant la ligne, pose le pied à plat et pivote sans te tordre. Arrête-toi à la moindre douleur.</p>
      ${injuryWarning()}
      <section class="card">
        <h2 class="small">Réglages</h2>
        <div class="field"><span>Version de la bande</span>${C.ui.segmented('lg-version', [{ value: '8.5', label: '1988 · 8,5 km/h' }, { value: '8', label: 'Militaire · 8 km/h' }], lg.version, 'data-change="chrono.lg-opt" data-o="version"')}</div>
        <label class="check-row"><input type="checkbox" data-change="chrono.lg-opt" data-o="voice" ${lg.voice ? 'checked' : ''}> Annonce vocale des paliers (comme la bande officielle)</label>
        <h3 class="mt">Avant de commencer</h3>
        <ul class="small tmr-list">
          <li>Deux lignes à 20 m exactement (mesure-les).</li>
          <li>Son du téléphone à fond ; sur iPhone, désactive le mode silencieux.</li>
          <li>Au bip, tu dois être sur la ligne. En général, on s'arrête après deux retards de suite (à vérifier selon ton centre).</li>
          <li>Si possible, quelqu'un appuie sur Stop pour toi.</li>
        </ul>
        <button type="button" class="btn block tmr-lg-go" data-action="chrono.lg-start">▶ Lancer la bande (départ dans 5 s)</button>
      </section>
      ${legerTable(sched)}`,
    };
  }

  /* ───────── Rafraîchissement des écrans en direct ───────── */

  function pageLive() {
    if (!hasDoc || !onChrono()) return false;
    const m = loadMem();
    if (m.sw.startedAt != null && byId('tmr-sw-time')) return true;
    const st = byId('tmr-st');
    if (st) { const sl = slot(st.dataset.key); if (sl && ['run', 'pause'].includes(splitStatus(sl.obj.run))) return true; }
    if (byId('tmr-tsa-recup')) return true;
    return false;
  }
  function paintPage() {
    const now = nowMs();
    if (byId('tmr-sw-time')) {
      const sw = loadMem().sw;
      const el = swElapsed(now);
      setText('tmr-sw-time', fmtMs(el));
      if (sw.laps.length) setText('tmr-sw-cur', `Tour ${sw.laps.length + 1} : ${fmtMs(el - sw.laps[sw.laps.length - 1])}`);
    }
    const stEl = byId('tmr-st');
    if (stEl) {
      const sl = slot(stEl.dataset.key);
      if (sl) {
        const r = sl.obj.run;
        const ms = splitElapsedMs(r, now);
        setText('tmr-st-total', fmtMs(ms));
        const s = splitStatus(r);
        if (s === 'run' || s === 'pause') setText('tmr-st-seg', `Segment : ${fmtMs(ms - (r.laps.length ? r.laps[r.laps.length - 1] : 0))}`);
      }
    }
    if (byId('tmr-tsa-recup')) {
      const t = tsaState();
      if (t.recupStart != null) setText('tmr-tsa-recup', fmtClock(Math.max(0, RECUP_SEC - (now - t.recupStart) / 1000)));
    }
  }

  // Aiguillage #/chrono/:mode
  const MODES = {
    chrono: { view: viewStopwatch, title: 'Chronomètre' },
    minuteur: { view: viewMinuteur, title: 'Minuteur' },
    intervalles: { view: viewIntervals, title: 'Intervalles' },
    'ssa-entree': { view: viewSsaEntry, title: "Test d'entrée SSA" },
    'ssa-tsa': { view: viewTsa, title: 'TSA' },
    hyrox: { view: viewHyrox, title: 'Simulation HYROX' },
    'luc-leger': { view: viewLeger, title: 'Luc Léger' },
  };
  function viewMode(params) {
    const m = MODES[params.mode];
    if (!m) return viewHome();
    const out = m.view(params);
    const o = typeof out === 'string' ? { html: out } : out;
    const after = o.after;
    return { html: o.html, after: ($app) => { if (hasDoc) document.title = `${m.title} · Crevare`; if (after) after($app); } };
  }

  /* ═════════════════ 8. Enregistrement ═════════════════ */

  // Instant exact de l'appui (pointerdown), plus précis que le clic qui arrive au relâchement.
  let tapAt = 0;
  const tapTime = () => { const n = nowMs(); return n - tapAt < 1500 ? tapAt : n; };

  if (hasDoc) {
    document.addEventListener('pointerdown', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-tmr-tap]')) tapAt = nowMs();
    }, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { if (full || rest || lgActive() || tsaRecupActive() || pageLive()) { ensureLoop(); loop(); } }
      else saveMem();
    });
    window.addEventListener('pagehide', saveMem);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !full) return;
      if (C.ui && C.ui.isModalOpen && C.ui.isModalOpen()) return;
      // Sinon le gestionnaire Échap d'app.js refermerait aussitôt la confirmation ouverte ici.
      e.preventDefault();
      e.stopImmediatePropagation();
      setTimeout(askStopFull, 0);
    });
  }

  function lapFeedback(last) {
    sound.beep(last ? { ...TONES.lap, count: 2, gap: 60 } : TONES.lap);
    sound.vibrate(last ? [60, 40, 60] : 40);
  }

  function launchTimer(spec) {
    if (!spec) { toast('Minuteur introuvable'); return; }
    sound.unlock();
    open(spec);
  }

  function register() {
    // Récupération TSA en cours avant un rechargement : le bip de fin doit sonner même hors de l'écran Chrono.
    loadMem();
    if (tsaRecupActive()) ensureLoop();

    C.route('#/chrono', viewHome, { tab: '#/chrono', title: 'Chrono' });
    C.route('#/chrono/edition/:id', viewEditor, { tab: '#/chrono', title: 'Minuteur' });
    C.route('#/chrono/:mode', viewMode, { tab: '#/chrono', title: 'Chrono' });

    /* Minuteur plein écran */
    C.action('chrono.t-toggle', () => {
      if (!full || full.done) return;
      if (isPaused(full.run)) { resume(full.run, nowMs()); sound.unlock(); } else { pause(full.run, nowMs()); clearTimeout(full.speakT); sound.cancel(); }
      paintFull();
    });
    C.action('chrono.t-next', () => { if (full && !full.done) { next(full.run, nowMs()); tickFull(); } });
    C.action('chrono.t-prev', () => { if (full && !full.done) { prev(full.run, nowMs()); tickFull(); } });
    C.action('chrono.t-add', () => { if (full && !full.done) { addTime(full.run, nowMs(), 10); paintFull(); } });
    C.action('chrono.t-stop', () => askStopFull());
    C.action('chrono.t-close', () => closeFull(true));
    C.action('chrono.t-again', () => { if (full) { const spec = full.sourceSpec; closeFull(true); open(spec); } });
    C.action('chrono.t-voice', () => {
      if (!full) return;
      full.voice = !full.voice;
      if (!full.voice) sound.cancel();
      else if (!voiceSetting()) toast('La voix est coupée dans les réglages.');
      else if (sound.hasVoice() === false) toast('Pas de voix française sur cet appareil : bips à la place.');
      renderFull();
    });

    /* Barre de repos */
    C.action('chrono.r-add', () => addRest(15));
    C.action('chrono.r-skip', () => stopRest());

    /* Chronomètre */
    C.action('chrono.sw-toggle', () => {
      const sw = loadMem().sw;
      const t = tapTime();
      if (sw.startedAt != null) { sw.acc += Math.max(0, t - sw.startedAt); sw.startedAt = null; sound.release('sw'); } else { sw.startedAt = t; sound.lock('sw'); }
      saveMem();
      refresh();
    });
    C.action('chrono.sw-lap', () => {
      const sw = loadMem().sw;
      if (sw.startedAt == null) return;
      const el = sw.acc + Math.max(0, tapTime() - sw.startedAt);
      if (sw.laps.length && el - sw.laps[sw.laps.length - 1] < 300) return;
      sw.laps.push(el);
      lapFeedback(false);
      saveMem();
      refresh();
    });
    C.action('chrono.sw-reset', () => { loadMem().sw = newSw(); sound.release('sw'); saveMem(); refresh(); });
    C.action('chrono.sw-save', () => swSaveSheet());
    C.onSubmit('chrono.sw-save', (form, fd) => {
      const sw = loadMem().sw;
      const which = fd.get('which');
      const ms = which === 'total' || which == null ? swElapsed(nowMs()) : sw.laps[+which] - (sw.laps[+which - 1] || 0);
      const benchId = String(fd.get('bench') || '');
      if (!benchId || !(ms >= 1000)) { toast('Choisis un test et un temps.'); return; }
      const pool = poolOptions().find((p) => p.value === fd.get('pool'));
      const note = [String(fd.get('note') || '').trim(), pool ? pool.text : ''].filter(Boolean).join(' · ').slice(0, 300);
      const context = fd.get('ctx') === 'entrainement' ? 'entrainement' : 'test';
      if (saveBench(benchId, { value: U.round(ms / 1000, 1), context, source: `chrono:sw-${U.uid().slice(0, 8)}`, note })) {
        C.ui.closeModal();
        const b = C.data && C.data.getBenchmark ? C.data.getBenchmark(benchId) : null;
        toast(`✓ Enregistré : ${b ? b.name : 'test'} ${fmtTenths(ms / 1000)}`);
      }
    });

    /* Minuteur simple */
    C.action('chrono.min-go', (el) => { const s = Number(el.dataset.sec); if (s > 0) launchTimer(minuteurSpec(s)); });
    C.onSubmit('chrono.min-custom', (form) => {
      const s = C.ui.readTime(form.elements.namedItem('sec'));
      if (!(s > 0)) { toast('Tape une durée, par exemple 130 pour 1:30.'); return; }
      launchTimer(minuteurSpec(Math.round(s)));
    });
    C.onChange('chrono.min-voice', (el) => { loadMem().prefs.minVoice = !!el.checked; saveMem(); });

    /* Intervalles */
    C.action('chrono.iv-go', (el) => {
      if (el.dataset.preset) { const p = getPreset(el.dataset.preset); launchTimer(p ? U.clone(p) : null); return; }
      const t = (C.state.timers || []).find((x) => x.id === el.dataset.id);
      launchTimer(t ? U.clone(t) : null);
    });
    C.action('chrono.iv-dup', (el) => {
      const t = (C.state.timers || []).find((x) => x.id === el.dataset.id);
      if (!t) return;
      const copy = { ...U.clone(t), id: U.uid(), name: `${t.name} (copie)`.slice(0, 80) };
      C.store.update((st) => { const i = st.timers.findIndex((x) => x.id === t.id); st.timers.splice(i + 1, 0, copy); });
      toast('Minuteur dupliqué');
    });
    C.action('chrono.iv-del', async (el) => {
      const t = (C.state.timers || []).find((x) => x.id === el.dataset.id);
      if (!t) return;
      if (!(await C.ui.ask(`Supprimer « ${t.name} » ?`, 'Supprimer', { danger: true }))) return;
      C.store.update((st) => { st.timers = st.timers.filter((x) => x.id !== t.id); });
      toast('Minuteur supprimé');
    });

    /* Éditeur */
    const editorForm = () => byId('tmr-ed');
    const editorInput = (form) => {
      readEditor(form);
      setText('tmr-ed-total', editorTotal());
      setText('tmr-ed-err', '');
    };
    C.onInput('chrono.ed-input', editorInput);
    C.onChange('chrono.ed-input', (form, ev) => {
      editorInput(form);
      // Couleur travail/repos de l'étape modifiée, sans re-rendre le formulaire.
      const li = ev && ev.target && ev.target.closest ? ev.target.closest('.tmr-ed-step') : null;
      if (li) { const k = li.querySelector('input[type=radio]:checked'); if (k) li.dataset.kind = k.value; }
    });
    C.action('chrono.ed-add', (el) => {
      const form = editorForm();
      readEditor(form);
      if (!draft) return;
      const kind = el.dataset.kind === 'rest' ? 'rest' : 'work';
      const nWork = draft.timer.steps.filter((s) => s.kind === 'work').length;
      draft.timer.steps.push(kind === 'rest' ? { label: 'Repos', sec: 20, kind } : { label: `Exercice ${nWork + 1}`, sec: 40, kind });
      C.rerender();
    });
    C.action('chrono.ed-move', (el) => {
      readEditor(editorForm());
      if (!draft) return;
      const k = Number(el.dataset.k), j = k + Number(el.dataset.d);
      const s = draft.timer.steps;
      if (j < 0 || j >= s.length) return;
      [s[k], s[j]] = [s[j], s[k]];
      C.rerender();
    });
    C.action('chrono.ed-del', (el) => {
      readEditor(editorForm());
      if (!draft) return;
      draft.timer.steps.splice(Number(el.dataset.k), 1);
      C.rerender();
    });
    C.action('chrono.ed-try', () => {
      readEditor(editorForm());
      if (!draft) return;
      const { timer, errors } = sanitizeTimer(draft.timer);
      if (errors.length) { setText('tmr-ed-err', errors.join(' ')); return; }
      launchTimer(timer);
    });
    C.onSubmit('chrono.ed-save', (form) => {
      readEditor(form);
      if (!draft) return;
      const { timer, errors } = sanitizeTimer(draft.timer);
      if (errors.length) { setText('tmr-ed-err', errors.join(' ')); return; }
      C.store.update((st) => {
        const i = st.timers.findIndex((x) => x.id === timer.id);
        if (i >= 0) st.timers[i] = timer; else st.timers.push(timer);
      }, { silent: true });
      draft = null;
      toast('✓ Minuteur enregistré');
      C.go('#/chrono/intervalles');
    });
    C.action('chrono.ed-remove', async () => {
      if (!draft || draft.isNew) return;
      const id = draft.timer.id;
      if (!(await C.ui.ask(`Supprimer « ${draft.timer.name || 'ce minuteur'} » ?`, 'Supprimer', { danger: true }))) return;
      C.store.update((st) => { st.timers = st.timers.filter((x) => x.id !== id); }, { silent: true });
      draft = null;
      toast('Minuteur supprimé');
      C.go('#/chrono/intervalles');
    });

    /* Tests à temps intermédiaires */
    C.action('chrono.st-tap', (el) => {
      const sl = slot(el.dataset.key);
      if (!sl) return;
      const r = sl.obj.run;
      const t = tapTime();
      const st = splitStatus(r);
      let scrollTop = false;
      if (st === 'idle') { sound.unlock(); splitStart(r, t); sound.lock('test'); lapFeedback(false); ensureLoop(); scrollTop = true; }
      else if (st === 'run') {
        if (!splitLap(r, t)) return;
        const done = splitStatus(r) === 'done';
        lapFeedback(done);
        if (done) sound.release('test');
      } else return;
      saveMem();
      refresh();
      if (scrollTop && hasDoc) window.scrollTo(0, 0);
    });
    C.action('chrono.st-undo', (el) => {
      const sl = slot(el.dataset.key);
      if (!sl || !splitUndo(sl.obj.run)) return;
      sl.obj.savedAt = null;
      sound.lock('test');
      saveMem();
      refresh();
    });
    C.action('chrono.st-pause', (el) => {
      const sl = slot(el.dataset.key);
      if (!sl) return;
      const r = sl.obj.run;
      if (splitStatus(r) === 'pause') splitResume(r, nowMs()); else splitPause(r, nowMs());
      saveMem();
      refresh();
    });
    C.action('chrono.st-reset', async (el) => {
      const sl = slot(el.dataset.key);
      if (!sl) return;
      const st = splitStatus(sl.obj.run);
      if ((st === 'run' || st === 'pause' || (st === 'done' && !sl.obj.savedAt)) && !(await C.ui.ask('Effacer ce chrono et recommencer ?', 'Recommencer', { danger: true }))) return;
      resetSlot(sl.key);
      sound.release('test');
      refresh();
    });
    C.onChange('chrono.st-answer', (el) => {
      const sl = slot(el.dataset.key);
      if (!sl) return;
      sl.obj.answers[el.dataset.k] = el.value === 'non' ? 'non' : 'oui';
      saveMem();
      refresh();
    });
    C.onChange('chrono.st-pool', (el) => {
      const sl = slot(el.dataset.key);
      if (!sl) return;
      sl.obj.pool = String(el.value).slice(0, 80);
      saveMem();
      refresh();
    });
    C.action('chrono.st-save', (el) => {
      const sl = slot(el.dataset.key);
      if (!sl || splitStatus(sl.obj.run) !== 'done' || sl.obj.savedAt) return;
      const total = splitTotal(sl.obj.run);
      let ok = false;
      if (sl.key === 'hyrox') {
        const h = sl.obj;
        const defs = hyroxSegments({ roxzone: h.roxzone });
        const sum = hyroxSummary(defs, splitTimes(h.run).map((x) => x.sec));
        const v = verdict(total, h.answers, HYROX.checks, {});
        const note = [h.doubles ? 'Doubles (stations partagées)' : 'Solo', `course ${U.formatDuration(sum.run)}`, `stations ${U.formatDuration(sum.station)}`,
          h.roxzone ? `Roxzone ${U.formatDuration(sum.rox)}` : '', sum.runDrift != null ? `dernier km ${sum.runDrift >= 0 ? '+' : '−'}${U.formatDuration(Math.abs(sum.runDrift))} vs 1er` : '',
          v.failed.length ? 'simulation partielle' : ''].filter(Boolean).join(' · ');
        ok = saveBench(HYROX.benchId, { value: Math.round(total), context: v.context, source: `chrono:${h.run.id}`, note: note.slice(0, 300) });
      } else {
        const ref = refFor(sl.cfg.benchId, sl.cfg.fallback);
        const v = verdict(total, sl.obj.answers, sl.cfg.checks, ref);
        if (v.pending.length) { toast('Réponds d’abord aux critères.'); return; }
        ok = saveBench(sl.cfg.benchId, { value: U.round(total, 1), context: v.context, source: `chrono:${sl.obj.run.id}`, note: splitNote(sl, v) });
      }
      if (!ok) return;
      sl.obj.savedAt = Date.now();
      pushHistory(sl.key, { date: U.todayKey(), id: sl.obj.run.id, total, splits: splitTimes(sl.obj.run).map((x) => x.sec) });
      saveMem();
      toast('✓ Test enregistré');
      refresh();
    });

    /* TSA */
    C.action('chrono.tsa-phase', (el) => {
      const t = tsaState();
      const to = el.dataset.to;
      if (to === 'recup') { t.phase = 'recup'; t.recupStart = nowMs(); t.recupBeeped = false; sound.lock('test'); ensureLoop(); }
      else if (to === 'palmes') { t.phase = 'palmes'; t.recupBeeped = true; sound.release('test'); }
      else t.phase = 'course';
      saveMem();
      refresh();
      if (hasDoc) window.scrollTo(0, 0);
    });
    C.action('chrono.tsa-reset', async () => {
      if (!(await C.ui.ask('Effacer tout le TSA en cours (parcours, récupération, palmes) ?', 'Recommencer', { danger: true }))) return;
      delete loadMem().tests['ssa-tsa'];
      tsaState();
      saveMem();
      sound.release('test');
      refresh();
    });

    /* HYROX */
    C.onChange('chrono.hx-opt', (el) => {
      const h = hyroxState();
      if (splitStatus(h.run) !== 'idle') return;
      if (el.dataset.o === 'format') h.doubles = el.value === 'doubles';
      if (el.dataset.o === 'roxzone') {
        h.roxzone = !!el.checked;
        h.run = createSplit(hyroxSegments({ roxzone: h.roxzone }).map((d) => d.label));
      }
      saveMem();
      refresh();
    });

    /* Luc Léger */
    C.onChange('chrono.lg-opt', (el) => {
      if (lgActive()) return;
      if (el.dataset.o === 'version' && LEGER_VERSIONS[el.value]) lg.version = el.value;
      if (el.dataset.o === 'voice') lg.voice = !!el.checked;
      refresh();
    });
    C.action('chrono.lg-start', () => { legerStart(); refresh(); });
    C.action('chrono.lg-stop', () => legerStop(tapTime(), false));
    C.action('chrono.lg-cancel', async () => {
      if (!(await C.ui.ask('Arrêter la bande sans enregistrer ?', 'Arrêter', { danger: true }))) return;
      sound.call('cancelScheduled');
      sound.cancel();
      sound.release('leger');
      lg.status = 'idle';
      refresh();
    });
    C.action('chrono.lg-adj', (el) => {
      if (lg.status !== 'done') return;
      const total = lg.schedule[lg.schedule.length - 1].cumAfter;
      lg.completed = U.clamp(lg.completed + Number(el.dataset.d || 0), 0, total);
      lg.savedAt = null;
      refresh();
    });
    C.action('chrono.lg-save', () => {
      if (lg.status !== 'done' || lg.savedAt) return;
      const sc = legerScore(lg.schedule, lg.completed);
      if (!(sc.value > 0)) return;
      const ver = LEGER_VERSIONS[lg.version] || LEGER_VERSIONS['8.5'];
      const vma = legerVma(sc.value, lg.version);
      const note = [ver.short, `arrêt palier ${sc.inPalier}, navette ${sc.shuttlesInPalier}/${sc.shuttlesOfPalier}`, `${sc.distance} m`,
        vma ? `VMA estimée ≈ ${U.fmtNum(vma, 1)} km/h` : ''].filter(Boolean).join(' · ');
      if (saveBench('luc_leger', { value: sc.value, context: 'test', source: `chrono:${lg.id}`, note })) {
        lg.savedAt = Date.now();
        toast(`✓ Luc Léger enregistré : palier ${U.fmtNum(sc.value, 1)}`);
        refresh();
      }
    });
    C.action('chrono.lg-reset', () => { lg.status = 'idle'; lg.savedAt = null; refresh(); });
    C.action('chrono.sound-on', () => { C.store.update((st) => { st.settings.sound = true; }); toast('Son activé'); });
  }

  function resetSlot(key) {
    const m = loadMem();
    if (key === 'ssa-entree') delete m.tests[key];
    else if (key === 'hyrox') { const h = hyroxState(); m.tests.hyrox = { doubles: h.doubles, roxzone: h.roxzone }; }
    else if (key === 'ssa-tsa.course' || key === 'ssa-tsa.fins') {
      const t = tsaState();
      const part = key.endsWith('course') ? 'course' : 'fins';
      const cfg = part === 'course' ? TSA_COURSE : TSA_FINS;
      t[part] = reviveTest(null, cfg.segments, cfg.checks);
    }
    slot(key);
    saveMem();
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.timer = {
    open,
    rest: (sec, label, opts) => startRest(sec, label, opts),
    stopRest,
    close: () => closeFull(false),
    isOpen: () => !!full,
    presets: PRESETS,
    // Fonctions pures (tests et autres modules)
    engine: { normSpec, buildSegments, totalOf, createRun, start, pause, resume, isPaused, elapsed, snapshot, seek, next, prev, addTime, poll, countFrom, indexAt, announceText, durationWords, positionText, COUNT_WORDS, LATE_SEC },
    split: { createSplit, splitStatus, splitElapsedMs, splitStart, splitLap, splitUndo, splitPause, splitResume, splitTimes, splitTotal, splitCurrent, reviveSplit, MIN_LAP_MS },
    leger: { LEGER_VERSIONS, legerSchedule, legerAt, legerScore, legerCues, legerSpeech, legerVma },
    tests: { SSA_ENTRY, TSA_COURSE, TSA_FINS, HYROX, hyroxSegments, hyroxSummary, verdict },
    sanitizeTimer, timerSummary, getPreset,
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
