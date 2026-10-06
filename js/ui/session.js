/* Crevare — écran de séance (#/seance/:id).
 * Saisie des séries selon le type de saisie (track), chrono intégré, minuteur pour les circuits,
 * sécurité apnée, choix de la piscine, fin de séance (durée, effort, douleur), résumé d'une séance terminée.
 * Les fonctions pures (sans DOM) sont exposées dans C.sessionUI._t pour les tests. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Référentiels ───────── */

  // Champs saisis par type de saisie (contrat ARCHITECTURE.md, « Types de saisie »).
  const FIELDS = { reps: ['reps'], load: ['kg', 'reps'], time: ['sec'], dist: ['m'], run: ['km', 'sec'], palier: ['palier'], cm: ['cm'], check: [] };
  const FIELD_META = {
    reps: { label: 'Répétitions', unit: 'reps', mode: 'numeric' },
    kg: { label: 'Charge', unit: 'kg', mode: 'decimal' },
    sec: { label: 'Temps', unit: '', mode: 'time' },
    m: { label: 'Distance', unit: 'm', mode: 'numeric' },
    km: { label: 'Distance', unit: 'km', mode: 'decimal' },
    palier: { label: 'Palier', unit: '', mode: 'decimal' },
    cm: { label: 'Mesure', unit: 'cm', mode: 'decimal' },
  };
  // Échelle d'effort (CR-10 de Foster, repères verbaux) — aucune valeur par défaut (biais d'ancrage).
  const RPE = [
    [1, 'très facile'], [2, 'facile'], [3, 'modéré'], [4, 'un peu dur'], [5, 'dur'],
    [6, 'dur +'], [7, 'très dur'], [8, 'très dur +'], [9, 'presque max'], [10, 'maximal'],
  ];
  const RPE_LABEL = Object.fromEntries(RPE);
  const FEELINGS = [{ value: 'facile', label: '😌 Facile' }, { value: 'ok', label: '🙂 Ok' }, { value: 'dur', label: '😮‍💨 Dur' }];
  const FEELING_LABEL = { facile: 'facile', ok: 'ok', dur: 'dur' };
  const ZONE_LABELS = { genou: 'Genou', cheville: 'Cheville', epaule: 'Épaule', dos: 'Dos', hanche: 'Hanche', poignet: 'Poignet', coude: 'Coude', nuque: 'Nuque', autre: 'Autre zone' };
  const VARIANT_LABELS = { allege: 'Version allégée', express: 'Version express', doux: 'Version douce (sans impact)' };
  const POOL_CATS = ['natation', 'apnee', 'sauvetage'];
  const SURFACE_FALLBACK = 'swim_crawl_easy';
  const SURFACE_SUFFIX = '~surface';

  /* ───────── Accès défensifs aux autres modules ───────── */

  const getEx = (id) => (C.data && C.data.getExercise ? C.data.getExercise(id) : null);
  const metricsFn = (name) => (C.metrics && typeof C.metrics[name] === 'function' ? C.metrics[name] : null);
  const timerFn = (name) => (C.timer && typeof C.timer[name] === 'function' ? C.timer[name] : null);
  const getSession = (id) => (C.sessions ? C.sessions.get(id) : (C.state.sessions || {})[id] || null);
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.error(e); return fallback; }
  }

  /* ───────── Fonctions pures : séries ───────── */

  const fieldsFor = (track) => FIELDS[track] || [];

  // Lit une valeur saisie. null = vide ; NaN = illisible.
  function parseField(f, raw) {
    const s = raw == null ? '' : String(raw).trim();
    if (!s) return null;
    if (f === 'sec') { const v = U.parseDuration(s); return v == null ? NaN : v; }
    const n = U.num(s);
    if (n == null) return NaN;
    if (f === 'cm') return n; // souplesse : une mesure négative est possible
    if (n < 0) return NaN;
    if (f === 'reps' || f === 'm') return Math.round(n);
    return n;
  }

  // Une série contient-elle au moins une mesure du jour ?
  function hasMeasure(track, set) {
    if (!set) return false;
    return fieldsFor(track).some((f) => set[f] != null && set[f] !== '' && isFinite(set[f]));
  }

  // Patch d'une série au moment du ✓. Sans valeur saisie : « faite, non mesurée » (measured:false).
  // On n'y recopie JAMAIS la valeur précédente affichée en indication.
  function setPatch(track, values, done) {
    const patch = { done: !!done };
    for (const f of fieldsFor(track)) {
      const v = values ? values[f] : null;
      patch[f] = v == null || Number.isNaN(v) ? null : v;
    }
    patch.measured = track === 'check' ? !!done : hasMeasure(track, patch);
    return patch;
  }

  // « 45 s », « 2 min », « 1 min 30 »
  function fmtRest(sec) {
    const s = Math.round(+sec || 0);
    if (s <= 0) return '';
    if (s < 60) return `${s} s`;
    return s % 60 ? `${Math.floor(s / 60)} min ${U.pad(s % 60)}` : `${s / 60} min`;
  }

  // Texte de prescription : « 3 × 8–12 · cible 40 kg · repos 1 min 30 »
  function prescription(item) {
    const parts = [];
    const sets = Number(item.sets) || 0;
    const reps = String(item.reps || '').trim();
    if (sets > 1 && reps) parts.push(`${sets} × ${reps}`);
    else if (reps) parts.push(reps);
    else if (sets) parts.push(U.plural(sets, 'série', 'séries'));
    const t = item.target || {};
    const tg = [];
    if (t.kg != null && t.kg !== '') tg.push(`${U.fmtNum(t.kg)} kg`);
    if (t.reps != null && t.reps !== '' && !reps) tg.push(`${t.reps} reps`);
    if (t.sec != null && t.sec !== '') tg.push(U.formatDuration(t.sec));
    if (t.m != null && t.m !== '' && !/\bm\b/.test(reps)) tg.push(`${t.m} m`);
    if (t.km != null && t.km !== '') tg.push(`${U.fmtNum(t.km, 2)} km`);
    if (tg.length) parts.push('cible ' + tg.join(' · '));
    const rest = fmtRest(item.rest);
    if (rest) parts.push('repos ' + rest);
    return parts.join(' · ');
  }

  // Distance d'une répétition de natation : cible en mètres, ou prescription « 100 m » / « 4 × 50 m ».
  function distanceOf(item) {
    const t = item.target || {};
    if (U.num(t.m)) return U.num(t.m);
    const m = String(item.reps || '').trim().match(/^(?:\d+\s*[×x]\s*)?(\d+)\s*m$/i);
    return m ? Number(m[1]) : null;
  }

  // « 4 longueurs », « ½ longueur », « 1 longueur ½ » pour un bassin donné.
  function lengthsText(meters, poolLength) {
    const m = U.num(meters), L = U.num(poolLength);
    if (!m || !L) return '';
    const n = m / L;
    if (Number.isInteger(n)) return U.plural(n, 'longueur', 'longueurs');
    if (Number.isInteger(n * 2)) return n < 1 ? '½ longueur' : `${Math.floor(n)} ${Math.floor(n) > 1 ? 'longueurs' : 'longueur'} ½`;
    return `${U.fmtNum(n, 1)} longueurs`;
  }

  const rowsCount = (s, item) => Math.max(Number(item.sets) || 1, ((s.log || {})[item.key] || []).length);

  // Séance de piscine : le lieu décide ; pour une séance sans lieu précis (libre), au moins un exercice
  // de natation / apnée / sauvetage.
  function isPoolSession(s) {
    if (!s) return false;
    if (s.loc === 'piscine' || s.kind === 'swim') return true;
    if (s.loc && s.loc !== 'autre') return false;
    return (s.exercises || []).some((it) => {
      if (it.apnea) return true;
      const ex = getEx(it.exId);
      return !!ex && POOL_CATS.includes(ex.cat);
    });
  }

  const isApneaItem = (it) => !!it && (it.apnea === true || !!(getEx(it.exId) || {}).apnea);
  const hasApnea = (s) => !!s && (s.exercises || []).some(isApneaItem);
  const baseKey = (key) => String(key || '').replace(SURFACE_SUFFIX, '');

  // Remplacement d'un exercice d'apnée par de la nage en surface (pas accompagné).
  // Pas de bench, pas de test : ce remplacement n'alimente jamais les tests de référence.
  function surfaceItem(item) {
    const D = C.data || {};
    let alt = null;
    const altId = D.findAlternative ? safe(() => D.findAlternative(item.exId, { noApnea: true, maxImpact: 0 }), null) : null;
    if (altId) alt = getEx(altId);
    if (!alt || alt.apnea) alt = getEx(SURFACE_FALLBACK);
    const base = alt || { id: SURFACE_FALLBACK, name: 'Crawl souple', track: 'dist', defaultReps: '', defaultRest: 30 };
    return {
      key: baseKey(item.key) + SURFACE_SUFFIX, exId: base.id, name: base.name, track: base.track,
      sets: item.sets, reps: base.defaultReps || 'en surface, souple', rest: base.defaultRest != null ? base.defaultRest : item.rest,
      note: `Remplace « ${item.name} » : l'apnée se fait uniquement accompagné.`, target: {}, impact: 0,
      skipped: !!item.skipped, replacedFrom: item.exId, replacedReason: 'apnee',
    };
  }

  // Exercices tels qu'affichés : apnée remplacée tant que l'accompagnement n'est pas confirmé.
  function effectiveItems(s) {
    return (s.exercises || []).map((it) => (isApneaItem(it) && s.apneaOk !== true ? surfaceItem(it) : it));
  }
  const findItem = (s, key) => effectiveItems(s).find((it) => it.key === key) || null;

  // Durée préremplie à la fin (min) : saisie > début réel plausible > durée prévue.
  function defaultDuration(s, nowMs) {
    if (s.durationMin) return s.durationMin;
    const m = s.startedAt ? Math.round((nowMs - s.startedAt) / 60000) : null;
    if (m != null && m >= 5 && m <= 300) return m;
    if (s.plannedMin) return s.plannedMin;
    return m != null && m >= 1 && m <= 300 ? m : null;
  }

  // Zones de blessure actives (une entrée par zone), avec côté éventuel.
  function painZones(profile) {
    const out = [];
    for (const inj of (profile && profile.injuries) || []) {
      if (!inj || inj.active === false) continue;
      const zone = inj.zone || 'autre';
      const side = String(inj.side || '').trim();
      const found = out.find((z) => z.zone === zone);
      if (found) { if (side && !found.sides.includes(side)) found.sides.push(side); continue; }
      out.push({ zone, sides: side ? [side] : [] });
    }
    return out.map((z) => ({ zone: z.zone, label: [ZONE_LABELS[z.zone] || z.zone, z.sides.join(' et ')].filter(Boolean).join(' ') }));
  }

  // Douleur ≥ 4/10 → { max, zones:[{zone, value}] } ; sinon null.
  function painAlert(pain) {
    const zones = Object.entries(pain || {}).map(([zone, v]) => ({ zone, value: U.num(v) }))
      .filter((z) => z.value != null && z.value >= 4).sort((a, b) => b.value - a.value);
    return zones.length ? { max: zones[0].value, zones } : null;
  }

  // Une série affichée : « 40 kg × 10 », « 1:45 », « 7,2 km en 38:10 (5:18 /km) »…
  function fmtSet(track, s) {
    if (!s || !s.done) return '';
    if (track === 'check') return 'fait';
    if (!hasMeasure(track, s)) return 'non mesurée';
    switch (track) {
      case 'reps': return `${U.fmtNum(s.reps, 0)}`;
      case 'load':
        if (s.kg != null && s.reps != null) return `${U.fmtNum(s.kg)} kg × ${U.fmtNum(s.reps, 0)}`;
        return s.kg != null ? `${U.fmtNum(s.kg)} kg` : `${U.fmtNum(s.reps, 0)} reps`;
      case 'time': return U.formatDuration(s.sec);
      case 'dist': return `${U.fmtNum(s.m, 0)} m`;
      case 'run': {
        const parts = [];
        if (s.km != null) parts.push(`${U.fmtNum(s.km, 2)} km`);
        if (s.sec != null) parts.push(`${s.km != null ? 'en ' : ''}${U.formatDuration(s.sec)}`);
        if (s.km > 0 && s.sec > 0) parts.push(`(${U.fmtPace(s.sec / s.km)})`);
        return parts.join(' ');
      }
      case 'palier': return `palier ${U.fmtNum(s.palier, 1)}`;
      case 'cm': return `${U.fmtNum(s.cm, 1)} cm`;
      default: return 'fait';
    }
  }

  // Résumé des séries faites d'un exercice : « 12, 10, 10 reps », « 1:45 · 1:48 · 1 série non mesurée ».
  function summarizeSets(track, sets) {
    const done = (sets || []).filter((x) => x && x.done);
    if (!done.length) return '';
    if (track === 'check') return done.length === 1 ? 'fait' : `${done.length} séries faites`;
    const vals = done.filter((x) => hasMeasure(track, x)).map((x) => fmtSet(track, x));
    const unm = done.length - vals.length;
    let txt = track === 'reps' && vals.length ? `${vals.join(', ')} reps` : vals.join(' · ');
    if (unm) txt += `${txt ? ' · ' : ''}${U.plural(unm, 'série non mesurée', 'séries non mesurées')}`;
    return txt;
  }

  // Séries faites / prévues (exercices passés exclus).
  function progressCount(s) {
    let done = 0, total = 0;
    for (const it of effectiveItems(s)) {
      if (it.skipped) continue;
      const sets = (s.log || {})[it.key] || [];
      total += rowsCount(s, it);
      done += sets.filter((x) => x && x.done).length;
    }
    return { done, total };
  }

  // Dernière performance mesurée de cet exercice dans une autre séance terminée (repli si C.metrics manque).
  function localPrev(sessions, exId, current) {
    let best = null;
    for (const s of Object.values(sessions || {})) {
      if (!s || s.status !== 'done' || s.id === current.id || s.date > current.date) continue;
      for (const it of s.exercises || []) {
        if (it.exId !== exId) continue;
        const sets = ((s.log || {})[it.key] || []).filter((x) => x && x.done && x.measured !== false && hasMeasure(it.track, x));
        if (!sets.length) continue;
        const rank = `${s.date}|${String(s.finishedAt || 0).padStart(15, '0')}`;
        if (!best || rank > best.rank) best = { rank, date: s.date, sessionId: s.id, sets };
      }
    }
    return best ? { date: best.date, sessionId: best.sessionId, sets: best.sets } : null;
  }

  // Normalise une entrée d'historique venant de C.metrics (forme tolérante).
  function normPrev(p, current) {
    if (!p || !Array.isArray(p.sets) || p.sessionId === current.id) return null;
    const sets = p.sets.filter((x) => x && x.done !== false && x.measured !== false);
    return sets.length ? { date: p.date || null, sessionId: p.sessionId || null, sets } : null;
  }

  // Version douce conseillée ce jour-là (douleur ≥ 4 notée les jours précédents, proposition acceptée).
  function softAdvice(sessions, date, excludeId) {
    let found = null;
    for (const s of Object.values(sessions || {})) {
      if (!s || s.id === excludeId || s.status !== 'done' || !s.softUntil) continue;
      if (s.date >= date || s.softUntil < date) continue;
      if (!found || s.date > found.from) found = { from: s.date, until: s.softUntil, alert: painAlert(s.pain) };
    }
    return found;
  }

  // Champs enregistrés à la fin de la séance, à partir des valeurs du formulaire.
  function finishFields(v, s, nowMs) {
    const out = { status: 'done', finishedAt: nowMs };
    const d = U.num(v.duration);
    out.durationMin = d != null && d > 0 ? U.clamp(Math.round(d), 1, 600) : null;
    const r = U.num(v.rpe);
    out.rpe = r != null && r >= 1 && r <= 10 ? Math.round(r) : null;
    out.feeling = FEELING_LABEL[v.feeling] ? v.feeling : null;
    out.pain = {};
    for (const [zone, val] of Object.entries(v.pain || {})) {
      const n = U.num(val);
      if (n != null && n >= 0 && n <= 10) out.pain[zone] = Math.round(n);
    }
    out.notes = String(v.notes || '').trim().slice(0, 2000);
    const hr = U.num(v.hr), kcal = U.num(v.kcal), km = U.num(v.km);
    const watch = {
      hrAvg: hr != null && hr >= 30 && hr <= 230 ? Math.round(hr) : null,
      kcal: kcal != null && kcal >= 0 && kcal < 10000 ? Math.round(kcal) : null,
      distanceKm: km != null && km > 0 && km < 500 ? U.round(km, 2) : null,
    };
    out.watch = Object.values(watch).some((x) => x != null) ? watch : null;
    if (!s.startedAt) out.startedAt = out.durationMin ? nowMs - out.durationMin * 60000 : nowMs;
    // Apnée non confirmée : le remplacement par la nage en surface devient définitif (pas de test alimenté).
    if (hasApnea(s) && s.apneaOk !== true) out.exercises = effectiveItems(s);
    return out;
  }

  // Remplacement d'un exercice par un autre de la bibliothèque (nouvelle clé : pas de mélange d'historique).
  function replacementItem(item, ex, stamp) {
    return {
      key: `${ex.id}#r${stamp}`, exId: ex.id, name: ex.name, track: ex.track,
      sets: item.sets || ex.defaultSets || 3, reps: ex.defaultReps || item.reps || '', rest: item.rest != null ? item.rest : ex.defaultRest,
      note: `Remplace « ${item.name} ».`, target: {}, apnea: !!ex.apnea, impact: ex.impact || 0, replacedFrom: item.exId,
    };
  }

  /* ───────── Rendu ───────── */

  // État d'affichage conservé entre deux rendus (consignes dépliées, piscine déjà demandée).
  const openCues = new Set();
  const poolAsked = new Set();
  let pendingPoolAsk = null;

  function placeholderFor(f, prev, i) {
    if (!prev || !prev.sets.length) return null;
    const s = prev.sets[i] || prev.sets[prev.sets.length - 1];
    const v = s ? s[f] : null;
    return v == null || v === '' || !isFinite(v) ? null : v;
  }

  function fieldHTML(s, item, idx, i, f, set, prev) {
    const meta = FIELD_META[f];
    const id = `ses-${idx}-${i}-${f}`;
    const label = `${meta.label}, série ${i + 1}`;
    const ph = placeholderFor(f, prev, i);
    if (meta.mode === 'time') {
      const input = C.ui.timeInput({
        id, label, value: set[f], placeholder: ph != null ? ph : (item.target && item.target.sec) || null,
        data: { input: 'seance.champ', id: s.id, k: item.key, i, f }, cls: 'ses-in ses-in-time',
      });
      const chrono = `<button type="button" class="icon-btn ses-sw-btn" data-action="seance.chrono" data-id="${esc(s.id)}" data-k="${esc(item.key)}" data-i="${esc(i)}" aria-label="Chronométrer la série ${esc(i + 1)}">⏱</button>`;
      return `<span class="ses-f ses-f-time">${input}${chrono}</span>`;
    }
    const val = set[f] != null && set[f] !== '' ? U.fmtNum(set[f], f === 'km' ? 2 : 1) : '';
    const tgt = item.target && item.target[f] != null ? item.target[f] : null;
    const phv = ph != null ? ph : tgt;
    const sign = f === 'cm' ? `<button type="button" class="icon-btn small ses-sign" data-action="seance.signe" data-for="${esc(id)}" aria-label="Changer le signe">±</button>` : '';
    return `<span class="ses-f">
      <input type="text" id="${esc(id)}" class="ses-in" inputmode="${meta.mode}" autocomplete="off" enterkeyhint="done"
        data-input="seance.champ" data-id="${esc(s.id)}" data-k="${esc(item.key)}" data-i="${esc(i)}" data-f="${esc(f)}"
        value="${esc(val)}" placeholder="${esc(phv != null ? U.fmtNum(phv, f === 'km' ? 2 : 1) : '')}" aria-label="${esc(label)}">
      ${meta.unit ? `<span class="ses-unit" aria-hidden="true">${esc(meta.unit)}</span>` : ''}${sign}</span>`;
  }

  function setRowHTML(s, item, idx, i, prev) {
    const set = ((s.log || {})[item.key] || [])[i] || {};
    const fields = fieldsFor(item.track);
    const done = !!set.done;
    const unmeasured = done && item.track !== 'check' && !hasMeasure(item.track, set);
    return `<div class="ses-set ${done ? 'is-done' : ''}">
      <span class="ses-set-n" aria-hidden="true">${esc(i + 1)}</span>
      <div class="ses-fields">${fields.length ? fields.map((f) => fieldHTML(s, item, idx, i, f, set, prev)).join('')
        : `<span class="muted small">Série ${esc(i + 1)}</span>`}
        ${unmeasured ? '<span class="pill ses-unm">faite, non mesurée</span>' : ''}</div>
      <button type="button" class="ses-check" id="ses-${esc(idx)}-${esc(i)}-ok" data-action="seance.serie" data-id="${esc(s.id)}" data-k="${esc(item.key)}" data-i="${esc(i)}"
        aria-pressed="${done}" aria-label="${done ? 'Annuler la validation de' : 'Valider'} la série ${esc(i + 1)}">✓</button>
    </div>`;
  }

  // Dernière performance (C.metrics si dispo, sinon calcul local) et suggestion de progression.
  function prevAndSuggest(s, item) {
    let prev = null;
    const last = metricsFn('lastPerformance');
    if (last) prev = normPrev(safe(() => last(item.exId, s.date), null), s);
    if (!prev) prev = localPrev(C.state.sessions, item.exId, s);
    let suggest = null;
    const sug = metricsFn('suggestNext');
    if (sug && !item.replacedReason) {
      const histFn = metricsFn('exerciseHistory');
      const hist = histFn ? safe(() => histFn(item.exId, { limit: 6 }), []) : [];
      const r = safe(() => sug(item, hist || []), null);
      if (r && r.text) suggest = String(r.text);
    }
    return { prev, suggest };
  }

  function exerciseCardHTML(s, item, idx, poolLen) {
    const ex = getEx(item.exId);
    const sets = (s.log || {})[item.key] || [];
    const n = rowsCount(s, item);
    const doneN = sets.filter((x) => x && x.done).length;
    const complete = doneN >= n;
    const cuesKey = `${s.id}|${item.key}`;
    const dist = poolLen ? distanceOf(item) : null;
    const lengths = dist ? lengthsText(dist, poolLen) : '';
    const { prev, suggest } = item.skipped ? { prev: null, suggest: null } : prevAndSuggest(s, item);
    const prevTxt = prev ? summarizeSets(item.track, prev.sets) : '';
    const hasCues = ex && (ex.description || ex.cues.length || ex.mistakes.length || ex.safety.length);
    const timerOk = item.timer && timerFn('open');
    const isSurface = item.replacedReason === 'apnee';
    const canReplace = !isSurface && ex && (ex.alt.length || ex.easier.length || ex.harder.length);
    const loggedDone = sets.some((x) => x && x.done);

    const head = `<div class="ses-ex-head">
      <div class="grow">
        <h3 class="ses-ex-name">${esc(item.name || (ex && ex.name) || 'Exercice')}</h3>
        <p class="ses-presc small">${esc(prescription(item))}</p>
        ${lengths ? `<p class="tiny ses-lengths">= ${esc(lengths)} (bassin de ${esc(poolLen)} m)</p>` : ''}
      </div>
      <span class="pill ${complete ? 'ok' : ''} num" aria-label="${esc(doneN)} séries faites sur ${esc(n)}">${esc(doneN)}/${esc(n)}</span>
    </div>`;

    if (item.skipped) {
      return `<article class="card ses-ex is-skipped" id="ses-ex-${esc(idx)}">${head}
        <p class="muted small">Exercice passé.</p>
        <div class="ses-ex-actions"><button type="button" class="btn ghost small" data-action="seance.passer" data-id="${esc(s.id)}" data-k="${esc(item.key)}">Reprendre</button></div></article>`;
    }

    const badges = [
      item.test && !isSurface ? '<span class="pill warn">📏 Test : compte comme référence</span>' : '',
      isSurface ? '<span class="pill">🫧 Apnée remplacée par de la nage en surface</span>' : '',
      item.apnea && !isSurface ? '<span class="pill warn">🫧 Apnée : accompagné seulement</span>' : '',
    ].filter(Boolean).join('');

    const cues = hasCues ? `<details class="ses-cues" data-cues="${esc(cuesKey)}" ${openCues.has(cuesKey) ? 'open' : ''}>
      <summary>Consignes</summary>
      ${ex.description ? `<p class="small">${esc(ex.description)}</p>` : ''}
      ${ex.cues.length ? `<ul class="small">${ex.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${ex.mistakes.length ? `<p class="small"><b>À éviter :</b> ${esc(ex.mistakes.join(' '))}</p>` : ''}
      ${ex.safety.length ? `<div class="note warn small">${ex.safety.map((c) => `<p>${esc(c)}</p>`).join('')}</div>` : ''}
      <a class="link small" href="#/exercice/${esc(encodeURIComponent(ex.id))}">Fiche complète</a>
    </details>` : '';

    const timerBtn = timerOk ? `<button type="button" class="btn ghost block ses-timer" data-action="seance.minuteur" data-id="${esc(s.id)}" data-k="${esc(item.key)}">▶ Lancer le minuteur</button>` : '';

    return `<article class="card ses-ex ${complete ? 'is-complete' : ''}" id="ses-ex-${esc(idx)}">
      ${head}
      ${item.note ? `<p class="note small">${esc(item.note)}</p>` : ''}
      ${badges ? `<div class="row wrap gap ses-badges">${badges}</div>` : ''}
      ${cues}
      ${prevTxt ? `<p class="tiny muted ses-prev">Dernière fois${prev.date ? ` (${esc(U.fmtShort(prev.date))})` : ''} : ${esc(prevTxt)}</p>` : ''}
      ${suggest ? `<p class="tiny ses-suggest">💡 ${esc(suggest)}</p>` : ''}
      ${timerBtn}
      <div class="ses-sets">${Array.from({ length: n }, (_, i) => setRowHTML(s, item, idx, i, prev)).join('')}</div>
      <div class="ses-ex-actions">
        <button type="button" class="btn ghost small" data-action="seance.plus-serie" data-id="${esc(s.id)}" data-k="${esc(item.key)}">+ Série</button>
        ${canReplace ? `<button type="button" class="btn ghost small" data-action="seance.remplacer" data-id="${esc(s.id)}" data-k="${esc(item.key)}">Remplacer</button>` : ''}
        <button type="button" class="btn ghost small" data-action="seance.passer" data-id="${esc(s.id)}" data-k="${esc(item.key)}">Passer</button>
        ${!loggedDone && !isSurface ? `<button type="button" class="btn ghost small danger" data-action="seance.retirer" data-id="${esc(s.id)}" data-k="${esc(item.key)}" aria-label="Retirer ${esc(item.name)} de la séance">Retirer</button>` : ''}
      </div>
    </article>`;
  }

  function headerHTML(s) {
    const variant = VARIANT_LABELS[s.variant];
    const today = U.todayKey();
    return `<header class="top ses-top">
      <button type="button" class="back ses-back" data-action="seance.retour">‹ Retour</button>
      <h1>${esc(s.title || 'Séance')}</h1>
      <div class="row wrap gap">
        ${C.ui.locBadge(s.loc)}${C.ui.goalTags(s.goals)}
        ${variant ? `<span class="pill">${esc(variant)}</span>` : ''}
        ${s.plannedMin ? `<span class="pill num">≈ ${esc(s.plannedMin)} min</span>` : ''}
        ${s.date !== today ? `<span class="pill">${esc(U.fmtDate(s.date))}</span>` : ''}
      </div>
    </header>`;
  }

  function poolLineHTML(s) {
    const pool = ((C.state.profile || {}).pools || []).find((p) => p.id === s.poolId);
    const label = pool ? `${pool.name} · bassin de ${pool.length} m` : s.poolLength ? `Bassin de ${s.poolLength} m` : '';
    return `<div class="ses-pool-line row between gap">
      <span class="small">🏊 ${label ? esc(label) : '<span class="warn-text">Piscine à choisir</span>'}</span>
      <button type="button" class="btn ghost small" data-action="seance.piscine" data-id="${esc(s.id)}">${label ? 'Changer' : 'Choisir'}</button>
    </div>`;
  }

  function apneaCardHTML(s) {
    const buddy = String((C.state.profile || {}).apneaBuddy || '').trim();
    if (s.apneaOk === true) {
      return `<div class="note ok small ses-apnea-ok">🫧 Apnée : tu as confirmé être accompagné. Jamais d'hyperventilation, récupère au moins 2 fois la durée de l'apnée (60 s minimum), arrête au moindre signe.
        <button type="button" class="link" data-action="seance.apnee" data-id="${esc(s.id)}" data-v="non">Je ne suis plus accompagné</button></div>`;
    }
    if (s.apneaOk === false) {
      return `<div class="note small">🫧 Apnée remplacée par de la nage en surface (pas d'accompagnement).
        <button type="button" class="link" data-action="seance.apnee" data-id="${esc(s.id)}" data-v="oui">Je suis accompagné finalement</button></div>`;
    }
    return `<section class="card ses-apnea" aria-labelledby="ses-apnea-t">
      <h2 id="ses-apnea-t">🫧 Cette séance contient de l'apnée</h2>
      <p class="small">L'apnée se pratique uniquement sous surveillance : la syncope peut arriver sans prévenir, même entraîné.</p>
      <ul class="small">
        <li>Jamais d'hyperventilation : 1 à 2 inspirations normales avant de partir.</li>
        <li>Récupère au moins 2 fois la durée de l'apnée, 60 s minimum.</li>
        <li>Arrêt immédiat au moindre signe : picotements, vision qui se trouble, envie irrépressible de respirer.</li>
      </ul>
      <div class="col gap">
        <button type="button" class="btn block" data-action="seance.apnee" data-id="${esc(s.id)}" data-v="oui">Je suis accompagné${buddy ? ` (${esc(buddy)})` : ' (club, binôme ou MNS au bord)'}</button>
        <button type="button" class="btn ghost block" data-action="seance.apnee" data-id="${esc(s.id)}" data-v="non">Je suis seul : nage en surface</button>
      </div>
      <p class="tiny muted">Sans confirmation, les exercices d'apnée sont remplacés par de la nage en surface.</p>
    </section>`;
  }

  function softCardHTML(s) {
    if (s.status !== 'in_progress' || s.variant === 'doux') return '';
    const adv = softAdvice(C.state.sessions, s.date, s.id);
    if (!adv) return '';
    const anyLogged = Object.values(s.log || {}).some((sets) => (sets || []).some((x) => x && x.done));
    const canSwitch = s.templateId && s.source === 'plan' && !anyLogged && C.planner && typeof C.planner.instantiate === 'function';
    const z = adv.alert && adv.alert.zones[0];
    return `<div class="note warn ses-soft">
      <p class="small">Douleur notée le ${esc(U.fmtShort(adv.from))}${z ? ` (${esc((ZONE_LABELS[z.zone] || z.zone).toLowerCase())} ${esc(z.value)}/10)` : ''} : la version douce est conseillée jusqu'au ${esc(U.fmtShort(adv.until))}.</p>
      ${canSwitch ? `<button type="button" class="btn small" data-action="seance.version-douce" data-id="${esc(s.id)}">Passer en version douce</button>` : ''}
    </div>`;
  }

  function startLineHTML(s) {
    if (s.startedAt) {
      const d = new Date(s.startedAt);
      return `<p class="small muted ses-started">Commencée à ${esc(U.pad(d.getHours()))}:${esc(U.pad(d.getMinutes()))}${s.date !== U.dateKey(d) ? ` le ${esc(U.fmtShort(U.dateKey(d)))}` : ''}</p>`;
    }
    return `<button type="button" class="btn block ses-start" data-action="seance.demarrer" data-id="${esc(s.id)}">▶ Démarrer la séance</button>`;
  }

  function viewInProgress(s) {
    const items = effectiveItems(s);
    const pool = isPoolSession(s);
    const poolLen = pool ? s.poolLength : null;
    const { done, total } = progressCount(s);
    const safety = (s.safety || []).filter(Boolean);
    return `${headerHTML(s)}
      <div class="ses-status row between gap">
        <span class="small muted">${esc(done)}/${esc(total)} séries</span>
        <button type="button" class="btn ghost small" data-action="seance.terminer" data-id="${esc(s.id)}">Terminer</button>
      </div>
      <div class="ses-progress" role="progressbar" aria-label="Séries faites" aria-valuemin="0" aria-valuemax="${esc(total)}" aria-valuenow="${esc(done)}">
        <span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>
      ${softCardHTML(s)}
      ${s.intro ? `<p class="ses-intro">${esc(s.intro)}</p>` : ''}
      ${safety.length ? `<div class="note warn small ses-safety">${safety.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
      ${hasApnea(s) ? apneaCardHTML(s) : ''}
      ${pool ? poolLineHTML(s) : ''}
      ${startLineHTML(s)}
      ${items.length ? items.map((it, idx) => exerciseCardHTML(s, it, idx, poolLen)).join('')
        : C.ui.empty('Aucun exercice pour l\'instant', 'Ajoute des exercices depuis la bibliothèque.')}
      <button type="button" class="btn ghost block mt" data-action="seance.ajouter" data-id="${esc(s.id)}">+ Ajouter un exercice</button>
      <button type="button" class="btn block mt" data-action="seance.terminer" data-id="${esc(s.id)}">Terminer la séance</button>
      <p class="tiny muted center mt">Une série validée sans valeur est notée « faite, non mesurée ».</p>`;
  }

  function viewDone(s) {
    const items = s.exercises || [];
    const dur = C.sessions ? C.sessions.durationOf(s) : s.durationMin;
    const pool = ((C.state.profile || {}).pools || []).find((p) => p.id === s.poolId);
    const loadFn = metricsFn('sessionLoad');
    const load = loadFn ? safe(() => loadFn(s), null) : (dur && s.rpe ? dur * s.rpe : null);
    const zones = Object.entries(s.pain || {});
    const w = s.watch || null;
    const stats = [
      dur ? ['Durée', `${dur} min`] : null,
      s.rpe ? ['Effort', `${s.rpe}/10 · ${RPE_LABEL[s.rpe] || ''}`] : null,
      s.feeling ? ['Ressenti', FEELING_LABEL[s.feeling]] : null,
      load ? ['Charge', `${Math.round(load)}`] : null,
      pool ? ['Piscine', `${pool.name} (${pool.length} m)`] : s.poolLength ? ['Bassin', `${s.poolLength} m`] : null,
      w && w.hrAvg ? ['FC moyenne', `${w.hrAvg} bpm`] : null,
      w && w.kcal ? ['Calories', `${w.kcal} kcal`] : null,
      w && w.distanceKm ? ['Distance (montre)', `${U.fmtNum(w.distanceKm, 2)} km`] : null,
    ].filter(Boolean);
    const skipped = s.status === 'skipped';
    return `${headerHTML(s)}
      <section class="card ses-done">
        <p class="ses-done-title">${skipped ? 'Séance marquée comme non faite' : `✓ Séance terminée · ${esc(U.fmtDate(s.date))}`}</p>
        ${stats.length ? `<dl class="ses-stats">${stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${zones.length ? `<p class="small">Douleur : ${zones.map(([z, v]) => `${esc(ZONE_LABELS[z] || z)} ${esc(v)}/10`).join(' · ')}</p>` : ''}
        ${s.notes ? `<p class="small ses-notes">${esc(s.notes)}</p>` : ''}
        ${!skipped && !s.rpe ? '<p class="tiny muted">Effort non noté : cette séance ne compte pas dans la charge de la semaine.</p>' : ''}
      </section>
      ${items.length ? `<section class="card"><h3>Exercices</h3><ul class="ses-sum">${items.map((it) => {
        const sum = it.skipped ? 'passé' : summarizeSets(it.track, (s.log || {})[it.key]);
        const ex = getEx(it.exId);
        const name = ex ? `<a href="#/exercice/${esc(encodeURIComponent(it.exId))}">${esc(it.name)}</a>` : esc(it.name);
        return `<li><b>${name}</b><span class="small ${sum ? '' : 'muted'}">${esc(sum || 'non fait')}</span></li>`;
      }).join('')}</ul></section>` : ''}
      <div class="row gap wrap mt">
        <button type="button" class="btn ghost" data-action="seance.rouvrir" data-id="${esc(s.id)}">Rouvrir</button>
        <button type="button" class="btn ghost danger" data-action="seance.supprimer" data-id="${esc(s.id)}">Supprimer</button>
      </div>`;
  }

  function view(params) {
    const s = getSession(params.id);
    if (!s) {
      return `<header class="top"><button type="button" class="back ses-back" data-action="seance.retour">‹ Retour</button><h1>Séance</h1></header>
        ${C.ui.empty('Séance introuvable', 'Elle a peut-être été supprimée.', '<a class="btn" href="#/">Revenir à aujourd\'hui</a>')}`;
    }
    const html = s.status === 'in_progress' ? viewInProgress(s) : viewDone(s);
    return {
      html,
      after($app) {
        // Mémorise les consignes dépliées pour les garder ouvertes après un nouveau rendu.
        $app.querySelectorAll('details[data-cues]').forEach((d) => d.addEventListener('toggle', () => {
          if (d.open) openCues.add(d.dataset.cues); else openCues.delete(d.dataset.cues);
        }));
        if (pendingPoolAsk === s.id) { pendingPoolAsk = null; setTimeout(() => openPoolSheet(s.id), 0); }
      },
    };
  }

  /* ───────── Piscine ───────── */

  function openPoolSheet(sid, opts = {}) {
    const s = getSession(sid);
    if (!s) return;
    poolAsked.add(sid);
    const pools = (C.state.profile || {}).pools || [];
    const list = pools.map((p) => `<button type="button" class="ses-pool ${p.id === s.poolId ? 'is-on' : ''}" data-action="seance.piscine-choix"
        data-id="${esc(sid)}" data-pool="${esc(p.id)}" aria-pressed="${p.id === s.poolId}">
        <b>${esc(p.name)}</b><span class="small muted">Bassin de ${esc(p.length)} m</span></button>`).join('');
    const form = `<form data-form="seance.piscine-new" data-id="${esc(sid)}" class="ses-pool-form">
      <label class="field"><span>Nom de la piscine</span><input name="name" required maxlength="60" autocomplete="off" placeholder="Ex. piscine municipale"></label>
      <div class="field"><span>Longueur du bassin</span>${C.ui.segmented('length', [{ value: 25, label: '25 m' }, { value: 50, label: '50 m' }], 25)}</div>
      <button class="btn block" type="submit">Enregistrer et choisir</button></form>`;
    C.ui.openModal({
      title: opts.finish ? 'Dans quelle piscine as-tu nagé ?' : 'Dans quelle piscine nages-tu ?',
      body: `<p class="small muted">Pour compter tes longueurs et comparer tes temps d'un bassin à l'autre.</p>
        ${pools.length ? `<div class="ses-pools">${list}</div><details class="mt"><summary>Ajouter une autre piscine</summary>${form}</details>` : form}
        <button type="button" class="btn ghost block mt" data-close>Plus tard</button>`,
    });
  }

  function choosePool(sid, poolId) {
    const pool = ((C.state.profile || {}).pools || []).find((p) => p.id === poolId);
    if (!pool) return;
    C.ui.closeModal();
    C.sessions.patch(sid, { poolId: pool.id, poolLength: pool.length });
    C.ui.toast(`🏊 ${pool.name} · ${pool.length} m`);
  }

  /* ───────── Chrono intégré ───────── */

  const sw = { t0: 0, acc: 0, run: false, laps: [], tick: null, target: null };
  const swNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const swElapsed = () => sw.acc + (sw.run ? swNow() - sw.t0 : 0);
  // 83 400 ms → « 1:23,4 »
  function fmtMs(ms) {
    const t = Math.max(0, Math.floor(ms / 100));
    return `${U.formatDuration(Math.floor(t / 10))},${t % 10}`;
  }
  function swPaint() {
    const el = document.getElementById('ses-sw-time');
    if (el) el.textContent = fmtMs(swElapsed());
  }
  function swButtons() {
    const t = document.getElementById('ses-sw-toggle');
    if (t) { t.textContent = sw.run ? 'Arrêter' : sw.acc ? 'Reprendre' : 'Démarrer'; t.classList.toggle('ghost', sw.run); }
    const lap = document.getElementById('ses-sw-lap');
    if (lap) lap.disabled = !sw.run;
    const use = document.getElementById('ses-sw-use');
    if (use) use.disabled = sw.run || swElapsed() < 1000;
    const laps = document.getElementById('ses-sw-laps');
    if (laps) {
      laps.innerHTML = sw.laps.map((ms, k) => `<li><span>Tour ${esc(k + 1)}</span><span class="num">${esc(fmtMs(ms - (sw.laps[k - 1] || 0)))}</span><span class="num muted">${esc(fmtMs(ms))}</span></li>`).join('');
    }
  }
  function swStop() {
    clearInterval(sw.tick); sw.tick = null;
    sw.run = false; sw.acc = 0; sw.laps = []; sw.target = null;
    if (C.audio && C.audio.wakeLock && C.audio.wakeLock.release) safe(() => C.audio.wakeLock.release());
  }
  function openStopwatch(target) {
    swStop();
    sw.target = target;
    C.ui.openModal({
      title: `Chrono · série ${target.i + 1}`,
      body: `<div class="ses-sw">
        <p class="small muted ses-sw-name">${esc(target.name)}</p>
        <div id="ses-sw-time" class="ses-sw-time num" role="timer" aria-live="off">0:00,0</div>
        <div class="ses-sw-btns">
          <button type="button" class="btn" id="ses-sw-toggle" data-action="seance.sw-toggle">Démarrer</button>
          <button type="button" class="btn ghost" id="ses-sw-lap" data-action="seance.sw-lap" disabled>Tour</button>
        </div>
        <ol id="ses-sw-laps" class="ses-sw-laps"></ol>
        <button type="button" class="btn block" id="ses-sw-use" data-action="seance.sw-use" disabled>Valider la série avec ce temps</button>
        <button type="button" class="btn ghost block mt" data-action="seance.sw-reset">Remettre à zéro</button>
      </div>`,
      onClose: swStop,
    });
  }

  /* ───────── Actions ───────── */

  function afterSetDone(s, item, i) {
    if (isPoolSession(s) && !s.poolId && !poolAsked.has(s.id)) { setTimeout(() => openPoolSheet(s.id), 0); return; }
    const rest = timerFn('rest');
    if (!rest || !(item.rest > 0)) return;
    const items = effectiveItems(s).filter((it) => !it.skipped);
    const pos = items.findIndex((it) => it.key === item.key);
    const n = rowsCount(s, item);
    let label = 'Repos';
    if (i + 1 < n) label = `Repos · série ${i + 2}`;
    else if (pos >= 0 && items[pos + 1]) label = `Repos · ensuite : ${items[pos + 1].name}`;
    else return; // dernière série de la séance : pas de repos
    safe(() => rest(item.rest, label));
  }

  // Modifie la liste des exercices d'une séance (clé de base : un exercice d'apnée remplacé garde sa clé d'origine).
  function editItems(sid, fn) {
    C.store.update((st) => {
      const s = st.sessions[sid];
      if (!s) return;
      s.exercises = fn(s.exercises.slice()) || s.exercises;
    });
  }

  function markAllDone(sid, key, result) {
    if (result && (result.completed === false || result.aborted === true)) {
      C.ui.toast('Minuteur arrêté avant la fin : coche les séries faites.');
      return;
    }
    const s = getSession(sid);
    const item = s && findItem(s, key);
    if (!item) return;
    const n = rowsCount(s, item);
    C.store.update((st) => {
      const ss = st.sessions[sid];
      if (!ss) return;
      if (!ss.startedAt) ss.startedAt = Date.now();
      const sets = (ss.log[key] ||= []);
      for (let i = 0; i < n; i++) {
        const cur = sets[i] || {};
        if (!cur.done) sets[i] = { ...cur, done: true, measured: item.track === 'check' ? true : hasMeasure(item.track, cur) };
      }
    });
    C.ui.toast('✓ Séries cochées');
  }

  function finishSheetHTML(s) {
    const dur = defaultDuration(s, Date.now());
    const zones = painZones(C.state.profile);
    const pools = (C.state.profile || {}).pools || [];
    const pool = isPoolSession(s);
    const w = s.watch || {};
    const poolBlock = !pool ? '' : pools.length ? `<fieldset class="ses-fs ${s.poolId ? '' : 'ses-attn'}"><legend>Piscine${s.poolId ? '' : ' — laquelle ?'}</legend>
        ${C.ui.segmented('poolId', pools.map((p) => ({ value: p.id, label: `${p.name} · ${p.length} m` })), s.poolId)}</fieldset>`
      : `<fieldset class="ses-fs ses-attn"><legend>Piscine — laquelle ?</legend>
        <label class="field"><span>Nom</span><input name="poolName" maxlength="60" autocomplete="off" placeholder="Ex. piscine municipale"></label>
        ${C.ui.segmented('poolLen', [{ value: 25, label: '25 m' }, { value: 50, label: '50 m' }], null)}</fieldset>`;
    const painBlock = zones.map((z) => `<fieldset class="ses-fs"><legend>Douleur · ${esc(z.label)} (0 = aucune)</legend>
        <div class="ses-scale ses-pain">${Array.from({ length: 11 }, (_, n) => `<label class="ses-chip ses-p${n <= 2 ? 'ok' : n <= 5 ? 'warn' : 'bad'}">
          <input type="radio" name="pain_${esc(z.zone)}" value="${n}" ${s.pain && s.pain[z.zone] === n ? 'checked' : ''}><span><b>${n}</b></span></label>`).join('')}</div></fieldset>`).join('');
    return `<form data-form="seance.fin" data-id="${esc(s.id)}" class="ses-finish">
      ${poolBlock}
      <label class="field"><span>Durée (minutes, échauffement compris)</span>
        <input name="duration" type="text" inputmode="numeric" autocomplete="off" value="${esc(dur || '')}" placeholder="ex. 60"></label>
      <fieldset class="ses-fs"><legend>Effort ressenti sur toute la séance</legend>
        <div class="ses-scale ses-rpe">${RPE.map(([n, label]) => `<label class="ses-chip">
          <input type="radio" name="rpe" value="${n}" ${s.rpe === n ? 'checked' : ''}><span><b>${n}</b><small>${esc(label)}</small></span></label>`).join('')}</div>
      </fieldset>
      <fieldset class="ses-fs"><legend>Ressenti général</legend>${C.ui.segmented('feeling', FEELINGS, s.feeling)}</fieldset>
      ${painBlock}
      <label class="field"><span>Notes</span><textarea name="notes" rows="3" maxlength="2000" placeholder="Sensations, matériel, ce qui a changé…">${esc(s.notes || '')}</textarea></label>
      <details class="ses-watch"><summary>Données Apple Watch (facultatif)</summary>
        <div class="ses-watch-grid">
          <label class="field"><span>FC moyenne (bpm)</span><input name="hr" type="text" inputmode="numeric" autocomplete="off" value="${esc(w.hrAvg != null ? w.hrAvg : '')}"></label>
          <label class="field"><span>Calories (kcal)</span><input name="kcal" type="text" inputmode="numeric" autocomplete="off" value="${esc(w.kcal != null ? w.kcal : '')}"></label>
          <label class="field"><span>Distance (km)</span><input name="km" type="text" inputmode="decimal" autocomplete="off" value="${esc(w.distanceKm != null ? U.fmtNum(w.distanceKm, 2) : '')}"></label>
        </div>
      </details>
      <button class="btn block mt" type="submit">Enregistrer la séance</button>
    </form>`;
  }

  function painSheet(sid, alert) {
    const z = alert.zones.map((x) => `${(ZONE_LABELS[x.zone] || x.zone).toLowerCase()} (${x.value}/10)`).join(', ');
    C.ui.openModal({
      title: 'Prends soin de toi',
      body: `<p>Tu as noté une douleur : ${esc(z)}. Merci de l'avoir signalé, c'est ce qui permet d'adapter la suite.</p>
        <ul class="small">
          <li>Je te propose la <b>version douce</b> pendant les 3 prochains jours : pas de sauts ni de course, remplacés par du vélo, de la natation ou du renforcement léger.</li>
          <li>Pendant l'effort, une gêne jusqu'à 2 ou 3/10 reste acceptable. Au-delà, ou si elle augmente, arrête l'exercice.</li>
          <li>Si la douleur dure plus de quelques jours, augmente, gêne la marche ou te réveille la nuit, consulte un médecin ou un kinésithérapeute.</li>
        </ul>
        <p class="tiny muted">Repères généraux, pas un avis médical.</p>
        <div class="col gap mt">
          <button type="button" class="btn block" data-action="seance.doux-oui" data-id="${esc(sid)}">Oui, version douce 3 jours</button>
          <button type="button" class="btn ghost block" data-close>Non merci</button>
        </div>`,
    });
  }

  function register() {
    C.route('#/seance/:id', view, { tab: '#/plan', title: 'Séance' });

    C.action('seance.retour', () => C.back('#/'));

    C.action('seance.demarrer', (el) => {
      const sid = el.dataset.id;
      const s = getSession(sid);
      if (!s) return;
      // La feuille « quelle piscine ? » s'ouvre après le rendu (voir after()).
      if (isPoolSession(s) && !s.poolId) pendingPoolAsk = sid;
      C.sessions.patch(sid, { startedAt: Date.now() });
      C.ui.toast('C\'est parti 💪');
    });

    C.action('seance.apnee', (el) => {
      C.sessions.patch(el.dataset.id, { apneaOk: el.dataset.v === 'oui' });
    });

    C.action('seance.piscine', (el) => openPoolSheet(el.dataset.id));
    C.action('seance.piscine-choix', (el) => choosePool(el.dataset.id, el.dataset.pool));
    C.onSubmit('seance.piscine-new', (form, fd) => {
      const name = String(fd.get('name') || '').trim().slice(0, 60);
      if (!name) { C.ui.toast('Donne un nom à la piscine'); return; }
      const length = Number(fd.get('length')) === 50 ? 50 : 25;
      const pool = { id: U.uid(), name, length, deepM: null, mannequin: null };
      C.store.update((st) => { st.profile.pools.push(pool); }, { silent: true });
      choosePool(form.dataset.id, pool.id);
    });

    // Saisie en cours : enregistrement silencieux (pas de re-rendu, le focus reste dans le champ).
    C.onInput('seance.champ', (el) => {
      const { id, k, f } = el.dataset;
      const i = Number(el.dataset.i);
      const v = parseField(f, el.value);
      if (Number.isNaN(v)) { el.setAttribute('aria-invalid', 'true'); return; }
      el.removeAttribute('aria-invalid');
      const s = getSession(id);
      const item = s && findItem(s, k);
      if (!item) return;
      const cur = ((s.log || {})[k] || [])[i] || {};
      const patch = { [f]: v };
      if (cur.done) patch.measured = item.track === 'check' ? true : hasMeasure(item.track, { ...cur, ...patch });
      C.sessions.patchSet(id, k, i, patch);
    });

    C.action('seance.signe', (el) => {
      const input = document.getElementById(el.dataset.for);
      if (!input) return;
      const v = input.value.trim();
      input.value = v.startsWith('-') ? v.slice(1) : v ? '-' + v : '-';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });

    // ✓ : valide (ou annule) une série avec les valeurs saisies — rien n'est recopié de la fois précédente.
    C.action('seance.serie', (el) => {
      const { id, k } = el.dataset;
      const i = Number(el.dataset.i);
      const s = getSession(id);
      const item = s && findItem(s, k);
      if (!item) return;
      const row = el.closest('.ses-set');
      const values = {};
      if (row) row.querySelectorAll('input[data-f]').forEach((inp) => { values[inp.dataset.f] = parseField(inp.dataset.f, inp.value); });
      if (Object.values(values).some((v) => Number.isNaN(v))) { C.ui.toast('Valeur illisible : corrige-la ou efface-la.'); return; }
      const cur = ((s.log || {})[k] || [])[i] || {};
      const done = !cur.done;
      C.sessions.patchSet(id, k, i, setPatch(item.track, values, done), { silent: false });
      if (done) afterSetDone(getSession(id), item, i);
    });

    C.action('seance.plus-serie', (el) => {
      const s = getSession(el.dataset.id);
      const item = s && findItem(s, el.dataset.k);
      if (!item) return;
      C.sessions.patchSet(s.id, item.key, rowsCount(s, item), { done: false }, { silent: false });
    });

    C.action('seance.passer', (el) => {
      const key = baseKey(el.dataset.k);
      editItems(el.dataset.id, (list) => list.map((it) => (it.key === key ? { ...it, skipped: !it.skipped } : it)));
    });

    C.action('seance.retirer', async (el) => {
      const s = getSession(el.dataset.id);
      const item = s && findItem(s, el.dataset.k);
      if (!item || !(await C.ui.ask(`Retirer « ${item.name} » de cette séance ?`, 'Retirer', { danger: true }))) return;
      editItems(s.id, (list) => list.filter((it) => it.key !== item.key));
    });

    C.action('seance.remplacer', (el) => {
      const s = getSession(el.dataset.id);
      const item = s && findItem(s, el.dataset.k);
      const ex = item && getEx(item.exId);
      if (!ex) return;
      const injured = painZones(C.state.profile).map((z) => z.zone);
      const group = (title, ids) => {
        const list = (ids || []).map(getEx).filter(Boolean);
        if (!list.length) return '';
        return `<h4>${esc(title)}</h4><div class="ses-repl">${list.map((a) => {
          const warn = (a.stress || []).filter((z) => injured.includes(z));
          return `<button type="button" class="ses-repl-btn" data-action="seance.remplacer-par" data-id="${esc(s.id)}" data-k="${esc(item.key)}" data-ex="${esc(a.id)}">
            <b>${esc(a.name)}</b><span class="tiny muted">${esc(a.defaultReps || '')}${a.impact === 0 ? ' · sans impact' : ''}${a.apnea ? ' · apnée' : ''}</span>
            ${warn.length ? `<span class="pill warn tiny">⚠ ${esc(warn.map((z) => ZONE_LABELS[z] || z).join(', '))}</span>` : ''}</button>`;
        }).join('')}</div>`;
      };
      C.ui.openModal({
        title: `Remplacer « ${item.name} »`,
        body: `${group('Alternatives', ex.alt)}${group('Plus facile', ex.easier)}${group('Plus dur', ex.harder)}
          ${C.libraryUI && C.libraryUI.pickExercise ? `<button type="button" class="btn ghost block mt" data-action="seance.remplacer-biblio" data-id="${esc(s.id)}" data-k="${esc(item.key)}">Chercher dans la bibliothèque</button>` : ''}`,
      });
    });

    const doReplace = async (sid, key, exId) => {
      const s = getSession(sid);
      const item = s && findItem(s, key);
      const ex = getEx(exId);
      if (!item || !ex) return;
      const logged = ((s.log || {})[key] || []).some((x) => x && x.done);
      C.ui.closeModal();
      if (logged && !(await C.ui.ask('Des séries sont déjà notées pour cet exercice. Les effacer et le remplacer ?', 'Remplacer', { danger: true }))) return;
      const fresh = replacementItem(item, ex, Date.now().toString(36));
      editItems(sid, (list) => list.map((it) => (it.key === key ? fresh : it)));
      C.ui.toast(`Remplacé par « ${ex.name} »`);
    };
    C.action('seance.remplacer-par', (el) => doReplace(el.dataset.id, el.dataset.k, el.dataset.ex));
    C.action('seance.remplacer-biblio', (el) => {
      const { id, k } = el.dataset;
      const s = getSession(id);
      C.ui.closeModal();
      C.libraryUI.pickExercise({ title: 'Remplacer par…', loc: s && s.loc, onPick: (exId) => doReplace(id, k, exId) });
    });

    C.action('seance.ajouter', (el) => {
      const sid = el.dataset.id;
      const s = getSession(sid);
      if (!s) return;
      if (!C.libraryUI || !C.libraryUI.pickExercise) { C.ui.toast('Bibliothèque indisponible'); return; }
      C.libraryUI.pickExercise({
        title: 'Ajouter un exercice', loc: s.loc,
        onPick: (exId) => {
          C.sessions.addExercise(sid, exId);
          const ex = getEx(exId);
          C.ui.toast(`Ajouté : ${ex ? ex.name : 'exercice'}`);
        },
      });
    });

    // Chrono intégré (exercices chronométrés et course).
    C.action('seance.chrono', (el) => {
      const s = getSession(el.dataset.id);
      const item = s && findItem(s, el.dataset.k);
      if (!item) return;
      openStopwatch({ sid: s.id, key: item.key, i: Number(el.dataset.i), name: item.name });
    });
    C.action('seance.sw-toggle', () => {
      if (C.audio && C.audio.unlock) safe(() => C.audio.unlock());
      if (sw.run) { sw.acc = swElapsed(); sw.run = false; clearInterval(sw.tick); sw.tick = null; swPaint(); }
      else {
        sw.t0 = swNow(); sw.run = true;
        sw.tick = setInterval(swPaint, 100);
        if (C.audio && C.audio.wakeLock && C.audio.wakeLock.request) safe(() => C.audio.wakeLock.request());
      }
      swButtons();
    });
    C.action('seance.sw-lap', () => { if (sw.run) { sw.laps.push(swElapsed()); swButtons(); } });
    C.action('seance.sw-reset', () => {
      const target = sw.target;
      clearInterval(sw.tick); sw.tick = null;
      sw.run = false; sw.acc = 0; sw.laps = []; sw.target = target;
      swPaint(); swButtons();
    });
    C.action('seance.sw-use', () => {
      const t = sw.target;
      const sec = Math.round(swElapsed() / 1000);
      if (!t || sec < 1) { C.ui.toast('Lance le chrono d\'abord'); return; }
      C.ui.closeModal();
      const s = getSession(t.sid);
      const item = s && findItem(s, t.key);
      if (!item) return;
      const cur = ((s.log || {})[t.key] || [])[t.i] || {};
      C.sessions.patchSet(t.sid, t.key, t.i, setPatch(item.track, { ...cur, sec }, true), { silent: false });
      C.ui.toast(`Série ${t.i + 1} : ${U.formatDuration(sec)}`);
      afterSetDone(getSession(t.sid), item, t.i);
    });

    // Minuteur (circuit abdos, réhab) fourni par l'item : à la fin, les séries sont cochées.
    C.action('seance.minuteur', (el) => {
      const open = timerFn('open');
      const s = getSession(el.dataset.id);
      const item = s && findItem(s, el.dataset.k);
      if (!open || !item || !item.timer) { C.ui.toast('Minuteur indisponible'); return; }
      const spec = U.clone(item.timer);
      if (!spec.name) spec.name = item.name;
      spec.onFinish = (result) => markAllDone(s.id, item.key, result);
      if (!s.startedAt) C.sessions.patch(s.id, { startedAt: Date.now() }, { silent: true });
      open(spec);
    });

    C.action('seance.terminer', (el) => {
      const s = getSession(el.dataset.id);
      if (!s) return;
      C.ui.openModal({ title: 'Terminer la séance', body: finishSheetHTML(s) });
    });

    C.onSubmit('seance.fin', (form, fd) => {
      const sid = form.dataset.id;
      const s = getSession(sid);
      if (!s) return;
      const zones = painZones(C.state.profile);
      const values = {
        duration: fd.get('duration'), rpe: fd.get('rpe'), feeling: fd.get('feeling'), notes: fd.get('notes'),
        hr: fd.get('hr'), kcal: fd.get('kcal'), km: fd.get('km'),
        pain: Object.fromEntries(zones.map((z) => [z.zone, fd.get('pain_' + z.zone)]).filter(([, v]) => v != null && v !== '')),
      };
      const fields = finishFields(values, s, Date.now());
      // Piscine choisie ou créée à la fin
      const poolName = String(fd.get('poolName') || '').trim().slice(0, 60);
      if (poolName) {
        const pool = { id: U.uid(), name: poolName, length: Number(fd.get('poolLen')) === 50 ? 50 : 25, deepM: null, mannequin: null };
        C.store.update((st) => { st.profile.pools.push(pool); }, { silent: true });
        fields.poolId = pool.id; fields.poolLength = pool.length;
      } else if (fd.get('poolId')) {
        const pool = ((C.state.profile || {}).pools || []).find((p) => p.id === fd.get('poolId'));
        if (pool) { fields.poolId = pool.id; fields.poolLength = pool.length; }
      }
      C.ui.closeModal();
      C.sessions.patch(sid, fields);
      const rec = metricsFn('recordsFromSession');
      if (rec) safe(() => rec(getSession(sid)));
      const alert = painAlert(fields.pain);
      if (alert) painSheet(sid, alert);
      else C.ui.toast(fields.rpe ? 'Séance enregistrée 💪' : 'Séance enregistrée (effort non noté)');
    });

    C.action('seance.doux-oui', (el) => {
      const s = getSession(el.dataset.id);
      if (!s) return;
      C.ui.closeModal();
      C.sessions.patch(s.id, { softUntil: U.addDays(s.date, 3) });
      C.ui.toast('Version douce conseillée jusqu\'au ' + U.fmtShort(U.addDays(s.date, 3)));
    });

    // Reconstruit la séance prévue du jour en version douce (rien n'a encore été noté).
    C.action('seance.version-douce', (el) => {
      const s = getSession(el.dataset.id);
      if (!s || !C.planner || !C.sessions.build) return;
      const fresh = C.sessions.build(s.date, { templateId: s.templateId, variant: 'doux' });
      C.sessions.patch(s.id, {
        variant: 'doux', title: fresh.title, exercises: fresh.exercises, intro: fresh.intro, safety: fresh.safety,
        plannedMin: fresh.plannedMin, goals: fresh.goals, log: {},
      });
      C.ui.toast('Version douce chargée');
    });

    C.action('seance.rouvrir', (el) => {
      C.sessions.patch(el.dataset.id, { status: 'in_progress', finishedAt: null });
    });

    C.action('seance.supprimer', async (el) => {
      const sid = el.dataset.id;
      if (!(await C.ui.ask('Supprimer cette séance et tout ce qui y est noté ?', 'Supprimer', { danger: true }))) return;
      C.store.update((st) => { delete st.sessions[sid]; }, { silent: true });
      C.ui.toast('Séance supprimée');
      C.back('#/');
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.sessionUI = {
    view, openPoolSheet, openStopwatch,
    // Fonctions pures (tests)
    _t: {
      FIELDS, RPE, fieldsFor, parseField, hasMeasure, setPatch, fmtRest, prescription, distanceOf, lengthsText, rowsCount,
      isPoolSession, hasApnea, isApneaItem, surfaceItem, effectiveItems, findItem, defaultDuration, painZones, painAlert,
      fmtSet, summarizeSets, progressCount, localPrev, normPrev, softAdvice, finishFields, replacementItem, fmtMs, baseKey,
    },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
