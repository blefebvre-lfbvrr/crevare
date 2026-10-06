/* Crevare — pont Apple Santé (via un Raccourci iOS), export calendrier (.ics) et partage de fichiers.
 * Une page web n'a pas accès à Apple Santé : un Raccourci lit les données (poids, pas, sommeil)
 * et les copie sous forme de texte ; l'utilisateur colle ce texte dans l'app.
 * Format documenté (une mesure par ligne, séparateur « ; », virgule décimale acceptée) :
 *   poids;AAAA-MM-JJ;72,4
 *   pas;AAAA-MM-JJ;8450
 *   sommeil;AAAA-MM-JJ;7,2                          (heures ; « 7h12 », « 7:12 », « 432 min » acceptés)
 *   entrainement;AAAA-MM-JJ;Course;45;7,8;520;148    (type ; durée min ; distance km ; kcal ; FC moyenne)
 * Dates : AAAA-MM-JJ, jj/mm/aaaa, « 6 oct. 2026 », « aujourd'hui », « hier ». JSON accepté aussi.
 * Fonctions pures (parse, buildICS, applyTo…) sans DOM : testables dans Node. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Lecture du texte (Raccourci) ───────── */

  // Libellés acceptés pour le type de mesure (comparés sans accents ni majuscules).
  const TYPE_ALIASES = {
    poids: 'weight', weight: 'weight', weights: 'weight', masse: 'weight', 'masse corporelle': 'weight', bodymass: 'weight',
    pas: 'steps', steps: 'steps', 'nombre de pas': 'steps', stepcount: 'steps',
    sommeil: 'sleep', sleep: 'sleep', 'analyse du sommeil': 'sleep', nuit: 'sleep',
    entrainement: 'workout', entrainements: 'workout', workout: 'workout', workouts: 'workout',
    seance: 'workout', seances: 'workout', activite: 'workout', activites: 'workout',
  };
  const TYPE_HELP = 'poids, pas, sommeil ou entrainement';
  // Type reconnu (propriété propre seulement : « constructor » n'est pas un type).
  const kindOf = (s) => (Object.prototype.hasOwnProperty.call(TYPE_ALIASES, norm(s)) ? TYPE_ALIASES[norm(s)] : null);

  const MONTHS = [['janv', 1], ['jan', 1], ['fevr', 2], ['fev', 2], ['mars', 3], ['mar', 3], ['avr', 4], ['mai', 5], ['juin', 6],
    ['juil', 7], ['aout', 8], ['sept', 9], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12]];

  const norm = (s) => U.normalize(s).replace(/[’']/g, '').replace(/\s+/g, ' ').trim();

  // Date réelle (rejette le 31/02) → clé AAAA-MM-JJ ou null.
  function makeKey(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (!(y >= 1900 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    const k = `${y}-${U.pad(m)}-${U.pad(d)}`;
    return U.dateKey(new Date(y, m - 1, d, 12)) === k ? k : null;
  }

  // Date saisie ou produite par Raccourcis → clé locale, ou null.
  function parseDate(input, today) {
    const raw = String(input ?? '').trim();
    if (!raw) return null;
    const t = U.isKey(today) ? today : U.todayKey();
    const s = norm(raw);
    if (s === 'aujourdhui' || s === 'today') return t;
    if (s === 'hier' || s === 'yesterday') return U.addDays(t, -1);
    // ISO avec heure et fuseau (2026-10-06T23:30:00Z) : date locale de cet instant.
    if (/^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})$/.test(s)) {
      const d = new Date(raw.replace(' ', 'T'));
      if (!isNaN(d)) return U.dateKey(d);
    }
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?![\d])/);
    if (m) return makeKey(m[1], m[2], m[3]);
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?![\d])/);
    if (m) return makeKey(m[3].length === 2 ? 2000 + Number(m[3]) : m[3], m[2], m[1]);
    // « 6 oct. 2026 », « 6 octobre 2026 à 07:30 », « mardi 6 octobre 2026 »
    m = s.match(/(?:^|\s)(\d{1,2})(?:er)?\s+([a-z]+)\.?\s+(\d{4})(?![\d])/);
    if (m) {
      const mo = MONTHS.find(([p]) => m[2].startsWith(p));
      if (mo) return makeKey(m[3], mo[1], m[1]);
    }
    return null;
  }

  // Premier nombre d'un texte : « 8 450 » → 8450, « 72,4 kg » → 72.4. null sinon.
  function parseNumber(input) {
    if (typeof input === 'number') return isFinite(input) ? input : null;
    const s = String(input ?? '').replace(/(\d)[\s\u00a0\u202f](?=\d{3}(?!\d))/g, '$1');
    const m = s.match(/-?\d+(?:[.,]\d+)?/);
    if (!m) return null;
    const n = Number(m[0].replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function parseWeight(v) {
    let n = parseNumber(v);
    if (n == null) return null;
    const s = norm(v);
    if (/\b(lb|lbs|livres?)\b/.test(s)) n *= 0.45359237;
    else if (/\d\s*g\b/.test(s) && n > 1000) n /= 1000;
    return n >= 20 && n <= 400 ? U.round(n, 2) : null;
  }

  function parseSteps(v) {
    const n = parseNumber(v);
    return n != null && n >= 0 && n <= 200000 ? Math.round(n) : null;
  }

  // Durée de sommeil → heures (2 décimales). Nombre seul : ≤ 24 → heures, ≤ 1440 → minutes, sinon secondes.
  function parseSleepHours(v) {
    const s = norm(v).replace(',', '.');
    if (!s) return null;
    let h = null, m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:eures?)?\s*(?:(\d{1,2})\s*(?:min|mn|m)?)?$/))) h = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
    else if ((m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/))) h = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3]) / 3600 : 0);
    else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:min|mn|minutes?)$/))) h = Number(m[1]) / 60;
    else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secondes?)$/))) h = Number(m[1]) / 3600;
    else if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) {
      const n = Number(m[1]);
      h = n <= 24 ? n : n <= 1440 ? n / 60 : n <= 86400 ? n / 3600 : null;
    }
    return h != null && isFinite(h) && h > 0 && h <= 24 ? U.round(h, 2) : null;
  }

  // Durée d'entraînement → minutes. Nombre seul = minutes ; « 0:45:00 », « 1h05 », « 2700 s » acceptés.
  function parseMinutes(v) {
    const s = norm(v).replace(/\s+/g, ' ');
    if (!s) return null;
    let min = null, m;
    if (/^\d+(?:[.,]\d+)?$/.test(s)) min = Number(s.replace(',', '.'));
    else if ((m = s.match(/^(\d):([0-5]\d)$/))) min = Number(m[1]) * 60 + Number(m[2]); // « 1:05 » = 1 h 05 (pas 1 min 5 s)
    else {
      const sec = U.parseDuration(s); // « 45:00 », « 0:45:00 », « 1h05 », « 2700 s »
      if (sec != null) min = sec / 60;
    }
    return min != null && min >= 1 && min <= 600 ? Math.round(min) : null;
  }

  function parseKm(v) {
    const n = parseNumber(v);
    if (n == null) return null;
    const s = norm(v);
    let km = n;
    if (/\d\s*m\b/.test(s) && !/km/.test(s)) km = n / 1000;
    else if (/\b(mi|miles?)\b/.test(s)) km = n * 1.609344;
    return km > 0 && km < 500 ? U.round(km, 2) : null;
  }
  const parseKcal = (v) => { const n = parseNumber(v); return n != null && n >= 0 && n < 10000 ? Math.round(n) : null; };
  const parseHr = (v) => { const n = parseNumber(v); return n != null && n >= 30 && n <= 230 ? Math.round(n) : null; };
  const blank = (v) => v == null || String(v).trim() === '';

  function emptyParsed() { return { weights: [], steps: [], sleep: [], workouts: [], errors: [], count: 0 }; }

  // Ajoute une mesure à `out`. vals : [valeur] ou, pour un entraînement, [type, durée, distance, kcal, fc].
  function addRecord(out, kind, dateRaw, vals, where, today) {
    const err = (reason) => { out.errors.push({ line: where.line, text: where.text, reason }); };
    const date = parseDate(dateRaw, today);
    if (!date) return err(blank(dateRaw) ? 'Date manquante' : `Date illisible : « ${String(dateRaw).slice(0, 30)} »`);
    if (date > today) return err('Date dans le futur');
    if (kind === 'weight') {
      const v = parseWeight(vals[0]);
      if (v == null) return err('Poids illisible (attendu entre 20 et 400 kg)');
      out.weights.push({ date, value: v });
    } else if (kind === 'steps') {
      const v = parseSteps(vals[0]);
      if (v == null) return err('Nombre de pas illisible');
      out.steps.push({ date, value: v });
    } else if (kind === 'sleep') {
      const v = parseSleepHours(vals[0]);
      if (v == null) return err('Durée de sommeil illisible (ex. 7,2 ou 7h12)');
      out.sleep.push({ date, hours: v });
    } else if (kind === 'workout') {
      const [type, dur, dist, kcal, hr] = vals;
      const w = {
        date, type: String(type || '').trim().slice(0, 40) || 'Entraînement',
        durationMin: parseMinutes(dur), distanceKm: blank(dist) ? null : parseKm(dist),
        kcal: blank(kcal) ? null : parseKcal(kcal), hrAvg: blank(hr) ? null : parseHr(hr),
      };
      if (w.durationMin == null) return err('Durée illisible (en minutes, ex. 45)');
      out.workouts.push(w);
    }
    out.count++;
    return null;
  }

  // Garde une seule mesure par jour (la dernière lue) et trie par date.
  function finalize(out) {
    const lastBy = (list, keyFn) => {
      const map = new Map();
      for (const x of list) map.set(keyFn(x), x);
      return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    };
    out.weights = lastBy(out.weights, (x) => x.date);
    out.steps = lastBy(out.steps, (x) => x.date);
    out.sleep = lastBy(out.sleep, (x) => x.date);
    out.workouts = lastBy(out.workouts, (x) => `${x.date}|${norm(x.type)}|${x.durationMin}`);
    out.count = out.weights.length + out.steps.length + out.sleep.length + out.workouts.length;
    return out;
  }

  const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return null; };
  const VALUE_KEYS = ['value', 'valeur', 'kg', 'poids', 'heures', 'hours', 'h', 'nombre', 'count', 'pas', 'steps', 'sommeil', 'qty'];

  // JSON : { poids:[{date, valeur}], pas:[…], sommeil:[…], entrainements:[{date, type, duree, distance, kcal, fc}] }
  // ou [{ type:'poids', date, valeur }, …].
  function parseJSON(text, today) {
    const out = emptyParsed();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      out.errors.push({ line: 0, text: '', reason: 'JSON illisible' });
      return out;
    }
    const records = [];
    const push = (kind, e, i) => {
      if (Array.isArray(e)) { records.push({ kind, date: e[0], vals: e.slice(1), where: { line: i + 1, text: JSON.stringify(e).slice(0, 80) } }); return; }
      if (!U.isObj(e)) { out.errors.push({ line: i + 1, text: String(e).slice(0, 80), reason: 'Entrée illisible' }); return; }
      const where = { line: i + 1, text: JSON.stringify(e).slice(0, 80) };
      const date = pick(e, ['date', 'jour', 'day', 'startDate', 'debut']);
      if (kind === 'workout') {
        records.push({ kind, date, where, vals: [
          pick(e, ['type', 'nom', 'name', 'activite', 'activity']),
          pick(e, ['durationMin', 'duree', 'durée', 'duration', 'minutes', 'min']),
          pick(e, ['distanceKm', 'distance', 'km']),
          pick(e, ['kcal', 'calories', 'energie', 'energy']),
          pick(e, ['hrAvg', 'fc', 'fcMoy', 'hr', 'heartRate', 'bpm']),
        ] });
      } else records.push({ kind, date, where, vals: [pick(e, VALUE_KEYS)] });
    };
    if (Array.isArray(data)) {
      data.forEach((e, i) => {
        const kind = U.isObj(e) ? kindOf(e.type || e.kind || e.mesure || '') : null;
        if (!kind) { out.errors.push({ line: i + 1, text: JSON.stringify(e).slice(0, 80), reason: `Type inconnu (${TYPE_HELP})` }); return; }
        push(kind, e, i);
      });
    } else if (U.isObj(data)) {
      for (const [k, v] of Object.entries(data)) {
        const kind = kindOf(k);
        if (!kind) continue; // autres clés ignorées (ex. « version »)
        (Array.isArray(v) ? v : [v]).forEach((e, i) => push(kind, e, i));
      }
    } else {
      out.errors.push({ line: 0, text: '', reason: 'JSON sans mesures' });
      return out;
    }
    for (const r of records) addRecord(out, r.kind, r.date, r.vals, r.where, today);
    return finalize(out);
  }

  /* parse(text, today?) → { weights:[{date, value}], steps:[{date, value}], sleep:[{date, hours}],
   *   workouts:[{date, type, durationMin, distanceKm, kcal, hrAvg}], errors:[{line, text, reason}], count } */
  function parse(text, today) {
    const t = U.isKey(today) ? today : U.todayKey();
    const src = String(text ?? '').replace(/^\uFEFF/, '').trim();
    if (!src) return emptyParsed();
    if (/^[[{]/.test(src)) return parseJSON(src, t);
    const out = emptyParsed();
    src.split(/\r\n|\n|\r/).forEach((rawLine, i) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) return;
      const where = { line: i + 1, text: line.slice(0, 80) };
      const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : line.includes('|') ? '|' : null;
      if (!sep) { out.errors.push({ ...where, reason: 'Séparateur « ; » manquant' }); return; }
      const f = line.split(sep).map((x) => x.trim());
      if (norm(f[1]) === 'date') return; // ligne d'en-tête
      const kind = kindOf(f[0]);
      if (!kind) { out.errors.push({ ...where, reason: `Type « ${f[0].slice(0, 20)} » inconnu (${TYPE_HELP})` }); return; }
      addRecord(out, kind, f[1], f.slice(2), where, t);
    });
    return finalize(out);
  }

  /* ───────── Application à l'état ───────── */

  // Catégorie d'un entraînement (libellé libre de la montre) et d'une séance de l'app.
  function workoutKind(type) {
    const t = U.normalize(type);
    if (/swim|nata|pisc|nage/.test(t)) return 'piscine';
    if (/run|cours|jog|foot|trail/.test(t)) return 'course';
    if (/strength|muscu|force|functional|fonction|hiit|cross|train|row|rame|ski|ellip|hyrox|core|gainage/.test(t)) return 'salle';
    return 'autre';
  }
  function sessionKind(s) {
    const k = s.kind, loc = s.loc;
    if (k === 'swim' || loc === 'piscine') return 'piscine';
    if (k === 'run' || loc === 'dehors') return 'course';
    if (loc === 'salle' || k === 'gym') return 'salle';
    if (loc === 'maison' || k === 'home' || k === 'rehab') return 'maison';
    return 'autre';
  }
  const KIND_LOC = { piscine: 'piscine', course: 'dehors', salle: 'salle', maison: 'maison', autre: 'autre' };

  // Habitude « sommeil » (cochable) et son seuil en heures (lu dans le nom, 7 h par défaut).
  function sleepHabit(state) {
    const list = Array.isArray(state.habits) ? state.habits : [];
    const h = list.find((x) => U.isObj(x) && !x.archivedAt && (x.type || 'check') === 'check' && (x.id === 'sleep' || /sommeil/i.test(x.name || '')));
    if (!h) return null;
    const m = String(h.name || '').match(/(\d+(?:[.,]\d+)?)\s*h/i);
    const threshold = m ? Number(m[1].replace(',', '.')) : 7;
    return { habit: h, threshold: threshold > 0 && threshold <= 12 ? threshold : 7 };
  }

  function freeSession(date, w) {
    const kind = workoutKind(w.type);
    const title = `${w.type} (montre)`;
    let s = null;
    try { if (C.sessions && typeof C.sessions.build === 'function') s = C.sessions.build(date, { free: true, title, loc: KIND_LOC[kind] }); } catch (e) { s = null; }
    if (!s) {
      s = { id: U.uid(), date, source: 'libre', templateId: null, customSessionId: null, variant: 'normal', title, loc: KIND_LOC[kind], kind: 'libre',
        goals: [], plannedMin: null, intro: '', safety: [], exercises: [], log: {}, pain: {}, feeling: null, poolId: null, poolLength: null };
    }
    return Object.assign(s, {
      status: 'done', startedAt: null, finishedAt: null, durationMin: w.durationMin, rpe: null,
      notes: 'Ajoutée depuis Apple Santé (Apple Watch).',
      watch: { hrAvg: w.hrAvg, kcal: w.kcal, distanceKm: w.distanceKm },
    });
  }

  /* applyTo(state, parsed, opts?) : modifie `state` (fonction pure sur l'objet reçu) et renvoie un résumé.
   * Poids → state.body ; sommeil ≥ seuil → coche l'habitude sommeil ; entraînements → complètent la séance
   * du même jour (données de la montre) ou créent une séance libre terminée ; pas → information seulement. */
  function applyTo(state, parsed, opts = {}) {
    const p = parsed || emptyParsed();
    const res = { weights: 0, sleepChecked: 0, sleepShort: 0, sleepNoHabit: false, sleepThreshold: 7,
      workoutsNew: 0, workoutsDup: 0, linked: 0, created: 0, steps: (p.steps || []).length, stepsAvg: null, stepsLast: null };

    if (!U.isObj(state.body)) state.body = {};
    for (const w of p.weights || []) {
      state.body[w.date] = { ...(U.isObj(state.body[w.date]) ? state.body[w.date] : {}), weight: w.value };
      res.weights++;
    }

    if ((p.sleep || []).length) {
      const sh = sleepHabit(state);
      if (!sh) res.sleepNoHabit = true;
      else {
        res.sleepThreshold = sh.threshold;
        if (!U.isObj(state.habitLog)) state.habitLog = {};
        for (const n of p.sleep) {
          if (n.hours >= sh.threshold) {
            state.habitLog[n.date] = { ...(U.isObj(state.habitLog[n.date]) ? state.habitLog[n.date] : {}), [sh.habit.id]: true };
            res.sleepChecked++;
          } else res.sleepShort++;
        }
      }
    }

    if ((p.steps || []).length) {
      res.stepsAvg = Math.round(U.mean(p.steps.map((x) => x.value)));
      res.stepsLast = p.steps[p.steps.length - 1];
    }

    if ((p.workouts || []).length) {
      if (!U.isObj(state.health)) state.health = { lastImportAt: null, workouts: [] };
      if (!Array.isArray(state.health.workouts)) state.health.workouts = [];
      if (!U.isObj(state.sessions)) state.sessions = {};
      const known = state.health.workouts;
      const used = new Set(known.map((x) => x && x.linkedSessionId).filter(Boolean));
      for (const w of p.workouts) {
        const dup = known.find((x) => U.isObj(x) && x.date === w.date && norm(x.type) === norm(w.type) && Math.abs((+x.durationMin || 0) - w.durationMin) <= 1);
        if (dup) { res.workoutsDup++; continue; }
        const entry = { id: U.uid(), date: w.date, type: w.type, durationMin: w.durationMin, distanceKm: w.distanceKm, kcal: w.kcal, hrAvg: w.hrAvg, linkedSessionId: null };
        const wk = workoutKind(w.type);
        const cands = Object.values(state.sessions).filter((s) => U.isObj(s) && s.date === w.date && s.status !== 'skipped' && !used.has(s.id));
        let target = cands.find((s) => sessionKind(s) === wk) || null;
        if (!target && cands.length === 1 && (wk === 'autre' || sessionKind(cands[0]) === 'autre' || sessionKind(cands[0]) === 'maison')) target = cands[0];
        if (target) {
          const prev = U.isObj(target.watch) ? target.watch : {};
          target.watch = {
            hrAvg: prev.hrAvg != null ? prev.hrAvg : w.hrAvg,
            kcal: prev.kcal != null ? prev.kcal : w.kcal,
            distanceKm: prev.distanceKm != null ? prev.distanceKm : w.distanceKm,
          };
          if (target.status === 'done' && !target.durationMin) target.durationMin = w.durationMin;
          entry.linkedSessionId = target.id;
          res.linked++;
        } else if (opts.createSessions !== false) {
          const s = freeSession(w.date, w);
          state.sessions[s.id] = s;
          entry.linkedSessionId = s.id;
          res.created++;
        }
        if (entry.linkedSessionId) used.add(entry.linkedSessionId);
        known.push(entry);
        res.workoutsNew++;
      }
    }

    if (!U.isObj(state.health)) state.health = { lastImportAt: null, workouts: [] };
    state.health.lastImportAt = opts.now || new Date().toISOString();
    return res;
  }

  // Enregistre (et re-rend) puis renvoie le résumé.
  function apply(parsed) {
    return C.store.update((st) => applyTo(st, parsed));
  }

  // Phrases lisibles pour un résumé d'import.
  function summaryLines(res) {
    const out = [];
    if (!res) return out;
    if (res.weights) out.push(`${U.plural(res.weights, 'poids ajouté', 'poids ajoutés')} (Poids & alimentation).`);
    if (res.sleepChecked) out.push(`Sommeil : habitude cochée ${U.plural(res.sleepChecked, 'jour', 'jours')} (≥ ${U.fmtNum(res.sleepThreshold, 1)} h).`);
    if (res.sleepShort) out.push(`Sommeil : ${U.plural(res.sleepShort, 'nuit', 'nuits')} sous ${U.fmtNum(res.sleepThreshold, 1)} h, rien de coché.`);
    if (res.sleepNoHabit) out.push('Sommeil lu, mais aucune habitude « sommeil » active : crée-la dans Habitudes pour la cocher automatiquement.');
    if (res.linked) out.push(`${U.plural(res.linked, 'séance complétée', 'séances complétées')} avec les données de la montre.`);
    if (res.created) out.push(`${U.plural(res.created, 'séance libre ajoutée', 'séances libres ajoutées')} (faite hors du plan).`);
    if (res.workoutsDup) out.push(`${U.plural(res.workoutsDup, 'entraînement déjà importé', 'entraînements déjà importés')} : ignoré${res.workoutsDup > 1 ? 's' : ''}.`);
    if (res.steps && res.stepsLast) out.push(`Pas : ${U.fmtNum(res.stepsLast.value, 0)} le ${U.fmtShort(res.stepsLast.date)}${res.steps > 1 ? ` (moyenne ${U.fmtNum(res.stepsAvg, 0)} sur ${res.steps} jours)` : ''}. Pour information.`);
    if (!out.length) out.push('Rien de nouveau à ajouter.');
    return out;
  }

  /* ───────── Calendrier (.ics, RFC 5545) ───────── */

  const utf8Len = (ch) => { const cp = ch.codePointAt(0); return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; };

  // Texte d'une propriété : \ ; , et retours à la ligne échappés.
  function icsEscape(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\n|\r/g, '\\n');
  }

  // Repli des lignes : 75 octets maximum (UTF-8), suite précédée d'une espace ; jamais au milieu d'un caractère.
  function foldLine(line) {
    const parts = [];
    let cur = '', bytes = 0;
    for (const ch of String(line)) {
      const b = utf8Len(ch);
      if (bytes + b > 75) { parts.push(cur); cur = ' ' + ch; bytes = 1 + b; } else { cur += ch; bytes += b; }
    }
    parts.push(cur);
    return parts.join('\r\n');
  }

  const compactDate = (k) => k.replace(/-/g, '');
  // Durée relative d'un rappel (RFC 5545) : -PT1H, PT8H, -P1D, -PT15H, -PT1H30M…
  const validTrigger = (t) => typeof t === 'string' && /^[-+]?P(?:\d+W|(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?)$/.test(t) && !/[PT]$/.test(t);
  function utcStamp(d) {
    const x = d instanceof Date && !isNaN(d) ? d : new Date();
    return `${x.getUTCFullYear()}${U.pad(x.getUTCMonth() + 1)}${U.pad(x.getUTCDate())}T${U.pad(x.getUTCHours())}${U.pad(x.getUTCMinutes())}${U.pad(x.getUTCSeconds())}Z`;
  }
  const isHM = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const hmToMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const minToHM = (m) => `${U.pad(Math.floor(m / 60) % 24)}:${U.pad(m % 60)}`;

  /* buildICS(events, opts) → texte .ics.
   * event : { uid, date, start?:'HH:MM', end?:'HH:MM', durationMin?, summary, description?, location?, categories?:[],
   *           alarm?:{ trigger:'-PT1H', text } }. Sans heure valide : événement sur la journée.
   * Heures « flottantes » (heure locale du téléphone). opts : { name, stamp (Date) }. */
  function buildICS(events, opts = {}) {
    const stamp = utcStamp(opts.stamp);
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Crevare//Plan//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    if (opts.name) L.push(`X-WR-CALNAME:${icsEscape(opts.name)}`);
    for (const e of events || []) {
      if (!e || !U.isKey(e.date) || !e.uid) continue;
      L.push('BEGIN:VEVENT', `UID:${icsEscape(e.uid)}`, `DTSTAMP:${stamp}`);
      if (isHM(e.start)) {
        const s = hmToMin(e.start);
        let end = isHM(e.end) ? hmToMin(e.end) : s + (e.durationMin > 0 ? Math.round(e.durationMin) : 60);
        let endDate = e.date;
        if (end <= s) end = s + (e.durationMin > 0 ? Math.round(e.durationMin) : 60);
        if (end >= 1440) { endDate = U.addDays(e.date, Math.floor(end / 1440)); end %= 1440; }
        L.push(`DTSTART:${compactDate(e.date)}T${e.start.replace(':', '')}00`);
        L.push(`DTEND:${compactDate(endDate)}T${minToHM(end).replace(':', '')}00`);
        L.push('TRANSP:OPAQUE');
      } else {
        L.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(U.addDays(e.date, 1))}`, 'TRANSP:TRANSPARENT');
      }
      L.push(`SUMMARY:${icsEscape(e.summary || 'Crevare')}`);
      if (e.description) L.push(`DESCRIPTION:${icsEscape(e.description)}`);
      if (e.location) L.push(`LOCATION:${icsEscape(e.location)}`);
      if (Array.isArray(e.categories) && e.categories.length) L.push(`CATEGORIES:${e.categories.map(icsEscape).join(',')}`);
      if (e.alarm && validTrigger(e.alarm.trigger)) {
        L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(e.alarm.text || e.summary || 'Rappel')}`, `TRIGGER:${e.alarm.trigger}`, 'END:VALARM');
      }
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(foldLine).join('\r\n') + '\r\n';
  }

  const LOC_ICON = { maison: '🏠', salle: '🏋️', piscine: '🏊', dehors: '🏃', repos: '🧘', autre: '•' };
  const LOC_LABEL = { maison: 'Maison', salle: 'Salle', piscine: 'Piscine', dehors: 'Extérieur', repos: 'Repos', autre: '' };
  const safe = (fn, fb = null) => { try { return fn(); } catch (e) { return fb; } };

  /* icsForPlan(from, to, opts?) → texte .ics : séances prévues (planificateur), jours d'épreuve, objectifs et
   * jalons non faits. Séance avec horaire si C.agenda.trainingSlot propose un créneau, sinon sur la journée.
   * Rappels : 1 h avant une séance avec horaire, 8 h le jour même sinon, 9 h la veille d'un objectif, 9 h pour un jalon.
   * UID stables : réimporter met à jour au lieu de dupliquer (selon l'app Calendrier). */
  function icsForPlan(from, to, opts = {}) {
    const f = U.isKey(from) ? from : U.todayKey();
    const t = U.isKey(to) && to >= f ? to : U.addDays(f, 55);
    const state = C.state || {};
    const events = [];
    const planned = C.planner && typeof C.planner.day === 'function';
    if (planned) {
      for (const date of U.range(f, t)) {
        const dp = safe(() => C.planner.day(date));
        if (!U.isObj(dp)) continue;
        const isEvent = dp.kind === 'event';
        if (!isEvent && !(dp.kind === 'session' && !dp.optional)) continue;
        const dur = U.num(dp.durationMin);
        let slot = null;
        if (!isEvent && dur && C.agenda && typeof C.agenda.trainingSlot === 'function') slot = safe(() => C.agenda.trainingSlot(date, dur));
        const timed = U.isObj(slot) && isHM(slot.start);
        const title = isEvent ? `🎯 ${(dp.event && dp.event.title) || dp.title || 'Épreuve'}` : `${LOC_ICON[dp.loc] || '•'} ${dp.title || 'Séance'}`;
        const desc = [
          !isEvent && dur ? `Environ ${dur} min.` : '',
          LOC_LABEL[dp.loc] ? `Lieu : ${LOC_LABEL[dp.loc]}.` : '',
          dp.reason || '',
          'Le détail de la séance est dans Crevare.',
        ].filter(Boolean).join('\n');
        events.push({
          uid: `seance-${date}@crevare`, date, goalId: isEvent && dp.event ? dp.event.goalId : null,
          start: timed ? slot.start : null, end: timed ? slot.end : null, durationMin: dur,
          summary: title, description: desc, categories: [isEvent ? 'Objectif' : 'Sport'],
          alarm: timed ? { trigger: '-PT1H', text: `Dans 1 h : ${dp.title || 'séance'}` } : { trigger: 'PT8H', text: `Aujourd'hui : ${dp.title || 'séance'}` },
        });
      }
    }
    for (const g of Array.isArray(state.goals) ? state.goals : []) {
      if (!U.isObj(g) || g.status !== 'active') continue;
      if (U.isKey(g.date) && g.date >= f && g.date <= t && !events.some((e) => e.date === g.date && e.goalId === g.id)) {
        events.push({ uid: `objectif-${g.id}@crevare`, date: g.date, goalId: g.id, summary: `🎯 ${g.name}`, description: 'Objectif suivi dans Crevare.',
          categories: ['Objectif'], alarm: { trigger: '-PT15H', text: `Demain : ${g.name}` } });
      }
      for (const m of Array.isArray(g.milestones) ? g.milestones : []) {
        if (!U.isObj(m) || m.done || !U.isKey(m.due) || m.due < f || m.due > t) continue;
        events.push({ uid: `jalon-${g.id}-${m.id}@crevare`, date: m.due, summary: `📌 ${m.title}`,
          description: [g.name, m.note].filter(Boolean).join('\n'), categories: ['Démarche'], alarm: { trigger: 'PT9H', text: m.title } });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || String(a.start || '').localeCompare(String(b.start || '')));
    return buildICS(events, { name: opts.name || 'Crevare — sport et échéances', stamp: opts.stamp });
  }

  /* ───────── Partage de fichier ───────── */

  // Affiche le texte dans une feuille, avec un bouton pour le copier (dernier recours).
  function showText(name, text) {
    if (!C.ui || !C.ui.openModal || typeof document === 'undefined') return;
    const sheet = C.ui.openModal({
      title: name,
      body: `<p class="small muted">Copie ce texte et enregistre-le (Notes, Fichiers, mail à toi-même).</p>
        <textarea id="hl-share-text" rows="8" readonly aria-label="Contenu du fichier">${esc(text)}</textarea>
        <button type="button" class="btn block mt" data-hl-copy>Copier</button>`,
    });
    if (!sheet) return;
    sheet.addEventListener('click', (e) => {
      if (!e.target.closest('[data-hl-copy]')) return;
      const ta = sheet.querySelector('#hl-share-text');
      if (C.copyText) C.copyText(ta);
      else { ta.focus(); ta.select(); }
    });
  }

  /* shareFile(name, text, mime) → Promise<'shared'|'cancelled'|'downloaded'|'copied'|'shown'>.
   * 1) Web Share avec fichier (iPhone : « Enregistrer dans Fichiers », Mail, AirDrop…) ;
   * 2) lien de téléchargement (hors cadre) ; 3) copie du texte ; 4) affichage pour copie manuelle.
   * À appeler directement dans un clic (le partage exige un geste de l'utilisateur). */
  async function shareFile(name, text, mime = 'text/plain', opts = {}) {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    try {
      if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && typeof File === 'function') {
        const file = new File([text], name, { type: mime });
        if (nav.canShare({ files: [file] })) {
          try {
            await nav.share({ files: [file], title: opts.title || name });
            return 'shared';
          } catch (e) {
            if (e && e.name === 'AbortError') return 'cancelled';
            // NotAllowedError (geste perdu) ou autre : on passe au repli.
          }
        }
      }
    } catch (e) { /* repli */ }
    const embedded = !!(C.env && C.env.embedded);
    if (!embedded && typeof document !== 'undefined' && typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) {
      try {
        const url = URL.createObjectURL(new Blob([text], { type: mime }));
        const a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 20000);
        return 'downloaded';
      } catch (e) { /* repli */ }
    }
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try { await nav.clipboard.writeText(text); return 'copied'; } catch (e) { /* repli */ }
    }
    showText(name, text);
    return 'shown';
  }

  /* ───────── Guide Raccourcis (iOS, libellés français) ───────── */

  const SAMPLE = 'poids;2026-10-06;72,4\npas;2026-10-06;8450\nsommeil;2026-10-06;7,2\nentrainement;2026-10-06;Course;45;7,8;520;148';

  function guideHTML() {
    const kbd = (s) => `<b class="hl-ios">${esc(s)}</b>`;
    return `<div class="hl-guide">
      <p>Une page web ne peut pas lire Apple Santé. L'app ${kbd('Raccourcis')} (gratuite, déjà sur ton iPhone) peut le faire :
        elle lit tes mesures, les écrit en texte et les copie. Tu les colles ensuite ici. À créer une seule fois, environ 10 minutes.</p>
      <p class="note small">Rien ne quitte ton téléphone : le raccourci copie du texte, Crevare le lit. Les libellés peuvent varier
        un peu selon ta version d'iOS.</p>

      <h4>Le format attendu</h4>
      <pre class="hl-pre" aria-label="Exemple de texte">${esc(SAMPLE)}</pre>
      <p class="small muted">Une mesure par ligne : type ; date ; valeur. La virgule décimale et les dates « 06/10/2026 » sont acceptées.
        Sommeil en heures (« 7,2 », « 7h12 » ou une durée). Entraînement : type ; durée en min ; distance en km ; kcal ; FC moyenne
        (les champs vides sont permis : <code>entrainement;2026-10-06;Musculation;60;;310;</code>).</p>

      <h4>1. Créer le raccourci</h4>
      <ol class="hl-steps">
        <li>Ouvre ${kbd('Raccourcis')}, onglet ${kbd('Raccourcis')}, touche ${kbd('+')} en haut à droite. Touche le nom en haut et appelle-le ${kbd('Crevare Santé')}.</li>
        <li>Pour ajouter une action : touche la barre ${kbd('Rechercher des actions')} en bas et tape son nom.
          Pour insérer une valeur dans un texte : touche le champ, puis choisis la variable au-dessus du clavier.</li>
      </ol>

      <h4>2. Poids (dernière pesée)</h4>
      <ol class="hl-steps">
        <li>${kbd('Rechercher des échantillons de santé')} : touche le type et choisis ${kbd('Poids')}.
          Règle ${kbd('Trier par')} : ${kbd('Date de début')}, ${kbd('Ordre')} : ${kbd('Le plus récent en premier')},
          active ${kbd('Limite')} : 1.</li>
        <li>${kbd('Obtenir les détails des échantillons de santé')} : ${kbd('Valeur')}.</li>
        <li>${kbd('Obtenir les détails des échantillons de santé')} encore une fois, en prenant comme entrée les ${kbd('Échantillons de santé')}
          de l'étape 1 : ${kbd('Date de début')}.</li>
        <li>${kbd('Formater la date')} : format ${kbd('Personnalisé')}, chaîne <code>yyyy-MM-dd</code>.</li>
        <li>${kbd('Texte')} : écris <code>poids;</code> puis insère la ${kbd('Date formatée')}, écris <code>;</code> puis insère la ${kbd('Valeur')}.
          Ajoute ${kbd('Définir la variable')} : nom <code>Poids</code>.</li>
      </ol>

      <h4>3. Pas (aujourd'hui)</h4>
      <ol class="hl-steps">
        <li>${kbd('Rechercher des échantillons de santé')} : type ${kbd('Nombre de pas')}, filtre ${kbd('Date de début')} ${kbd("est aujourd'hui")}
          (pas de limite).</li>
        <li>${kbd('Calculer des statistiques')} : ${kbd('Somme')}.</li>
        <li>${kbd('Formater la date')} : comme date, choisis la variable ${kbd('Date actuelle')} ; format ${kbd('Personnalisé')}, <code>yyyy-MM-dd</code>.</li>
        <li>${kbd('Texte')} : <code>pas;</code> + la date formatée + <code>;</code> + la ${kbd('Somme')}. Puis ${kbd('Définir la variable')} : <code>Pas</code>.</li>
      </ol>

      <h4>4. Sommeil (nuit dernière)</h4>
      <ol class="hl-steps">
        <li>${kbd('Rechercher des échantillons de santé')} : type ${kbd('Analyse du sommeil')}, filtre ${kbd('Date de fin')} ${kbd("est aujourd'hui")}.
          Si ton iPhone propose un filtre ${kbd('Valeur')}, exclus ${kbd('Au lit')} et ${kbd('Éveillé')} : sinon le total compte aussi le temps passé au lit sans dormir.</li>
        <li>${kbd('Obtenir les détails des échantillons de santé')} : ${kbd('Durée')}.</li>
        <li>${kbd('Calculer des statistiques')} : ${kbd('Somme')}.</li>
        <li>${kbd('Texte')} : <code>sommeil;</code> + la date formatée de l'étape 3 + <code>;</code> + la ${kbd('Somme')}.
          Crevare comprend des heures, des minutes ou des secondes. ${kbd('Définir la variable')} : <code>Sommeil</code>.</li>
      </ol>

      <h4>5. Copier</h4>
      <ol class="hl-steps">
        <li>${kbd('Texte')} : insère <code>Poids</code>, retour à la ligne, <code>Pas</code>, retour à la ligne, <code>Sommeil</code>.</li>
        <li>${kbd('Copier dans le presse-papiers')}.</li>
        <li>Lance le raccourci une fois : iOS demande l'accès à Santé, touche ${kbd('Autoriser')} pour Poids, Pas et Sommeil.
          Plus tard : ${kbd('Réglages')} › ${kbd('Santé')} › ${kbd('Accès aux données et appareils')} › ${kbd('Raccourcis')}.</li>
        <li>Ouvre Crevare › Plus › Apple Santé & calendrier › ${kbd('Coller depuis le presse-papiers')}.</li>
      </ol>

      <h4>Chaque jour, sans y penser</h4>
      <p class="small">Raccourcis › onglet ${kbd('Automatisation')} › ${kbd('+')} › ${kbd('Heure de la journée')} (par exemple 21:30, quotidien)
        › ${kbd('Exécuter immédiatement')} › choisis ${kbd('Crevare Santé')}. Le texte t'attend dans le presse-papiers.
        Tu peux aussi le lancer avec Siri (« Crevare Santé ») ou un widget.</p>

      <h4>Et les séances de la montre ?</h4>
      <p class="small">Les entraînements enregistrés par l'Apple Watch ne sont pas proposés comme type dans
        ${kbd('Rechercher des échantillons de santé')} (non trouvés lors de nos vérifications ; regarde quand même sur ta version d'iOS).
        Crevare ne peut donc pas les lire automatiquement. À la place, en fin de séance, ouvre ${kbd('Données Apple Watch')}
        dans l'écran « Terminer » et recopie FC moyenne, calories et distance (30 secondes). Pour une séance faite hors de l'app,
        utilise « Saisir une séance de la montre » sur cette page. Une ligne <code>entrainement;…</code> au format ci-dessus est aussi acceptée.</p>
    </div>`;
  }

  C.health = {
    parse, apply, applyTo, summaryLines, guideHTML, icsForPlan, buildICS, shareFile, SAMPLE,
    // Fonctions pures exposées pour les tests et les écrans.
    _t: { parseDate, parseNumber, parseWeight, parseSteps, parseSleepHours, parseMinutes, parseKm, icsEscape, foldLine, utcStamp, workoutKind, sessionKind, sleepHabit },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
