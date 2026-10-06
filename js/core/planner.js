/* Crevare — planificateur (C.planner) : phases, semaine type, séance du jour, adaptations.
 *
 * Tout est déterministe : mêmes données (objectifs, profil, agenda, tests) → même plan. Aucun aléa,
 * aucune dépendance à « aujourd'hui ». Les séances déjà créées sont figées par js/core/sessions.js :
 * changer le plan ne réécrit jamais l'historique.
 *
 * Grandes étapes :
 *  1. phase(date) : objectif prioritaire du moment et période (reprise, base, développement, spécifique,
 *     affûtage, jour J, récupération, entretien), semaine allégée (1 sur 4).
 *  2. Semaine : jours bloqués (jour J, veille, lendemain de course, garde Protection civile), choix des
 *     séances selon la période (les 3 objectifs restent touchés), placement par recherche exhaustive des
 *     permutations qui minimise les pénalités (jambes lourdes la veille d'une course intense, deux séances
 *     dures ou deux piscines d'affilée, agenda chargé), bonus facultatifs les jours de repos.
 *  3. instantiate(date) : contenu concret (modèles de js/data/sessions.js) + variante + blessures + sécurité. */
(function (C) {
  'use strict';
  const U = C.util;

  const st = () => C.state || (C.schema ? C.schema.defaultState() : { profile: {}, goals: [], plan: { overrides: {} } });
  const TPL = () => (C.data && C.data.sessionTemplates) || {};
  const exInfo = (id) => (C.data && C.data.sessionKit ? C.data.sessionKit.exInfo(id) : { id, name: id, track: 'check', impact: 0, stress: [], alt: [], known: false });

  const VARIANTS = ['normal', 'allege', 'express', 'doux'];
  const KEY_LABEL = {
    reprise: 'Reprise en douceur', base: 'Base', developpement: 'Développement', specifique: 'Spécifique', affutage: 'Affûtage',
    'jour-j': 'Jour J', recuperation: 'Récupération', entretien: 'Entretien',
  };
  const SCOPE_LABEL = { hyrox: 'HYROX', ssa: 'SSA', pompier: 'pompier' };
  const LEVEL_OF = { reprise: 'reprise', base: 'base', developpement: 'dev', specifique: 'spe', affutage: 'spe', 'jour-j': 'spe', recuperation: 'base', entretien: 'base' };
  const PHASE_VOL = { reprise: 0.7, recuperation: 0.5 };
  const VARIANT_VOL = { normal: 1, allege: 2 / 3, express: 1, doux: 0.8 };
  const DELOAD_VOL = 0.65; // semaine allégée : −35 % (course et natation comprises : tout le volume passe par ctx.vol)
  const NO_DELOAD = ['reprise', 'affutage', 'jour-j', 'recuperation'];
  const HX_TAPER_DAYS = 12; // affûtage HYROX : 12 derniers jours
  const SSA_TAPER_DAYS = 7; // affûtage court avant chaque jalon SSA
  const SSA_RAMP_DAYS = 42; // priorité SSA : 6 semaines avant chaque jalon
  const RUNNING = new Set(['run_easy', 'run_long', 'run_tempo', 'run_3030', 'run_400', 'run_1k_rep', 'run_strides', 'run_drills', 'run_warmup',
    'treadmill_easy', 'treadmill_1k', 'run_1k_test', 'run_5k_test', 'hyrox_run_station', 'run_shuttle', 'luc_leger']);

  const prio = (g) => ([1, 2, 3].includes(+g.priority) ? +g.priority : 2);
  const join = (...p) => p.filter(Boolean).join(' ');

  /* ───────── Préparation des objectifs (mémorisée tant qu'ils ne changent pas) ───────── */

  function goalsSig(s) {
    return JSON.stringify([s.plan && s.plan.startDate, (Array.isArray(s.goals) ? s.goals : []).map((g) => g && [g.id, g.type, g.status, g.date, g.priority, g.name,
      U.isObj(g.details) ? [g.details.raceDate, g.details.entryTestDate, g.details.tsaDate, g.details.applyDate, g.details.division] : null])]);
  }

  let prepMemo = null;
  function prep() {
    const s = st();
    const sig = goalsSig(s);
    if (prepMemo && prepMemo.sig === sig) return prepMemo.v;
    const start = U.isKey(s.plan && s.plan.startDate) ? s.plan.startDate : U.todayKey();
    const all = Array.isArray(s.goals) ? s.goals.filter(U.isObj) : [];
    const active = all.filter((g) => g.status === 'active');
    const byDate = (a, b) => a.date.localeCompare(b.date) || String(a.goal.id).localeCompare(String(b.goal.id));
    const det = (g) => (U.isObj(g.details) ? g.details : {});

    const races = active.filter((g) => g.type === 'hyrox')
      .map((g) => ({ goal: g, kind: 'hyrox', date: U.isKey(g.date) ? g.date : U.isKey(det(g).raceDate) ? det(g).raceDate : null, title: g.name || 'HYROX' }))
      .filter((r) => r.date).sort(byDate);

    // Jalons SSA : test d'entrée, TSA ; sans date de TSA, la date de l'objectif tient lieu de TSA (estimée).
    // Une date d'objectif postérieure au TSA n'est qu'administrative (certification) : pas d'épreuve physique.
    const ssaGoals = active.filter((g) => g.type === 'ssa');
    const jalons = [];
    for (const g of ssaGoals) {
      const d = det(g);
      const entry = U.isKey(d.entryTestDate) ? d.entryTestDate : null;
      const tsa = U.isKey(d.tsaDate) ? d.tsaDate : null;
      if (entry) jalons.push({ goal: g, kind: 'entry', date: entry, title: "Test d'entrée SSA" });
      if (tsa && tsa !== entry) jalons.push({ goal: g, kind: 'tsa', date: tsa, title: 'TSA (certification SSA)' });
      else if (!tsa && U.isKey(g.date) && (!entry || g.date > entry)) jalons.push({ goal: g, kind: 'tsa', date: g.date, title: 'SSA (date visée)', estimated: true });
    }
    jalons.sort(byDate);
    // Une course et un jalon le même jour : la course l'emporte.
    const ssaJalons = jalons.filter((j, i) => !races.some((r) => r.date === j.date) && (i === 0 || jalons[i - 1].date !== j.date));
    const ssaEnd = (g) => [g.date, det(g).entryTestDate, det(g).tsaDate].filter(U.isKey).sort().pop() || null;

    const pompiers = active.filter((g) => g.type === 'pompier')
      .map((g) => ({ goal: g, kind: 'pompier', date: U.isKey(g.date) ? g.date : U.isKey(det(g).applyDate) ? det(g).applyDate : null, title: 'Candidature pompier' }))
      .filter((p) => p.date).sort(byDate);

    const v = {
      start, races, jalons: ssaJalons, ssaGoals, pompiers, ssaEnds: ssaGoals.map(ssaEnd),
      pompierUndated: active.some((g) => g.type === 'pompier' && !U.isKey(g.date) && !U.isKey(det(g).applyDate)),
      ssaEver: all.some((g) => g.type === 'ssa'), memo: new Map(),
    };
    prepMemo = { sig, v };
    return v;
  }

  /* ───────── Phases ───────── */

  function hyroxKey(dR) {
    if (dR > 112) return 'base'; // plus de 16 semaines
    if (dR > 56) return 'developpement'; // 16 → 8 semaines
    if (dR > HX_TAPER_DAYS) return 'specifique'; // 8 → 2 semaines
    return 'affutage';
  }

  // Phase « brute » d'un jour (sans semaine allégée ni compteur de semaines).
  function rawPhase(d, P) {
    const hit = P.memo.get(d);
    if (hit) return hit;
    const r = computeRaw(d, P);
    P.memo.set(d, r);
    return r;
  }

  function computeRaw(d, P) {
    if (d < P.start) return { key: 'reprise', scope: null, goal: null, pre: true };
    const race = P.races.find((r) => r.date === d);
    if (race) return { key: 'jour-j', scope: 'hyrox', goal: race.goal, event: race, target: race, days: 0 };
    const jal = P.jalons.find((j) => j.date === d);
    if (jal) return { key: 'jour-j', scope: 'ssa', goal: jal.goal, event: jal, target: jal, days: 0 };

    let prev = null;
    for (const r of P.races) if (r.date < d) prev = r;
    if (prev && U.daysBetween(prev.date, d) <= 7) return { key: 'recuperation', scope: 'hyrox', goal: prev.goal, target: prev, days: -U.daysBetween(prev.date, d) };

    const nr = P.races.find((r) => r.date > d) || null;
    const nj = P.jalons.find((j) => j.date > d) || null;
    const np = P.pompiers.find((p) => p.date >= d) || null;
    const dR = nr ? U.daysBetween(d, nr.date) : Infinity;
    const dJ = nj ? U.daysBetween(d, nj.date) : Infinity;
    const tH = dR <= HX_TAPER_DAYS, tS = dJ <= SSA_TAPER_DAYS;
    if (tH && (!tS || dR <= dJ)) return { key: 'affutage', scope: 'hyrox', goal: nr.goal, target: nr, days: dR };
    if (tS) return { key: 'affutage', scope: 'ssa', goal: nj.goal, target: nj, days: dJ };

    if (U.weeksBetween(P.start, d) <= 2) {
      // Reprise : l'objectif le plus proche sert de repère.
      const cands = [nr, nj, np].filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
      const t = cands[0] || null;
      return { key: 'reprise', scope: t ? (t.kind === 'hyrox' ? 'hyrox' : t.kind === 'pompier' ? 'pompier' : 'ssa') : null, goal: t ? t.goal : null, target: t, days: t ? U.daysBetween(d, t.date) : null };
    }

    const hx = nr ? hyroxKey(dR) : null;
    const ramp = dJ <= SSA_RAMP_DAYS;
    if (ramp && hx === 'specifique') {
      // Les deux veulent la priorité : l'objectif de priorité la plus forte, puis le plus proche.
      const ssaWins = prio(nj.goal) < prio(nr.goal) || (prio(nj.goal) === prio(nr.goal) && dJ < dR);
      if (!ssaWins) return { key: hx, scope: 'hyrox', goal: nr.goal, target: nr, days: dR };
    }
    if (ramp) return { key: 'specifique', scope: 'ssa', goal: nj.goal, target: nj, days: dJ };
    if (hx) return { key: hx, scope: 'hyrox', goal: nr.goal, target: nr, days: dR };
    if (nj) return { key: dJ > 84 ? 'base' : 'developpement', scope: 'ssa', goal: nj.goal, target: nj, days: dJ };
    const undated = P.ssaGoals.find((g) => !U.isKey(g.date) && !P.jalons.some((j) => j.goal === g));
    if (undated) return { key: 'base', scope: 'ssa', goal: undated, target: null, days: null };
    if (np) {
      const dP = U.daysBetween(d, np.date);
      return { key: dP <= 84 ? 'specifique' : 'entretien', scope: 'pompier', goal: np.goal, target: np, days: dP };
    }
    if (P.pompierUndated) return { key: 'entretien', scope: 'pompier', goal: null, target: null, days: null };
    return { key: 'entretien', scope: null, goal: null, target: null, days: null };
  }

  // Identité d'une période (pour fusionner les jours et compter les semaines).
  const rid = (r) => `${r.key}|${r.scope || ''}|${r.goal ? r.goal.id : ''}|${r.pre ? 'pre' : ''}|${r.scope === 'ssa' && r.target ? r.target.date : ''}`;

  function evTitle(t) {
    if (!t) return '';
    if (t.kind === 'hyrox') return t.goal && t.goal.name ? t.goal.name : 'HYROX';
    return t.title || (t.goal && t.goal.name) || '';
  }

  function labelOf(r) {
    if (r.pre) return 'Avant le début du plan';
    if (r.key === 'reprise') return KEY_LABEL.reprise;
    if (r.key === 'jour-j') return `Jour J — ${evTitle(r.event)}`;
    if (r.key === 'entretien') return r.scope === 'pompier' ? 'Entretien (orienté tests pompier)' : 'Entretien';
    const base = `${KEY_LABEL[r.key]} ${SCOPE_LABEL[r.scope] || ''}`.trim();
    if (r.scope === 'ssa' && r.target) return `${base} (${r.target.kind === 'entry' ? "test d'entrée" : 'TSA'})`;
    return base;
  }

  // Semaine allégée : weekIndex % 4 === 3, jamais pendant la reprise, l'affûtage, le jour J ni la récupération.
  // La semaine 4 (weekIndex 3) suit directement 3 semaines de reprise déjà réduites : la 1re allégée est la semaine 8.
  const isDeload = (r, wi) => !r.pre && !NO_DELOAD.includes(r.key) && wi >= 4 && wi % 4 === 3;

  function notesOf(r, deload, P, d) {
    if (r.pre) return [`Ton plan commence le ${U.fmtLong(P.start)}.`];
    const n = [];
    const hx = r.scope === 'hyrox', ssa = r.scope === 'ssa';
    switch (r.key) {
      case 'reprise': n.push('Commençons doucement : volumes réduits (× 0,7) pendant les 3 premières semaines.'); break;
      case 'base': n.push(hx ? 'Base : endurance facile, technique des stations et force.' : 'Base : technique, endurance et aisance dans l\'eau.'); break;
      case 'developpement': n.push(hx ? 'Développement : course en état de fatigue (1 km + station) et allure seuil.' : 'Développement : plus de spécifique dans l\'eau.'); break;
      case 'specifique': n.push(hx ? 'Spécifique : simulations progressives (½, ¾, puis complète au plus tard à J-21).'
        : ssa ? 'Priorité SSA : au moins 2 séances piscine par semaine (à partir de 3 séances), simulations toutes les 3 semaines.' : 'Préparation des tests pompier.'); break;
      case 'affutage': n.push(hx ? 'Affûtage : volume réduit de 40 à 60 %, on garde l\'intensité.' : 'Affûtage court : dernière simulation au plus tard à J-5, repos la veille.'); break;
      case 'jour-j': n.push('Jour J : pas d\'entraînement. Check-list prête ?'); break;
      case 'recuperation': n.push('Récupération : nage facile, mobilité, sommeil. Pas de séance dure.'); break;
      default: n.push(r.scope === 'pompier' ? 'Entretien : on garde tout, orienté tests pompier (ICP).' : 'Entretien : on garde la forme.');
    }
    const t = r.target;
    if (t && r.key !== 'jour-j' && U.isKey(t.date) && r.days != null && r.days > 0) n.push(`${evTitle(t)} : ${U.relDays(r.days)} (${U.fmtLong(t.date)}).`);
    if (deload) n.push('Semaine allégée : volume réduit d\'environ 35 %, course et natation comprises.');
    const noEntry = P.ssaGoals.some((g) => !U.isKey(g.details && g.details.entryTestDate) && (!U.isKey(g.date) || g.date >= d));
    if (noEntry) n.push("Date du test d'entrée SSA inconnue : saisis-la dans ton objectif dès que tu la connais.");
    return n;
  }

  function phaseWith(date, P) {
    const r = rawPhase(date, P);
    const wi = U.weeksBetween(P.start, date);
    const id = rid(r);
    let s = date;
    for (let n = 0; n < 400; n++) {
      const p = U.addDays(s, -1);
      if (p < P.start || rid(rawPhase(p, P)) !== id) break;
      s = p;
    }
    const deload = isDeload(r, wi);
    return {
      key: r.key, label: labelOf(r), goal: r.goal || null, weekInPhase: Math.floor(U.daysBetween(s, date) / 7) + 1, weekIndex: wi,
      deload, taper: r.key === 'affutage', notes: notesOf(r, deload, P, date),
      scope: r.scope || null, start: s, daysToTarget: r.days == null ? null : r.days,
    };
  }

  function phase(date) {
    if (!U.isKey(date)) return null;
    return phaseWith(date, prep());
  }

  // Phase HYROX d'un jour, sans tenir compte du SSA (sert au choix des séances HYROX/course).
  function hxKeyAt(d, P) {
    if (P.races.some((r) => r.date === d)) return 'jour-j';
    let prev = null;
    for (const r of P.races) if (r.date < d) prev = r;
    if (prev && U.daysBetween(prev.date, d) <= 7) return 'recuperation';
    const nr = P.races.find((r) => r.date > d);
    return nr ? hyroxKey(U.daysBetween(d, nr.date)) : null;
  }

  /* ───────── Contexte d'une séance ───────── */

  function injuriesOf(prof) {
    const inj = {}, labels = {};
    for (const i of Array.isArray(prof && prof.injuries) ? prof.injuries : []) {
      if (!U.isObj(i) || i.active === false || !i.zone) continue;
      inj[i.zone] = true;
      if (!labels[i.zone]) labels[i.zone] = `${i.zone}${i.side ? ` ${String(i.side).trim()}` : ''}`;
    }
    return { inj, labels };
  }

  function poolFor(prof, o = {}) {
    const pools = Array.isArray(prof.pools) ? prof.pools.filter(U.isObj) : [];
    if (o.poolId) { const p = pools.find((x) => x.id === o.poolId); if (p) return p; }
    if ([25, 33, 50].includes(+o.poolLength)) return { id: null, name: '', length: +o.poolLength, deepM: null, mannequin: null };
    return pools[0] || null;
  }

  // Meilleure valeur connue d'un test (C.metrics si présent, sinon lecture directe des tests « test » et « officiel »).
  function best(id) {
    try {
      if (C.metrics && typeof C.metrics.benchBest === 'function') {
        const b = C.metrics.benchBest(id);
        if (typeof b === 'number') return isFinite(b) ? b : null;
        if (U.isObj(b) && U.num(b.value) != null) return U.num(b.value);
        return null;
      }
    } catch (e) { /* repli ci-dessous */ }
    const list = (st().benchmarks || {})[id];
    if (!Array.isArray(list)) return null;
    const vals = list.filter((e) => U.isObj(e) && (e.context === 'test' || e.context === 'officiel') && U.num(e.value) != null).map((e) => U.num(e.value));
    if (!vals.length) return null;
    const bm = C.data && C.data.getBenchmark ? C.data.getBenchmark(id) : null;
    return bm && bm.lower ? Math.min(...vals) : Math.max(...vals);
  }

  // Étape de la simulation HYROX selon la semaine : ½ (≥ 5 semaines), ¾ (4), complète (3, au plus tard à J-21).
  function simStageFor(date, race) {
    if (!race) return 'demi';
    const wo = Math.floor(U.daysBetween(U.mondayOf(date), race.date) / 7);
    const dR = U.daysBetween(date, race.date);
    if (wo >= 5) return 'demi';
    if (wo === 4) return '3/4';
    return dR >= 21 ? 'complete' : dR >= 14 ? '3/4' : 'demi';
  }
  // Tests de course : 5 km puis 1 km en alternance (S3, puis une semaine allégée sur trois).
  const testRunFor = (wi) => ((wi <= 2 ? 0 : 1 + Math.floor(Math.max(0, wi - 7) / 12)) % 2 === 0 ? '5k' : '1k');

  function volFor(ph) {
    let v = PHASE_VOL[ph.key] || 1;
    if (ph.key === 'affutage') {
      const d = U.clamp(ph.daysToTarget || 1, 1, ph.scope === 'hyrox' ? HX_TAPER_DAYS : SSA_TAPER_DAYS);
      // HYROX : de 0,6 (J-12) à 0,45 (J-1) ; SSA : de 0,6 (J-7) à 0,5 (J-1).
      v = ph.scope === 'hyrox' ? 0.45 + (0.15 * (d - 1)) / (HX_TAPER_DAYS - 1) : 0.5 + (0.1 * (d - 1)) / (SSA_TAPER_DAYS - 1);
    }
    if (ph.deload) v *= DELOAD_VOL;
    return v;
  }

  function ctxFor(date, variant, o = {}) {
    const s = st(), prof = U.isObj(s.profile) ? s.profile : {}, P = prep();
    const ph = phaseWith(date, P);
    const { inj, labels } = injuriesOf(prof);
    const pool = poolFor(prof, o);
    const race = P.races.find((r) => r.date >= date) || null;
    const lastRace = [...P.races].reverse().find((r) => r.date < date) || null;
    const goals = Array.isArray(s.goals) ? s.goals : [];
    const hxGoal = (race && race.goal) || (lastRace && lastRace.goal) || goals.find((g) => g && g.type === 'hyrox') || null;
    const nj = P.jalons.find((j) => j.date >= date) || null;
    const ssaGoal = (nj && nj.goal) || P.ssaGoals[0] || goals.find((g) => g && g.type === 'ssa') || null;
    const ssaD = ssaGoal && U.isObj(ssaGoal.details) ? ssaGoal.details : null;
    const entryPending = !!ssaD && (!U.isKey(ssaD.entryTestDate) || ssaD.entryTestDate >= date);
    const pg = goals.find((g) => g && g.type === 'pompier') || null;
    const v = VARIANTS.includes(variant) ? variant : 'normal';
    return {
      date, phase: ph.key, weekInPhase: ph.weekInPhase, weekIndex: Math.max(0, ph.weekIndex), deload: ph.deload, taper: ph.taper, variant: v,
      profile: prof, goals, goal: ph.goal, hyrox: hxGoal && U.isObj(hxGoal.details) ? hxGoal.details : hxGoal ? {} : null,
      ssa: ssaD, pompier: pg && U.isObj(pg.details) ? pg.details : null, level: LEVEL_OF[ph.key] || 'base',
      injuries: inj, injuryLabels: labels, pool, poolLength: pool && [25, 33, 50].includes(+pool.length) ? +pool.length : 25,
      best, vol: Math.max(0.3, volFor(ph) * VARIANT_VOL[v]), maxMin: +prof.maxSessionMin || 0,
      daysToRace: race ? U.daysBetween(date, race.date) : null, simStage: simStageFor(date, race),
      ssaNext: nj ? { date: nj.date, kind: nj.kind, days: U.daysBetween(date, nj.date) } : null,
      simMode: nj ? nj.kind : entryPending ? 'entry' : 'tsa', ssaEvent: P.jalons.find((j) => j.date === date) || null,
      testRun: testRunFor(Math.max(0, ph.weekIndex)), phaseInfo: ph,
    };
  }

  /* ───────── Adaptations (variante, blessures, durée, sécurité) ───────── */

  function painToday(date) {
    const ci = (st().checkins || {})[date];
    const p = ci && U.isObj(ci.pain) ? ci.pain : {};
    return (+p.genou || 0) >= 3 || (+p.cheville || 0) >= 3;
  }

  // 1re alternative sans impact (bibliothèque), sinon repli selon le lieu.
  function altFor(exId, zones, loc) {
    const D = C.data || {};
    if (typeof D.findAlternative === 'function') {
      try {
        const a0 = D.findAlternative(exId, { maxImpact: 0, avoid: zones });
        if (a0) return a0;
        const a1 = D.findAlternative(exId, { maxImpact: 1, avoid: zones });
        if (a1 && exInfo(a1).impact < 2) return a1;
      } catch (e) { /* repli */ }
    }
    const info = exInfo(exId);
    for (const a of info.alt) { const ia = exInfo(a); if (ia.known && ia.impact === 0) return a; }
    for (const a of info.alt) { const ia = exInfo(a); if (ia.known && ia.impact < 2 && !ia.stress.some((z) => zones.includes(z))) return a; }
    return { salle: 'bike_easy', dehors: 'walk_brisk', piscine: 'swim_crawl_easy', maison: 'squat_bw' }[loc] || 'walk_brisk';
  }

  function swapItem(item, newId, label) {
    const ni = exInfo(newId);
    const out = { ...item, exId: newId, name: ni.name, track: ni.track, impact: ni.impact || 0,
      note: join(`Adapté : ${label} (à la place de « ${item.name} »).`, item.note) };
    if (ni.alt && ni.alt.length) out.alt = ni.alt.slice(); else delete out.alt;
    if (ni.apnea) out.apnea = true; else delete out.apnea;
    delete out.bench; delete out.test; delete out.timer;
    if (item.track !== ni.track) out.target = item.target && item.target.sec && ni.track === 'time' ? { sec: item.target.sec } : {};
    return out;
  }

  // Remplace les exercices à impact 2 qui sollicitent une zone blessée (ou tous en version douce) ;
  // en version douce avec genou/cheville douloureux, la course passe au vélo ou à la marche rapide.
  function adaptItems(items, c, loc) {
    const zones = Object.keys(c.injuries || {}).filter((z) => c.injuries[z]);
    const labels = c.injuryLabels || {};
    const doux = c.variant === 'doux';
    const legZones = zones.filter((z) => z === 'genou' || z === 'cheville');
    const legPain = legZones.length > 0 || painToday(c.date);
    const lab = (zs) => (zs.length ? zs.map((z) => labels[z] || z).join(' et ') : 'version douce');
    return items.map((item) => {
      const info = exInfo(item.exId);
      const imp = info.known ? info.impact : +item.impact || 0;
      const stress = info.stress && info.stress.length ? info.stress : imp >= 2 ? ['genou', 'cheville'] : [];
      const hit = zones.filter((z) => stress.includes(z));
      if (imp >= 2 && (doux || hit.length)) return swapItem(item, altFor(item.exId, hit.length ? hit : zones, loc), lab(hit));
      if (doux && legPain && RUNNING.has(item.exId)) return swapItem(item, loc === 'salle' ? 'bike_easy' : 'walk_brisk', lab(legZones));
      return item;
    });
  }

  const sumMin = (items) => items.reduce((a, x) => a + (+x.estMin || 0), 0);
  const durOf = (items, extra) => Math.max(5, Math.round((sumMin(items) + (extra || 0)) / 5) * 5);

  // Version express : un échauffement court + les exercices essentiels.
  function expressFilter(items) {
    const warm = items.find((x) => x.warm);
    let core = items.filter((x) => x.core && !x.warm);
    if (!core.length) core = items.filter((x) => !x.warm).slice(0, 3);
    const out = [];
    if (warm) out.push({ ...warm, estMin: Math.min(+warm.estMin || 5, 5), note: join('Version express : 5 min suffisent.', warm.note) });
    return out.concat(core);
  }

  // Dernier recours pour tenir dans la durée : moins de séries, puis on retire des exercices non essentiels.
  function fitItems(items, extra, limit) {
    let list = items.slice();
    for (let k = 0; k < 6 && durOf(list, extra) > limit; k++) {
      const f = limit / durOf(list, extra);
      list = list.map((x) => {
        if (!(x.sets > 1)) return x;
        const sets = Math.max(1, Math.floor(x.sets * f));
        return sets === x.sets ? x : { ...x, sets, estMin: ((+x.estMin || 0) * sets) / x.sets };
      });
    }
    for (let i = list.length - 1; i >= 0 && durOf(list, extra) > limit && list.length > 2; i--) if (!list[i].core) list.splice(i, 1);
    while (durOf(list, extra) > limit && list.length > 2) list.splice(list.length - 1, 1);
    return list;
  }

  function safeBuild(tpl, c) {
    try { const r = tpl.build(c); return r && Array.isArray(r.exercises) ? r : null; } catch (e) { if (typeof console !== 'undefined') console.error(e); return null; }
  }

  function strip(items) {
    return items.map((x) => {
      const o = { ...x };
      delete o.estMin; delete o.core; delete o.warm;
      if (!U.isObj(o.target)) o.target = {};
      return o;
    });
  }

  function safetyFor(items, base, c) {
    const kit = C.data && C.data.sessionKit;
    const out = (base || []).filter(Boolean);
    if (kit && items.some((x) => x.apnea)) out.push(...kit.SAFETY_APNEA);
    if (kit && (c.injuries.genou || c.injuries.cheville) && items.some((x) => (+x.impact || 0) >= 1)) out.push(kit.SAFETY_PAIN);
    return [...new Set(out)];
  }

  // Construit une séance concrète d'un modèle pour un contexte donné.
  function realize(tid, c) {
    const tpl = TPL()[tid];
    if (!tpl) return null;
    const express = c.variant === 'express';
    const limit = express ? 30 : (+c.maxMin || 0);
    let vol = c.vol, best = null;
    for (let k = 0; k < 4; k++) {
      const cc = { ...c, vol, capMin: limit || undefined };
      const res = safeBuild(tpl, cc);
      if (!res) break;
      let items = res.exercises.slice();
      if (express) items = expressFilter(items);
      items = adaptItems(items, cc, tpl.loc);
      best = { res, items, dur: durOf(items, res.extraMin) };
      if (!limit || best.dur <= limit || tpl.fixed) break;
      vol = Math.max(0.3, vol * (limit / best.dur) * 0.95);
    }
    if (!best) return { templateId: tid, title: tpl.title, loc: tpl.loc, kind: tpl.kind, goals: (tpl.goals || []).slice(), durationMin: null, intro: 'Séance indisponible pour le moment.', safety: [], exercises: [], variant: c.variant };
    let { items } = best;
    if (limit && best.dur > limit) items = fitItems(items, best.res.extraMin, limit);
    const out = {
      templateId: tid, title: best.res.title || tpl.title, loc: tpl.loc, kind: tpl.kind, goals: (tpl.goals || []).slice(),
      durationMin: durOf(items, best.res.extraMin), intro: best.res.intro || '', safety: safetyFor(items, best.res.safety, c),
      exercises: strip(items), variant: c.variant, phase: c.phase,
    };
    if (best.res.checklist) out.checklist = best.res.checklist.slice();
    return out;
  }

  /* ───────── Séances perso ───────── */

  const customOf = (id) => (Array.isArray(st().customSessions) ? st().customSessions : []).find((x) => U.isObj(x) && x.id === id) || null;

  function customItems(cs) {
    return (Array.isArray(cs.exercises) ? cs.exercises : []).filter((e) => U.isObj(e) && e.exId).map((e) => {
      const info = exInfo(e.exId);
      const item = {
        exId: e.exId, name: e.name || info.name, track: info.track, sets: Math.max(1, Math.round(+e.sets || 1)),
        reps: e.reps == null ? '' : String(e.reps), target: U.isObj(e.target) ? { ...e.target } : {}, rest: Math.max(0, +e.rest || 0),
        note: e.note || '', impact: info.impact || 0,
      };
      if (info.apnea) item.apnea = true;
      if (info.alt && info.alt.length) item.alt = info.alt.slice();
      item.estMin = item.target.sec ? (item.sets * (item.target.sec + item.rest)) / 60 : (item.sets * (45 + item.rest)) / 60;
      return item;
    });
  }
  const customDuration = (cs) => durOf(customItems(cs), 5);

  function instantiateCustom(date, cs, variant, o) {
    const c = ctxFor(date, variant, o);
    let items = customItems(cs);
    if (variant === 'allege') items = items.map((x) => (x.sets > 1 ? { ...x, sets: Math.max(1, Math.round((x.sets * 2) / 3)), estMin: (x.estMin * Math.max(1, Math.round((x.sets * 2) / 3))) / x.sets } : x));
    items = adaptItems(items, c, cs.loc || 'autre');
    const limit = variant === 'express' ? 30 : +c.maxMin || 0;
    if (limit && durOf(items, 5) > limit) items = fitItems(items, 5, limit);
    return {
      templateId: null, customSessionId: cs.id, title: cs.name || 'Séance perso', loc: cs.loc || 'autre', kind: 'perso', goals: Array.isArray(cs.goals) ? cs.goals.slice() : [],
      durationMin: durOf(items, 5), intro: cs.intro || '', safety: safetyFor(items, [], c), exercises: strip(items), variant,
    };
  }

  /* ───────── Agenda (cours, Protection civile) ───────── */

  let agendaBusy = false; // garde contre les appels croisés (l'agenda peut lui-même lire le plan)
  const hasAgenda = () => !!(C.agenda && typeof C.agenda.dayInfo === 'function');
  function minuteOf(stamp, date, dflt) {
    if (typeof stamp !== 'string') return dflt;
    const d = stamp.slice(0, 10);
    if (d < date) return 0;
    if (d > date) return 1440;
    const m = stamp.match(/T(\d{2}):(\d{2})/);
    return m ? +m[1] * 60 + +m[2] : dflt;
  }
  const hhmm = (min) => `${U.pad(Math.floor(min / 60))}:${U.pad(min % 60)}`;
  const fmtH = (min) => (min % 60 ? `${Math.floor(min / 60)} h ${U.pad(min % 60)}` : `${Math.floor(min / 60)} h`);

  function agendaDay(date) {
    if (agendaBusy || !hasAgenda()) return null;
    let info = null;
    agendaBusy = true;
    try { info = C.agenda.dayInfo(date); } catch (e) { info = null; } finally { agendaBusy = false; }
    if (!U.isObj(info)) return null;
    const ag = st().agenda || {};
    const sources = Array.isArray(ag.sources) ? ag.sources : [];
    const kindOf = (e) => { const src = sources.find((x) => x.id === e.sourceId); return (src && src.kind) || e.kind || null; };
    const evs = Array.isArray(info.events) ? info.events.filter(U.isObj) : [];
    let pcMin = 0, allDayPC = false, coursEnd = -1;
    for (const e of evs) {
      const k = kindOf(e);
      if (k === 'protection-civile') {
        if (e.allDay) allDayPC = true;
        else pcMin += Math.max(0, minuteOf(e.end, date, 1440) - minuteOf(e.start, date, 0));
      } else if (k === 'cours' && !e.allDay) {
        coursEnd = Math.max(coursEnd, minuteOf(e.end, date, -1));
      }
    }
    if (!evs.length && info.hasCivilProtection && +info.busyMin >= 240) pcMin = +info.busyMin;
    let penalty = 0;
    const why = [];
    if (allDayPC || pcMin >= 240) { penalty += 40; why.push(allDayPC ? 'Protection civile toute la journée' : `Protection civile (${fmtH(pcMin)})`); }
    if (coursEnd > 19 * 60) { penalty += 40; why.push(`cours jusqu'à ${hhmm(Math.min(coursEnd, 1439))}`); }
    if (!penalty && +info.busyMin >= 480) { penalty += 4; why.push('journée chargée'); }
    return { penalty, full: allDayPC || pcMin >= 480, why: why.join(', ') };
  }

  /* ───────── Semaine : composition ───────── */

  // Ordre de priorité des créneaux selon la période (les premiers sont gardés quand il y a peu de séances).
  const COMPO = {
    reprise: ['hyrox', 'swim', 'run', 'strength', 'swim2', 'run2', 'mobility'],
    'base:hyrox': ['hyrox', 'swim', 'run', 'strength', 'swim2', 'run2', 'core'],
    'developpement:hyrox': ['hyrox', 'swim', 'run', 'strength', 'run2', 'swim2', 'core'],
    'specifique:hyrox': ['hyrox', 'run', 'swim', 'strength', 'run2', 'swim2', 'core'],
    'affutage:hyrox': ['hyrox', 'run', 'swim', 'run2', 'mobility', 'core', 'swim2'],
    'recuperation:hyrox': ['swim', 'mobility', 'run', 'core', 'swim2', 'strength', 'run2'],
    'base:ssa': ['swim', 'hyrox', 'swim2', 'run', 'strength', 'run2', 'core'],
    'developpement:ssa': ['swim', 'hyrox', 'swim2', 'run', 'strength', 'run2', 'core'],
    'specifique:ssa': ['swim', 'swim2', 'hyrox', 'run', 'strength', 'swim3', 'core'],
    'affutage:ssa': ['swim', 'hyrox', 'swim2', 'run', 'mobility', 'core', 'strength'],
    'specifique:pompier': ['icp', 'run', 'swim', 'strength', 'run2', 'swim2', 'core'],
    entretien: ['hyrox', 'swim', 'run', 'strength', 'run2', 'swim2', 'core'],
  };
  const isSwimSlot = (x) => /^swim/.test(x);
  const isHxSlot = (x) => x === 'hyrox' || x === 'run' || x === 'run2' || x === 'runTest';

  function weekContext(monday, days, P, prof, inj) {
    const wi = U.weeksBetween(P.start, monday);
    const thu = U.addDays(monday, 3);
    // Période dominante de la semaine (jours du plan hors jour J ; égalité → la plus tardive).
    const counts = new Map();
    for (const d of days) if (!d.raw.pre && d.raw.key !== 'jour-j') counts.set(rid(d.raw), (counts.get(rid(d.raw)) || 0) + 1);
    let dom = null, domN = 0;
    for (const d of days) {
      if (d.raw.pre || d.raw.key === 'jour-j') continue;
      const n = counts.get(rid(d.raw));
      if (n >= domN) { dom = d; domN = n; }
    }
    const ph = dom ? dom.ph : phaseWith(thu, P);
    const raw = dom ? dom.raw : rawPhase(thu, P);
    const race = P.races.find((r) => r.date >= monday) || null;
    const jal = P.jalons.find((j) => j.date >= monday) || null;
    const avail = new Set(Array.isArray(prof.availableDays) && prof.availableDays.length ? prof.availableDays : [0, 1, 2, 3, 4, 5, 6]);
    const week0 = U.weekDays(U.mondayOf(P.start)).filter((d, i) => d >= P.start && avail.has(i)).length;
    const swimUnknown = !prof.levels || !prof.levels.swim || /inconnu/i.test(String(prof.levels.swim));
    const testsOk = !['specifique', 'affutage', 'recuperation', 'jour-j'].includes(ph.key);
    let testSlot = null, forceBonus = false;
    if (wi === 2 && ph.key === 'reprise') { testSlot = 'run'; forceBonus = true; }
    else if (ph.deload && testsOk && wi >= 7) testSlot = ['force', 'run', 'swim'][Math.floor((wi - 7) / 4) % 3];
    return {
      monday, wi, key: ph.key, scope: raw.scope || null, ph, raw, deload: ph.deload,
      race, raceWo: race ? Math.floor(U.daysBetween(monday, race.date) / 7) : null, hx: (race || P.races.some((r) => r.date < monday)) ? hxKeyAt(thu, P) : null,
      jal, jalWo: jal ? Math.floor(U.daysBetween(monday, jal.date) / 7) : null,
      ssaActive: P.ssaGoals.some((g, i) => !P.ssaEnds[i] || P.ssaEnds[i] >= monday),
      raceUpcoming: !!race, pompierActive: P.pompiers.some((p) => p.date >= monday) || P.pompierUndated,
      entryPending: P.ssaGoals.some((g) => !U.isKey(g.details && g.details.entryTestDate) || g.details.entryTestDate >= monday),
      ssaEver: P.ssaEver, swimTest: swimUnknown && wi === (week0 >= 2 ? 0 : 1), testSlot, forceBonus,
      inj, legInj: !!(inj.genou || inj.cheville),
    };
  }

  function rotation(wk, idx) {
    let R;
    if (wk.ssaActive) R = wk.entryPending ? ['swim_technique', 'swim_ssa_entry', 'swim_endurance', 'swim_fins'] : ['swim_technique', 'swim_ssa_tsa', 'swim_endurance', 'swim_fins'];
    else R = wk.ssaEver ? ['swim_endurance', 'swim_ssa_tsa', 'swim_technique', 'swim_fins'] : ['swim_endurance', 'swim_technique', 'swim_endurance', 'swim_technique'];
    const w = Math.max(0, wk.wi);
    return R[[w % 4, (w + 2) % 4, (w + 1) % 4][idx] || 0];
  }

  function resolveSwim(wk, idx) {
    if (wk.key === 'recuperation' || (wk.key === 'affutage' && wk.scope === 'hyrox')) return idx === 0 ? 'swim_easy' : 'swim_technique';
    if (wk.key === 'reprise') return (Math.max(0, wk.wi) + idx) % 2 ? 'swim_endurance' : 'swim_technique';
    const J = wk.ssaActive ? wk.jal : null;
    if (J) {
      const spec = J.kind === 'entry' ? 'swim_ssa_entry' : 'swim_ssa_tsa';
      const sim = [1, 4, 7].includes(wk.jalWo); // simulations toutes les 3 semaines dans les 8 dernières
      const second = J.kind === 'tsa' ? 'swim_fins' : wk.wi % 2 ? 'swim_endurance' : 'swim_technique';
      const third = J.kind === 'tsa' ? 'swim_technique' : wk.wi % 2 ? 'swim_technique' : 'swim_endurance';
      if (wk.key === 'affutage' && wk.scope === 'ssa') return [sim ? 'swim_ssa_sim' : spec, 'swim_easy', 'swim_technique'][idx];
      if (wk.key === 'specifique' && wk.scope === 'ssa') return (sim ? ['swim_ssa_sim', spec, second] : [spec, second, third])[idx];
      if (sim && wk.jalWo === 7) return idx === 0 ? 'swim_ssa_sim' : rotation(wk, idx);
    }
    return rotation(wk, idx);
  }

  function resolveHyrox(wk) {
    if (wk.key === 'reprise') return 'gym_hybrid';
    if (!wk.race) return wk.pompierActive ? 'gym_icp' : 'gym_hybrid';
    switch (wk.hx) {
      case 'developpement': return 'gym_hyrox_dev';
      case 'specifique': return [6, 4, 3].includes(wk.raceWo) ? 'gym_hyrox_sim' : 'gym_hyrox_dev';
      case 'affutage': return 'gym_activation';
      case 'recuperation': return 'mobility';
      default: return 'gym_hybrid';
    }
  }

  function resolveRun(wk, idx) {
    if (wk.key === 'recuperation' || wk.key === 'reprise') return 'run_easy';
    const odd = Math.max(0, wk.wi) % 2 === 1;
    if (wk.race) {
      switch (wk.hx) {
        case 'affutage': return idx === 0 ? 'run_intervals' : 'run_easy';
        case 'specifique': return idx === 0 ? (odd ? 'run_intervals' : 'run_tempo') : 'run_long';
        case 'developpement': return idx === 0 ? (odd ? 'run_tempo' : 'run_intervals') : 'run_long';
        case 'recuperation': return 'run_easy';
        default: return idx === 0 ? (odd ? 'run_intervals' : 'run_easy') : 'run_easy';
      }
    }
    if (wk.pompierActive) return idx === 0 ? ['run_intervals', 'run_luc_leger_prep', 'run_easy'][Math.max(0, wk.wi) % 3] : 'run_easy';
    return idx === 0 ? (odd ? 'run_intervals' : 'run_easy') : 'run_easy';
  }

  function resolveStrength(wk) {
    if (wk.key === 'reprise') return 'home_strength';
    const odd = Math.max(0, wk.wi) % 2 === 1;
    if (wk.race && (wk.hx === 'developpement' || wk.hx === 'specifique')) return wk.raceWo <= 1 ? 'home_strength' : 'gym_force_lower';
    if (wk.race && wk.hx === 'base') return odd ? 'gym_force_lower' : 'home_strength';
    if (wk.scope === 'ssa') return 'home_strength';
    return odd ? 'gym_force_upper' : 'home_strength';
  }

  function resolveSlot(slot, wk) {
    switch (slot) {
      case 'hyrox': return resolveHyrox(wk);
      case 'icp': return 'gym_icp';
      case 'swim': return resolveSwim(wk, 0);
      case 'swim2': return resolveSwim(wk, 1);
      case 'swim3': return resolveSwim(wk, 2);
      case 'run': return resolveRun(wk, 0);
      case 'run2': return resolveRun(wk, 1);
      case 'strength': return resolveStrength(wk);
      case 'core': return 'home_core';
      case 'mobility': return 'mobility';
      case 'swimTest': return 'swim_test';
      case 'runTest': return 'run_test';
      case 'forceTest': return 'test_force';
      default: return 'gym_hybrid';
    }
  }

  function replaceLast(arr, val, ok) {
    for (let i = arr.length - 1; i >= 0; i--) if (ok(arr[i])) { arr[i] = val; return true; }
    return false;
  }

  // Liste des séances de la semaine (S séances), dans l'ordre de priorité.
  function compose(wk, S) {
    wk.forceBonusFinal = wk.forceBonus;
    if (S <= 0) return [];
    const list = COMPO[`${wk.key}:${wk.scope}`] || COMPO[wk.key] || COMPO.entretien;
    let chosen = list.slice(0, S);
    // Une épreuve dans la semaine compte pour son objectif (la course = séance HYROX, un test SSA = piscine).
    const needSwim = wk.ssaActive && !wk.ssaEventInWeek, needHx = wk.raceUpcoming && !wk.raceInWeek;
    if (S === 1 && needSwim && needHx) {
      const ssaFirst = wk.scope === 'ssa' && ['specifique', 'affutage'].includes(wk.key);
      const hxFirst = wk.scope === 'hyrox' && ['specifique', 'affutage', 'developpement'].includes(wk.key);
      chosen = [ssaFirst ? 'swim' : hxFirst ? 'hyrox' : Math.max(0, wk.wi) % 2 ? 'swim' : 'hyrox'];
    } else {
      if (needSwim && !chosen.some(isSwimSlot)) replaceLast(chosen, 'swim', (x) => !(needHx && isHxSlot(x) && chosen.filter(isHxSlot).length === 1));
      if (needHx && !chosen.some(isHxSlot)) replaceLast(chosen, 'hyrox', (x) => !(needSwim && isSwimSlot(x) && chosen.filter(isSwimSlot).length === 1));
    }
    // Séances de tests (début de plan, puis une semaine allégée sur trois pour chaque type).
    if (wk.swimTest || wk.testSlot === 'swim') { const i = chosen.findIndex(isSwimSlot); if (i >= 0) chosen[i] = 'swimTest'; }
    if (wk.testSlot === 'run') { const i = chosen.indexOf('run'); if (i >= 0) chosen[i] = 'runTest'; }
    if (wk.testSlot === 'force') { const i = chosen.indexOf('strength'); if (i >= 0) chosen[i] = 'forceTest'; else wk.forceBonusFinal = true; }
    return chosen.map((slot) => ({ slot, tid: resolveSlot(slot, wk) }));
  }

  /* ───────── Semaine : placement ───────── */

  function meta(tid) {
    const t = TPL()[tid] || {};
    return { tid, load: +t.load || 0, legs: +t.legs || 0, intense: !!t.intense, run: !!t.run, pool: t.loc === 'piscine' };
  }

  // Contraintes dures : simulation HYROX complète au plus tard à J-21, simulation SSA au plus tard à J-5.
  function hardPen(tid, date, wk) {
    if (tid === 'gym_hyrox_sim' && wk.race && wk.raceWo === 3 && U.daysBetween(date, wk.race.date) < 21) return 1000;
    if (tid === 'swim_ssa_sim' && wk.jal && U.daysBetween(date, wk.jal.date) < 5) return 1000;
    return 0;
  }

  function scoreWeek(week, wk) {
    let p = 0;
    for (let i = 0; i < 6; i++) {
      const a = week[i], b = week[i + 1];
      if (!a || !b) continue;
      if (a.legs >= 2 && b.intense) p += 10; // jambes lourdes la veille d'une séance de course intense
      if (a.load >= 2 && b.load >= 2) p += 6; // deux séances dures d'affilée
      if (a.pool && b.pool) p += 5; // deux piscines d'affilée
      if (a.run && b.run) p += wk.legInj ? 7 : 4; // impacts répétés (genou, cheville)
      if (a.tid === b.tid) p += 3;
      p += 1; // on préfère espacer
      if (i < 5 && week[i + 2]) p += 3; // trois jours d'affilée
    }
    return p;
  }

  // Recherche exhaustive : chaque séance sur un jour utilisable différent ; pénalité minimale,
  // à égalité la première trouvée (séance prioritaire au plus tôt) → résultat déterministe.
  function place(plan, usable, days, wk) {
    const res = new Map();
    if (!plan.length) return res;
    const metas = plan.map((p) => meta(p.tid));
    const base = new Array(7).fill(null);
    for (const d of days) if (d.blocked === 'event' && d.event) base[d.i] = { tid: 'event', load: 3, legs: d.event.kind === 'hyrox' ? 2 : 0, intense: true, run: d.event.kind === 'hyrox', pool: d.event.kind !== 'hyrox' };
    const dayPen = plan.map((p, k) => usable.map((d) => (d.agenda ? d.agenda.penalty * (1 + metas[k].load / 3) : 0) + hardPen(p.tid, d.date, wk)));
    let bestP = Infinity, best = null;
    const assign = new Array(plan.length);
    const used = new Array(usable.length).fill(false);
    const week = base.slice();
    (function dfs(k, acc) {
      if (acc >= bestP) return;
      if (k === plan.length) {
        const p = acc + scoreWeek(week, wk);
        if (p < bestP) { bestP = p; best = assign.slice(); }
        return;
      }
      for (let j = 0; j < usable.length; j++) {
        if (used[j]) continue;
        used[j] = true; assign[k] = j; week[usable[j].i] = metas[k];
        dfs(k + 1, acc + dayPen[k][j]);
        used[j] = false; week[usable[j].i] = base[usable[j].i];
      }
    })(0, 0);
    if (best) best.forEach((j, k) => res.set(usable[j].i, plan[k]));
    return res;
  }

  /* ───────── Semaine : jours ───────── */

  const WHY = {
    hyrox: 'Séance clé HYROX de la semaine.', icp: 'Préparation des tests pompier.', run: 'Course.', run2: 'Course.',
    strength: 'Force.', core: 'Abdos et gainage.', mobility: 'Récupération active.',
    swimTest: 'Tests natation : pour connaître ton niveau de départ.', runTest: 'Test chrono : pour calculer tes allures.',
    forceTest: 'Bilan force : pour ajuster ta progression.',
  };

  function reasonFor(item, d, wk) {
    let r;
    if (item.tid === 'gym_hyrox_sim') r = `Simulation HYROX (${U.relDays(U.daysBetween(d.date, wk.race.date)).replace('dans ', '')} avant la course).`;
    else if (item.tid === 'swim_ssa_sim' && wk.jal) r = `Simulation : ${wk.jal.title} ${U.relDays(U.daysBetween(d.date, wk.jal.date))}.`;
    else if (isSwimSlot(item.slot) && item.slot !== 'swimTest') {
      r = wk.scope === 'ssa' && wk.jal ? `Priorité SSA : ${wk.jal.title} le ${U.fmtShort(wk.jal.date)}.` : wk.ssaActive ? 'Piscine : préparation SSA.' : 'Piscine : entretien.';
    } else r = WHY[item.slot] || '';
    if (d.ph.deload) r = join(r, 'Semaine allégée.');
    if (d.agenda && d.agenda.penalty >= 40) r = join(r, `Journée chargée (${d.agenda.why}) : prends la version express si besoin.`);
    return r;
  }

  const BLOCK_WHY = {
    'avant-plan': 'Avant le début de ton plan.', veille: 'Repos : veille de l\'épreuve.', 'apres-course': 'Récupération après la course.',
  };

  function evInfo(ev) {
    return { goalId: ev.goal ? ev.goal.id : null, title: evTitle(ev), kind: ev.kind, checklist: ev.kind === 'hyrox' ? 'hyrox-jour-j' : ev.kind === 'entry' ? 'ssa-test' : 'ssa-tsa' };
  }

  function realizeOn(date, tid) { return realize(tid, ctxFor(date, 'normal')) || { title: (TPL()[tid] || {}).title || 'Séance', loc: (TPL()[tid] || {}).loc || 'autre', durationMin: null }; }

  function toDayPlan(d, item, bonus, wk) {
    const base = {
      date: d.date, kind: 'rest', templateId: null, customSessionId: null, title: 'Repos', loc: 'repos', durationMin: 0,
      optional: false, bonus: [], event: null, overridden: false, reason: '', phase: d.ph.key, blocked: d.blocked,
    };
    if (d.blocked === 'event' && d.event) {
      const tid = d.event.kind === 'hyrox' ? 'event_race' : 'event_ssa';
      const r = realizeOn(d.date, tid);
      return { ...base, kind: 'event', templateId: tid, title: r.title, loc: r.loc, durationMin: r.durationMin, event: evInfo(d.event), reason: 'Jour J : pas d\'entraînement.' };
    }
    if (item) {
      const r = realizeOn(d.date, item.tid);
      return { ...base, kind: 'session', templateId: item.tid, title: r.title, loc: r.loc, durationMin: r.durationMin, reason: reasonFor(item, d, wk) };
    }
    let reason = BLOCK_WHY[d.blocked] || 'Repos.';
    if (d.blocked === 'veille' && d.eve) reason = `Repos : veille ${d.eve.kind === 'hyrox' ? 'de la course' : 'du test'} (${evTitle(d.eve)}).`;
    if (d.blocked === 'agenda' || (d.agenda && d.agenda.penalty >= 40)) reason = `Repos : ${d.agenda.why}.`;
    if (bonus && bonus.length) {
      const names = bonus.map((tid) => { const r = realizeOn(d.date, tid); return `${r.title} (${r.durationMin} min)`; });
      return { ...base, bonus: bonus.slice(), optional: true, reason: join(reason, `En option : ${names.join(', ')}.`) };
    }
    return { ...base, reason };
  }

  // Bonus facultatifs (1 ou 2 jours de repos) : bilan force éventuel, cheville/genou si blessure, abdos.
  function pickBonus(days, placed, wk) {
    const list = [];
    if (wk.forceBonusFinal) list.push('test_force');
    if (wk.legInj) list.push('home_rehab');
    list.push(['affutage', 'recuperation'].includes(wk.key) ? 'mobility' : 'home_core');
    const max = Math.min(2, list.length, wk.legInj || wk.forceBonusFinal ? 2 : 1);
    const cand = days.filter((d) => (!d.blocked || d.blocked === 'agenda') && !placed.has(d.i) && !(d.agenda && d.agenda.penalty >= 40));
    const score = (d) => (d.i > 0 && placed.has(d.i - 1) ? 0 : 1);
    cand.sort((a, b) => score(a) - score(b) || a.i - b.i);
    const out = new Map();
    for (let k = 0; k < max && k < cand.length; k++) out.set(cand[k].i, [list[k]]);
    return out;
  }

  function computeLayout(monday) {
    const s = st(), prof = U.isObj(s.profile) ? s.profile : {}, P = prep();
    const dates = U.weekDays(monday);
    const N = U.clamp(Math.round(+prof.sessionsPerWeek || 3), 1, 7);
    const avail = new Set(Array.isArray(prof.availableDays) && prof.availableDays.length ? prof.availableDays : [0, 1, 2, 3, 4, 5, 6]);
    const { inj } = injuriesOf(prof);
    const evOn = (d) => P.races.find((r) => r.date === d) || P.jalons.find((j) => j.date === d) || null;
    const days = dates.map((date, i) => {
      const d = { date, i, ph: phaseWith(date, P), raw: rawPhase(date, P), blocked: null, agenda: null, event: null, eve: null };
      const tomorrow = evOn(U.addDays(date, 1));
      const lastRace = [...P.races].reverse().find((r) => r.date < date);
      if (date < P.start) d.blocked = 'avant-plan';
      else if (d.raw.key === 'jour-j') { d.blocked = 'event'; d.event = d.raw.event; }
      else if (tomorrow) { d.blocked = 'veille'; d.eve = tomorrow; }
      else if (lastRace && U.daysBetween(lastRace.date, date) <= 2) d.blocked = 'apres-course';
      else {
        d.agenda = agendaDay(date);
        if (d.agenda && d.agenda.full) d.blocked = 'agenda';
      }
      return d;
    });
    const events = days.filter((d) => d.blocked === 'event').length;
    const usable = days.filter((d) => !d.blocked && avail.has(d.i));
    const S = Math.max(0, Math.min(N - events, usable.length));
    const wk = weekContext(monday, days, P, prof, inj);
    wk.raceInWeek = days.some((d) => d.event && d.event.kind === 'hyrox');
    wk.ssaEventInWeek = days.some((d) => d.event && d.event.kind !== 'hyrox');
    const plan = compose(wk, S);
    const placed = place(plan, usable, days, wk);
    const bonus = pickBonus(days, placed, wk);
    return { monday, days: days.map((d) => toDayPlan(d, placed.get(d.i), bonus.get(d.i), wk)), sessions: S };
  }

  const layoutMemo = new Map();
  function layoutSig() {
    const s = st(), p = U.isObj(s.profile) ? s.profile : {}, ag = U.isObj(s.agenda) ? s.agenda : {};
    const evs = Array.isArray(ag.events) ? ag.events : [];
    const agSig = hasAgenda() ? [evs.length, evs.length ? [evs[0].id, evs[evs.length - 1].id] : null,
      (Array.isArray(ag.sources) ? ag.sources : []).map((x) => x && [x.id, x.kind, x.busy, x.lastSyncAt, x.count])] : null;
    const bench = Object.entries(U.isObj(s.benchmarks) ? s.benchmarks : {}).map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : 0}`).join(',');
    return JSON.stringify([goalsSig(s), p.sessionsPerWeek, p.availableDays, p.injuries, p.maxSessionMin, p.pools, p.levels && p.levels.swim, p.sex,
      agSig, agendaBusy, bench, !!C.metrics, Object.keys(TPL()).length]);
  }
  function weekLayout(monday) {
    const key = `${monday}|${layoutSig()}`;
    const hit = layoutMemo.get(key);
    if (hit) return hit;
    const lay = computeLayout(monday);
    if (layoutMemo.size > 400) layoutMemo.clear();
    layoutMemo.set(key, lay);
    return lay;
  }

  /* ───────── API publique ───────── */

  const overrides = () => { const p = st().plan; return p && U.isObj(p.overrides) ? p.overrides : {}; };
  const copyPlan = (dp) => ({ ...dp, bonus: (dp.bonus || []).slice(), event: dp.event ? { ...dp.event } : null });

  function fromOverride(date, ov, base) {
    const T = TPL();
    const o = { ...base, overridden: true, bonus: [], optional: false, event: null, blocked: null };
    if (ov.rest) return { ...o, kind: 'rest', templateId: null, customSessionId: null, title: 'Repos', loc: 'repos', durationMin: 0, reason: 'Repos choisi par toi.' };
    if (ov.free) return { ...o, kind: 'session', templateId: null, customSessionId: null, title: 'Séance libre', loc: 'autre', durationMin: null, reason: 'Séance libre choisie par toi.' };
    if (ov.customSessionId) {
      const cs = customOf(ov.customSessionId);
      if (cs) return { ...o, kind: 'session', templateId: null, customSessionId: cs.id, title: cs.name || 'Séance perso', loc: cs.loc || 'autre', durationMin: customDuration(cs), reason: 'Séance perso choisie par toi.' };
    }
    if (ov.templateId && T[ov.templateId]) {
      const tid = ov.templateId, isEv = T[tid].kind === 'event';
      const r = realizeOn(date, tid);
      const P = prep();
      const ev = isEv ? (P.races.find((x) => x.date === date) || P.jalons.find((x) => x.date === date)) : null;
      return { ...o, kind: isEv ? 'event' : 'session', templateId: tid, customSessionId: null, title: r.title, loc: r.loc, durationMin: r.durationMin,
        event: ev ? evInfo(ev) : null, reason: 'Séance choisie par toi.' };
    }
    return { ...base, reason: join(base.reason, '(Ton choix pour ce jour n\'existe plus : plan d\'origine.)') };
  }

  // DayPlan d'un jour (changements manuels compris).
  function day(date) {
    if (!U.isKey(date)) return null;
    const base = weekLayout(U.mondayOf(date)).days[U.dow(date)];
    const ov = overrides()[date];
    return copyPlan(U.isObj(ov) ? fromOverride(date, ov, base) : base);
  }

  function week(monday) {
    if (!U.isKey(monday)) return [];
    return U.weekDays(U.mondayOf(monday)).map(day);
  }

  // Contenu concret d'une séance (sans templateId ni customSessionId : la séance prévue ce jour-là).
  // Options en plus du contrat : poolId ou poolLength (bassin choisi avant d'enregistrer).
  function instantiate(date, opts = {}) {
    const o = U.isObj(opts) ? opts : {};
    const variant = VARIANTS.includes(o.variant) ? o.variant : 'normal';
    const d = U.isKey(date) ? date : U.todayKey();
    let tid = o.templateId || null, cid = o.customSessionId || null;
    if (!tid && !cid) {
      const dp = day(d);
      if (dp && dp.customSessionId) cid = dp.customSessionId;
      else if (dp && dp.templateId) tid = dp.templateId;
      else if (dp && dp.kind === 'rest') tid = (dp.bonus && dp.bonus[0]) || 'rest';
    }
    if (cid) {
      const cs = customOf(cid);
      if (cs) return instantiateCustom(d, cs, variant, o);
      return { templateId: null, customSessionId: cid, title: 'Séance perso introuvable', loc: 'autre', kind: 'perso', goals: [], durationMin: null,
        intro: 'Cette séance perso n\'existe plus : choisis-en une autre.', safety: [], exercises: [], variant };
    }
    if (!tid) return { templateId: null, title: 'Séance libre', loc: 'autre', kind: 'libre', goals: [], durationMin: null, intro: '', safety: [], exercises: [], variant };
    if (!TPL()[tid]) {
      return { templateId: tid, title: 'Séance introuvable', loc: 'autre', kind: null, goals: [], durationMin: null,
        intro: 'Cette séance n\'existe plus : choisis-en une autre.', safety: [], exercises: [], variant };
    }
    return realize(tid, ctxFor(d, variant, o));
  }

  // Frise des blocs : périodes consécutives fusionnées.
  function macro(from, to) {
    if (!U.isKey(from) || !U.isKey(to) || to < from) return [];
    const P = prep();
    const start = U.maxKey(from, P.start);
    const end = U.minKey(to, U.addDays(start, 2200));
    const out = [];
    let last = null;
    for (let d = start; d <= end; d = U.addDays(d, 1)) {
      const r = rawPhase(d, P);
      const id = rid(r);
      if (last && last.id === id) { last.seg.end = d; continue; }
      const seg = { start: d, end: d, key: r.key, label: labelOf(r), goalId: r.goal ? r.goal.id : null };
      out.push(seg);
      last = { id, seg };
    }
    return out;
  }

  function normOverride(o) {
    if (!U.isObj(o)) return null;
    if (o.rest) return { rest: true };
    if (o.free) return { free: true };
    if (o.customSessionId) return { customSessionId: String(o.customSessionId) };
    if (o.templateId && TPL()[o.templateId]) return { templateId: String(o.templateId) };
    return null;
  }

  function writeOverrides(changes) {
    const apply = (s) => {
      if (!U.isObj(s.plan)) s.plan = { startDate: U.todayKey(), overrides: {} };
      if (!U.isObj(s.plan.overrides)) s.plan.overrides = {};
      for (const [date, ov] of changes) { if (ov) s.plan.overrides[date] = ov; else delete s.plan.overrides[date]; }
    };
    if (C.store && typeof C.store.update === 'function') C.store.update(apply); else apply(st());
  }

  // override : { templateId } | { customSessionId } | { rest:true } | { free:true } ; null = revenir au plan.
  function setOverride(date, override) {
    if (!U.isKey(date)) return false;
    const clean = override == null ? null : normOverride(override);
    if (override != null && !clean) return false;
    writeOverrides([[date, clean]]);
    return true;
  }

  const toOverride = (dp) => (dp.kind === 'rest' ? { rest: true } : dp.customSessionId ? { customSessionId: dp.customSessionId } : dp.templateId ? { templateId: dp.templateId } : { free: true });

  // Échange le contenu de deux jours. Refusé pour un jour d'épreuve (course, test SSA).
  function swapDays(dateA, dateB) {
    if (!U.isKey(dateA) || !U.isKey(dateB) || dateA === dateB) return false;
    const a = day(dateA), b = day(dateB);
    if ((a.kind === 'event' && !a.overridden) || (b.kind === 'event' && !b.overridden)) return false;
    writeOverrides([[dateA, toOverride(b)], [dateB, toOverride(a)]]);
    return true;
  }

  const CATALOG = ['swim_technique', 'swim_endurance', 'swim_ssa_entry', 'swim_ssa_tsa', 'swim_fins', 'swim_ssa_sim', 'swim_test', 'swim_easy',
    'gym_hybrid', 'gym_hyrox_dev', 'gym_hyrox_sim', 'gym_force_lower', 'gym_force_upper', 'gym_icp', 'gym_activation',
    'run_easy', 'run_intervals', 'run_tempo', 'run_long', 'run_test', 'run_luc_leger_prep',
    'home_strength', 'home_core', 'home_rehab', 'mobility', 'test_force'];

  // Séances proposées pour « changer la séance » : celle du plan, les bonus, le catalogue, puis les séances perso.
  function choices(date) {
    if (!U.isKey(date)) return [];
    const dp = day(date), T = TPL(), out = [], seen = new Set();
    const types = new Set((Array.isArray(st().goals) ? st().goals : []).filter((g) => g && g.status === 'active').map((g) => g.type));
    const push = (tid) => {
      if (seen.has(tid) || !T[tid]) return;
      seen.add(tid);
      const r = realizeOn(date, tid);
      out.push({ templateId: tid, title: r.title, loc: r.loc, kind: T[tid].kind, durationMin: r.durationMin, goals: (T[tid].goals || []).slice(),
        planned: !!dp && dp.templateId === tid, recommended: (T[tid].goals || []).some((g) => types.has(g)) });
    };
    if (dp && dp.templateId) push(dp.templateId);
    if (dp && dp.bonus) dp.bonus.forEach(push);
    CATALOG.forEach(push);
    for (const cs of Array.isArray(st().customSessions) ? st().customSessions : []) {
      if (!U.isObj(cs) || !cs.id) continue;
      out.push({ customSessionId: cs.id, title: cs.name || 'Séance perso', loc: cs.loc || 'autre', kind: 'perso', durationMin: customDuration(cs),
        goals: Array.isArray(cs.goals) ? cs.goals.slice() : [], planned: !!dp && dp.customSessionId === cs.id, recommended: false });
    }
    return out;
  }

  function clearCache() { layoutMemo.clear(); prepMemo = null; }

  C.planner = {
    phase, day, week, instantiate, macro, setOverride, swapDays, choices, clearCache,
    // Fonctions internes exposées pour les tests.
    _: { prep, rawPhase: (d) => rawPhase(d, prep()), ctxFor, realize, compose, place, scoreWeek, weekLayout, adaptItems, simStageFor, hyroxKey, VARIANTS, CATALOG },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
