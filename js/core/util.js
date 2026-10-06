/* Crevare — utilitaires purs (dates, durées, texte, statistiques).
 * Aucune dépendance au DOM : chargeable tel quel dans les tests Node. */
(function (C) {
  'use strict';

  const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const DAYS_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const DAYS_ABBR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  /* ───────── Dates (clés locales AAAA-MM-JJ, jamais d'UTC) ───────── */

  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !isNaN(parseKey(k));
  function parseKey(k) {
    const [y, m, d] = String(k).split('-').map(Number);
    // Midi local : insensible aux changements d'heure.
    return new Date(y, m - 1, d, 12);
  }
  // Permet aux tests de figer « aujourd'hui ».
  let nowOverride = null;
  const now = () => (nowOverride ? new Date(nowOverride) : new Date());
  const setNow = (d) => { nowOverride = d ? new Date(d) : null; };
  const todayKey = () => dateKey(now());
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); }
  const dow = (k) => (parseKey(k).getDay() + 6) % 7; // 0 = lundi … 6 = dimanche
  const mondayOf = (k) => addDays(k, -dow(k));
  const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
  const weeksBetween = (a, b) => Math.floor(daysBetween(mondayOf(a), mondayOf(b)) / 7);
  const minKey = (a, b) => (a <= b ? a : b);
  const maxKey = (a, b) => (a >= b ? a : b);
  function range(from, to) { const out = []; for (let k = from; k <= to; k = addDays(k, 1)) out.push(k); return out; }
  const weekDays = (monday) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));

  const fmtDate = (k) => { const d = parseKey(k); return `${DAYS[dow(k)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const fmtShort = (k) => { const d = parseKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const fmtLong = (k) => { const d = parseKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtMonthYear = (k) => { const d = parseKey(k); return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`; };

  // « dans 12 jours », « dans 7 mois », « aujourd'hui », « il y a 3 jours »
  function relDays(days) {
    if (days === 0) return "aujourd'hui";
    if (days === 1) return 'demain';
    if (days === -1) return 'hier';
    const abs = Math.abs(days);
    let txt;
    if (abs < 14) txt = `${abs} jours`;
    else if (abs < 70) txt = `${Math.round(abs / 7)} semaines`;
    else txt = `${Math.round(abs / 30.44)} mois`;
    return days > 0 ? `dans ${txt}` : `il y a ${txt}`;
  }

  /* ───────── Durées ───────── */

  // 225 → "3:45" ; 3725 → "1:02:05" ; null → ""
  function formatDuration(sec, opts = {}) {
    if (sec == null || sec === '' || isNaN(sec)) return '';
    const neg = sec < 0;
    sec = Math.round(Math.abs(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const out = h || opts.forceHours ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    return neg ? `−${out}` : out;
  }

  // Saisie « chiffres seuls » : les 2 derniers chiffres = secondes, puis minutes, puis heures.
  // "345" → 225 s ; "45" → 45 s ; "10230" → 3750 s. Secondes ≥ 60 → null.
  function digitsToDuration(digits) {
    const d = String(digits ?? '').replace(/\D/g, '');
    if (!d) return null;
    const s = Number(d.slice(-2));
    const m = Number(d.slice(-4, -2) || 0);
    const h = Number(d.slice(0, -4) || 0);
    if (s >= 60 || (h > 0 && m >= 60)) return null;
    return h * 3600 + m * 60 + s;
  }
  // 225 → "345" (inverse de digitsToDuration, pour pré-remplir un champ)
  function durationToDigits(sec) {
    if (sec == null || isNaN(sec) || sec < 0) return '';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}${pad(m)}${pad(s)}` : m ? `${m}${pad(s)}` : String(s);
  }
  // Mise en forme pendant la frappe : "3" → "0:03", "345" → "3:45", "10230" → "1:02:30"
  function formatDigitsLive(digits) {
    const d = String(digits ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!d) return '';
    const s = d.slice(-2).padStart(2, '0');
    const rest = d.slice(0, -2);
    if (rest.length <= 2) return `${Number(rest || 0)}:${s}`;
    return `${Number(rest.slice(0, -2))}:${rest.slice(-2)}:${s}`;
  }

  // Analyse tolérante d'une durée saisie librement. Renvoie des secondes (≥ 0) ou null.
  // Accepte : "3:45", "1:02:30", "3'45", "3'45\"", "3m45", "3 min 45", "1h05", "1h05m30", "45s",
  // "90 s", "2 min", "1.30" / "1,30" (= 1:30), "345" (= 3:45, saisie chiffres seuls).
  function parseDuration(input) {
    if (input == null) return null;
    if (typeof input === 'number') return isFinite(input) && input >= 0 ? input : null;
    let str = String(input).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!str || str.startsWith('-') || str.startsWith('−')) return null;
    if (/^\d+$/.test(str)) return digitsToDuration(str);
    // 1.30 ou 1,30 → 1:30 (deux chiffres après le séparateur)
    let m = str.match(/^(\d+)[.,](\d{2})$/);
    if (m) { const s = Number(m[2]); return s < 60 ? Number(m[1]) * 60 + s : null; }
    // h:mm:ss ou m:ss (les composantes après la première doivent rester < 60)
    if (/^\d+(:\d{1,2}){1,2}$/.test(str)) {
      const parts = str.split(':').map(Number);
      if (parts.slice(1).some((p) => p >= 60)) return null;
      return parts.reduce((acc, p) => acc * 60 + p, 0);
    }
    // Unités explicites : h, min/m/', s/sec/"
    const re = /(\d+(?:[.,]\d+)?)\s*(h|heures?|min(?:utes?)?|mn|m|'|s(?:ec(?:ondes?)?)?|")?/g;
    let total = 0, found = false, lastUnit = null, consumed = '';
    while ((m = re.exec(str)) !== null) {
      if (!m[0].trim()) { re.lastIndex++; continue; }
      const val = Number(m[1].replace(',', '.'));
      let unit = m[2] || null;
      if (!unit) {
        // Nombre sans unité après une unité : on prend l'unité suivante (1h05 → 5 min, 3'45 → 45 s)
        unit = lastUnit === 'h' ? 'min' : lastUnit === 'min' ? 's' : null;
        if (!unit) return null;
      }
      if (/^h/.test(unit)) { total += val * 3600; lastUnit = 'h'; }
      else if (/^(min|mn|m|')/.test(unit)) { total += val * 60; lastUnit = 'min'; }
      else { total += val; lastUnit = 's'; }
      found = true;
      consumed += m[0];
    }
    if (!found) return null;
    if (consumed.replace(/\s/g, '').length !== str.replace(/\s/g, '').length) return null;
    return Math.round(total);
  }

  // Allure : secondes par km → "5:12 /km"
  const fmtPace = (secPerKm) => (secPerKm ? `${formatDuration(secPerKm)} /km` : '');

  /* ───────── Texte ───────── */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
  const plural = (n, one, many) => `${n} ${Math.abs(n) >= 2 ? many : one}`;
  const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function uid() {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* contexte non sécurisé */ }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  const fmtNum = (n, d = 1) => (n == null || isNaN(n) ? '' : String(+Number(n).toFixed(d)).replace('.', ','));
  // Lit un nombre saisi (accepte la virgule). Renvoie null si vide ou invalide.
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = Number(String(v).trim().replace(',', '.'));
    return String(v).trim() && isFinite(n) ? n : null;
  }

  /* ───────── Maths ───────── */

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = (v, d = 0) => { const f = 10 ** d; return Math.round(v * f) / f; };
  const sum = (arr) => arr.reduce((a, b) => a + (+b || 0), 0);
  const mean = (arr) => (arr.length ? sum(arr) / arr.length : null);
  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  // Régression linéaire sur des points {x, y}. Renvoie {slope, intercept} ou null (< 2 points distincts).
  function linearTrend(points) {
    const pts = points.filter((p) => isFinite(p.x) && isFinite(p.y));
    if (pts.length < 2) return null;
    const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
    let num_ = 0, den = 0;
    for (const p of pts) { num_ += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
    if (!den) return null;
    const slope = num_ / den;
    return { slope, intercept: my - slope * mx };
  }
  // Moyenne exponentielle (charge aiguë/chronique, poids lissé…)
  function ewma(values, span) {
    const a = 2 / (span + 1);
    let acc = null;
    return values.map((v) => (acc = acc == null ? v : a * v + (1 - a) * acc));
  }

  /* ───────── Objets ───────── */

  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const isObj = (o) => o != null && typeof o === 'object' && !Array.isArray(o);

  C.util = {
    DAYS, DAYS_SHORT, DAYS_ABBR, MONTHS, MONTHS_LONG,
    pad, dateKey, isKey, parseKey, now, setNow, todayKey, addDays, dow, mondayOf, daysBetween, weeksBetween,
    minKey, maxKey, range, weekDays, fmtDate, fmtShort, fmtLong, fmtMonthYear, relDays,
    formatDuration, digitsToDuration, durationToDigits, formatDigitsLive, parseDuration, fmtPace,
    esc, plural, normalize, uid, fmtNum, num,
    clamp, round, sum, mean, median, linearTrend, ewma,
    clone, isObj,
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
