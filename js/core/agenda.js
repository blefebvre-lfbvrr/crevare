/* Crevare — agenda : calendriers importés (cours, Protection civile, perso), créneaux libres,
 * créneau de sport conseillé et révisions espacées placées entre les cours et les gardes.
 *
 * Tout est calculé sur le téléphone. Les liens des calendriers restent dans le stockage local ;
 * sync() les lit directement (souvent bloqué par le site : on propose alors le Raccourci iOS).
 * Aucune donnée n'est envoyée ailleurs.
 *
 * Conventions :
 * - heures « HH:MM » (heure locale) ; en interne, minutes depuis minuit (0–1440) ;
 * - événements stockés en heure locale : start/end « AAAA-MM-JJTHH:MM », ou « AAAA-MM-JJ » pour une
 *   journée entière (fin INCLUSE : un événement d'un jour a start === end) ;
 * - event.status : marqueurs séparés par des virgules — 'tentative' (à confirmer),
 *   'busy' (TRANSP:OPAQUE explicite), 'free' (TRANSP:TRANSPARENT).
 * dayInfo() n'appelle jamais C.planner (c'est le planificateur qui l'appelle). */
(function (C) {
  'use strict';
  const U = C.util;

  /* ───────── Constantes ───────── */

  const MIN_DAY = 1440;
  const DEFAULT_EVENT_MIN = 60; // événement sans fin ni durée
  const WINDOW_PAST = 30;
  const WINDOW_FUTURE = 180;
  const MAX_EVENTS = 4000; // garde-fou pour le stockage local
  const PREF_SPORT_END = 21 * 60; // séance de sport finie avant 21:00 si possible
  const FREE_DAY_SPORT = 17 * 60; // jour sans cours : séance vers 17:00
  // Déjeuner protégé (pas encore réglable : revision.lunch sera lu s'il existe un jour dans le schéma).
  const DEFAULT_LUNCH = { start: '12:00', end: '13:00' };
  const KEEP_DONE_DAYS = 365; // tâches faites conservées un an

  const KINDS = {
    cours: { label: 'Cours', color: 'info', icon: '🎓' },
    'protection-civile': { label: 'Protection civile', color: 'accent', icon: '🚑' },
    perso: { label: 'Perso', color: 'loc-repos', icon: '📌' },
    sport: { label: 'Sport', color: 'ok', icon: '🏃' },
  };
  // Codes des types d'événements eProtec (Protection civile).
  const PC_CODES = {
    COOP: 'coopération', DPS: 'dispositif prévisionnel de secours', GAR: 'garde', MED: 'médical',
    FOR: 'formation', MAN: 'manœuvre', EXE: 'exercice', REU: 'réunion',
  };
  // Couleurs possibles d'une matière : jetons de base.css uniquement.
  // Ordre d'attribution : d'abord des teintes distinctes du bleu des cours et du vert du sport.
  const COLORS = ['goal-custom', 'warn', 'loc-piscine', 'accent-2', 'loc-dehors', 'loc-salle', 'danger', 'info', 'loc-maison', 'ok'];
  const COLOR_LABELS = {
    info: 'Bleu', 'loc-maison': 'Vert', warn: 'Ambre', 'goal-custom': 'Violet', 'loc-piscine': 'Cyan',
    'accent-2': 'Orange', 'loc-dehors': 'Jaune', danger: 'Rouge', ok: 'Vert vif', 'loc-salle': 'Orange clair',
  };
  const KIND_RANK = { relecture: 0, examen: 1, exercices: 2, synthese: 3, libre: 4 };
  // Préparation d'examen : jours avant l'examen (plus serrés à l'approche), selon le poids de la matière.
  const EXAM_PLAN = {
    1: [12, 8, 5, 3, 1],
    2: [14, 11, 8, 6, 4, 3, 2, 1],
    3: [14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 2, 1, 1],
  };

  const HTML_MSG = {
    'protection-civile': 'Ce lien renvoie une page web, pas un calendrier : sur eProtec, cherche l\'option d\'abonnement ou d\'export iCal (.ics). Si la page demande de te connecter, ce lien ne peut pas marcher tel quel.',
    cours: 'Ce lien renvoie une page web, pas un calendrier : dans ton espace école, cherche le lien iCal (.ics) de ton emploi du temps.',
    default: 'Ce lien renvoie une page web, pas un calendrier : cherche l\'option d\'abonnement ou d\'export iCal (.ics) (sur eProtec, dans tes événements).',
  };
  const CORS_MSG = 'Impossible de lire ce lien depuis l\'app : le site du calendrier bloque la lecture par d\'autres sites '
    + '(protection habituelle des navigateurs). Utilise le Raccourci iOS (Agenda → Réglages) : il récupère le calendrier, puis tu touches « Coller ».';

  /* ───────── Petits outils : minutes, jours ───────── */

  const pad = U.pad;
  function toMin(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v).trim());
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (mi > 59 || h > 24 || (h === 24 && mi)) return null;
    return h * 60 + mi;
  }
  const hm = (min) => { const m = Math.max(0, Math.min(MIN_DAY, Math.round(min))); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  // Numéro de jour absolu, indépendant du fuseau (0 = 1970-01-01).
  function dayNum(key) { const [y, m, d] = String(key).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
  function keyOf(n) { const d = new Date(n * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const wdOf = (n) => (((n % 7) + 7 + 3) % 7); // 1970-01-01 était un jeudi ; 0 = lundi
  const absOf = (date, min) => dayNum(date) * MIN_DAY + min;
  function fromAbs(a) { const n = Math.floor(a / MIN_DAY); return { date: keyOf(n), min: a - n * MIN_DAY }; }
  const stampOf = (date, min) => { const x = fromAbs(absOf(date, min)); return `${x.date}T${hm(x.min)}`; };
  function parseStamp(s) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ''));
    return m ? { date: m[1], min: m[2] ? +m[2] * 60 + +m[3] : 0, timed: !!m[2] } : null;
  }
  const ceil5 = (m) => Math.ceil(m / 5) * 5;
  const nowMin = () => { const d = U.now(); return d.getHours() * 60 + d.getMinutes(); };
  const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const norm = (s) => U.normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();
  function safe(fn, fallback = null) { try { const r = fn(); return r === undefined ? fallback : r; } catch (e) { return fallback; } }
  // Petite empreinte stable (FNV-1a) pour raccourcir les identifiants longs.
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }

  // Intervalles [a, b] en minutes : soustraction et longueur de l'union.
  function subtract(base, cuts) {
    let out = base.filter(([a, b]) => b > a).map(([a, b]) => [a, b]);
    for (const [c, d] of cuts) {
      if (!(d > c)) continue;
      const next = [];
      for (const [a, b] of out) {
        if (d <= a || c >= b) { next.push([a, b]); continue; }
        if (c > a) next.push([a, c]);
        if (d < b) next.push([d, b]);
      }
      out = next;
    }
    return out.sort((x, y) => x[0] - y[0]);
  }
  function unionLength(list) {
    const xs = list.map((x) => [x.s, x.e]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    let total = 0, cs = null, ce = null;
    for (const [a, b] of xs) {
      if (ce == null || a > ce) { if (ce != null) total += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b);
    }
    if (ce != null) total += ce - cs;
    return total;
  }

  /* ───────── État ───────── */

  const st = () => C.state || {};
  let fallbackAgenda = null;
  // Agenda courant (lecture). Si l'état n'a pas d'agenda, un agenda vide (non enregistré).
  function A() {
    const s = st();
    if (U.isObj(s.agenda)) return s.agenda;
    if (!fallbackAgenda) fallbackAgenda = C.schema.defaultAgenda();
    return fallbackAgenda;
  }
  // Modification : enregistre (et re-rend la vue, sauf {silent:true}).
  function upd(fn, opts) {
    const run = (s) => {
      if (!U.isObj(s.agenda)) s.agenda = C.schema.defaultAgenda();
      const ag = s.agenda;
      if (!Array.isArray(ag.sources)) ag.sources = [];
      if (!Array.isArray(ag.events)) ag.events = [];
      if (!Array.isArray(ag.subjects)) ag.subjects = [];
      if (!Array.isArray(ag.exams)) ag.exams = [];
      if (!U.isObj(ag.tasks)) ag.tasks = {};
      if (!U.isObj(ag.blocks)) ag.blocks = {};
      return fn(ag, s);
    };
    if (C.store && typeof C.store.update === 'function' && C.state) return C.store.update(run, opts);
    return run(C.state || (C.state = {}));
  }

  // Réglages des révisions, complétés et vérifiés.
  function revision(ag) {
    const d = C.schema.defaultAgenda().revision;
    const r = U.isObj((ag || A()).revision) ? (ag || A()).revision : {};
    const out = { ...d };
    for (const k of Object.keys(d)) {
      const v = r[k];
      if (typeof d[k] === 'string') { if (toMin(v) != null) out[k] = v; }
      else if (typeof d[k] === 'number') { const n = U.num(v); if (n != null && n >= 0) out[k] = n; }
      else if (typeof d[k] === 'boolean') { if (typeof v === 'boolean') out[k] = v; }
      else if (Array.isArray(d[k])) { if (Array.isArray(v)) out[k] = v.map(Number).filter((n) => isFinite(n)); }
      else if (U.isObj(d[k]) && U.isObj(v)) out[k] = { start: String(v.start || ''), end: String(v.end || '') };
    }
    out.blockMin = U.clamp(Math.round(out.blockMin), 15, 180);
    out.breakMin = U.clamp(Math.round(out.breakMin), 0, 60);
    out.minSlotMin = U.clamp(Math.round(out.minSlotMin), 10, out.blockMin);
    out.bufferAfterMin = U.clamp(Math.round(out.bufferAfterMin), 0, 180);
    out.bufferBeforeMin = U.clamp(Math.round(out.bufferBeforeMin), 0, 180);
    out.maxWeekdayMin = U.clamp(Math.round(out.maxWeekdayMin), 0, 720);
    out.maxWeekendMin = U.clamp(Math.round(out.maxWeekendMin), 0, 720);
    out.daysOff = [...new Set(out.daysOff.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
    out.spacing = [...new Set(out.spacing.map(Math.round).filter((n) => n >= 0 && n <= 120))].sort((a, b) => a - b);
    if (!out.spacing.length) out.spacing = d.spacing.slice();
    return out;
  }

  const sourcesOf = (ag) => (Array.isArray(ag.sources) ? ag.sources.filter(U.isObj) : []);
  const sourceById = (ag, id) => sourcesOf(ag).find((s) => s.id === id) || null;

  /* ───────── Lecture iCal (RFC 5545) ───────── */

  // Retire les échappements d'un texte iCal : \n \N \, \; \\ (et \: toléré).
  const unescapeText = (v) => String(v == null ? '' : v).replace(/\\([\\;,nN:])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
  // Découpe une valeur sur un séparateur non échappé.
  function splitEscaped(v, sep) {
    const out = [];
    let cur = '';
    const s = String(v == null ? '' : v);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i++; continue; }
      if (c === sep) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }
  // Lignes logiques : fins de ligne normalisées, lignes repliées (CRLF + espace ou tabulation) recollées.
  const unfold = (text) => String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');

  // « NOM;PARAM=valeur;PARAM="va:leur":VALEUR » → { name, params, value }
  function parseLine(line) {
    let inQ = false, colon = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ':' && !inQ) { colon = i; break; }
    }
    if (colon <= 0) return null;
    const head = line.slice(0, colon);
    const parts = [];
    let cur = '';
    inQ = false;
    for (const c of head) {
      if (c === '"') inQ = !inQ;
      if (c === ';' && !inQ) { parts.push(cur); cur = ''; } else cur += c;
    }
    parts.push(cur);
    const name = parts[0].trim().toUpperCase().replace(/^[A-Z0-9-]+\./, ''); // préfixe de groupe éventuel
    const params = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim().replace(/^"|"$/g, '');
    }
    return { name, params, value: line.slice(colon + 1) };
  }

  /* Date iCal → { date, min, allDay }.
   * - « AAAAMMJJ » ou VALUE=DATE : journée ;
   * - « …Z » (UTC) : convertie en heure locale de l'appareil ;
   * - avec TZID ou sans fuseau : heure locale telle quelle. */
  function parseDT(value, params = {}) {
    const v = String(value == null ? '' : value).trim().replace(/[-:]/g, '');
    let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (m || String(params.VALUE || '').toUpperCase() === 'DATE') {
      m = m || /^(\d{4})(\d{2})(\d{2})/.exec(v);
      if (!m) return null;
      const date = `${m[1]}-${m[2]}-${m[3]}`;
      return keyOf(dayNum(date)) === date ? { date, min: 0, allDay: true } : null;
    }
    m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(?:[.,]\d+)?(Z)?$/i.exec(v);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59) return null;
    if (m[7]) {
      const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
      if (isNaN(dt)) return null;
      const u = dt.toISOString();
      return { date: U.dateKey(dt), min: dt.getHours() * 60 + dt.getMinutes(), allDay: false, utc: true, utcDate: u.slice(0, 10), utcMin: +u.slice(11, 13) * 60 + +u.slice(14, 16) };
    }
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (keyOf(dayNum(date)) !== date) return null;
    const x = fromAbs(absOf(date, h * 60 + mi)); // 24:00 → minuit du lendemain
    return { date: x.date, min: x.min, allDay: false };
  }

  // DURATION iCal (P1D, PT1H30M, P1W…) → minutes (ou null).
  function parseIcsDuration(v) {
    const s = String(v == null ? '' : v).trim();
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(s);
    if (!m || /^[+-]?PT?$/i.test(s)) return null;
    const total = (+m[2] || 0) * 7 * MIN_DAY + (+m[3] || 0) * MIN_DAY + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.floor((+m[6] || 0) / 60);
    return m[1] === '-' ? -total : total;
  }

  const WD = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
  function parseRRule(v) {
    const r = { freq: null, interval: 1, count: null, until: null, byday: [], bymonthday: [], bymonth: [], wkst: 0 };
    for (const part of String(v || '').split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim().toUpperCase(), val = part.slice(eq + 1).trim();
      if (k === 'FREQ') r.freq = val.toUpperCase();
      else if (k === 'INTERVAL') r.interval = Math.max(1, parseInt(val, 10) || 1);
      else if (k === 'COUNT') { const n = parseInt(val, 10); r.count = n > 0 ? n : null; }
      else if (k === 'UNTIL') r.until = parseDT(val, {});
      else if (k === 'BYDAY') {
        r.byday = val.split(',').map((x) => /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(x.trim())).filter(Boolean)
          .map((mm) => ({ n: mm[1] ? parseInt(mm[1], 10) : 0, wd: WD[mm[2].toUpperCase()] }));
      } else if (k === 'BYMONTHDAY') r.bymonthday = val.split(',').map((x) => parseInt(x, 10)).filter((n) => n && Math.abs(n) <= 31);
      else if (k === 'BYMONTH') r.bymonth = val.split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= 12);
      else if (k === 'WKST' && WD[val.toUpperCase()] != null) r.wkst = WD[val.toUpperCase()];
    }
    return r;
  }

  /* Jours des occurrences d'une règle (numéros de jour absolus), DTSTART compris, jusqu'à limitDN.
   * COUNT compte depuis DTSTART (les occurrences retirées par EXDATE comptent aussi, comme le veut la norme). */
  function expandDays(startDN, startMin, rule, limitDN) {
    const out = [startDN];
    if (!rule || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) return out;
    const untilAbs = !rule.until ? Infinity
      : rule.until.allDay ? dayNum(rule.until.date) * MIN_DAY + MIN_DAY - 1 : absOf(rule.until.date, rule.until.min);
    const maxN = rule.count || Infinity;
    const months = rule.bymonth.length ? new Set(rule.bymonth) : null;
    const monthOf = (dn) => +keyOf(dn).slice(5, 7);
    const domOf = (dn) => +keyOf(dn).slice(8, 10);
    let n = 1, guard = 0;
    // false = arrêter
    const push = (dn) => {
      if (dn <= startDN) return true;
      if (dn > limitDN || dn * MIN_DAY + startMin > untilAbs || n >= maxN || ++guard > 20000) return false;
      out.push(dn); n++;
      return true;
    };
    const step = rule.interval;
    if (rule.freq === 'DAILY') {
      const days = rule.byday.length ? new Set(rule.byday.map((b) => b.wd)) : null;
      for (let dn = startDN + step; dn <= limitDN; dn += step) {
        if (days && !days.has(wdOf(dn))) continue;
        if (months && !months.has(monthOf(dn))) continue;
        if (rule.bymonthday.length && !rule.bymonthday.includes(domOf(dn))) continue;
        if (!push(dn)) break;
      }
    } else if (rule.freq === 'WEEKLY') {
      const wk = rule.wkst;
      const rel = (d) => (d - wk + 7) % 7;
      const days = (rule.byday.length ? [...new Set(rule.byday.map((b) => b.wd))] : [wdOf(startDN)]).sort((a, b) => rel(a) - rel(b));
      const week0 = startDN - rel(wdOf(startDN));
      outer: for (let base = week0; base <= limitDN; base += 7 * step) {
        for (const d of days) {
          const dn = base + rel(d);
          if (dn <= startDN) continue;
          if (months && !months.has(monthOf(dn))) continue;
          if (!push(dn)) break outer;
        }
      }
    } else if (rule.freq === 'MONTHLY') {
      const s = keyOf(startDN);
      const y0 = +s.slice(0, 4), m0 = +s.slice(5, 7) - 1, d0 = +s.slice(8, 10);
      outer: for (let k = 0; k < 2400; k += step) {
        const mi = y0 * 12 + m0 + k, y = Math.floor(mi / 12), mo = mi % 12;
        const first = Math.round(Date.UTC(y, mo, 1) / 86400000);
        const dim = Math.round(Date.UTC(y, mo + 1, 1) / 86400000) - first;
        if (first > limitDN) break;
        if (months && !months.has(mo + 1)) continue;
        let cands = [];
        if (rule.bymonthday.length) {
          cands = rule.bymonthday.map((md) => (md > 0 ? md : dim + md + 1)).filter((d) => d >= 1 && d <= dim);
          if (rule.byday.length) cands = cands.filter((d) => rule.byday.some((b) => b.wd === wdOf(first + d - 1)));
        } else if (rule.byday.length) {
          for (const b of rule.byday) {
            const all = [];
            for (let d = 1; d <= dim; d++) if (wdOf(first + d - 1) === b.wd) all.push(d);
            if (!b.n) cands.push(...all);
            else { const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (pick) cands.push(pick); }
          }
        } else if (d0 <= dim) cands = [d0];
        for (const d of [...new Set(cands)].sort((a, b) => a - b)) if (!push(first + d - 1)) break outer;
      }
    } else if (rule.freq === 'YEARLY') {
      const s = keyOf(startDN);
      const y0 = +s.slice(0, 4), m0 = +s.slice(5, 7), d0 = +s.slice(8, 10);
      const ms = months ? [...months].sort((a, b) => a - b) : [m0];
      outer: for (let k = 0; k < 200; k += step) {
        for (const mo of ms) {
          const key = `${y0 + k}-${pad(mo)}-${pad(d0)}`;
          if (keyOf(dayNum(key)) !== key) continue; // 29 février, 31 avril…
          if (!push(dayNum(key))) break outer;
        }
        if (Math.round(Date.UTC(y0 + k, 0, 1) / 86400000) > limitDN) break;
      }
    }
    return out;
  }

  // Date et minute UTC → heure locale de l'appareil.
  function utcToLocal(date, min) {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60));
    return { date: U.dateKey(dt), min: dt.getHours() * 60 + dt.getMinutes() };
  }

  function looksHTML(text) {
    const head = String(text || '').slice(0, 3000).trim().toLowerCase();
    return /^<(!doctype|html|head|body|\?xml)/.test(head) || /<(html|body|head)[\s>]/.test(head) || /^</.test(head);
  }
  const htmlMessage = (kind) => HTML_MSG[kind] || HTML_MSG.default;

  // Propriétés d'un VEVENT → enregistrement intermédiaire.
  function readVEvent(props) {
    const get = (n) => props.find((p) => p.name === n);
    const all = (n) => props.filter((p) => p.name === n);
    const text = (n) => { const p = get(n); return p ? unescapeText(p.value) : ''; };
    const ds = get('DTSTART');
    const start = ds && parseDT(ds.value, ds.params);
    if (!start) return null;
    const de = get('DTEND');
    const end = de && parseDT(de.value, de.params);
    const du = get('DURATION');
    const dur = du ? parseIcsDuration(du.value) : null;
    let durMin;
    if (end) durMin = absOf(end.date, end.allDay && !start.allDay ? 0 : end.min) - absOf(start.date, start.min);
    else if (dur != null) durMin = dur;
    else durMin = start.allDay ? MIN_DAY : DEFAULT_EVENT_MIN;
    if (start.allDay) durMin = Math.max(1, Math.round(durMin / MIN_DAY)) * MIN_DAY;
    else if (!(durMin >= 0)) durMin = DEFAULT_EVENT_MIN;
    durMin = Math.min(durMin, 60 * MIN_DAY);

    let title = clip(text('SUMMARY'), 300);
    // Titre réduit au type (« TD », « CM ») : on cherche la matière dans la description.
    if (!cleanTitle(title)) {
      const desc = text('DESCRIPTION');
      const m = /(?:^|\n)\s*(?:mati[eè]re|cours|module|enseignement|ue|ec|intitul[ée])\s*[:：-]\s*([^\n]{2,80})/i.exec(desc);
      if (m) title = clip(`${title ? title + ' · ' : ''}${m[1]}`, 300);
    }
    const categories = [];
    for (const p of all('CATEGORIES')) {
      for (const c of splitEscaped(p.value, ',')) {
        const v = clip(unescapeText(c), 40);
        if (v && !categories.includes(v)) categories.push(v);
      }
    }
    const exdates = new Set();
    for (const p of all('EXDATE')) {
      for (const v of String(p.value).split(',')) {
        const x = parseDT(v, p.params);
        if (x) exdates.add(x.allDay ? x.date : stampOf(x.date, x.min));
      }
    }
    const rdates = [];
    for (const p of all('RDATE')) {
      for (const v of String(p.value).split(',')) {
        const x = parseDT(v.split('/')[0], p.params);
        if (x) rdates.push(x);
      }
    }
    const rid = get('RECURRENCE-ID');
    const recur = rid && parseDT(rid.value, rid.params);
    const rr = get('RRULE');
    const status = String(text('STATUS')).trim().toUpperCase();
    const transp = String(text('TRANSP')).trim().toUpperCase();
    const flags = [];
    if (status === 'TENTATIVE') flags.push('tentative');
    if (transp === 'OPAQUE') flags.push('busy');
    else if (transp === 'TRANSPARENT') flags.push('free');
    const uidRaw = clip(text('UID'), 1000);
    return {
      uid: uidRaw || 'sans-uid-' + hash(`${ds.value}|${title}`),
      title: title || 'Sans titre', location: clip(text('LOCATION'), 300), categories: categories.slice(0, 10),
      start, durMin, rule: rr ? parseRRule(rr.value) : null, exdates, rdates,
      recurKey: recur ? (recur.allDay ? recur.date : stampOf(recur.date, recur.min)) : null,
      cancelled: status === 'CANCELLED', flags: flags.join(','),
    };
  }

  /* parseICS(text, sourceId, opts?) → { events, errors, isHTML, calName }
   * opts : { from, to } (fenêtre ; par défaut −30 j / +180 j autour d'aujourd'hui). */
  function parseICS(text, sourceId, opts = {}) {
    const res = { events: [], errors: [], isHTML: false, calName: '' };
    const raw = String(text == null ? '' : text);
    if (!/BEGIN:(VCALENDAR|VEVENT)/i.test(raw)) {
      if (raw.trim() && looksHTML(raw)) { res.isHTML = true; res.errors.push(htmlMessage(opts.kind)); }
      else res.errors.push(raw.trim() ? 'Ce texte ne ressemble pas à un calendrier (.ics).' : 'Le texte est vide.');
      return res;
    }
    const today = U.todayKey();
    const from = U.isKey(opts.from) ? opts.from : U.addDays(today, -WINDOW_PAST);
    const to = U.isKey(opts.to) ? opts.to : U.addDays(today, WINDOW_FUTURE);
    const wStart = dayNum(from) * MIN_DAY, wEnd = (dayNum(to) + 1) * MIN_DAY, limitDN = dayNum(to) + 1;

    // Découpage en composants ; seules les propriétés directes des VEVENT sont gardées.
    const vevents = [];
    const stack = [];
    let cur = null;
    for (const line of unfold(raw)) {
      if (!line.trim()) continue;
      const p = parseLine(line);
      if (!p) continue;
      if (p.name === 'BEGIN') {
        const comp = p.value.trim().toUpperCase();
        stack.push(comp);
        if (comp === 'VEVENT') cur = { props: [] };
        continue;
      }
      if (p.name === 'END') {
        const comp = p.value.trim().toUpperCase();
        const i = stack.lastIndexOf(comp);
        if (i >= 0) stack.length = i;
        if (comp === 'VEVENT' && cur) { vevents.push(cur.props); cur = null; }
        continue;
      }
      if (cur && stack[stack.length - 1] === 'VEVENT') cur.props.push(p);
      else if (!cur && p.name === 'X-WR-CALNAME' && !res.calName) res.calName = clip(unescapeText(p.value), 60);
    }

    let bad = 0;
    const masters = [];
    const overrides = new Map(); // uid → Map(clé d'occurrence → enregistrement)
    for (const props of vevents) {
      let rec = null;
      try { rec = readVEvent(props); } catch (e) { rec = null; }
      if (!rec) { bad++; continue; }
      if (rec.recurKey) {
        if (!overrides.has(rec.uid)) overrides.set(rec.uid, new Map());
        overrides.get(rec.uid).set(rec.recurKey, rec);
      } else masters.push(rec);
    }

    const out = [];
    const seen = new Map();
    const sid = String(sourceId || 'src');
    const emit = (rec, date, min) => {
      const a = absOf(date, min), b = a + rec.durMin;
      if (Math.max(b, a + 1) <= wStart || a >= wEnd) return;
      const start = rec.start.allDay ? date : stampOf(date, min);
      let end;
      if (rec.start.allDay) end = keyOf(dayNum(date) + Math.max(1, Math.round(rec.durMin / MIN_DAY)) - 1);
      else { const e = fromAbs(b); end = stampOf(e.date, e.min); }
      const u = rec.uid.length > 80 ? hash(rec.uid) : rec.uid;
      let id = `${sid}|${u}|${start}`;
      const n = (seen.get(id) || 0) + 1;
      seen.set(id, n);
      if (n > 1) id += '#' + n;
      out.push({
        id, sourceId: sid, uid: clip(rec.uid, 300), title: rec.title, start, end, allDay: !!rec.start.allDay,
        location: rec.location, categories: rec.categories.slice(), status: rec.flags,
      });
    };
    const keyFor = (rec, date, min) => (rec.start.allDay ? date : stampOf(date, min));

    for (const rec of masters) {
      if (rec.cancelled) continue;
      const ov = overrides.get(rec.uid);
      let starts;
      if (rec.rule && rec.start.utc) {
        // DTSTART en UTC : la règle se répète en UTC (l'heure locale peut changer au passage heure d'été / d'hiver).
        const u = rec.rule.until;
        const rule = { ...rec.rule, until: u && u.utc ? { date: u.utcDate, min: u.utcMin, allDay: false } : u };
        starts = expandDays(dayNum(rec.start.utcDate), rec.start.utcMin, rule, limitDN + 1).map((dn) => utcToLocal(keyOf(dn), rec.start.utcMin));
      } else if (rec.rule) {
        starts = expandDays(dayNum(rec.start.date), rec.start.min, rec.rule, limitDN).map((dn) => ({ date: keyOf(dn), min: rec.start.min }));
      } else starts = [{ date: rec.start.date, min: rec.start.min }];
      for (const r of rec.rdates) if (!starts.some((s) => s.date === r.date && s.min === r.min)) starts.push({ date: r.date, min: r.allDay ? rec.start.min : r.min });
      for (const s of starts) {
        const k = keyFor(rec, s.date, s.min);
        if (rec.exdates.has(k) || rec.exdates.has(s.date)) continue;
        if (ov && ov.has(k)) continue; // occurrence remplacée (ou annulée) par un RECURRENCE-ID
        emit(rec, s.date, s.min);
      }
    }
    // Occurrences modifiées : émises à leur nouvelle date (sauf annulées).
    const cancelledMasters = new Set(masters.filter((m) => m.cancelled).map((m) => m.uid));
    for (const [uid, map] of overrides) {
      if (cancelledMasters.has(uid)) continue;
      for (const rec of map.values()) if (!rec.cancelled) emit(rec, rec.start.date, rec.start.min);
    }

    out.sort((x, y) => x.start.localeCompare(y.start) || x.title.localeCompare(y.title) || x.id.localeCompare(y.id));
    if (out.length > MAX_EVENTS) {
      res.errors.push(`Calendrier très chargé : seuls les ${MAX_EVENTS} premiers événements sont gardés.`);
      out.length = MAX_EVENTS;
    }
    if (bad) res.errors.push(`${U.plural(bad, 'événement illisible ignoré', 'événements illisibles ignorés')}.`);
    if (!vevents.length) res.errors.push('Aucun événement dans ce calendrier.');
    res.events = out;
    return res;
  }

  /* ───────── Plusieurs calendriers collés d'un coup (Raccourci iOS) ───────── */

  function normKind(s) {
    const n = U.normalize(s).replace(/[^a-z]/g, '');
    if (['cours', 'ecole', 'edt', 'emploidutemps'].includes(n)) return 'cours';
    if (['protectioncivile', 'pc', 'eprotec', 'protection'].includes(n)) return 'protection-civile';
    if (['perso', 'personnel', 'personal'].includes(n)) return 'perso';
    if (n === 'sport') return 'sport';
    return null;
  }

  /* parseBundle(text) → [{ kind, name, text }]
   * Blocs « --CREVARE-SOURCE <kind> <nom> » suivis du contenu ; sans marqueur : un seul bloc { kind: null }. */
  function parseBundle(text) {
    const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const re = /^[ \t]*-{2,}[ \t]*CREVARE-SOURCE\b[ \t]*(.*)$/gim;
    const marks = [];
    let m;
    while ((m = re.exec(raw))) marks.push({ at: m.index, end: m.index + m[0].length, arg: m[1] });
    if (!marks.length) return [{ kind: null, name: '', text: raw }];
    return marks.map((mk, i) => {
      let arg = mk.arg;
      let prefix = '';
      // Contenu collé sur la même ligne que le marqueur.
      const cut = arg.search(/BEGIN:VCALENDAR|<!doctype|<html/i);
      if (cut >= 0) { prefix = arg.slice(cut); arg = arg.slice(0, cut); }
      const body = (prefix + raw.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : raw.length)).trim();
      const words = arg.trim().split(/\s+/).filter(Boolean);
      const kind = words.length ? normKind(words[0]) : null;
      const name = clip(kind ? words.slice(1).join(' ') : words.join(' '), 60);
      return { kind: kind || 'perso', name: name || KINDS[kind || 'perso'].label, text: body };
    });
  }

  /* ───────── Sources, import, synchronisation ───────── */

  function cleanUrl(u) {
    let s = String(u == null ? '' : u).trim();
    if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
    return s.slice(0, 2000);
  }
  function newSource(o = {}) {
    const kind = KINDS[o.kind] ? o.kind : 'perso';
    return {
      id: 'src-' + String(U.uid()).replace(/[^a-z0-9]/gi, '').slice(-10), name: clip(o.name, 60) || KINDS[kind].label,
      url: cleanUrl(o.url), kind, color: KINDS[kind].color, busy: o.busy !== false,
      lastSyncAt: null, lastError: '', count: 0,
    };
  }
  function addSource(o = {}) {
    const src = newSource(o);
    upd((ag) => { ag.sources.push(src); });
    return src.id;
  }
  function updateSource(id, patch = {}) {
    return upd((ag) => {
      const s = sourceById(ag, id);
      if (!s) return false;
      if ('name' in patch) s.name = clip(patch.name, 60) || KINDS[s.kind].label;
      if ('url' in patch) s.url = cleanUrl(patch.url);
      if ('kind' in patch && KINDS[patch.kind]) { s.kind = patch.kind; s.color = KINDS[patch.kind].color; }
      if ('busy' in patch) s.busy = patch.busy !== false;
      refreshDerived(ag, U.todayKey());
      return true;
    });
  }
  function removeSource(id) {
    return upd((ag) => {
      const before = ag.sources.length;
      ag.sources = ag.sources.filter((s) => s.id !== id);
      ag.events = ag.events.filter((e) => e.sourceId !== id);
      refreshDerived(ag, U.todayKey());
      return ag.sources.length < before;
    });
  }
  const findSource = (ag, kind, name) => sourcesOf(ag).find((s) => s.kind === kind && norm(s.name) === norm(name))
    || (sourcesOf(ag).filter((s) => s.kind === kind).length === 1 && kind !== 'perso' ? sourcesOf(ag).find((s) => s.kind === kind) : null);

  // Type probable d'un calendrier collé seul : codes eProtec → Protection civile ; CM/TD/TP → cours.
  function guessKind(events) {
    const codes = new RegExp(`\\b(${Object.keys(PC_CODES).join('|')})\\b`);
    if (events.some((e) => (e.categories || []).some((c) => PC_CODES[String(c).toUpperCase()]) || codes.test(e.title))) return 'protection-civile';
    if (events.some((e) => /(^|[^a-z])(cm|td|tp|cours|amphi)([^a-z]|$)/.test(norm(e.title)))) return 'cours';
    return 'perso';
  }

  // Remplace les événements d'une source par le résultat d'une lecture (sauf si la lecture a échoué).
  function applyParsed(ag, src, parsed) {
    const failed = parsed.isHTML || (!parsed.events.length && parsed.errors.length && !/Aucun événement/.test(parsed.errors.join(' ')));
    if (failed) {
      src.lastError = clip(parsed.isHTML ? htmlMessage(src.kind) : parsed.errors.join(' '), 300);
      return { sourceId: src.id, name: src.name, kind: src.kind, ok: false, count: 0, error: src.lastError, isHTML: parsed.isHTML };
    }
    ag.events = ag.events.filter((e) => e.sourceId !== src.id).concat(parsed.events.map((e) => ({ ...e, sourceId: src.id })));
    src.count = parsed.events.length;
    src.lastSyncAt = U.now().toISOString();
    src.lastError = clip(parsed.errors.filter((x) => !/Aucun événement/.test(x)).join(' '), 300);
    return { sourceId: src.id, name: src.name, kind: src.kind, ok: true, count: parsed.events.length, error: src.lastError, isHTML: false };
  }

  /* importText(text, sourceId?, opts?) → { ok, results:[{ sourceId, name, kind, ok, count, error, isHTML }] }
   * Texte du Raccourci (plusieurs blocs) : chaque bloc va dans la source de même type et même nom (créée au besoin).
   * Un seul calendrier : dans sourceId, sinon dans une nouvelle source (opts.kind / opts.name, ou type deviné). */
  function importText(text, sourceId, opts = {}) {
    const parts = parseBundle(text);
    const win = { from: opts.from, to: opts.to };
    const results = upd((ag) => {
      const list = [];
      for (const part of parts) {
        let src = null;
        let parsed = null;
        if (part.kind) {
          src = findSource(ag, part.kind, part.name);
          if (!src) { src = newSource({ kind: part.kind, name: part.name }); ag.sources.push(src); }
          if (!part.text.trim()) {
            // Le Raccourci n'a rien récupéré (lien faux, pas de réseau) : on garde les anciens événements.
            src.lastError = 'Rien reçu pour ce calendrier : vérifie son lien dans le Raccourci, puis relance-le.';
            list.push({ sourceId: src.id, name: src.name, kind: src.kind, ok: false, count: 0, error: src.lastError, isHTML: false });
            continue;
          }
        } else if (sourceId) {
          src = sourceById(ag, sourceId);
        } else {
          parsed = parseICS(part.text, 'tmp', { ...win, kind: opts.kind });
          if (parsed.isHTML || !parsed.events.length) { list.push({ ok: false, count: 0, error: parsed.errors.join(' ') || 'Aucun événement.', isHTML: parsed.isHTML }); continue; }
          const kind = KINDS[opts.kind] ? opts.kind : guessKind(parsed.events);
          src = newSource({ kind, name: opts.name || parsed.calName || KINDS[kind].label });
          ag.sources.push(src);
        }
        if (!src) { list.push({ ok: false, count: 0, error: 'Calendrier introuvable.' }); continue; }
        if (!parsed || parsed.events.some((e) => e.sourceId !== src.id)) parsed = parseICS(part.text, src.id, { ...win, kind: src.kind });
        list.push(applyParsed(ag, src, parsed));
      }
      refreshDerived(ag, U.todayKey());
      return list;
    }, opts.silent ? { silent: true } : undefined);
    return { ok: results.length > 0 && results.every((r) => r.ok), results };
  }

  function setSourceError(id, msg) {
    upd((ag) => { const s = sourceById(ag, id); if (s) s.lastError = clip(msg, 300); });
  }

  /* sync(sourceId) → Promise<{ ok, count, error, cors }>
   * Lit le lien du calendrier depuis le téléphone (fetch, sans cache, sans cookies). */
  async function sync(sourceId) {
    const src = sourceById(A(), sourceId);
    if (!src) return { ok: false, count: 0, error: 'Calendrier introuvable.' };
    const url = cleanUrl(src.url);
    const fail = (error, extra = {}) => { setSourceError(sourceId, error); return { ok: false, count: 0, error, ...extra }; };
    if (!url) return fail('Ajoute d\'abord le lien du calendrier, ou utilise le Raccourci iOS.');
    if (!/^https?:\/\//i.test(url)) return fail('Le lien doit commencer par https://');
    if (typeof fetch !== 'function') return fail(CORS_MSG, { cors: true });
    let text;
    try {
      const res = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
      if (!res || !res.ok) return fail(`Le site du calendrier a répondu « erreur ${res ? res.status : '?'} ». Vérifie le lien.`);
      text = await res.text();
    } catch (e) {
      return fail(CORS_MSG, { cors: true });
    }
    const r = importText(text, sourceId);
    const one = r.results[0] || {};
    return { ok: !!one.ok, count: one.count || 0, error: one.error || '', isHTML: !!one.isHTML };
  }
  async function syncAll() {
    const out = [];
    for (const s of sourcesOf(A())) if (s.url) out.push({ id: s.id, name: s.name, ...(await sync(s.id)) });
    return out;
  }

  /* ───────── Journée : événements, occupation ───────── */

  const flagsOf = (ev) => new Set(String((ev && ev.status) || '').toLowerCase().split(/[,\s]+/).filter(Boolean));
  // Un événement occupe-t-il son créneau ?
  function isBusy(ev, src) {
    if (src && src.busy === false) return false;
    const kind = (src && src.kind) || 'perso';
    const f = flagsOf(ev);
    if (ev.allDay) return kind === 'protection-civile' || f.has('busy');
    if (f.has('free') && kind !== 'cours' && kind !== 'protection-civile') return false;
    return true;
  }
  // Code eProtec d'un événement (catégorie, sinon mot du titre).
  function pcCode(ev) {
    for (const c of (ev && ev.categories) || []) {
      const k = String(c).trim().toUpperCase();
      if (PC_CODES[k]) return k;
      const head = k.split(/[^A-Z]/)[0]; // « DPS - Dispositif… »
      if (PC_CODES[head]) return head;
    }
    const m = new RegExp(`(^|[^A-Za-z])(${Object.keys(PC_CODES).join('|')})([^A-Za-z]|$)`).exec(String((ev && ev.title) || ''));
    return m ? m[2] : null;
  }
  const typeLabel = (ev) => { const c = pcCode(ev); return c ? PC_CODES[c] : ''; };

  // Index date → événements (reconstruit quand la liste change).
  let idx = { ref: null, len: -1, map: new Map() };
  function index(ag) {
    const evs = Array.isArray(ag.events) ? ag.events : [];
    if (idx.ref === evs && idx.len === evs.length) return idx.map;
    const map = new Map();
    for (const e of evs) {
      if (!U.isObj(e)) continue;
      const s = parseStamp(e.start);
      if (!s) continue;
      const en = parseStamp(e.end) || s;
      let last = dayNum(en.date);
      if (!e.allDay && en.timed && en.min === 0 && last > dayNum(s.date)) last--; // fin à minuit
      const first = dayNum(s.date);
      for (let n = first; n <= Math.max(first, last) && n - first < 62; n++) {
        const k = keyOf(n);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(e);
      }
    }
    idx = { ref: evs, len: evs.length, map };
    return map;
  }

  // Portions d'événements sur une journée, en minutes : [{ s, e, busy, kind, allDay, totalMin, ev }]
  function daySpans(date, ag = A()) {
    const srcs = new Map(sourcesOf(ag).map((s) => [s.id, s]));
    const out = [];
    for (const ev of index(ag).get(date) || []) {
      const src = srcs.get(ev.sourceId) || null;
      const kind = (src && src.kind) || 'perso';
      const busy = isBusy(ev, src);
      if (ev.allDay) { out.push({ s: 0, e: MIN_DAY, busy, kind, allDay: true, totalMin: MIN_DAY, ev, src }); continue; }
      const a = parseStamp(ev.start), b = parseStamp(ev.end) || a;
      const s = a.date < date ? 0 : a.date > date ? MIN_DAY : a.min;
      const e = b.date > date ? MIN_DAY : b.date < date ? 0 : b.min;
      const totalMin = absOf(b.date, b.min) - absOf(a.date, a.min);
      if (e < s || (e === s && a.date !== date)) continue;
      out.push({ s, e, busy, kind, allDay: false, totalMin, ev, src });
    }
    return out.sort((x, y) => (y.allDay - x.allDay) || x.s - y.s || x.e - y.e || String(x.ev.title).localeCompare(String(y.ev.title)));
  }

  function eventView(x, date) {
    const ev = x.ev;
    const a = parseStamp(ev.start), b = parseStamp(ev.end) || a;
    const time = ev.allDay ? 'Journée' : `${a.date === date ? hm(a.min) : '…'}–${b.date === date ? hm(b.min) : '…'}`;
    return {
      ...ev, categories: (ev.categories || []).slice(), kind: x.kind, busy: x.busy, allDay: !!ev.allDay,
      sourceName: x.src ? x.src.name : '', startMin: x.s, endMin: x.e, time,
      typeCode: x.kind === 'protection-civile' ? pcCode(ev) : null, typeLabel: x.kind === 'protection-civile' ? typeLabel(ev) : '',
      tentative: flagsOf(ev).has('tentative'),
    };
  }

  // eventsOn(date) → événements du jour (toutes sources), journées entières d'abord, puis par heure.
  function eventsOn(date) {
    if (!U.isKey(date)) return [];
    return daySpans(date).map((x) => eventView(x, date));
  }

  // Séance de sport du jour (planificateur) : { planned, slot:{s,e,title}|null }.
  function sportInfo(date) {
    const P = C.planner;
    if (!P || typeof P.day !== 'function') return { planned: false, slot: null };
    const dp = safe(() => P.day(date));
    if (!U.isObj(dp) || dp.kind !== 'session') return { planned: false, slot: null };
    const done = safe(() => C.sessions && C.sessions.isDone && C.sessions.isDone(date), false);
    if (done) return { planned: true, slot: null, done: true, title: dp.title };
    const sl = trainingSlot(date, U.num(dp.durationMin) || 60);
    return { planned: true, slot: sl ? { s: toMin(sl.start), e: toMin(sl.end), title: dp.title || 'Séance de sport' } : null, title: dp.title };
  }

  /* busyIntervals(date, opts?) → [{ start, end, title, kind }]
   * Événements qui occupent le créneau + séance de sport prévue (opts.sport === false pour l'exclure).
   * opts.margins : ajoute les marges des réglages (bufferBeforeMin avant, bufferAfterMin après). */
  function busyIntervals(date, opts = {}) {
    if (!U.isKey(date)) return [];
    const rv = revision();
    const before = opts.margins ? rv.bufferBeforeMin : 0, after = opts.margins ? rv.bufferAfterMin : 0;
    const list = daySpans(date).filter((x) => x.busy).map((x) => ({
      s: x.allDay ? 0 : Math.max(0, x.s - before), e: x.allDay ? MIN_DAY : Math.min(MIN_DAY, x.e + after), title: x.ev.title, kind: x.kind,
    }));
    if (opts.sport !== false) {
      const sp = sportInfo(date).slot;
      if (sp) list.push({ s: Math.max(0, sp.s - before), e: Math.min(MIN_DAY, sp.e + after), title: sp.title, kind: 'sport' });
    }
    return list.sort((a, b) => a.s - b.s || a.e - b.e).map((x) => ({ start: hm(x.s), end: hm(x.e), title: x.title, kind: x.kind }));
  }

  /* dayInfo(date) → { events, busyMin, hasCivilProtection, firstStart, lastEnd, freeEveningFrom, … }
   * Uniquement les événements qui occupent le créneau. N'appelle jamais le planificateur. */
  function dayInfo(date) {
    if (!U.isKey(date)) return null;
    const ag = A();
    const rv = revision(ag);
    const busy = daySpans(date, ag).filter((x) => x.busy);
    const pc = busy.filter((x) => x.kind === 'protection-civile');
    const cours = busy.filter((x) => x.kind === 'cours' && !x.allDay);
    const allDayBusy = busy.some((x) => x.allDay);
    const lastE = busy.length ? Math.max(...busy.map((x) => x.e)) : null;
    const latest = toMin(rv.latestEnd);
    const free = lastE != null && !allDayBusy ? lastE + rv.bufferAfterMin : null;
    return {
      date,
      events: busy.map((x) => eventView(x, date)),
      busyMin: unionLength(busy),
      hasCivilProtection: pc.length > 0,
      pcMin: unionLength(pc),
      pcLongest: pc.length ? Math.max(...pc.map((x) => x.totalMin)) : 0,
      hasCours: cours.length > 0,
      coursEnd: cours.length ? hm(Math.max(...cours.map((x) => x.e))) : null,
      allDayBusy,
      firstStart: busy.length ? hm(Math.min(...busy.map((x) => x.s))) : null,
      lastEnd: lastE != null ? hm(lastE) : null,
      freeEveningFrom: free != null && free < latest ? hm(free) : null,
    };
  }

  /* ───────── Créneau de sport ───────── */

  const isWeekend = (date) => U.dow(date) >= 5;
  function dayStartMin(date, rv, hasCours) {
    return toMin(hasCours || !isWeekend(date) ? rv.weekdayStart : rv.weekendStart);
  }
  function rangeCut(r) {
    const a = toMin(r && r.start), b = toMin(r && r.end);
    return a != null && b != null && b > a ? [a, b] : null;
  }
  // Créneaux repas protégés : dîner (réglable) et déjeuner.
  const mealCuts = (rv) => [rangeCut(rv.meal), rangeCut(U.isObj(rv.lunch) ? rv.lunch : DEFAULT_LUNCH)].filter(Boolean);

  /* trainingSlot(date, durationMin?) → { start, end } | null
   * Après les cours (marge comprise), fini avant 21:00 si possible, jamais après l'heure de fin max.
   * Sans durée : la séance prévue par le planificateur (null si repos). */
  function trainingSlot(date, durationMin) {
    if (!U.isKey(date)) return null;
    let dur = U.num(durationMin);
    if (!(dur > 0)) {
      const P = C.planner;
      if (!P || typeof P.day !== 'function') return null;
      const dp = safe(() => P.day(date));
      if (!U.isObj(dp) || dp.kind !== 'session') return null;
      dur = U.num(dp.durationMin) || 60;
    }
    dur = U.clamp(Math.round(dur), 15, 360);
    const ag = A();
    const rv = revision(ag);
    const busy = daySpans(date, ag).filter((x) => x.busy);
    if (busy.some((x) => x.allDay)) return null;
    const cours = busy.filter((x) => x.kind === 'cours');
    const coursEnd = cours.length ? Math.max(...cours.map((x) => x.e)) : null;
    const latest = toMin(rv.latestEnd);
    const cuts = busy.map((x) => [x.s - rv.bufferBeforeMin, x.e + rv.bufferAfterMin]).concat(mealCuts(rv));
    const free = subtract([[dayStartMin(date, rv, cours.length > 0), latest]], cuts);
    const target = coursEnd != null ? coursEnd + rv.bufferAfterMin : FREE_DAY_SPORT;
    let best = null;
    for (const [a0, b] of free) {
      const a = ceil5(a0);
      if (b - a < dur) continue;
      for (let t = a; t + dur <= b; t = t === a ? Math.ceil((a + 1) / 15) * 15 : t + 15) {
        const end = t + dur;
        let cost = Math.abs(t - target);
        if (end > PREF_SPORT_END) cost += 1000 + (end - PREF_SPORT_END);
        if (coursEnd != null && t < coursEnd) cost += 500;
        if (!best || cost < best.cost) best = { s: t, e: end, cost };
      }
    }
    return best ? { start: hm(best.s), end: hm(best.e) } : null;
  }

  /* ───────── Matières ───────── */

  const NOISE = new Set(['cm', 'td', 'tp', 'tdm', 'tds', 'tps', 'cours', 'amphi', 'amphis', 'amphitheatre', 'magistral', 'magistraux',
    'dirige', 'diriges', 'pratique', 'pratiques', 'travaux', 'examen', 'examens', 'exam', 'partiel', 'partiels', 'ds', 'controle',
    'controles', 'continu', 'cc', 'evaluation', 'evaluations', 'soutenance', 'soutenances', 'interro', 'interrogation', 'rattrapage',
    'seance', 'groupe', 'groupes', 'gr', 'grp', 'distanciel', 'presentiel', 'visio', 'tutorat', 'td/tp', 'cm/td']);
  const ROOM_WORDS = new Set(['salle', 'room', 'bat', 'batiment', 'amphi', 'amphitheatre']);
  const STOP = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'et', 'en', 'pour', 'aux', 'avec', 'sur', 'dans', 'au', 'a', 'l', 'd',
    'introduction', 'intro', 'initiation', 'approfondissement', 'avance', 'avancee', 'avances', 'avancees', 'partie', 'chapitre',
    'module', 'bases', 'base', 'applique', 'appliquee', 'appliques', 'appliquees', 'general', 'generale', 'fondamentaux', 'notions']);
  const isCode = (tok) => /^[A-Z]{2,6}[-_]?\d{2,4}[A-Z]?$/.test(tok) || /^\d+[A-Za-z]?$/.test(tok) || /^[A-Z]-?\d{2,4}[A-Z]?$/.test(tok)
    || /^(gr|grp|g)\.?\d+[a-z]?$/i.test(tok) || /^(s|sem)\d{1,2}$/i.test(tok) || /^ing\.?\d$/i.test(tok) || /^\d(a|eme|e)$/i.test(tok)
    || /^[lm]\d$/i.test(tok) || /^(?=.*\d)[A-Z0-9_-]{3,}$/.test(tok) || /^[A-Z0-9]{2,}([-_/][A-Z0-9]+)+$/.test(tok);

  // Nettoie un segment de titre : retire types (CM, TD…), codes, salles, groupes.
  function cleanSegment(seg) {
    const toks = seg.split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i].replace(/^[«"'(.,;]+|[»"'),.;]+$/g, '');
      if (!tok) continue;
      const n = norm(tok);
      if (ROOM_WORDS.has(n)) { if (toks[i + 1] && /\d/.test(toks[i + 1])) i++; continue; }
      if (n === 'en' && norm(toks[i + 1] || '') === 'ligne') { i++; continue; }
      if (n === 'a' && norm(toks[i + 1] || '') === 'distance') { i++; continue; }
      if (NOISE.has(n) || !n || isCode(tok)) continue;
      out.push(tok);
    }
    while (out.length && STOP.has(norm(out[out.length - 1]))) out.pop();
    while (out.length && STOP.has(norm(out[0])) && out.length > 1) out.shift();
    return out.join(' ');
  }
  // Matière déduite d'un titre de cours (« TD Mécanique des fluides (Gr 2) » → « Mécanique des fluides »). '' si rien.
  function cleanTitle(title) {
    const t = String(title || '').replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
    const segs = t.split(/\s[-–—]\s|[|:;·,/\\]|\s[–—]|[–—]\s|\s-$|^-\s/).map((s) => cleanSegment(s.trim())).filter(Boolean);
    if (!segs.length) return '';
    let best = segs[0];
    for (const s of segs) if (s.replace(/[^\p{L}]/gu, '').length > best.replace(/[^\p{L}]/gu, '').length) best = s;
    best = best.replace(/^[^\p{L}\d]+|[^\p{L}\d)]+$/gu, '').trim();
    if (!best || !/\p{L}{2}/u.test(best)) return '';
    const letters = best.replace(/[^\p{L}]/gu, '');
    if (letters.length > 3 && letters === letters.toUpperCase()) best = best.toLowerCase();
    return clip(best.charAt(0).toUpperCase() + best.slice(1), 80);
  }
  const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 40);
  const subjectIdFor = (name) => 'm-' + (slug(name) || 'autre');
  const stem = (w) => (w.length > 4 ? w.replace(/[sx]$/, '') : w);
  const sigWords = (name) => [...new Set(norm(name).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];
  const wordEq = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
  const subsetOf = (A1, B1) => A1.length > 0 && A1.every((a) => B1.some((b) => wordEq(a, b)));

  // Matière correspondant à un titre : mot-clé le plus long trouvé en début de mot.
  function matchSubject(title, subjects) {
    const t = ' ' + norm(title) + ' ';
    let best = null, bestLen = 0;
    for (const s of subjects || []) {
      if (!U.isObj(s)) continue;
      for (const k of [s.name, ...(Array.isArray(s.match) ? s.match : [])]) {
        const kk = norm(k);
        if (kk.length < 2) continue;
        if (t.includes(' ' + kk) && kk.length > bestLen) { best = s; bestLen = kk.length; }
      }
    }
    return best;
  }
  const subjectsOf = (ag) => (Array.isArray(ag.subjects) ? ag.subjects.filter((s) => U.isObj(s) && s.id) : []);
  // Matière d'un événement : enregistrée (même ignorée), sinon déduite du titre. null si aucune.
  function subjectOfTitle(title, ag) {
    const s = matchSubject(title, subjectsOf(ag));
    if (s) return s;
    const name = cleanTitle(title);
    return name ? { id: subjectIdFor(name), name, color: '', match: [norm(name)], ignore: false, weight: 2, derived: true } : null;
  }
  const IGNORE_RE = /^(sport|eps|activites? (physiques?|sportives?)|pause|dejeuner|repas|vacances|ferie|conge|forum|journee d integration|integration|rentree|reunion d information)\b/;
  const LANG_RE = /^(anglais|espagnol|allemand|italien|chinois|japonais|portugais|arabe|russe|lv\d|langues?|fle|toeic)\b/;
  const courseEvents = (ag) => {
    const kinds = new Map(sourcesOf(ag).map((s) => [s.id, s.kind]));
    return (Array.isArray(ag.events) ? ag.events : []).filter((e) => U.isObj(e) && kinds.get(e.sourceId) === 'cours' && !e.allDay);
  };

  /* subjectsFromEvents() → [{ id, name, color, match, ignore, weight, count, isNew }]
   * Matières enregistrées (avec leur nombre de cours) + matières nouvelles déduites des titres de cours. */
  function subjectsFrom(ag) {
    const existing = subjectsOf(ag).map((s) => ({ ...s, match: Array.isArray(s.match) ? s.match.slice() : [], count: 0, isNew: false }));
    const groups = new Map(); // nom normalisé → { name, count, forms: Map(forme → nb) }
    for (const e of courseEvents(ag)) {
      if (EXAM_TEST(e.title)) continue;
      const hit = matchSubject(e.title, existing);
      if (hit) { hit.count++; continue; }
      const name = cleanTitle(e.title);
      if (!name) continue;
      const k = norm(name);
      if (!groups.has(k)) groups.set(k, { key: k, name, count: 0, forms: new Map() });
      const g = groups.get(k);
      g.count++;
      g.forms.set(name, (g.forms.get(name) || 0) + 1);
    }
    // Fusion par mots-clés (« Maths » et « Mathématiques », « Physique » et « Physique quantique »…).
    const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const clusters = [];
    for (const g of sorted) {
      const w = sigWords(g.name);
      const into = clusters.find((c) => subsetOf(w, c.words) || subsetOf(c.words, w));
      if (into) { into.count += g.count; into.keys.push(g.key); } else clusters.push({ name: g.name, words: w, count: g.count, keys: [g.key] });
    }
    const used = new Set(existing.map((s) => s.color));
    const free = COLORS.filter((c) => !used.has(c));
    const fresh = clusters.sort((a, b) => a.name.localeCompare(b.name)).map((c, i) => {
      const n = norm(c.name);
      return {
        id: subjectIdFor(c.name), name: c.name, color: free.length ? free[i % free.length] : COLORS[(existing.length + i) % COLORS.length],
        match: [...new Set(c.keys)], ignore: IGNORE_RE.test(n), weight: LANG_RE.test(n) ? 1 : 2, count: c.count, isNew: true,
      };
    });
    const ids = new Set(existing.map((s) => s.id));
    for (const f of fresh) { let id = f.id, k = 2; while (ids.has(id)) id = `${f.id}-${k++}`; f.id = id; ids.add(id); }
    return existing.concat(fresh);
  }
  const subjectsFromEvents = () => subjectsFrom(A());

  // Ajoute les nouvelles matières à l'état (sans toucher aux réglages de l'utilisateur).
  function addNewSubjects(ag) {
    let n = 0;
    for (const s of subjectsFrom(ag)) {
      if (!s.isNew) continue;
      ag.subjects.push({ id: s.id, name: s.name, color: s.color, match: s.match, ignore: s.ignore, weight: s.weight });
      n++;
    }
    return n;
  }
  function updateSubject(id, patch = {}) {
    return upd((ag) => {
      const s = subjectsOf(ag).find((x) => x.id === id);
      if (!s) return false;
      if ('name' in patch) s.name = clip(patch.name, 80) || s.name;
      if ('color' in patch && COLORS.includes(patch.color)) s.color = patch.color;
      if ('weight' in patch && [1, 2, 3].includes(+patch.weight)) s.weight = +patch.weight;
      if ('ignore' in patch) s.ignore = !!patch.ignore;
      if ('match' in patch) {
        const list = (Array.isArray(patch.match) ? patch.match : String(patch.match).split(',')).map((m) => clip(m, 80)).filter(Boolean);
        s.match = [...new Set(list)].slice(0, 12);
      }
      refreshDerived(ag, U.todayKey());
      return true;
    });
  }
  function rescanSubjects() { return upd((ag) => { const n = addNewSubjects(ag); refreshDerived(ag, U.todayKey()); return n; }); }

  /* ───────── Examens ───────── */

  const EXAM_RE = /(^| )(examens?|exam|partiels?|ds|controles?|cc|evaluations?|soutenances?)( |$)/;
  function EXAM_TEST(title) {
    const t = norm(title);
    const m = EXAM_RE.exec(t);
    if (!m) return false;
    // « Évaluation des risques — CM » est un cours, pas une épreuve.
    if (/^evaluations?$/.test(m[2]) && /(^| )(cm|td|tp|cours|amphi)( |$)/.test(t)) return false;
    return true;
  }

  /* detectExams() → [{ id, subjectId, date, title, source:'auto', start, eventId }]
   * Événements de cours (ou perso) titrés Examen, Partiel, DS, Contrôle, CC, Évaluation, Soutenance. */
  function examsFrom(ag) {
    const kinds = new Map(sourcesOf(ag).map((s) => [s.id, s.kind]));
    const out = new Map();
    for (const e of Array.isArray(ag.events) ? ag.events : []) {
      if (!U.isObj(e) || !['cours', 'perso'].includes(kinds.get(e.sourceId)) || !EXAM_TEST(e.title)) continue;
      const s = parseStamp(e.start);
      if (!s) continue;
      const subj = subjectOfTitle(e.title, ag);
      if (subj && subj.ignore) continue;
      const subjectId = subj ? subj.id : '';
      const id = `auto:${subjectId || hash(norm(e.title))}:${s.date}`;
      if (!out.has(id)) out.set(id, { id, subjectId, date: s.date, title: clip(e.title, 160), source: 'auto', start: s.timed ? hm(s.min) : null, eventId: e.id });
    }
    return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  const detectExams = () => examsFrom(A());
  function refreshExams(ag) {
    const manual = (Array.isArray(ag.exams) ? ag.exams : []).filter((x) => U.isObj(x) && x.source !== 'auto');
    ag.exams = manual.concat(examsFrom(ag).map(({ id, subjectId, date, title, source }) => ({ id, subjectId, date, title, source })));
  }
  function addExam(o = {}) {
    if (!U.isKey(o.date)) return null;
    const id = 'man-' + String(U.uid()).replace(/[^a-z0-9]/gi, '').slice(-10);
    upd((ag) => {
      ag.exams.push({ id, subjectId: clip(o.subjectId, 80), date: o.date, title: clip(o.title, 160) || 'Examen', source: 'manuel' });
      refreshDerived(ag, U.todayKey());
    });
    return id;
  }
  function removeExam(id) {
    return upd((ag) => {
      const before = ag.exams.length;
      ag.exams = ag.exams.filter((x) => !(x.id === id && x.source !== 'auto'));
      refreshDerived(ag, U.todayKey());
      return ag.exams.length < before;
    });
  }

  /* ───────── Tâches de révision ───────── */

  const subjectById = (ag, id) => subjectsOf(ag).find((s) => s.id === id) || null;
  const weightOf = (ag, id) => { const s = subjectById(ag, id); return s && [1, 2, 3].includes(+s.weight) ? +s.weight : 2; };

  // Révision espacée : type, durée et tolérance selon l'écart au cours.
  function spacedSpec(off, big) {
    if (off <= 0) return { kind: 'relecture', dur: big ? 30 : 20, label: 'Relecture du cours', short: 'Relecture du jour', early: 0, grace: 1 };
    if (off <= 2) return { kind: 'relecture', dur: big ? 20 : 15, label: `Relecture J+${off}`, short: `Relecture J+${off}`, early: 0, grace: 1 };
    if (off <= 14) return { kind: 'exercices', dur: big ? 50 : 40, label: `Exercices J+${off}`, short: `Exercices J+${off}`, early: 1, grace: 3 };
    return { kind: 'synthese', dur: 30, label: `Fiche de synthèse J+${off}`, short: `Synthèse J+${off}`, early: 3, grace: 7 };
  }

  // Cours regroupés par matière et par jour, entre deux dates : [{ subjectId, date, minutes, lastEnd, eventIds }]
  function courseGroups(ag, from, to) {
    const groups = new Map();
    for (const e of courseEvents(ag)) {
      const s = parseStamp(e.start), en = parseStamp(e.end) || s;
      if (!s || s.date < from || s.date > to || EXAM_TEST(e.title)) continue;
      const subj = subjectOfTitle(e.title, ag);
      if (!subj || subj.ignore) continue;
      const k = `${subj.id}|${s.date}`;
      if (!groups.has(k)) groups.set(k, { subjectId: subj.id, name: subj.name, date: s.date, minutes: 0, lastEnd: 0, eventIds: [] });
      const g = groups.get(k);
      const endMin = en.date > s.date ? MIN_DAY - 1 : en.min;
      g.minutes += Math.max(0, absOf(en.date, en.min) - absOf(s.date, s.min));
      g.lastEnd = Math.max(g.lastEnd, endMin);
      g.eventIds.push(e.id);
    }
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.subjectId.localeCompare(b.subjectId));
  }

  /* Tâches générées (pures) : révisions espacées des cours entre courseFrom et courseTo,
   * préparation des examens à venir. → { [id]: tâche } */
  function generateTasks(ag, today, courseFrom, courseTo) {
    const rv = revision(ag);
    const out = {};
    for (const g of courseGroups(ag, courseFrom, courseTo)) {
      const w = weightOf(ag, g.subjectId);
      const big = g.minutes > 120 || w >= 3;
      for (const off of rv.spacing) {
        const sp = spacedSpec(off, big);
        const id = `rev|${g.subjectId}|${g.date}|J${off}`;
        const due = U.addDays(g.date, off);
        out[id] = {
          id, subjectId: g.subjectId, kind: sp.kind, title: `${sp.label} (cours du ${U.fmtShort(g.date)})`, short: sp.short,
          due, durationMin: sp.dur, sourceEventId: g.eventIds[0] || '', done: false, doneAt: null, skipped: false,
          from: U.maxKey(g.date, U.addDays(due, -sp.early)), until: U.addDays(due, sp.grace),
          availableAt: off === 0 ? stampOf(g.date, g.lastEnd) : null, courseDate: g.date, offset: off, auto: true,
        };
      }
    }
    for (const ex of Array.isArray(ag.exams) ? ag.exams : []) {
      if (!U.isObj(ex) || !U.isKey(ex.date) || ex.date <= today || U.daysBetween(today, ex.date) > WINDOW_FUTURE) continue;
      const subj = ex.subjectId ? subjectById(ag, ex.subjectId) : null;
      if (subj && subj.ignore) continue;
      const plan = EXAM_PLAN[weightOf(ag, ex.subjectId)] || EXAM_PLAN[2];
      const seen = {};
      for (const n of plan) {
        seen[n] = (seen[n] || 0) + 1;
        const id = `exam|${ex.id}|J-${n}${seen[n] > 1 ? '.' + seen[n] : ''}`;
        const due = U.addDays(ex.date, -n);
        out[id] = {
          id, subjectId: ex.subjectId || '', kind: 'examen', title: `Préparer : ${ex.title || 'examen'} (J-${n})`, short: `Prépa examen J-${n}`,
          due, durationMin: rv.blockMin, sourceEventId: '', done: false, doneAt: null, skipped: false,
          from: U.addDays(due, -1), until: U.addDays(ex.date, -1), availableAt: null, examId: ex.id, examDate: ex.date, offset: -n, auto: true,
        };
      }
    }
    return out;
  }

  // Fusion avec les tâches enregistrées : garde fait / sauté / reporté ; retire les tâches orphelines non faites.
  function mergeTasks(ag, today) {
    const from = U.addDays(today, -WINDOW_PAST);
    const gen = generateTasks(ag, today, from, today);
    const examDates = new Map((Array.isArray(ag.exams) ? ag.exams : []).filter(U.isObj).map((x) => [x.id, x.date]));
    let added = 0, removed = 0;
    for (const [id, t] of Object.entries(gen)) {
      const old = U.isObj(ag.tasks[id]) ? ag.tasks[id] : {};
      if (!ag.tasks[id]) added++;
      ag.tasks[id] = {
        ...t, done: !!old.done, doneAt: old.doneAt || null, skipped: !!old.skipped,
        notBefore: U.isKey(old.notBefore) ? old.notBefore : null,
        until: old.postponed && U.isKey(old.until) && old.until > t.until ? old.until : t.until,
        postponed: !!old.postponed,
      };
    }
    // Blocs « pas fait » des jours passés : l'information ne sert plus.
    for (const [id, b] of Object.entries(ag.blocks)) if (!U.isObj(b) || (!b.done && (!U.isKey(b.date) || b.date < today))) delete ag.blocks[id];
    for (const [id, t] of Object.entries(ag.tasks)) {
      if (gen[id]) continue;
      if (!U.isObj(t)) { delete ag.tasks[id]; continue; }
      if (t.done) {
        if (U.isKey(t.due) && t.due < U.addDays(today, -KEEP_DONE_DAYS)) { delete ag.tasks[id]; removed++; }
        continue;
      }
      const courseInScope = U.isKey(t.courseDate) && t.courseDate >= from && t.courseDate <= today;
      const examGone = t.examId && (!examDates.has(t.examId) || examDates.get(t.examId) !== t.examDate);
      const examInScope = t.examId && U.isKey(t.examDate) && t.examDate > today;
      const stale = U.isKey(t.until) && t.until < U.addDays(today, -14);
      if ((t.auto && (courseInScope || examGone || examInScope)) || stale) { delete ag.tasks[id]; removed++; }
    }
    return { added, removed, total: Object.keys(ag.tasks).length };
  }

  // Après un import ou un changement de réglage : matières, examens, tâches.
  function refreshDerived(ag, today) {
    addNewSubjects(ag);
    refreshExams(ag);
    mergeTasks(ag, today);
  }

  /* buildTasks(today) → { added, removed, total }
   * Crée ou actualise les tâches de révision (cours des 30 derniers jours, examens à venir).
   * Ne supprime jamais une tâche faite (sauf au-delà d'un an, pour garder le stockage léger). */
  function buildTasks(today) {
    const t = U.isKey(today) ? today : U.todayKey();
    return upd((ag) => { refreshExams(ag); return mergeTasks(ag, t); }, { silent: true });
  }

  // Révision libre ajoutée à la main (ex. « DM de physique », 60 min, avant vendredi).
  function addTask(o = {}) {
    const due = U.isKey(o.due) ? o.due : U.todayKey();
    const id = 'libre|' + String(U.uid()).replace(/[^a-z0-9]/gi, '').slice(-10);
    upd((ag) => {
      ag.tasks[id] = {
        id, subjectId: clip(o.subjectId, 80), kind: 'libre', title: clip(o.title, 160) || 'Révision', short: clip(o.title, 40) || 'Révision',
        due, durationMin: U.clamp(Math.round(U.num(o.durationMin) || 50), 15, 240), sourceEventId: '', done: false, doneAt: null, skipped: false,
        from: U.todayKey(), until: U.addDays(due, 3), availableAt: null, auto: false,
      };
    });
    return id;
  }

  /* ───────── Planification des révisions ───────── */

  // Tâches à placer : enregistrées + générées (cours jusqu'à `to`, y compris à venir), non faites, non expirées.
  function taskPool(ag, today, to) {
    const gen = generateTasks(ag, today, U.addDays(today, -WINDOW_PAST), to);
    const all = new Map();
    for (const [id, t] of Object.entries(gen)) all.set(id, t);
    for (const [id, t] of Object.entries(U.isObj(ag.tasks) ? ag.tasks : {})) {
      if (!U.isObj(t) || !U.isKey(t.due)) continue;
      const g = all.get(id);
      all.set(id, g ? { ...g, done: !!t.done, skipped: !!t.skipped, notBefore: t.notBefore || null, until: t.postponed && t.until > g.until ? t.until : g.until } : { ...t, id });
    }
    return [...all.values()].filter((t) => !t.done && !t.skipped && (!U.isKey(t.until) || t.until >= today))
      .map((t) => ({ ...t, durationMin: U.clamp(Math.round(U.num(t.durationMin) || 30), 10, 240) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  // Contexte d'une journée pour placer des blocs.
  function dayCtx(date, ag, rv) {
    const busy = daySpans(date, ag).filter((x) => x.busy);
    const hasCours = busy.some((x) => x.kind === 'cours' && !x.allDay);
    const sport = sportInfo(date);
    const dow = U.dow(date);
    const allDayBusy = busy.some((x) => x.allDay);
    const cuts = busy.filter((x) => !x.allDay).map((x) => [x.s - rv.bufferBeforeMin, x.e + rv.bufferAfterMin]).concat(mealCuts(rv));
    if (sport.slot) cuts.push([sport.slot.s - rv.bufferBeforeMin, sport.slot.e + rv.bufferAfterMin]);
    const pcLong = busy.some((x) => x.kind === 'protection-civile' && x.totalMin >= 240);
    let limit = isWeekend(date) ? rv.maxWeekendMin : rv.maxWeekdayMin;
    if (pcLong) limit = Math.floor(limit / 2);
    let off = '';
    if (!rv.enabled) off = 'disabled';
    else if (rv.daysOff.includes(dow)) off = 'day-off';
    else if (allDayBusy) off = 'busy';
    else if (rv.avoidTrainingDays && sport.planned) off = 'sport';
    return { date, rv, start: dayStartMin(date, rv, hasCours), end: toMin(rv.latestEnd), cuts, limit, off, pcLong, sport };
  }

  // Priorité d'une tâche pour le jour `date` (plus petit = plus urgent).
  function priority(t, date, ag, examsBySubject) {
    let exam = t.examDate || null;
    if (!exam && t.subjectId) exam = (examsBySubject.get(t.subjectId) || []).find((d) => d >= date) || null;
    const examBonus = exam ? Math.max(0, 15 - U.daysBetween(date, exam)) * (t.kind === 'examen' ? 4 : 2) : 0;
    return 10 * U.daysBetween(date, t.due) - examBonus - 3 * weightOf(ag, t.subjectId) + (KIND_RANK[t.kind] || 0);
  }
  const minLen = (t) => Math.min(t.durationMin, Math.max(15, Math.round(t.durationMin * 0.6)));
  function availableOn(t, date) {
    if (U.isKey(t.from) && t.from > date) return false;
    if (U.isKey(t.until) && t.until < date) return false;
    if (U.isKey(t.notBefore) && t.notBefore > date) return false;
    if (t.availableAt) { const a = parseStamp(t.availableAt); if (a && a.date > date) return false; }
    return true;
  }
  const availMinOn = (t, date) => { const a = t.availableAt && parseStamp(t.availableAt); return a && a.date === date ? a.min : 0; };

  /* Place des blocs dans une journée (sans modifier le pool).
   * fixed : blocs déjà là ({ s, e }) ; startMin : rien avant cette minute. */
  function placeDay(ctx, pool, fixed, startMin, ag, examsBySubject) {
    if (ctx.off || ctx.start == null || ctx.end == null) return [];
    const rv = ctx.rv;
    const cuts = ctx.cuts.concat(fixed.map((b) => [b.s - rv.breakMin, b.e + rv.breakMin]));
    const free = subtract([[Math.max(ctx.start, startMin), ctx.end]], cuts);
    let remaining = ctx.limit - fixed.reduce((n, b) => n + (b.e - b.s), 0);
    const avail = pool.filter((t) => availableOn(t, ctx.date))
      .map((t) => ({ t, p: priority(t, ctx.date, ag, examsBySubject) }))
      .sort((a, b) => a.p - b.p || a.t.id.localeCompare(b.t.id)).map((x) => x.t);
    const prio = new Map(avail.map((t, i) => [t.id, i]));
    const used = new Set();
    const out = [];
    let prevSubject = null;
    for (const [a, b] of free) {
      let cur = ceil5(a);
      while (remaining >= 15 && b - cur >= rv.minSlotMin) {
        const len = Math.min(rv.blockMin, b - cur, remaining);
        const ready = avail.filter((t) => !used.has(t.id) && availMinOn(t, ctx.date) <= cur);
        // Alterner les matières : à priorité proche, on évite d'enchaîner la même.
        const pick = ready.filter((t) => minLen(t) <= len);
        const score = (t) => priority(t, ctx.date, ag, examsBySubject) + (prevSubject != null && t.subjectId === prevSubject ? 8 : 0);
        const primary = pick.length ? pick.reduce((best, t) => { const s = score(t); return s < best.s || (s === best.s && prio.get(t.id) < prio.get(best.t.id)) ? { t, s } : best; }, { t: pick[0], s: score(pick[0]) }).t : null;
        if (!primary) {
          // Une tâche devient disponible plus tard dans ce créneau (relecture après le cours) ?
          const later = avail.filter((t) => !used.has(t.id) && availMinOn(t, ctx.date) > cur && minLen(t) <= Math.min(rv.blockMin, remaining))
            .map((t) => ceil5(availMinOn(t, ctx.date))).sort((x, y) => x - y)[0];
          if (later != null && b - later >= rv.minSlotMin) { cur = later; continue; }
          break;
        }
        const group = [primary];
        let total = Math.min(primary.durationMin, len);
        for (const t of ready) {
          if (t === primary || t.subjectId !== primary.subjectId || total + t.durationMin > len) continue;
          group.push(t);
          total += t.durationMin;
        }
        group.forEach((t) => used.add(t.id));
        out.push({ date: ctx.date, s: cur, e: cur + total, subjectId: primary.subjectId || '', tasks: group });
        prevSubject = primary.subjectId || '';
        remaining -= total;
        cur = ceil5(cur + total + rv.breakMin);
      }
    }
    return out;
  }

  function shortLabel(t, date) {
    if (t.kind === 'libre') return t.title;
    if (t.offset === 0 && t.courseDate && t.courseDate !== date) return `Relecture du cours du ${U.fmtShort(t.courseDate)}`;
    return t.short || t.title;
  }
  const blockTitle = (tasks, date) => tasks.map((t) => shortLabel(t, date)).join(' + ');
  function asBlock(b, ag) {
    const subj = b.subjectId ? subjectById(ag, b.subjectId) : null;
    const name = subj ? subj.name : b.subjectId ? (b.tasks[0] && courseNameOf(ag, b.tasks[0])) || '' : '';
    return {
      id: `${b.date}T${hm(b.s)}|${b.subjectId || 'libre'}`, date: b.date, start: hm(b.s), end: hm(b.e),
      subjectId: b.subjectId || '', subjectName: name, color: subj && COLORS.includes(subj.color) ? subj.color : 'loc-repos',
      title: blockTitle(b.tasks, b.date), taskIds: b.tasks.map((t) => t.id), tasks: b.tasks.map((t) => ({ ...t })),
      kind: b.tasks[0].kind, done: false, minutes: b.e - b.s,
    };
  }
  // Nom d'une matière pas encore enregistrée (tâche prévue pour un cours à venir).
  function courseNameOf(ag, t) {
    if (!t.sourceEventId) return '';
    const e = (ag.events || []).find((x) => x.id === t.sourceEventId);
    return e ? cleanTitle(e.title) : '';
  }
  function pinnedBlocks(ag) {
    const out = [];
    for (const [id, b] of Object.entries(U.isObj(ag.blocks) ? ag.blocks : {})) {
      if (!U.isObj(b) || !b.done || !U.isKey(b.date) || toMin(b.start) == null || toMin(b.end) == null) continue;
      const subj = b.subjectId ? subjectById(ag, b.subjectId) : null;
      out.push({
        id, date: b.date, start: b.start, end: b.end, subjectId: b.subjectId || '', subjectName: subj ? subj.name : (b.subjectName || ''),
        color: subj && COLORS.includes(subj.color) ? subj.color : 'loc-repos', title: b.title || 'Révision',
        taskIds: Array.isArray(b.taskIds) ? b.taskIds.slice() : [], tasks: [], kind: b.kind || 'relecture', done: true,
        minutes: U.num(b.minutes) || Math.max(0, toMin(b.end) - toMin(b.start)), doneAt: b.doneAt || null, pinned: true,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  }

  // Calcul complet d'aujourd'hui à `to` (jours passés : seulement les blocs faits).
  function planFrom(ag, today, to) {
    const rv = revision(ag);
    const pool = taskPool(ag, today, to);
    const pinned = pinnedBlocks(ag);
    const examsBySubject = new Map();
    for (const ex of (Array.isArray(ag.exams) ? ag.exams : []).filter((x) => U.isObj(x) && U.isKey(x.date)).sort((a, b) => a.date.localeCompare(b.date))) {
      if (!examsBySubject.has(ex.subjectId)) examsBySubject.set(ex.subjectId, []);
      examsBySubject.get(ex.subjectId).push(ex.date);
    }
    const take = (blocks) => { const ids = new Set(blocks.flatMap((b) => b.tasks.map((t) => t.id))); for (let i = pool.length - 1; i >= 0; i--) if (ids.has(pool[i].id)) pool.splice(i, 1); };
    const nm = nowMin();
    const out = [];
    const missed = [];
    for (let d = today, guard = 0; d <= to && guard < 400; d = U.addDays(d, 1), guard++) {
      const fixedB = pinned.filter((b) => b.date === d);
      const fixed = fixedB.map((b) => ({ s: toMin(b.start), e: toMin(b.end) }));
      const ctx = dayCtx(d, ag, rv);
      let placed = placeDay(ctx, pool, fixed, 0, ag, examsBySubject);
      if (d === today) {
        // Les blocs déjà finis (non cochés) sont replacés plus tard ; un bloc en cours reste à sa place.
        const keep = placed.filter((b) => b.e > nm);
        missed.push(...placed.filter((b) => b.e <= nm).map((b) => ({ ...asBlock(b, ag), missed: true })));
        take(keep);
        const extra = placeDay(ctx, pool, fixed.concat(keep), nm, ag, examsBySubject);
        take(extra);
        placed = keep.concat(extra);
      } else take(placed);
      out.push(...fixedB, ...placed.map((b) => asBlock(b, ag)));
    }
    return { blocks: out, missed };
  }

  /* schedule(from, to) → [{ id, date, start, end, subjectId, subjectName, color, title, taskIds, tasks, kind, done, minutes }]
   * Blocs de révision. Calcul toujours mené depuis aujourd'hui (le résultat d'un jour ne dépend pas de la période
   * demandée) ; rien n'est placé dans le passé ; jours passés : blocs cochés « fait » seulement. Déterministe. */
  function schedule(from, to) {
    const today = U.todayKey();
    const f = U.isKey(from) ? from : today;
    const t = U.isKey(to) && to >= f ? to : f;
    const ag = A();
    const out = pinnedBlocks(ag).filter((b) => b.date >= f && b.date <= t && b.date < today);
    if (t >= today) out.push(...planFrom(ag, today, t).blocks.filter((b) => b.date >= f && b.date <= t));
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  }

  /* ───────── Blocs : fait / pas fait / reporter ───────── */

  /* missedBlocks() → blocs prévus aujourd'hui, déjà finis et pas cochés (leurs tâches sont replacées plus tard) :
   * l'écran propose « Fait ? » pour les cocher après coup. Les blocs écartés (« pas fait ») n'y sont plus. */
  function missedBlocks() {
    const ag = A();
    const today = U.todayKey();
    return planFrom(ag, today, today).missed.filter((b) => !(U.isObj(ag.blocks[b.id]) && ag.blocks[b.id].dismissed));
  }
  function findBlock(blockId) {
    const id = String(blockId || '');
    const date = id.slice(0, 10);
    if (!U.isKey(date)) return null;
    const hit = schedule(date, date).find((b) => b.id === id);
    if (hit) return hit;
    return date === U.todayKey() ? planFrom(A(), date, date).missed.find((b) => b.id === id) || null : null;
  }
  const cleanTask = (t) => ({ ...t });

  /* markBlock(blockId, done = true) → bool : coche (ou décoche) le bloc et ses tâches.
   * Un bloc coché avant son heure prévue (aujourd'hui) est daté de maintenant.
   * « Pas fait » sur un bloc coché : annule ; sur un bloc manqué : l'écarte (ses tâches restent à faire). */
  function markBlock(blockId, done = true) {
    const id = String(blockId || '');
    const today = U.todayKey();
    if (done) {
      const b = findBlock(id);
      if (!b) return false;
      let s = toMin(b.start), e = toMin(b.end);
      const nm = nowMin();
      if (b.date === today && s > nm) { e = Math.max(b.minutes, Math.floor(nm / 5) * 5); s = e - b.minutes; }
      return upd((ag) => {
        ag.blocks[id] = {
          done: true, doneAt: today, date: b.date, start: hm(s), end: hm(e), subjectId: b.subjectId, subjectName: b.subjectName,
          title: b.title, kind: b.kind, taskIds: b.taskIds.slice(), minutes: b.minutes, note: '',
        };
        for (const t of b.tasks) {
          const cur = U.isObj(ag.tasks[t.id]) ? ag.tasks[t.id] : cleanTask(t);
          ag.tasks[t.id] = { ...cur, done: true, doneAt: today };
        }
        return true;
      });
    }
    return upd((ag) => {
      const prev = ag.blocks[id];
      if (U.isObj(prev) && prev.done) {
        for (const tid of Array.isArray(prev.taskIds) ? prev.taskIds : []) if (U.isObj(ag.tasks[tid])) ag.tasks[tid] = { ...ag.tasks[tid], done: false, doneAt: null };
        delete ag.blocks[id];
        return true;
      }
      const date = id.slice(0, 10);
      if (!U.isKey(date)) return false;
      ag.blocks[id] = { done: false, doneAt: null, dismissed: true, date, note: '' };
      return true;
    });
  }

  // Reporter : les tâches du bloc ne sont plus proposées avant demain (ou dans `days` jours).
  function postponeBlock(blockId, days = 1) {
    const b = findBlock(blockId);
    if (!b || b.done) return false;
    const today = U.todayKey();
    const target = U.addDays(U.maxKey(b.date, today), Math.max(1, Math.round(days) || 1));
    return upd((ag) => {
      for (const t of b.tasks) {
        const cur = U.isObj(ag.tasks[t.id]) ? ag.tasks[t.id] : cleanTask(t);
        const next = { ...cur, notBefore: target, postponed: true };
        if (t.kind !== 'examen' && U.isKey(next.until) && next.until < U.addDays(target, 1)) next.until = U.addDays(target, 1);
        ag.tasks[t.id] = next;
      }
      return true;
    });
  }
  // Ne pas faire : les tâches du bloc sont retirées (gardées comme « sautées »).
  function skipBlock(blockId) {
    const b = findBlock(blockId);
    if (!b || b.done) return false;
    return upd((ag) => {
      for (const t of b.tasks) {
        const cur = U.isObj(ag.tasks[t.id]) ? ag.tasks[t.id] : cleanTask(t);
        ag.tasks[t.id] = { ...cur, skipped: true };
      }
      return true;
    });
  }

  // Résumé d'une semaine : minutes prévues (faites + à venir) et faites.
  function weekStats(monday) {
    const m = U.mondayOf(U.isKey(monday) ? monday : U.todayKey());
    const blocks = schedule(m, U.addDays(m, 6));
    const doneMin = blocks.filter((b) => b.done).reduce((n, b) => n + b.minutes, 0);
    const plannedMin = blocks.reduce((n, b) => n + b.minutes, 0);
    return { monday: m, plannedMin, doneMin, blocks: blocks.length, done: blocks.filter((b) => b.done).length };
  }

  // Réglages des révisions : mise à jour d'un champ (valeur vérifiée).
  function setRevision(key, value) {
    const d = C.schema.defaultAgenda().revision;
    if (!(key in d)) return false;
    return upd((ag) => {
      const r = U.isObj(ag.revision) ? ag.revision : (ag.revision = { ...d });
      if (typeof d[key] === 'string') {
        const m = toMin(value);
        // Heure de fin avant midi : sûrement une erreur de saisie (aucune révision ne serait possible).
        if (m == null || (key === 'latestEnd' && m < 12 * 60)) return false;
        r[key] = hm(m).replace('24:00', '23:59');
      }
      else if (typeof d[key] === 'number') { const n = U.num(value); if (n == null || n < 0) return false; r[key] = Math.round(Math.min(n, 1440)); }
      else if (typeof d[key] === 'boolean') r[key] = value === true || value === 'true' || value === 'on';
      else if (key === 'daysOff') r.daysOff = [...new Set((Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
      else if (key === 'spacing') {
        const list = (Array.isArray(value) ? value : String(value).split(/[,; ]+/)).map((x) => parseInt(x, 10)).filter((n) => n >= 0 && n <= 120);
        if (!list.length) return false;
        r.spacing = [...new Set(list)].sort((a, b) => a - b);
      } else if (key === 'meal') {
        const a = toMin(value && value.start), b = toMin(value && value.end);
        r.meal = a != null && b != null && b > a ? { start: hm(a), end: hm(b) } : { start: '', end: '' };
      }
      refreshDerived(ag, U.todayKey());
      return true;
    });
  }

  /* ───────── Export .ics des révisions ───────── */

  const icsEscape = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  // Replie une ligne à 75 octets (UTF-8), sans couper un caractère.
  function foldLine(line) {
    const enc = (c) => { const n = c.codePointAt(0); return n < 0x80 ? 1 : n < 0x800 ? 2 : n < 0x10000 ? 3 : 4; };
    const out = [];
    let cur = '', bytes = 0, limit = 75;
    for (const ch of line) {
      const b = enc(ch);
      if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function utcStamp(date, min) {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d, Math.floor(min / 60), min % 60, 0);
    return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;
  }

  /* icsForRevisions(from, to) → texte .ics des blocs de révision à venir (rappel 10 min avant). */
  function icsForRevisions(from, to) {
    const today = U.todayKey();
    const f = U.isKey(from) ? from : today;
    const t = U.isKey(to) && to >= f ? to : U.addDays(f, 13);
    const now = U.now();
    const stamp = utcStamp(U.dateKey(now), now.getHours() * 60 + now.getMinutes());
    const nm = nowMin();
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Crevare//Revisions//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Crevare — révisions'];
    for (const b of schedule(f, t)) {
      if (b.done || (b.date === today && toMin(b.end) <= nm)) continue;
      const what = b.subjectName ? `${b.subjectName} — ${b.title}` : b.title;
      const desc = (b.tasks || []).map((x) => `• ${x.title}`).join('\n') || b.title;
      L.push('BEGIN:VEVENT', `UID:rev-${hash(b.id)}-${b.date.replace(/-/g, '')}@crevare`, `DTSTAMP:${stamp}`,
        `DTSTART:${utcStamp(b.date, toMin(b.start))}`, `DTEND:${utcStamp(b.date, toMin(b.end))}`,
        `SUMMARY:${icsEscape('📚 Révision · ' + what)}`, `DESCRIPTION:${icsEscape(desc + '\nPlanifié par Crevare.')}`,
        'CATEGORIES:Révisions', 'TRANSP:OPAQUE',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape('Dans 10 min : ' + what)}`, 'TRIGGER:-PT10M', 'END:VALARM',
        'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(foldLine).join('\r\n') + '\r\n';
  }

  function clearCache() { idx = { ref: null, len: -1, map: new Map() }; fallbackAgenda = null; }

  C.agenda = {
    // Contrat
    parseICS, parseBundle, sync, importText, addSource, eventsOn, busyIntervals, dayInfo, trainingSlot,
    subjectsFromEvents, detectExams, buildTasks, schedule, markBlock, icsForRevisions,
    // Compléments
    updateSource, removeSource, syncAll, rescanSubjects, updateSubject, addExam, removeExam, addTask,
    postponeBlock, skipBlock, findBlock, missedBlocks, weekStats, revision: () => revision(), setRevision, clearCache,
    typeLabel, pcCode, cleanTitle, matchSubject,
    KINDS, PC_CODES, COLORS, COLOR_LABELS, CORS_MSG,
    // Fonctions internes exposées pour les tests
    _t: {
      unfold, parseLine, parseDT, parseIcsDuration, parseRRule, expandDays, unescapeText, splitEscaped, looksHTML,
      toMin, hm, dayNum, keyOf, subtract, unionLength, generateTasks, taskPool, courseGroups, isBusy, sportInfo,
      foldLine, icsEscape, guessKind, normKind, EXAM_TEST, sigWords, subsetOf, mealCuts, DEFAULT_LUNCH,
    },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
