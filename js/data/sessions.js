/* Crevare — modèles de séances paramétrés → C.data.sessionTemplates.
 *
 * Chaque modèle : { id, title, loc, kind, goals, summary, load, legs, intense, run, fixed?, build(ctx) }
 *   build(ctx) → { title?, durationMin, intro, safety?, checklist?, exercises:[ExerciseItem sans key] }
 *   load (0–3), legs (0–2), intense, run : repères utilisés par le planificateur pour répartir la semaine.
 *   fixed : format imposé (tests, simulations, jour J) : le planificateur ne filtre pas la séance (variante
 *           « express ») et ne réduit pas le volume, le modèle s'adapte lui-même.
 *
 * ctx vient du planificateur (js/core/planner.js) ; ctxOf() complète ce qui manque pour qu'un appel
 * direct (tests, bibliothèque) fonctionne aussi. Aucun aléa : même ctx → même séance.
 * Les exercices n'utilisent que les identifiants canoniques (docs/ARCHITECTURE.md). Champs internes des
 * exercices renvoyés par build() : estMin (minutes estimées), core (essentiel pour « express »), warm
 * (échauffement) — le planificateur les retire avant de créer la séance. */
(function (C) {
  'use strict';
  const U = C.util;
  const D = (C.data = C.data || {});
  const clamp = U.clamp;

  /* ───────── Repli : infos minimales des exercices canoniques ─────────
   * Sert seulement si js/data/exercises.js n'est pas chargé (tests isolés) ou s'il lui manque un id.
   * [nom, track, impact, stress, alt, apnée] */
  const GK = ['genou', 'cheville'];
  const FALLBACK = {
    swim_warmup: ['Échauffement nages variées', 'dist', 0], swim_drills: ['Éducatifs crawl', 'check', 0],
    swim_crawl_easy: ['Crawl souple', 'dist', 0], swim_crawl_25: ['25 m crawl rapide', 'time', 0],
    swim_crawl_50: ['50 m crawl soutenu', 'time', 0], swim_crawl_100: ['100 m crawl', 'time', 0],
    swim_crawl_200: ['200 m crawl', 'time', 0], swim_crawl_400: ['400 m crawl', 'time', 0],
    swim_kick: ['Battements ventral sans planche', 'check', 0],
    swim_back_legs: ["Dos jambes seules, mains hors de l'eau", 'time', 0], swim_eggbeater: ['Rétropédalage', 'time', 0],
    swim_breast_glide: ['Brasse coulée longue glisse', 'check', 0],
    swim_head_up: ["Crawl tête hors de l'eau (nage d'approche)", 'time', 0], swim_dive_start: ['Plongeon du bord', 'check', 0],
    swim_50_test: ['50 m nage libre chrono', 'time', 0], swim_cooldown: ['Retour au calme', 'check', 0],
    apnea_breath_dry: ['Respiration et récupération à sec (assis)', 'check', 0],
    apnea_dynamic: ['Apnée dynamique', 'dist', 0, [], ['swim_crawl_25'], true],
    apnea_dive_15: ['Plongeon + 15 m en immersion', 'time', 0, [], ['swim_dive_start'], true],
    duck_dive: ['Plongée canard', 'reps', 0, [], [], true], duck_dive_object: ['Canard + objet lesté au fond', 'reps', 0, [], [], true],
    manikin_lift: ['Remontée du mannequin (saisie, mise en surface)', 'reps', 0, [], ['duck_dive_object'], true],
    manikin_tow: ['Remorquage du mannequin', 'time', 0, [], ['partner_tow']], partner_tow: ["Remorquage d'un partenaire", 'time', 0],
    rescue_entries: ["Entrées à l'eau de sauvetage", 'check', 0], fins_don: ['Chaussage des palmes chronométré', 'time', 0],
    fins_kick: ['Battements avec palmes', 'check', 0], fins_100: ['100 m palmes', 'time', 0], fins_300: ['300 m palmes', 'time', 0],
    ssa_entry_test: ["Test d'entrée SSA complet (100 m)", 'time', 0, [], [], true],
    ssa_tsa_course: ['Parcours de sauvetage TSA (100 m)', 'time', 0, [], [], true],
    run_warmup: ['Échauffement footing + gammes', 'check', 1, GK, ['bike_easy', 'walk_brisk']],
    run_drills: ['Gammes athlétiques', 'check', 1, GK, ['walk_brisk']],
    run_easy: ['Footing en endurance fondamentale', 'run', 1, GK, ['bike_easy', 'walk_brisk']],
    run_long: ['Sortie longue', 'run', 1, GK, ['bike_easy', 'walk_brisk']], run_strides: ['Lignes droites accélérées', 'check', 1, GK, ['bike_easy']],
    run_3030: ['30 s vite / 30 s lent', 'check', 1, GK, ['bike_easy']], run_400: ['400 m rapide', 'time', 1, GK, ['bike_easy']],
    run_1k_rep: ['1 km allure soutenue (fractionné)', 'time', 1, GK, ['row_erg', 'bike_easy']],
    run_tempo: ['Allure seuil', 'run', 1, GK, ['bike_easy']], run_1k_test: ['1 km chrono', 'time', 1, GK],
    run_5k_test: ['5 km chrono', 'time', 1, GK], run_shuttle: ['Navettes 20 m avec demi-tour', 'reps', 2, GK, ['run_3030', 'bike_easy']],
    luc_leger: ['Test Luc Léger', 'palier', 2, GK, ['bike_easy']], treadmill_easy: ['Tapis en endurance', 'run', 1, GK, ['bike_easy']],
    treadmill_1k: ['1 km sur tapis', 'time', 1, GK, ['row_erg', 'bike_easy']], bike_easy: ['Vélo / elliptique (sans impact)', 'time', 0],
    walk_brisk: ['Marche rapide', 'time', 0], run_cooldown: ['Retour au calme', 'check', 0],
    skierg: ['SkiErg', 'time', 0], row_erg: ['Rameur', 'time', 0], sled_push: ['Sled push', 'load', 1, GK, ['leg_press']],
    sled_pull: ['Sled pull', 'load', 0, [], ['seated_row']],
    burpee_broad_jump: ['Burpee broad jumps', 'time', 2, GK, ['burpee_step_back']], burpee: ['Burpees', 'reps', 2, GK, ['burpee_step_back']],
    burpee_step_back: ['Burpee sans saut (pas en arrière)', 'reps', 0], farmers_carry: ['Farmers carry', 'load', 0],
    sandbag_lunge: ['Fentes avec sandbag', 'load', 1, ['genou'], ['split_squat_db']], wall_ball: ['Wall balls', 'reps', 1, ['genou'], ['goblet_squat']],
    hyrox_run_station: ['1 km + station (enchaîné)', 'time', 1, GK, ['row_erg', 'bike_easy']],
    goblet_squat: ['Squat goblet', 'load', 0], back_squat: ['Squat barre', 'load', 0], leg_press: ['Presse à cuisses', 'load', 0],
    split_squat_db: ['Fente arrière aux haltères', 'load', 0], rdl: ['Soulevé de terre jambes semi-tendues', 'load', 0],
    hip_thrust: ['Hip thrust', 'load', 0], leg_curl: ['Leg curl', 'load', 0], step_up: ['Montée sur banc', 'load', 0],
    calf_raise: ['Mollets debout', 'load', 0], bench_press: ['Développé couché', 'load', 0], db_press: ['Développé militaire haltères', 'load', 0],
    lat_pulldown: ['Tirage vertical', 'load', 0], seated_row: ['Tirage horizontal', 'load', 0], db_row: ['Rowing haltère', 'load', 0],
    assisted_pullup: ['Traction assistée (machine)', 'load', 0], cable_face_pull: ['Face pull à la poulie', 'load', 0],
    pallof_press: ['Pallof press', 'load', 0], band_warmup: ["Échauffement épaules à l'élastique", 'check', 0],
    dead_hang: ['Suspension à la barre', 'time', 0], scap_pullup: ['Tractions scapulaires', 'reps', 0],
    pullup_negative: ['Traction négative (descente lente)', 'reps', 0], pullup_band: ['Traction avec élastique', 'reps', 0],
    pullup_strict: ['Traction stricte (pronation)', 'reps', 0], chinup_strict: ['Traction supination (ICP)', 'reps', 0],
    band_row: ["Rowing à l'élastique", 'reps', 0], band_face_pull: ["Face pull à l'élastique", 'reps', 0],
    band_pull_apart: ["Écartés à l'élastique", 'reps', 0], pushup: ['Pompes', 'reps', 0], pushup_incline: ['Pompes inclinées', 'reps', 0],
    pushup_cadence: ['Pompes en cadence (ICP)', 'reps', 0], chair_dips: ['Dips entre deux chaises', 'reps', 0],
    squat_bw: ['Squat au poids du corps', 'reps', 0], split_squat_bw: ['Fente statique', 'reps', 0], reverse_lunge: ['Fente arrière', 'reps', 0],
    wall_sit: ['Chaise contre le mur (Killy)', 'time', 0], glute_bridge: ['Pont fessier', 'reps', 0],
    hanging_knee_raise: ['Relevés de genoux à la barre', 'reps', 0], squat_jump: ['Squats sautés', 'reps', 2, GK, ['squat_bw', 'glute_bridge']],
    jumping_jack: ['Jumping jacks', 'time', 2, GK, ['squat_bw']], mountain_climber: ['Mountain climbers', 'time', 1, ['poignet'], ['plank']],
    plank: ['Planche', 'time', 0], side_plank: ['Planche latérale', 'time', 0], hollow_hold: ['Hollow hold', 'time', 0],
    dead_bug: ['Dead bug', 'reps', 0], bird_dog: ['Bird dog', 'reps', 0], superman: ['Superman', 'reps', 0], crunch: ['Crunch', 'reps', 0],
    russian_twist: ['Rotations russes', 'reps', 0], leg_raise_floor: ['Relevés de jambes au sol', 'reps', 0],
    single_leg_balance: ['Équilibre sur une jambe', 'time', 0], calf_raise_eccentric: ['Mollets excentriques sur une marche', 'reps', 0],
    tibialis_raise: ['Relevés de pointe de pied (tibial)', 'reps', 0], ankle_band: ["Cheville à l'élastique (4 directions)", 'reps', 0],
    ankle_knee_to_wall: ['Mobilité cheville genou-au-mur', 'reps', 0], spanish_squat: ['Squat espagnol isométrique (élastique)', 'time', 0],
    step_down: ['Descente de marche contrôlée', 'reps', 0], tke_band: ["Extension terminale du genou à l'élastique", 'reps', 0],
    nordic_hamstring: ['Nordic hamstring (assisté)', 'reps', 0], copenhagen_plank: ['Planche de Copenhague (adducteurs)', 'time', 0],
    mob_hips: ['Mobilité hanches (90/90)', 'check', 0], mob_thoracic: ['Mobilité thoracique', 'check', 0],
    mob_shoulders: ['Mobilité épaules', 'check', 0], stretch_hamstrings: ['Étirement ischios (flexion avant)', 'time', 0],
    sit_and_reach: ['Souplesse : flexion avant jambes tendues (mesure)', 'cm', 0], foam_roll: ['Rouleau de massage', 'check', 0],
    test_pullup_max: ['Tractions max (pronation)', 'reps', 0], test_chinup_max: ['Tractions max (supination, ICP)', 'reps', 0],
    test_pushup_max: ['Pompes max', 'reps', 0], test_plank_max: ['Planche max', 'time', 0], test_wall_sit_max: ['Chaise max (Killy)', 'time', 0],
  };
  // Exercices unilatéraux (côté gauche puis droit dans les minuteurs de repli).
  const SIDED = new Set(['side_plank', 'single_leg_balance', 'step_down', 'copenhagen_plank', 'tke_band']);

  // Infos d'un exercice : bibliothèque (exercises.js, exercices perso) d'abord, repli sinon.
  function exInfo(exId) {
    let e = null;
    try { e = D.getExercise ? D.getExercise(exId) : null; } catch (err) { e = null; }
    const f = FALLBACK[exId];
    if (!e && !f) return { id: exId, name: String(exId || 'Exercice'), track: 'check', impact: 0, stress: [], alt: [], apnea: false, known: false };
    const pick = (k, i, dflt) => (e && e[k] != null ? e[k] : f && f[i] != null ? f[i] : dflt);
    return {
      id: exId, name: pick('name', 0, exId), track: pick('track', 1, 'check'), impact: +pick('impact', 2, 0) || 0,
      stress: Array.isArray(pick('stress', 3, [])) ? pick('stress', 3, []) : [], alt: Array.isArray(pick('alt', 4, [])) ? pick('alt', 4, []) : [],
      apnea: !!(e ? e.apnea : f && f[5]), sides: !!(e ? e.sides : SIDED.has(exId)), workSec: e && e.workSec, known: true,
    };
  }

  /* ───────── Contexte ───────── */

  const LEVEL_OF = { reprise: 'reprise', base: 'base', developpement: 'dev', specifique: 'spe', affutage: 'spe', 'jour-j': 'spe', recuperation: 'base', entretien: 'base' };
  const PHASE_VOL = { reprise: 0.7, affutage: 0.5, recuperation: 0.5 };
  const VARIANT_VOL = { allege: 2 / 3, doux: 0.8 };
  const VARIANTS = ['normal', 'allege', 'express', 'doux'];
  const POOLS = [25, 33, 50];

  // Complète un contexte partiel (valeurs par défaut sûres).
  function ctxOf(raw) {
    const c = Object.assign({}, raw || {});
    c.phase = LEVEL_OF[c.phase] ? c.phase : 'base';
    c.level = ['reprise', 'base', 'dev', 'spe'].includes(c.level) ? c.level : LEVEL_OF[c.phase];
    c.variant = VARIANTS.includes(c.variant) ? c.variant : 'normal';
    c.weekIndex = Number.isFinite(+c.weekIndex) ? Math.max(0, Math.floor(+c.weekIndex)) : 0;
    c.weekInPhase = Math.max(1, Math.floor(+c.weekInPhase || 1));
    if (!(+c.vol > 0)) c.vol = (PHASE_VOL[c.phase] || 1) * (c.deload ? 0.65 : 1) * (VARIANT_VOL[c.variant] || 1);
    c.vol = clamp(+c.vol, 0.3, 1.2);
    c.profile = U.isObj(c.profile) ? c.profile : {};
    c.injuries = U.isObj(c.injuries) ? c.injuries : {};
    c.injuryLabels = U.isObj(c.injuryLabels) ? c.injuryLabels : {};
    c.pool = U.isObj(c.pool) ? c.pool : null;
    c.poolLength = POOLS.includes(+c.poolLength) ? +c.poolLength : c.pool && POOLS.includes(+c.pool.length) ? +c.pool.length : 25;
    const best = typeof c.best === 'function' ? c.best : null;
    c.best = (id) => { try { const v = best ? best(id) : null; return U.num(v) != null && U.num(v) > 0 ? U.num(v) : null; } catch (e) { return null; } };
    c.hyrox = U.isObj(c.hyrox) ? c.hyrox : null;
    c.ssa = U.isObj(c.ssa) ? c.ssa : null;
    c.goal = U.isObj(c.goal) ? c.goal : null;
    return c;
  }

  /* ───────── Outils ───────── */

  const r5 = (kg) => Math.max(5, Math.round(kg / 5) * 5);
  const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
  // Séries ajustées au volume du jour (jamais moins de `min`).
  const sv = (c, n, min = 1) => Math.max(min, Math.round(n * c.vol));
  // Minutes ajustées au volume (arrondies à 5 au-delà de 15 min).
  const mv = (c, n, min = 5) => { const x = n * c.vol; return Math.max(min, x >= 15 ? Math.round(x / 5) * 5 : Math.round(x)); };
  const fmtT = (sec) => U.formatDuration(Math.round(sec));
  const join = (...parts) => parts.filter(Boolean).join(' ');

  // Longueurs de bassin : « 8 longueurs », « ½ longueur », « ≈ 2,4 longueurs ».
  function lapsTxt(m, L) {
    const n = m / L;
    if (Math.abs(n - Math.round(n)) < 1e-9) return U.plural(Math.round(n), 'longueur', 'longueurs');
    if (Math.abs(n - 0.5) < 1e-9) return '½ longueur';
    return `≈ ${U.fmtNum(n, 1)} longueurs`;
  }

  // Distance continue ajustée au volume, en allers-retours complets (on finit au mur de départ).
  function pv(c, m, minM) {
    const step = 2 * c.poolLength;
    const n = Math.max(Math.ceil((minM || step) / step), Math.round((m * c.vol) / step));
    return n * step;
  }
  // Longueurs pour le bassin du jour (dans la note, le bassin est rappelé : la séance peut changer de piscine).
  function lapNote(c, m) {
    if (!(m > 0)) return '';
    if (m < c.poolLength) return `Bassin de ${c.poolLength} m : ${lapsTxt(m, c.poolLength)}, arrête-toi à ${m} m (repère au bord ou ligne de fond).`;
    return `${m} m = ${lapsTxt(m, c.poolLength)} (bassin de ${c.poolLength} m).`;
  }
  const swimMin = (m, perHundred = 150) => (m * perHundred) / 6000;

  // Allures de course à partir des tests (5 km, sinon 1 km via Riegel). Secondes par km.
  function paces(c) {
    const b5 = c.best('run_5k'), b1 = c.best('run_1k');
    const p5 = b5 ? b5 / 5 : b1 ? (b1 * Math.pow(5, 1.06)) / 5 : null;
    if (!p5) return null;
    return { p5, easy: p5 + 75, tempo: p5 + 18, fast: p5 - 8, race: p5 + 25 };
  }
  const kmh = (secPerKm) => U.fmtNum(3600 / secPerKm, 1);
  const paceTxt = (s) => `${U.fmtPace(Math.round(s))} (${kmh(s)} km/h)`;

  // Charges HYROX selon la division de l'objectif (goals.js), repli Open hommes / femmes.
  const LOADS_FALLBACK = {
    men: { sledPushKg: 152, sledPullKg: 103, farmersKg: 24, sandbagKg: 20, wallBallKg: 6, wallBallTargetM: 3 },
    women: { sledPushKg: 102, sledPullKg: 78, farmersKg: 16, sandbagKg: 10, wallBallKg: 4, wallBallTargetM: 2.7 },
  };
  function hxLoads(c) {
    const h = c.hyrox || {};
    const sex = c.profile.sex === 'F' ? 'F' : 'H';
    const cat = ['men', 'women', 'mixed'].includes(h.category) ? h.category : sex === 'F' ? 'women' : 'men';
    let L = null;
    try { L = D.hyroxLoads ? D.hyroxLoads(h.division || 'solo', cat, h.level || 'open') : null; } catch (e) { L = null; }
    if (L && L.perSex) L = L.perSex[sex];
    if (!L || !(L.sledPushKg > 0)) L = cat === 'women' ? LOADS_FALLBACK.women : LOADS_FALLBACK.men;
    return L;
  }
  const isDoubles = (c) => !!(c.hyrox && c.hyrox.division === 'doubles');

  // Blessures (zones actives) : textes « genou gauche », adaptations.
  const legHurt = (c) => !!(c.injuries.genou || c.injuries.cheville);
  const noJump = (c) => legHurt(c) || c.variant === 'doux';
  const injTxt = (c, zones) => (zones || ['genou', 'cheville']).filter((z) => c.injuries[z]).map((z) => c.injuryLabels[z] || z).join(' et ');
  function adaptNote(c, zones) { const t = injTxt(c, zones); return t ? `Adapté : ${t}.` : c.variant === 'doux' ? 'Version douce.' : ''; }
  const kneeNote = (c) => (c.injuries.genou ? `${c.injuryLabels.genou || 'Genou'} : amplitude sans douleur (3/10 maximum), descente contrôlée.` : '');
  const sideFirst = (c) => {
    const l = c.injuryLabels.genou || c.injuryLabels.cheville || '';
    const side = /gauche/.test(l) ? 'gauche' : /droit/.test(l) ? 'droite' : '';
    return side ? `Commence par la jambe ${side}, fais autant des deux côtés.` : '';
  };

  // Estimation (min) d'un exercice quand le modèle ne la donne pas.
  function estimate(item) {
    const sets = Math.max(1, +item.sets || 1), rest = +item.rest || 0, t = item.target || {};
    if (t.sec) return (sets * (t.sec + rest)) / 60;
    if (t.m && item.track === 'dist') return sets * (swimMin(t.m) + rest / 60);
    if (item.track === 'check') return sets * 1.5 + (sets * rest) / 60;
    return (sets * (45 + rest)) / 60;
  }

  // Élément d'exercice (ExerciseItem sans key).
  function it(c, exId, o = {}) {
    const info = exInfo(exId);
    const item = {
      exId, name: o.name || info.name, track: o.track || info.track,
      sets: Math.max(1, Math.round(o.sets == null ? 1 : o.sets)), reps: o.reps == null ? '' : String(o.reps),
      target: U.isObj(o.target) ? o.target : {}, rest: Math.max(0, Math.round(o.rest || 0)), note: o.note || '',
      impact: info.impact || 0,
    };
    if (o.bench) item.bench = o.bench;
    if (o.test) item.test = true;
    if (info.apnea || o.apnea) item.apnea = true;
    if (o.timer) item.timer = o.timer;
    if (info.alt && info.alt.length) item.alt = info.alt.slice();
    item.estMin = o.min != null ? o.min : estimate(item);
    if (o.core) item.core = true;
    if (o.warm) item.warm = true;
    return item;
  }

  // Exercice de natation : distance en clair (« 50 m »), en mètres dans target.m, longueurs dans la note.
  function sw(c, exId, m, o = {}) {
    return it(c, exId, { ...o, reps: o.reps || `${m} m${o.suffix ? `, ${o.suffix}` : ''}`, target: { m, ...(o.target || {}) }, note: join(o.note, lapNote(c, m)) });
  }

  // Résultat d'un build : durée = somme des estimations (+ transitions), arrondie à 5 min.
  function out(c, items, o = {}) {
    const exercises = items.filter(Boolean);
    const sum = exercises.reduce((a, x) => a + (+x.estMin || 0), 0);
    const res = { durationMin: round5(sum + (o.extraMin || 0)), intro: o.intro || '', safety: (o.safety || []).filter(Boolean), exercises };
    if (o.title) res.title = o.title;
    if (o.checklist) res.checklist = o.checklist;
    res.extraMin = o.extraMin || 0;
    return res;
  }

  // Séquence de minuteur (TimerSpec) : circuitSpec de exercises.js si disponible, sinon repli local.
  function circuit(name, voice, list, rounds, o = {}) {
    const restSec = o.restSec == null ? 20 : o.restSec;
    const between = o.restBetweenRoundsSec == null ? 60 : o.restBetweenRoundsSec;
    if (D.circuitSpec) {
      try {
        const spec = D.circuitSpec(list.map((x) => ({ exId: x.exId, sec: x.sec })), { name, voice, rounds, restSec, restBetweenRoundsSec: between, prepSec: 10 });
        if (spec && spec.steps && spec.steps.length) return spec;
      } catch (e) { /* repli ci-dessous */ }
    }
    const steps = [];
    for (const x of list) {
      const info = exInfo(x.exId);
      const sides = info.sides ? ['côté gauche', 'côté droit'] : [null];
      sides.forEach((side, k) => {
        if (k > 0) steps.push({ label: 'Change de côté', sec: 5, kind: 'rest' });
        else if (steps.length && restSec) steps.push({ label: 'Repos', sec: restSec, kind: 'rest' });
        steps.push({ label: side ? `${info.name}, ${side}` : info.name, sec: x.sec, kind: 'work' });
      });
    }
    return { name, voice: !!voice, prepSec: 10, rounds: Math.max(1, rounds), restBetweenRoundsSec: between, steps };
  }
  function timerMin(spec) {
    if (!spec) return 0;
    const round = spec.steps.reduce((a, s) => a + (s.sec || 0), 0);
    return ((spec.prepSec || 0) + round * spec.rounds + (spec.restBetweenRoundsSec || 0) * (spec.rounds - 1)) / 60;
  }

  /* ───────── Textes de sécurité ───────── */

  const SAFETY_APNEA = [
    "Apnée : uniquement accompagné (club, binôme ou MNS prévenu qui te regarde). Sinon, nage en surface à la place.",
    "Jamais d'hyperventilation : 1 ou 2 inspirations normales avant de partir.",
    "Récupère au moins 2 fois la durée de l'apnée, et au moins 60 s.",
    "Arrête tout de suite au moindre signe : picotements, vision qui se rétrécit, envie irrépressible de respirer.",
    "Pas d'apnée en fin de séance épuisante. Progression : 2,5 m par semaine au maximum.",
  ];
  const SAFETY_PAIN = 'Douleur pendant l\'effort : 0 à 2 sur 10, continue ; 3 à 5, continue sans forcer plus ; au-delà, arrête et passe à la version douce. Si ça persiste, consulte.';

  /* ───────── Stations HYROX ───────── */

  const STN = [
    { n: 1, exId: 'skierg', name: 'SkiErg', full: 1000, unit: 'm', min: 5 },
    { n: 2, exId: 'sled_push', name: 'Sled push', full: 50, unit: 'sled', load: 'sledPushKg', min: 3.5 },
    { n: 3, exId: 'sled_pull', name: 'Sled pull', full: 50, unit: 'sled', load: 'sledPullKg', min: 4.5 },
    { n: 4, exId: 'burpee_broad_jump', name: 'Burpee broad jumps', full: 80, unit: 'm', min: 6 },
    { n: 5, exId: 'row_erg', name: 'Rameur', full: 1000, unit: 'm', min: 5 },
    { n: 6, exId: 'farmers_carry', name: 'Farmers carry', full: 200, unit: 'm', load: 'farmersKg', min: 2.5 },
    { n: 7, exId: 'sandbag_lunge', name: 'Fentes avec sandbag', full: 100, unit: 'm', load: 'sandbagKg', min: 5.5 },
    { n: 8, exId: 'wall_ball', name: 'Wall balls', full: 100, unit: 'reps', load: 'wallBallKg', min: 7 },
  ];
  function amountTxt(st, qty) {
    if (st.unit === 'sled') return `${U.fmtNum(qty)} m (${U.fmtNum(qty / 12.5)} × 12,5 m)`;
    if (st.unit === 'reps') return `${qty} répétitions`;
    return `${U.fmtNum(qty)} m`;
  }
  // Charge d'une station : charge de course exacte (frac ≥ 1), sinon une fraction arrondie à 5 kg.
  // Le wall ball et les kettlebells du farmers gardent toujours leur poids de course.
  const loadKg = (st, L, frac = 1) => (!st.load ? null : st.load === 'wallBallKg' || st.load === 'farmersKg' || frac >= 1 ? L[st.load] : r5(L[st.load] * frac));
  function loadTxt(st, L, frac = 1) {
    if (!st.load) return '';
    const kg = loadKg(st, L, frac);
    if (st.load === 'farmersKg') return `2 × ${kg} kg`;
    if (st.load === 'wallBallKg') return `${kg} kg, cible à ${U.fmtNum(L.wallBallTargetM || 3)} m`;
    if (st.load === 'sandbagKg') return `${kg} kg`;
    return `${kg} kg traîneau compris`;
  }
  const STN_TIPS = {
    skierg: 'Bras presque tendus, la poussée vient des hanches. Résistance 5 à 6.',
    sled_push: 'Bras tendus, buste penché, petits pas rapides.',
    sled_pull: 'Reste dans ton couloir, tire main sur main en reculant.',
    burpee_broad_jump: 'Poitrine et cuisses au sol, mains à 30 cm max devant les pieds, saut pieds joints.',
    row_erg: 'Jambes, buste, bras ; retour dans l\'ordre inverse. Résistance 5 à 6.',
    farmers_carry: 'Épaules basses, gainé, petits pas rapides. Tu peux poser les charges.',
    sandbag_lunge: 'Sac sur les épaules, genou arrière posé au sol à chaque fente.',
    wall_ball: 'Hanche sous le genou, centre du ballon sur la cible.',
  };

  // Station d'une simulation ou d'un enchaînement : ExerciseItem (BBJ → burpees sans saut si genou/cheville).
  function stationItem(c, st, L, qty, frac, o = {}) {
    if (st.exId === 'burpee_broad_jump' && noJump(c)) {
      const reps = Math.max(5, Math.round(qty / 2));
      return it(c, 'burpee_step_back', { name: `Burpees sans saut (à la place des ${st.name})`, sets: 1, reps: `${reps} burpees, pas en arrière`,
        target: { reps }, min: (st.min * qty) / st.full, core: o.core, note: join(adaptNote(c), 'Poitrine au sol, relève-toi en marchant les pieds vers les mains.') });
    }
    let q = qty;
    let extra = '';
    if (st.exId === 'sandbag_lunge' && c.injuries.genou && o.knee !== false) { q = Math.max(10, Math.round(qty / 2)); extra = join(adaptNote(c, ['genou']), 'Distance réduite, amplitude contrôlée.'); }
    const kg = loadKg(st, L, frac);
    const target = {};
    if (kg) target.kg = kg;
    if (st.unit === 'reps') target.reps = q;
    if (st.unit === 'm' && st.exId !== 'burpee_broad_jump' && st.exId !== 'farmers_carry') target.m = q;
    const lt = loadTxt(st, L, frac);
    return it(c, st.exId, { name: o.name || st.name, sets: 1, reps: `${amountTxt(st, q)}${lt ? ` — ${lt}` : ''}`, target, min: (st.min * q) / st.full,
      core: o.core, note: join(STN_TIPS[st.exId], extra, st.exId === 'wall_ball' ? kneeNote(c) : '', o.note) });
  }

  /* ───────── Modèles ───────── */

  const T = {};
  function def(id, meta, build) {
    T[id] = Object.assign({ id, load: 1, legs: 0, intense: false, run: false }, meta, { build: (raw) => build(ctxOf(raw)) });
  }

  /* ── Fitness Park ── */

  def('gym_hybrid', {
    title: 'Salle — Hybride (tapis, force, stations)', loc: 'salle', kind: 'gym', goals: ['hyrox', 'general'],
    summary: 'Endurance au tapis, force, puis technique de 3 ou 4 stations HYROX à charge légère.', load: 2, legs: 1, run: true,
  }, (c) => {
    const L = hxLoads(c), pc = paces(c), A = c.weekIndex % 2 === 0;
    const z2 = mv(c, c.level === 'dev' || c.level === 'spe' ? 35 : 30, 10);
    const nSt = c.level === 'dev' || c.level === 'spe' ? 4 : 3;
    const kn = kneeNote(c);
    const force = A ? [
      it(c, 'goblet_squat', { sets: sv(c, 3, 2), reps: '8–10', target: { reps: 10 }, rest: 90, core: true, note: join('Garde 2 répétitions en réserve.', kn) }),
      it(c, 'rdl', { sets: sv(c, 3, 2), reps: '8–10', target: { reps: 10 }, rest: 90, note: 'Dos plat, hanches vers l\'arrière.' }),
      it(c, 'seated_row', { sets: sv(c, 3, 2), reps: '10–12', target: { reps: 12 }, rest: 75 }),
    ] : [
      it(c, 'split_squat_db', { sets: sv(c, 3, 2), reps: '8 / jambe', target: { reps: 8 }, rest: 90, core: true, note: join(kn, sideFirst(c)) }),
      it(c, 'hip_thrust', { sets: sv(c, 3, 2), reps: '10', target: { reps: 10 }, rest: 90 }),
      it(c, 'lat_pulldown', { sets: sv(c, 3, 2), reps: '8–10', target: { reps: 10 }, rest: 75 }),
    ];
    const groups = [['skierg', 'sled_push', 'wall_ball', 'farmers_carry'], ['row_erg', 'sled_pull', 'sandbag_lunge', 'burpee_broad_jump']];
    const tech = groups[c.weekIndex % 2].slice(0, nSt).map((id) => {
      const st = STN.find((s) => s.exId === id);
      if (id === 'skierg' || id === 'row_erg') {
        return it(c, id, { sets: sv(c, 3, 2), reps: '250 m, technique', rest: 60, min: sv(c, 3, 2) * 2.2, note: STN_TIPS[id] });
      }
      if (id === 'sled_push' || id === 'sled_pull') {
        const kg = r5(L[st.load] * 0.5);
        return it(c, id, { sets: sv(c, 4, 2), reps: '12,5 m', target: { kg }, rest: 60, min: sv(c, 4, 2) * 1.5,
          note: join(`Course : ${L[st.load]} kg traîneau compris. Aujourd'hui ≈ ${kg} kg pour la technique.`, STN_TIPS[id]) });
      }
      if (id === 'burpee_broad_jump') {
        if (noJump(c)) return it(c, 'burpee_step_back', { sets: sv(c, 3, 2), reps: '6–8', target: { reps: 8 }, rest: 60, note: join(adaptNote(c), 'Burpees sans saut, en contrôle.') });
        return it(c, id, { sets: sv(c, 2, 1), reps: '10 m', rest: 75, min: sv(c, 2, 1) * 2, note: STN_TIPS[id] });
      }
      if (id === 'farmers_carry') return it(c, id, { sets: sv(c, 2, 1), reps: '50 m', target: { kg: L.farmersKg }, rest: 60, min: sv(c, 2, 1) * 1.5, note: join(`2 × ${L.farmersKg} kg comme en course.`, STN_TIPS[id]) });
      if (id === 'sandbag_lunge') {
        const kg = r5(L.sandbagKg * 0.5);
        return it(c, id, { sets: sv(c, 2, 1), reps: c.injuries.genou ? '6 m' : '10 m', target: { kg }, rest: 75, min: sv(c, 2, 1) * 1.8,
          note: join(`Course : ${L.sandbagKg} kg. Aujourd'hui ≈ ${kg} kg.`, STN_TIPS[id], c.injuries.genou ? adaptNote(c, ['genou']) : '') });
      }
      return it(c, 'wall_ball', { sets: sv(c, 3, 2), reps: '10–12', target: { reps: 12, kg: L.wallBallKg }, rest: 60,
        note: join(`${L.wallBallKg} kg, cible à ${U.fmtNum(L.wallBallTargetM || 3)} m.`, STN_TIPS.wall_ball, kn) });
    });
    return out(c, [
      it(c, 'band_warmup', { reps: '2 × 15 écartés + 10 rotations d\'épaules', min: 5, warm: true }),
      it(c, 'treadmill_easy', { reps: `${z2} min, pente 1 %`, target: { sec: z2 * 60 }, min: z2 + 2, core: true,
        note: join(pc ? `Allure facile ≈ ${paceTxt(pc.easy)}.` : 'Allure facile : tu dois pouvoir parler en phrases.', legHurt(c) ? 'Si la cheville ou le genou tire : vélo ou elliptique.' : '') }),
      ...force, ...tech,
      it(c, 'pallof_press', { sets: 2, reps: '10 / côté', rest: 45, min: 4, note: 'Le buste ne tourne pas.' }),
    ], {
      extraMin: 5,
      intro: 'Séance hybride : endurance facile au tapis, un peu de force, puis la technique de quelques stations HYROX à charge légère. Aucune station à fond aujourd\'hui.',
    });
  });

  def('gym_force_lower', {
    title: 'Salle — Force bas du corps', loc: 'salle', kind: 'gym', goals: ['hyrox', 'pompier'],
    summary: 'Squat, soulevé de terre jambes semi-tendues, fentes : la base du sled, des fentes et des wall balls.', load: 2, legs: 2,
  }, (c) => {
    const knee = !!c.injuries.genou;
    const heavy = (c.level === 'dev' || c.level === 'spe') && !knee;
    const kn = kneeNote(c);
    return out(c, [
      it(c, 'bike_easy', { reps: '8 min, progressif', target: { sec: 480 }, min: 8, warm: true }),
      heavy
        ? it(c, 'back_squat', { sets: sv(c, 4, 2), reps: '5–6', target: { reps: 6 }, rest: 150, core: true, note: 'Garde 2 répétitions en réserve. Toutes les séries à 6 : +5 kg la fois suivante.' })
        : it(c, 'goblet_squat', { sets: sv(c, 4, 2), reps: '8–10', target: { reps: 10 }, rest: 120, core: true, note: join('Garde 2 répétitions en réserve. Toutes les séries à 10 : +2,5 à 5 kg.', kn) }),
      it(c, 'rdl', { sets: sv(c, 3, 2), reps: '8', target: { reps: 8 }, rest: 120, core: true, note: 'Dos plat, hanches vers l\'arrière, charge près des jambes.' }),
      it(c, 'split_squat_db', { sets: sv(c, 3, 1), reps: '8 / jambe', target: { reps: 8 }, rest: 90, note: join(kn, sideFirst(c)) }),
      it(c, 'hip_thrust', { sets: sv(c, 3, 1), reps: '10', target: { reps: 10 }, rest: 90 }),
      it(c, 'leg_curl', { sets: sv(c, 2, 1), reps: '10–12', target: { reps: 12 }, rest: 60 }),
      it(c, 'calf_raise', { sets: sv(c, 3, 1), reps: '12–15', target: { reps: 15 }, rest: 45, note: 'Lent, amplitude complète : protège la cheville et le tendon d\'Achille.' }),
      it(c, 'pallof_press', { sets: 2, reps: '10 / côté', rest: 45, min: 4 }),
    ], { extraMin: 5, intro: 'Force du bas du corps. Double progression : quand toutes les séries atteignent le haut de la fourchette, ajoute un peu de charge la fois suivante.', safety: [legHurt(c) ? SAFETY_PAIN : ''] });
  });

  def('gym_force_upper', {
    title: 'Salle — Force haut du corps', loc: 'salle', kind: 'gym', goals: ['pompier', 'general'],
    summary: 'Tirages, développés et épaules : tractions, pompes, remorquage et SkiErg.', load: 1, legs: 0,
  }, (c) => {
    const pu = c.best('pullups');
    return out(c, [
      it(c, 'band_warmup', { reps: '2 × 15 écartés + 10 rotations', min: 5, warm: true }),
      it(c, 'lat_pulldown', { sets: sv(c, 4, 2), reps: '6–8', target: { reps: 8 }, rest: 120, core: true, note: 'Coudes vers les poches, sans balancer.' }),
      pu != null && pu >= 5
        ? it(c, 'pullup_strict', { sets: sv(c, 3, 1), reps: `${Math.max(2, Math.round(pu) - 2)}`, target: { reps: Math.max(2, Math.round(pu) - 2) }, rest: 120, note: 'Bras tendus en bas, menton au-dessus de la barre.' })
        : it(c, 'assisted_pullup', { sets: sv(c, 3, 1), reps: '5–6', target: { reps: 6 }, rest: 90, note: 'Assistance juste suffisante pour 6 répétitions propres.' }),
      it(c, 'bench_press', { sets: sv(c, 3, 2), reps: '6–8', target: { reps: 8 }, rest: 120, core: true }),
      it(c, 'seated_row', { sets: sv(c, 3, 1), reps: '10', target: { reps: 10 }, rest: 90 }),
      it(c, 'db_press', { sets: sv(c, 3, 1), reps: '8–10', target: { reps: 10 }, rest: 90 }),
      it(c, 'cable_face_pull', { sets: sv(c, 3, 1), reps: '15', target: { reps: 15 }, rest: 45, note: 'Protège les épaules (natation, tractions, SkiErg).' }),
      it(c, 'dead_hang', { sets: 2, reps: 'max', track: 'time', rest: 60, min: 3, note: 'Poigne : remorquage, farmers, échelle.' }),
    ], { extraMin: 5, intro: 'Force du haut du corps. Garde 2 répétitions en réserve sur chaque série.' });
  });

  def('gym_hyrox_dev', {
    title: 'Salle — Course + stations HYROX', loc: 'salle', kind: 'gym', goals: ['hyrox'],
    summary: '1 km au tapis puis une station partielle, enchaînés, 4 à 6 fois : apprendre à courir fatigué.', load: 2, legs: 2, intense: true, run: true,
  }, (c) => {
    const L = hxLoads(c), pc = paces(c);
    const R0 = Math.min(6, 4 + Math.floor((c.weekInPhase - 1) / 3) + (c.level === 'spe' ? 1 : 0));
    const R = clamp(Math.round(R0 * c.vol), 2, 6);
    const frac = c.level === 'spe' ? 1 : c.level === 'dev' ? 0.75 : 0.6;
    const PART = { skierg: 500, sled_push: 25, sled_pull: 25, burpee_broad_jump: 40, row_erg: 500, farmers_carry: 100, sandbag_lunge: 50, wall_ball: 50 };
    const rounds = [];
    for (let i = 0; i < R; i++) {
      const st = STN[(c.weekIndex + i) % 8];
      const qty = PART[st.exId];
      let partTxt;
      if (st.exId === 'burpee_broad_jump' && noJump(c)) partTxt = `${Math.round(qty / 2)} burpees sans saut`;
      else if (st.exId === 'sandbag_lunge' && c.injuries.genou) partTxt = `${amountTxt(st, qty / 2)} ${st.name.toLowerCase()} — ${loadTxt(st, L, frac)}`;
      else partTxt = `${amountTxt(st, qty)} ${st.exId === 'wall_ball' ? 'wall balls' : st.name.toLowerCase()}${st.load ? ` — ${loadTxt(st, L, frac)}` : ''}`;
      const adapted = (st.exId === 'burpee_broad_jump' && noJump(c)) || (st.exId === 'sandbag_lunge' && c.injuries.genou);
      rounds.push(it(c, 'hyrox_run_station', {
        name: `1 km + ${st.name}`, reps: `1 km au tapis puis ${partTxt}`, rest: 120, min: 6.5 + (st.min * qty) / st.full + 2, core: i < 2,
        note: join(i === 0 ? (pc ? `1 km à ≈ ${paceTxt(pc.race)}, pas plus vite : la relance après la station compte plus.` : '1 km à allure « course » : soutenu mais tenable 8 fois.') : '',
          STN_TIPS[st.exId], adapted ? adaptNote(c) : ''),
      }));
    }
    return out(c, [
      it(c, 'treadmill_easy', { reps: '10 min facile + 3 accélérations', target: { sec: 600 }, min: 12, warm: true }),
      it(c, 'band_warmup', { reps: 'épaules + 10 squats + 10 fentes', min: 4, warm: true }),
      ...rounds,
      it(c, 'bike_easy', { reps: '5 min très facile', target: { sec: 300 }, min: 5 }),
    ], {
      extraMin: 3,
      intro: `Course en état de fatigue : ${R} × (1 km au tapis + une station partielle), 2 min de récupération entre les tours. Le but : apprendre à relancer après la station sans partir trop vite.${isDoubles(c) ? ' En Doubles, vous courrez les 8 km ensemble : cale-toi sur l\'allure du moins rapide.' : ''}`,
      safety: [legHurt(c) ? SAFETY_PAIN : ''],
    });
  });

  const SIM_STAGES = ['mini', 'demi', '3/4', 'complete'];
  const SIM_FROM = { mini: 7, demi: 5, '3/4': 3, complete: 1 };
  const SIM_LABEL = {
    mini: 'mini (2 × 1 km, stations 7 et 8)', demi: '½ (4 × 1 km, stations 5 à 8)', '3/4': '¾ (6 × 1 km, stations 3 à 8)', complete: 'complète (8 × 1 km)',
  };
  function simMinutes(c, stage) {
    const dbl = isDoubles(c);
    let m = 15;
    for (let n = SIM_FROM[stage]; n <= 8; n++) m += 7 + (STN[n - 1].min * (dbl ? 0.5 : 1));
    return m;
  }
  def('gym_hyrox_sim', {
    title: 'Simulation HYROX', loc: 'salle', kind: 'gym', goals: ['hyrox'], fixed: true,
    summary: 'Simulation progressive : ½, puis ¾, puis complète au plus tard 3 semaines avant la course.', load: 3, legs: 2, intense: true, run: true,
  }, (c) => {
    const L = hxLoads(c), pc = paces(c), dbl = isDoubles(c);
    let stage = SIM_STAGES.includes(c.simStage) ? c.simStage : 'demi';
    const down = (s) => SIM_STAGES[Math.max(0, SIM_STAGES.indexOf(s) - 1)];
    if (c.variant === 'allege' || c.variant === 'doux') stage = down(stage);
    if (c.variant === 'express') stage = 'mini';
    const cap = +c.capMin || +c.profile.maxSessionMin || 0;
    while (cap && simMinutes(c, stage) > cap && stage !== 'mini') stage = down(stage);
    const items = [
      it(c, 'treadmill_easy', { reps: '10 min facile + 3 accélérations', target: { sec: 600 }, min: 12, warm: true }),
      it(c, 'band_warmup', { reps: 'épaules, hanches, 10 wall balls légers', min: 3, warm: true }),
    ];
    for (let n = SIM_FROM[stage]; n <= 8; n++) {
      const st = STN[n - 1];
      items.push(it(c, 'treadmill_1k', { name: `1 km n° ${n}`, reps: '1 km', min: 6.5, core: true,
        target: pc ? { sec: Math.round(pc.race) } : {}, note: n === SIM_FROM[stage] ? (pc ? `≈ ${paceTxt(pc.race)}. Pars plus lentement que tu ne le crois.` : 'Pars plus lentement que tu ne le crois.') : '' }));
      items.push(stationItem(c, st, L, dbl ? st.full / 2 : st.full, 1, { name: `Station ${n} — ${st.name}`, core: true, knee: false,
        note: dbl ? 'Doubles : ta moitié (ton binôme fait l\'autre).' : '' }));
    }
    const complete = stage === 'complete';
    items.push(it(c, 'hyrox_run_station', {
      name: 'Temps total de la simulation', reps: 'du départ du 1er km à la fin de la dernière station', min: 0, core: true,
      bench: complete ? 'hyrox_sim' : undefined, test: complete || undefined,
      note: complete ? 'Ce temps alimente ton test « Simulation HYROX complète ».' : 'Temps de la simulation partielle (non comparable à une course).',
    }));
    items.push(it(c, 'bike_easy', { reps: '5 min très facile + étirements légers', target: { sec: 300 }, min: 5 }));
    return out(c, items, {
      title: `Simulation HYROX — ${SIM_LABEL[stage]}`, extraMin: 3,
      intro: join(`Enchaîne sans t'arrêter, comme le jour J (1 km au tapis puis la station). Charges de course : ${L.label || 'ta division'}.`,
        dbl ? 'Mode Doubles : les 8 × 1 km sont complets, les stations sont à volume partagé (÷ 2).' : '',
        noJump(c) ? adaptNote(c) : ''),
      safety: [legHurt(c) ? SAFETY_PAIN : '', 'Bois entre les stations si tu en as besoin ; arrête-toi si tu as la tête qui tourne.'],
    });
  });

  def('gym_activation', {
    title: 'Salle — Activation (affûtage)', loc: 'salle', kind: 'gym', goals: ['hyrox'],
    summary: 'Court, à allure course : garder les sensations sans se fatiguer.', load: 1, legs: 0, run: true,
  }, (c) => {
    const L = hxLoads(c), pc = paces(c);
    return out(c, [
      it(c, 'treadmill_easy', { reps: '12 min dont 3 × 1 min à allure course', target: { sec: 720 }, min: 13, warm: true, core: true,
        note: pc ? `Allure course ≈ ${paceTxt(pc.race)}.` : '' }),
      it(c, 'band_warmup', { reps: 'épaules et hanches', min: 3, warm: true }),
      it(c, 'skierg', { sets: 2, reps: '250 m allure course', rest: 90, min: 5, note: STN_TIPS.skierg }),
      it(c, 'sled_push', { sets: 2, reps: '12,5 m charge de course', target: { kg: L.sledPushKg }, rest: 90, min: 4, note: STN_TIPS.sled_push }),
      it(c, 'wall_ball', { sets: 2, reps: '10', target: { reps: 10, kg: L.wallBallKg }, rest: 60, min: 3, core: true, note: STN_TIPS.wall_ball }),
      it(c, 'row_erg', { sets: 2, reps: '250 m allure course', rest: 60, min: 4 }),
      it(c, 'treadmill_1k', { reps: '1 km à allure course', min: 6, core: true, target: pc ? { sec: Math.round(pc.race) } : {} }),
      it(c, 'mob_hips', { reps: '5 min', min: 5 }),
    ], { extraMin: 2, intro: 'Affûtage : peu de volume, mais à allure course pour garder les sensations. Tu dois sortir avec de l\'énergie.' });
  });

  def('gym_icp', {
    title: 'Salle — Préparation tests pompier', loc: 'salle', kind: 'gym', goals: ['pompier'],
    summary: 'Tractions en supination, pompes en cadence, chaise, gainage, port de charge.', load: 1, legs: 1,
  }, (c) => {
    const ch = c.best('chinups');
    const pu = c.best('pushups');
    return out(c, [
      it(c, 'bike_easy', { reps: '8 min progressif', target: { sec: 480 }, min: 8, warm: true }),
      it(c, 'band_warmup', { reps: 'épaules', min: 3, warm: true }),
      ch != null && ch >= 3
        ? it(c, 'chinup_strict', { sets: sv(c, 4, 2), reps: `${Math.max(2, Math.round(ch) - 2)}`, target: { reps: Math.max(2, Math.round(ch) - 2) }, rest: 120, core: true, note: 'Paumes vers toi, départ bras tendus, menton au-dessus de la barre, pas de pause de plus de 3 s.' })
        : it(c, 'assisted_pullup', { name: 'Traction assistée (prise supination)', sets: sv(c, 4, 2), reps: '5–6', target: { reps: 6 }, rest: 90, core: true, note: 'Paumes vers toi, comme au test pompier.' }),
      it(c, 'pushup_cadence', { sets: sv(c, 3, 2), reps: pu ? `${Math.max(5, Math.round(pu * 0.6))} en cadence` : 'en cadence, 2 avant l\'échec', target: pu ? { reps: Math.max(5, Math.round(pu * 0.6)) } : {}, rest: 90, core: true,
        note: '1 pompe toutes les 2 s, poitrine à environ 5 cm du sol, corps gainé.' }),
      it(c, 'wall_sit', { sets: sv(c, 3, 2), reps: c.level === 'reprise' ? '45 s' : '60–90 s', target: { sec: c.level === 'reprise' ? 45 : 75 }, rest: 60, note: join('Dos plaqué au mur, cuisses à 90°.', kneeNote(c)) }),
      it(c, 'plank', { sets: sv(c, 3, 2), reps: '60–90 s', target: { sec: 75 }, rest: 60, note: 'Avant-bras et orteils, corps aligné.' }),
      it(c, 'farmers_carry', { sets: sv(c, 3, 2), reps: '40 m', rest: 60, min: sv(c, 3, 2) * 1.5, note: 'Port de charge, comme les tuyaux ou le matériel.' }),
      it(c, 'step_up', { sets: sv(c, 3, 1), reps: '10 / jambe', target: { reps: 10 }, rest: 60, note: join('Comme des escaliers en tenue.', kneeNote(c)) }),
      it(c, 'stretch_hamstrings', { sets: 2, reps: '45 s', target: { sec: 45 }, rest: 15, note: 'Souplesse : expire en descendant, sans à-coups.' }),
    ], { extraMin: 4, intro: 'Préparation des tests physiques pompier (type ICP). Les épreuves et barèmes varient selon le SDIS : à confirmer quand tu auras choisi ta voie.' });
  });

  /* ── Piscine ── */

  // Distance d'apnée prescrite : meilleure distance connue + 2 m (≤ 2,5 m/semaine), plafonnée à l'exigence + petite marge.
  function apneaMax(c, cap = 18) {
    const b = c.best('apnea_dyn');
    if (b != null) return clamp(Math.floor(b + 2), 6, cap);
    return clamp(8 + Math.floor(1.5 * Math.max(0, c.weekIndex - 1)), 8, Math.min(cap, 15));
  }
  const ssaT = (c, k, dflt) => { const t = c.ssa && c.ssa.targets; const v = t && U.num(t[k]); return v && v > 0 ? v : dflt; };
  const deepTxt = (c) => (c.pool && U.num(c.pool.deepM) ? `fond à ${U.fmtNum(Math.min(+c.pool.deepM, 2.8))} m (ta fosse fait ${U.fmtNum(+c.pool.deepM)} m)` : 'fond le plus profond possible, vise 2,80 m');
  const hasManikin = (c) => !!(c.pool && c.pool.mannequin === true);
  const coolM = (c) => (c.poolLength === 33 ? 132 : 100);
  const surfaceTo = (c) => (c.poolLength > 25 ? 'puis nage en surface jusqu\'à 25 m' : 'puis nage en surface jusqu\'au bout');

  def('swim_test', {
    title: 'Piscine — Tests natation', loc: 'piscine', kind: 'test', goals: ['ssa', 'pompier'], fixed: true,
    summary: '100 m crawl, 25 m dos jambes seules, apnée progressive (avec le club), canard, 300 m palmes.', load: 2, legs: 0, pool: true,
  }, (c) => {
    const express = c.variant === 'express';
    // Test d'apnée : paliers jusqu'à 12 m sans mesure connue, sinon meilleure distance + 2 m (18 m au plus).
    const b = c.best('apnea_dyn');
    const top = b != null ? clamp(Math.floor(b + 2), 8, 18) : 12;
    const ladder = [5, 8, 10, 12, 15].filter((x) => x < top).slice(-3).concat(top);
    const items = [sw(c, 'swim_warmup', express ? coolM(c) : pv(c, 300, 200), { suffix: 'souple, nages variées', min: express ? 4 : 8, warm: true })];
    if (!express) {
      items.push(it(c, 'apnea_breath_dry', { reps: '2 min au bord : respiration calme, sans hyperventiler', min: 3 }));
      items.push(it(c, 'apnea_dynamic', { sets: ladder.length, reps: `${ladder.map((x) => `${x} m`).join(' → ')}, arrête dès que c'est inconfortable`, target: { m: top }, rest: 120, min: 3 * ladder.length,
        bench: 'apnea_dyn', test: true, note: 'Avec le club (ou un MNS prévenu qui te regarde). Note ta meilleure distance confortable, pas un record.' }));
      items.push(it(c, 'duck_dive_object', { name: 'Canard : profondeur atteinte', track: 'dist', sets: 3, reps: 'objet lesté au fond (vise 2 m)', target: { m: 2 }, rest: 90, min: 6,
        bench: 'duck_depth', test: true, note: 'Note la profondeur atteinte en mètres (repère au bord ou demande au MNS). Pas plus profond que 2 m aujourd\'hui.' }));
    }
    items.push(sw(c, 'swim_crawl_100', 100, { suffix: 'chrono', rest: 240, min: 6, core: true, bench: 'swim_100', test: true, note: 'Départ dans l\'eau, allure soutenue mais régulière.' }));
    items.push(sw(c, 'swim_back_legs', 25, { suffix: 'chrono, mains hors de l\'eau', rest: 180, min: 4, core: true, bench: 'swim_back_25', test: true,
      note: 'Poignets au-dessus de la surface : seules les jambes avancent (rétropédalage ou ciseaux).' }));
    if (!express) {
      items.push(sw(c, 'fins_300', 300, { suffix: 'palmes chrono, chaussage compris', min: 8, bench: 'ssa_tsa_fins', test: true,
        note: 'Départ au bord SANS palmes : le chrono part avant le chaussage. Nage ventrale ; masque et tuba autorisés.' }));
    }
    items.push(sw(c, 'swim_cooldown', coolM(c), { suffix: 'souple', min: 4 }));
    return out(c, items, {
      extraMin: 3,
      intro: 'Séance de tests pour connaître ton niveau de départ. Rien à prouver : nage propre et note tes temps. L\'apnée et le canard seulement avec le club (ou un MNS prévenu).',
    });
  });

  def('swim_technique', {
    title: 'Piscine — Technique crawl', loc: 'piscine', kind: 'swim', goals: ['ssa', 'pompier'],
    summary: 'Éducatifs, battements, 50 m réguliers : un crawl économique fait gagner du temps partout.', load: 1, pool: true,
  }, (c) => {
    const w = pv(c, 300, 100);
    const b = c.best('swim_100');
    const t50 = b ? Math.round(b / 2 + 5) : null;
    return out(c, [
      sw(c, 'swim_warmup', w, { suffix: 'nages variées', min: swimMin(w, 160), warm: true }),
      sw(c, 'swim_drills', 50, { sets: sv(c, 6, 3), rest: 20, min: sv(c, 6, 3) * 1.8, core: true,
        note: 'Rattrapé, poing fermé, respiration tous les 3 temps. Allonge-toi, cherche la glisse.' }),
      sw(c, 'swim_kick', 25, { sets: sv(c, 4, 2), rest: 20, min: sv(c, 4, 2) * 1, note: 'Sans planche, bras devant.' }),
      sw(c, 'swim_crawl_50', 50, { sets: sv(c, 6, 3), rest: 30, target: t50 ? { sec: t50 } : {}, min: sv(c, 6, 3) * 1.8, core: true,
        note: join(t50 ? `Vise ≈ ${fmtT(t50)} à chaque fois.` : '', 'Compte tes mouvements de bras par longueur : moins = mieux, à vitesse égale.') }),
      sw(c, 'swim_breast_glide', 25, { sets: sv(c, 4, 2), rest: 20, min: sv(c, 4, 2) * 1, note: 'Longue glisse immergée : aisance sous l\'eau.' }),
      sw(c, 'swim_cooldown', coolM(c), { suffix: 'souple', min: 3 }),
    ], { extraMin: 2, intro: 'Technique : nage lentement mais bien. C\'est l\'économie du crawl qui te fera gagner du temps au test SSA.' });
  });

  def('swim_endurance', {
    title: 'Piscine — Endurance', loc: 'piscine', kind: 'swim', goals: ['ssa', 'pompier', 'general'],
    summary: 'Séries de 200 m (et un 400 m quand ça vient), à une allure que tu peux tenir.', load: 1, pool: true,
  }, (c) => {
    const w = pv(c, 300, 100);
    const b = c.best('swim_100');
    const p100 = b ? b + 12 : null;
    const long = (c.level === 'dev' || c.level === 'spe') && c.vol >= 0.8;
    const n200 = sv(c, long ? 3 : 4, 2);
    return out(c, [
      sw(c, 'swim_warmup', w, { suffix: 'nages variées', min: swimMin(w, 160), warm: true }),
      long ? sw(c, 'swim_crawl_400', 400, { rest: 60, min: swimMin(400, p100 || 150) + 1, core: true, target: p100 ? { sec: Math.round(p100 * 4) } : {},
        note: 'Allure régulière du début à la fin.' }) : null,
      sw(c, 'swim_crawl_200', 200, { sets: n200, rest: 30, min: n200 * (swimMin(200, p100 || 150) + 0.5), core: true,
        target: p100 ? { sec: Math.round(p100 * 2) } : {}, note: p100 ? `Vise ≈ ${fmtT(p100 * 2)} par 200 m, respiration régulière.` : 'Allure que tu pourrais tenir longtemps, respiration régulière.' }),
      sw(c, 'swim_crawl_25', 25, { sets: sv(c, 4, 2), rest: 30, min: sv(c, 4, 2) * 1, note: 'Rapide mais relâché.' }),
      sw(c, 'swim_cooldown', pv(c, 200, 100), { suffix: 'souple', min: 4 }),
    ], { extraMin: 2, intro: 'Volume en endurance : tu dois pouvoir enchaîner sans être à bout. Le fond de forme sert au SSA comme au 50 m des tests pompier.' });
  });

  def('swim_ssa_entry', {
    title: "Piscine — Prépa test d'entrée SSA", loc: 'piscine', kind: 'swim', goals: ['ssa'],
    summary: "Plongeon + immersion, 50 m crawl allure test, 25 m dos mains hors de l'eau.", load: 1, pool: true,
  }, (c) => {
    const target = ssaT(c, 'entry', 135);
    const a = Math.min(15, apneaMax(c, 15));
    const t50 = Math.round(target * 0.4), tBack = Math.round(target * 0.33);
    const w = pv(c, 300, 100);
    return out(c, [
      sw(c, 'swim_warmup', w, { suffix: 'dont 2 × 25 m accélérés', min: swimMin(w, 160), warm: true }),
      it(c, 'apnea_breath_dry', { reps: '1 min au bord : respiration calme', min: 1.5 }),
      it(c, 'apnea_dive_15', { sets: sv(c, 4, 2), reps: `plongeon + ${a} m en immersion, ${surfaceTo(c)}`, target: { m: a }, rest: 120, min: sv(c, 4, 2) * 2.5, core: true,
        note: 'Coulée longue, expiration lente. Le test demande au moins 15 m en immersion complète.' }),
      sw(c, 'swim_crawl_50', 50, { suffix: 'allure test', target: { sec: t50 }, sets: sv(c, 4, 2), rest: 45, min: sv(c, 4, 2) * 1.8, core: true,
        note: `≈ ${fmtT(t50)} pour ta cible de ${fmtT(target)} au test.` }),
      sw(c, 'swim_back_legs', 25, { suffix: 'mains hors de l\'eau', target: { sec: tBack }, sets: sv(c, 4, 2), rest: 40, min: sv(c, 4, 2) * 1.5, core: true,
        note: 'Poignets au-dessus de la surface, seules les jambes avancent. C\'est le segment le plus lent du test.' }),
      it(c, 'swim_eggbeater', { sets: sv(c, 3, 2), reps: '30 s sur place, mains hors de l\'eau', target: { sec: 30 }, rest: 30, note: 'Rétropédalage : genoux écartés, pieds qui tournent en sens opposé.' }),
      sw(c, 'swim_cooldown', pv(c, 200, 100), { suffix: 'souple', min: 4 }),
    ], {
      extraMin: 2,
      intro: `Test d'entrée : 100 m sans appui en 2:45 maximum (à confirmer avec ton organisme) — plongeon avec au moins 15 m en immersion, 50 m crawl, 25 m dos mains hors de l'eau. Ta cible : ${fmtT(target)}.`,
    });
  });

  def('swim_ssa_tsa', {
    title: 'Piscine — Sauvetage (parcours TSA)', loc: 'piscine', kind: 'swim', goals: ['ssa', 'pompier'],
    summary: "Immersions, nage d'approche, canard, mannequin, remorquage.", load: 2, pool: true,
  }, (c) => {
    const w = pv(c, 300, 100);
    const mk = hasManikin(c);
    return out(c, [
      sw(c, 'swim_warmup', w, { suffix: 'nages variées', min: swimMin(w, 160), warm: true }),
      it(c, 'apnea_dive_15', { sets: sv(c, 3, 2), reps: 'plongeon + 15 m en immersion + 10 m de nage', target: { m: 15 }, rest: 120, min: sv(c, 3, 2) * 2.5, core: true,
        note: 'Comme le début du parcours TSA. Coulée longue, sans forcer.' }),
      sw(c, 'swim_head_up', 25, { suffix: 'tête hors de l\'eau', sets: sv(c, 4, 2), rest: 30, min: sv(c, 4, 2) * 1.2, note: 'Nage d\'approche : regard fixé sur la victime.' }),
      mk
        ? it(c, 'manikin_lift', { sets: sv(c, 4, 2), reps: `canard + remontée du mannequin — ${deepTxt(c)}`, rest: 90, min: sv(c, 4, 2) * 2, core: true, note: 'Saisis sous les aisselles, pousse sur le fond, visage du mannequin vers le haut.' })
        : it(c, 'duck_dive_object', { sets: sv(c, 4, 2), reps: `canard + objet lesté — ${deepTxt(c)}`, rest: 90, min: sv(c, 4, 2) * 2, core: true, note: 'Pas de mannequin ici : un objet lesté fait l\'affaire. Le mannequin repose entre 1,80 et 2,80 m au TSA.' }),
      sw(c, mk ? 'manikin_tow' : 'partner_tow', 25, { sets: sv(c, 4, 2), rest: 90, min: sv(c, 4, 2) * 2, core: true,
        note: 'Voies aériennes dégagées, visage hors de l\'eau : plus de 3 s d\'immersion = échec. Ciseaux ou rétropédalage.' }),
      sw(c, 'swim_crawl_25', 25, { sets: sv(c, 4, 2), rest: 30, min: sv(c, 4, 2) * 1, note: 'Rapide, comme le 25 m crawl du parcours.' }),
      sw(c, 'swim_cooldown', pv(c, 200, 100), { suffix: 'souple', min: 4 }),
    ], {
      extraMin: 3,
      intro: 'Parcours TSA (épreuve 1, 2:30 maximum, à confirmer) : plongeon, 15 m en immersion + 10 m, 25 m crawl, 15 m en immersion + 10 m, approche tête hors de l\'eau, canard, mannequin entre 1,80 et 2,80 m, remorquage jusqu\'au bord.',
    });
  });

  def('swim_fins', {
    title: 'Piscine — Palmes', loc: 'piscine', kind: 'swim', goals: ['ssa'],
    summary: 'Chaussage chronométré, battements, 100 m à l\'allure du 300 m palmes du TSA.', load: 1, pool: true,
  }, (c) => {
    const target = ssaT(c, 'fins', 235);
    const per100 = Math.round((target - 15) / 3);
    const n100 = sv(c, 5, 3);
    const ank = c.injuries.cheville ? `${c.injuryLabels.cheville || 'Cheville'} : palmes souples si possible, amplitude modérée.` : '';
    return out(c, [
      sw(c, 'swim_warmup', pv(c, 200, 100), { suffix: 'sans palmes', min: 5, warm: true }),
      it(c, 'fins_don', { sets: sv(c, 4, 2), reps: 'chaussage hors de l\'eau, chrono', target: { sec: 15 }, rest: 30, min: 3, core: true,
        note: 'Assis au bord, palme mouillée, talon d\'abord. Vise moins de 15 s : au TSA, le chrono part avant le chaussage.' }),
      sw(c, 'fins_kick', 50, { sets: sv(c, 4, 2), rest: 20, min: sv(c, 4, 2) * 1.2, note: join('Jambes presque tendues, battements amples depuis la hanche.', ank) }),
      sw(c, 'fins_100', 100, { target: { sec: per100 }, sets: n100, rest: 30, min: n100 * 2, core: true,
        note: `≈ ${fmtT(per100)} au 100 m pour ta cible de ${fmtT(target)} au 300 m (chaussage compris). Masque et tuba autorisés au TSA.` }),
      c.level === 'spe' && c.vol >= 0.8 ? sw(c, 'fins_300', 300, { suffix: 'chaussage compris', min: 6, note: 'Entraînement : départ au bord sans palmes.' }) : null,
      sw(c, 'swim_cooldown', coolM(c), { suffix: 'sans palmes', min: 3 }),
    ], { extraMin: 2, intro: 'Palmes : le 300 m palmes du TSA (4:30 maximum, à confirmer) est une épreuve à part entière, chaussage compris.' });
  });

  def('swim_ssa_sim', {
    title: 'Piscine — Simulation SSA', loc: 'piscine', kind: 'swim', goals: ['ssa'], fixed: true,
    summary: "Simulation complète du test d'entrée ou du TSA, chronométrée.", load: 2, pool: true,
  }, (c) => {
    const mode = c.simMode === 'tsa' ? 'tsa' : 'entry';
    const items = [];
    if (mode === 'entry') {
      const t = ssaT(c, 'entry', 135);
      items.push(sw(c, 'swim_warmup', pv(c, 400, 200), { suffix: "dont 2 × 25 m à l'allure du test et 1 départ plongé", min: 11, warm: true }));
      items.push(it(c, 'ssa_entry_test', { reps: "100 m : plongeon + 15 m en immersion, 50 m crawl, 25 m dos mains hors de l'eau", target: { sec: t, m: 100 }, min: 4, core: true,
        bench: 'ssa_entry_test', test: true, note: join(`Sans appui, chrono du signal au toucher. Ta cible : ${fmtT(t)} (limite 2:45, à confirmer). Fais-toi chronométrer par le club.`, lapNote(c, 100)) }));
      items.push(sw(c, 'swim_crawl_easy', pv(c, 200, 100), { suffix: 'souple', min: 5 }));
      if (c.variant !== 'express') items.push(sw(c, 'swim_back_legs', 25, { suffix: 'technique', sets: 2, rest: 60, min: 3 }));
    } else {
      const tc = ssaT(c, 'tsa', 125), tf = ssaT(c, 'fins', 235);
      items.push(sw(c, 'swim_warmup', pv(c, 400, 200), { suffix: '+ 1 canard facile + 1 chaussage de palmes', min: 12, warm: true }));
      items.push(it(c, 'ssa_tsa_course', { reps: 'parcours 100 m complet', target: { sec: tc, m: 100 }, min: 4, core: true, bench: 'ssa_tsa_course', test: true,
        note: join(`Ta cible : ${fmtT(tc)} (limite 2:30, à confirmer). Visage du mannequin hors de l'eau pendant le remorquage.${hasManikin(c) ? '' : ' Sans mannequin : remorque un partenaire.'}`, lapNote(c, 100)) }));
      if (c.variant !== 'express') {
        items.push(it(c, 'apnea_breath_dry', { name: 'Récupération entre les deux épreuves', reps: '10 min : bois, reste au chaud', min: 10,
          timer: { name: 'Récupération TSA', voice: false, prepSec: 0, rounds: 1, restBetweenRoundsSec: 0, steps: [{ label: 'Récupération', sec: 600, kind: 'rest' }] } }));
        items.push(sw(c, 'fins_300', 300, { suffix: 'palmes, chaussage compris', target: { sec: tf }, min: 6, core: true, bench: 'ssa_tsa_fins', test: true,
          note: `Départ au bord sans palmes. Ta cible : ${fmtT(tf)} (limite 4:30, à confirmer).` }));
      }
    }
    items.push(sw(c, 'swim_cooldown', pv(c, 200, 100), { suffix: 'souple', min: 4 }));
    return out(c, items, {
      title: mode === 'entry' ? "Simulation du test d'entrée SSA" : 'Simulation du TSA',
      extraMin: 3,
      intro: mode === 'entry'
        ? "Simulation du test d'entrée, comme le jour J. Une seule tentative, à fond mais propre."
        : 'Simulation du TSA : parcours de sauvetage, 10 min de récupération, puis 300 m palmes.',
    });
  });

  def('swim_easy', {
    title: 'Piscine — Nage facile', loc: 'piscine', kind: 'swim', goals: ['general'],
    summary: 'Nage souple pour récupérer.', load: 0, pool: true,
  }, (c) => {
    const m = pv(c, 600, 200);
    return out(c, [
      sw(c, 'swim_crawl_easy', m, { suffix: 'souple, respiration régulière', min: swimMin(m, 170), core: true }),
      sw(c, 'swim_breast_glide', 25, { sets: 4, rest: 20, min: 4 }),
      sw(c, 'swim_kick', 25, { sets: 4, rest: 20, min: 4 }),
      sw(c, 'swim_cooldown', coolM(c), { suffix: 'souple', min: 3 }),
    ], { intro: 'Récupération : nage souple, sans chrono. Tu dois sortir de l\'eau plus frais qu\'en arrivant.' });
  });

  /* ── Course ── */

  const softGround = 'Surface souple conseillée (herbe, chemin, piste).';
  const runInj = (c) => (legHurt(c) ? `${adaptNote(c)} Terrain plat, pas de descente ; douleur au-dessus de 3/10 : passe en marche rapide.` : '');
  // Durée du footing : +5 min toutes les 2 semaines, plafonnée (plus bas si blessure).
  function easyMinutes(c) {
    if (c.phase === 'recuperation') return mv(c, 50, 15);
    const cap = legHurt(c) ? 50 : 60;
    return mv(c, Math.min(cap, 40 + 5 * Math.floor(c.weekIndex / 2)), 15);
  }

  def('run_easy', {
    title: 'Course — Footing facile', loc: 'dehors', kind: 'run', goals: ['hyrox', 'pompier', 'general'],
    summary: 'Endurance fondamentale : la base de tout, même pour HYROX.', load: 0, run: true,
  }, (c) => {
    const pc = paces(c);
    const m = easyMinutes(c);
    const strides = c.level !== 'reprise' && !legHurt(c) && c.phase !== 'recuperation';
    return out(c, [
      it(c, 'run_easy', { reps: `${m} min`, target: { sec: m * 60 }, min: m, core: true,
        note: join(pc ? `Allure ≈ ${paceTxt(pc.easy)}.` : '', 'Tu dois pouvoir parler en phrases.', softGround, runInj(c)) }),
      strides ? it(c, 'run_strides', { sets: 4, reps: '20 s accéléré, retour en marchant', rest: 60, min: 5, note: 'Relâché, sur l\'herbe si possible.' }) : null,
      c.injuries.cheville
        ? it(c, 'ankle_knee_to_wall', { sets: 2, reps: '10 / côté', min: 3, note: 'Mobilité de cheville après la course.' })
        : it(c, 'mob_hips', { reps: '3 min', min: 3 }),
    ], { intro: 'Footing en endurance fondamentale : lent, régulier, en aisance. C\'est là que se construit l\'endurance.', safety: [legHurt(c) ? SAFETY_PAIN : ''] });
  });

  def('run_intervals', {
    title: 'Course — Fractionné', loc: 'dehors', kind: 'run', goals: ['hyrox', 'pompier'],
    summary: '30/30, 400 m ou 1 km à allure soutenue selon la période.', load: 2, intense: true, run: true,
  }, (c) => {
    const pc = paces(c);
    const inj = legHurt(c);
    const main = [];
    let intro;
    if (c.level === 'reprise' || c.level === 'base') {
      const reps = Math.max(4, Math.round((c.level === 'reprise' ? 6 : 8) * c.vol) - (inj ? 1 : 0));
      const timer = { name: '30/30', voice: false, prepSec: 10, rounds: 2, restBetweenRoundsSec: 180,
        steps: Array.from({ length: reps }, () => [{ label: 'Vite', sec: 30, kind: 'work' }, { label: 'Lent', sec: 30, kind: 'rest' }]).flat() };
      main.push(it(c, 'run_3030', { sets: 2, reps: `${reps} × (30 s vite / 30 s lent), 3 min entre les 2 séries`, rest: 180, min: 2 * reps + 3, core: true, timer,
        note: join('Vite = allure que tu tiendrais 5 à 6 min, pas un sprint.', runInj(c)) }));
      intro = '30/30 : le moyen le plus simple de passer du temps à haute intensité sans t\'épuiser.';
    } else if (c.level === 'dev') {
      const n = Math.max(4, Math.round(Math.min(10, 6 + Math.floor(c.weekInPhase / 2)) * c.vol) - (inj ? 2 : 0));
      const t400 = pc ? Math.round(pc.fast * 0.4) : null;
      main.push(it(c, 'run_400', { sets: n, reps: '400 m', target: t400 ? { sec: t400 } : {}, rest: 90, min: n * 3.5, core: true,
        note: join(t400 ? `≈ ${fmtT(t400)} par 400 m.` : 'Allure soutenue, la même sur toutes les répétitions.', '90 s de trot entre chaque.', runInj(c)) }));
      intro = '400 m rapides : vitesse et puissance aérobie.';
    } else {
      const n = Math.max(2, Math.round(5 * c.vol) - (inj ? 1 : 0));
      const t1k = pc ? Math.round(pc.race - 10) : null;
      main.push(it(c, 'run_1k_rep', { sets: n, reps: '1 km', target: t1k ? { sec: t1k } : {}, rest: 120, min: n * 7.5, core: true,
        note: join(t1k ? `≈ ${fmtT(t1k)} au km : un peu plus vite que ton allure HYROX.` : 'Un peu plus vite que ton allure HYROX.', runInj(c)) }));
      intro = c.taper ? 'Affûtage : peu de répétitions mais on garde l\'allure.' : '1 km à allure soutenue : ton allure HYROX doit devenir confortable.';
    }
    return out(c, [
      it(c, 'run_warmup', { reps: '15 min de footing + gammes', min: 15, warm: true, note: softGround }),
      ...main,
      it(c, 'run_cooldown', { reps: '10 min très facile', min: 10 }),
    ], { intro, safety: [inj ? SAFETY_PAIN : ''] });
  });

  def('run_tempo', {
    title: 'Course — Allure seuil', loc: 'dehors', kind: 'run', goals: ['hyrox'],
    summary: 'Blocs à allure « phrases courtes » : tenir longtemps un rythme soutenu.', load: 2, intense: true, run: true,
  }, (c) => {
    const pc = paces(c);
    const blocks = c.level === 'spe' ? 1 : c.level === 'dev' ? 3 : 2;
    const each = c.level === 'spe' ? mv(c, 25, 10) : mv(c, 8, 5);
    return out(c, [
      it(c, 'run_warmup', { reps: '15 min de footing + gammes', min: 15, warm: true, note: softGround }),
      it(c, 'run_tempo', { sets: blocks, reps: `${each} min allure seuil`, target: { sec: each * 60 }, rest: blocks > 1 ? 120 : 0, min: blocks * each + (blocks - 1) * 2, core: true,
        note: join(pc ? `≈ ${paceTxt(pc.tempo)}.` : '', 'Tu peux dire des phrases courtes, pas plus.', runInj(c)) }),
      it(c, 'run_cooldown', { reps: '10 min très facile', min: 10 }),
    ], { intro: 'Allure seuil : soutenu mais contrôlé. C\'est l\'allure qui fait tenir les 8 km d\'une course HYROX.', safety: [legHurt(c) ? SAFETY_PAIN : ''] });
  });

  def('run_long', {
    title: 'Course — Sortie longue', loc: 'dehors', kind: 'run', goals: ['hyrox'],
    summary: 'Sortie longue facile : l\'endurance qui fait plus de la moitié du chrono HYROX.', load: 2, legs: 1, run: true,
  }, (c) => {
    const pc = paces(c);
    const cap = legHurt(c) ? 70 : 90;
    const m = mv(c, Math.min(cap, 60 + 5 * Math.floor(c.weekIndex / 3)), 20);
    const finish = c.level === 'spe' && !legHurt(c) && m >= 45;
    return out(c, [
      it(c, 'run_long', { reps: `${m} min${finish ? ', les 10 dernières à allure HYROX' : ''}`, target: { sec: m * 60 }, min: m, core: true,
        note: join(pc ? `Allure facile ≈ ${paceTxt(pc.easy)}${finish ? `, puis ≈ ${paceTxt(pc.race)}` : ''}.` : 'Allure facile, en aisance.', softGround, 'Emporte de l\'eau au-delà d\'une heure.', runInj(c)) }),
      it(c, 'foam_roll', { reps: '5 min : mollets, cuisses, fessiers', min: 5 }),
    ], { intro: 'Sortie longue : lente et régulière. Mieux vaut finir frais que partir trop vite.', safety: [legHurt(c) ? SAFETY_PAIN : ''] });
  });

  def('run_test', {
    title: 'Course — Test chrono', loc: 'dehors', kind: 'test', goals: ['hyrox', 'pompier'], fixed: true,
    summary: '1 km ou 5 km chronométré : sert à calculer tes allures.', load: 2, intense: true, run: true,
  }, (c) => {
    // Version express : le test de 1 km (le 5 km ne tient pas en 30 min avec l'échauffement).
    const five = c.testRun !== '1k' && c.variant !== 'express';
    return out(c, [
      it(c, 'run_warmup', { reps: '15 min de footing + gammes', min: 15, warm: true }),
      it(c, 'run_strides', { sets: 3, reps: '20 s accéléré', rest: 60, min: 4 }),
      five
        ? it(c, 'run_5k_test', { reps: '5 km chrono', min: 28, core: true, bench: 'run_5k', test: true, note: join('Parcours plat mesuré, piste ou tapis à 1 %. Pars régulier : le 1er km ne doit pas être le plus rapide.', runInj(c)) })
        : it(c, 'run_1k_test', { reps: '1 km chrono', min: 6, core: true, bench: 'run_1k', test: true, note: join('Piste ou parcours plat mesuré. À fond mais régulier.', runInj(c)) }),
      it(c, 'run_cooldown', { reps: '10 min très facile', min: 10 }),
    ], {
      title: five ? 'Course — Test 5 km' : 'Course — Test 1 km',
      intro: 'Test chronométré : il sert à calculer tes allures d\'entraînement. Note ton temps même s\'il ne te plaît pas.',
      safety: [legHurt(c) ? 'Douleur de 4/10 ou plus : arrête le test et note-le, ce n\'est pas grave.' : ''],
    });
  });

  def('run_luc_leger_prep', {
    title: 'Course — Préparation Luc Léger', loc: 'dehors', kind: 'run', goals: ['pompier'],
    summary: 'Navettes avec demi-tours et 30/30 : préparer le test Luc Léger.', load: 2, legs: 1, intense: true, run: true,
  }, (c) => {
    const nj = noJump(c);
    const main = nj
      ? it(c, 'run_3030', { sets: 2, reps: `${Math.max(5, Math.round(8 * c.vol))} × (30 s vite / 30 s lent) en ligne droite`, rest: 180, min: 2 * Math.max(5, Math.round(8 * c.vol)) + 3, core: true,
        note: join(adaptNote(c), 'Pas de demi-tours tant que la cheville et le genou ne sont pas prêts.') })
      : it(c, 'run_shuttle', { sets: sv(c, 6, 3), reps: 'navettes de 20 m pendant 1 min (allure palier 8–9)', rest: 60, min: sv(c, 6, 3) * 2, core: true,
        note: 'Demi-tour en posant le pied sur la ligne, relance immédiate. Compte tes navettes.' });
    return out(c, [
      it(c, 'run_warmup', { reps: '15 min de footing + gammes', min: 15, warm: true }),
      main,
      it(c, 'run_strides', { sets: 4, reps: '20 s accéléré', rest: 60, min: 5 }),
      it(c, 'run_cooldown', { reps: '10 min très facile', min: 10 }),
    ], { intro: 'Luc Léger : navette de 20 m au rythme des bips, +0,5 km/h par palier. Demande la version de la bande (départ 8 ou 8,5 km/h) le moment venu.', safety: [legHurt(c) ? SAFETY_PAIN : ''] });
  });

  /* ── Maison ── */

  // Niveau de traction : A (0), B (1 à 4), C (5 à 9), D (10 et plus). Sans test : A.
  function pullLevel(c) {
    const b = c.best('pullups');
    if (b == null || b < 1) return 'A';
    return b < 5 ? 'B' : b < 10 ? 'C' : 'D';
  }

  def('home_strength', {
    title: 'Maison — Tractions et pompes', loc: 'maison', kind: 'home', goals: ['pompier', 'hyrox'],
    summary: 'Barre + 2 élastiques : progression des tractions (négatives → élastique → strictes), pompes, gainage.', load: 1,
  }, (c) => {
    const lvl = pullLevel(c), b = c.best('pullups'), pu = c.best('pushups');
    const pull = {
      A: [
        it(c, 'dead_hang', { sets: sv(c, 3, 2), reps: '20–30 s', target: { sec: 30 }, rest: 60 }),
        it(c, 'scap_pullup', { sets: sv(c, 3, 2), reps: '8', target: { reps: 8 }, rest: 60, note: 'Bras tendus, seules les omoplates bougent.' }),
        it(c, 'pullup_negative', { sets: sv(c, 4, 2), reps: '3 (descente en 5 s)', target: { reps: 3 }, rest: 90, core: true, note: 'Monte avec une chaise, descends le plus lentement possible.' }),
        it(c, 'pullup_band', { sets: sv(c, 3, 2), reps: '5–8', target: { reps: 8 }, rest: 90, core: true, note: 'Élastique le plus fort d\'abord, le plus léger quand 8 passent.' }),
      ],
      B: [
        it(c, 'pullup_strict', { sets: sv(c, 6, 3), reps: '1–2 (8 à 12 au total)', target: { reps: 2 }, rest: 75, core: true, note: 'Petites séries propres, jamais à l\'échec.' }),
        it(c, 'pullup_negative', { sets: sv(c, 3, 2), reps: '3 (descente en 5 s)', target: { reps: 3 }, rest: 90 }),
        it(c, 'pullup_band', { sets: sv(c, 2, 1), reps: '5–8', target: { reps: 8 }, rest: 90 }),
      ],
      C: [
        it(c, 'pullup_strict', { sets: sv(c, 5, 3), reps: `${Math.max(2, Math.round(b || 5) - 2)}`, target: { reps: Math.max(2, Math.round(b || 5) - 2) }, rest: 120, core: true, note: '2 en réserve ; +1 répétition par série chaque semaine.' }),
        it(c, 'chinup_strict', { sets: sv(c, 2, 1), reps: 'max − 2', rest: 120, note: 'Supination, comme au test pompier.' }),
      ],
      D: [
        it(c, 'pullup_strict', { sets: sv(c, 5, 3), reps: '4–6 (lesté si tu peux)', target: { reps: 6 }, rest: 150, core: true }),
        it(c, 'chinup_strict', { sets: sv(c, 2, 1), reps: 'max − 2', rest: 120 }),
      ],
    }[lvl];
    const pushReps = pu ? Math.max(5, Math.round(pu * 0.6)) : null;
    return out(c, [
      it(c, 'band_warmup', { reps: '2 × 15 écartés + 10 rotations d\'épaules', min: 4, warm: true }),
      ...pull,
      pu != null && pu < 10
        ? it(c, 'pushup_incline', { sets: sv(c, 3, 2), reps: '8–12', target: { reps: 12 }, rest: 75, core: true })
        : it(c, 'pushup', { sets: sv(c, 4, 2), reps: pushReps ? `${pushReps}` : 'max − 3', target: pushReps ? { reps: pushReps } : {}, rest: 90, core: true, note: 'Corps gainé, poitrine à un poing du sol.' }),
      it(c, 'band_row', { sets: sv(c, 3, 2), reps: '15', target: { reps: 15 }, rest: 45 }),
      it(c, 'band_face_pull', { sets: sv(c, 3, 2), reps: '15', target: { reps: 15 }, rest: 45, note: 'Protège les épaules : utile avec la natation.' }),
      it(c, 'chair_dips', { sets: sv(c, 3, 1), reps: '8–12', target: { reps: 12 }, rest: 60 }),
      it(c, 'hanging_knee_raise', { sets: sv(c, 3, 1), reps: '8–10', target: { reps: 10 }, rest: 60 }),
      it(c, 'glute_bridge', { sets: 2, reps: '15', target: { reps: 15 }, rest: 45 }),
    ], { extraMin: 2, intro: `Barre de traction et élastiques. Niveau tractions : ${lvl}${b == null ? ' (fais le bilan force pour l\'ajuster)' : ''}. Pas de tractions 2 jours de suite.` });
  });

  // Circuit d'abdos guidé à la voix (la voix n'est utilisée que pour les abdos).
  def('home_core', {
    title: 'Maison — Abdos et gainage (voix)', loc: 'maison', kind: 'home', goals: ['pompier', 'hyrox', 'general'],
    summary: 'Circuit guidé à la voix : annonce de l\'exercice suivant, « 5, 4, 3, 2, 1 » et bip.', load: 0,
  }, (c) => {
    const work = c.level === 'reprise' ? 30 : c.level === 'base' ? 40 : 45;
    const rest = c.level === 'spe' ? 15 : 20;
    const rounds = clamp(Math.round(3 * c.vol), 2, 3);
    const list = [
      { exId: 'plank', sec: work + 10 }, { exId: 'dead_bug', sec: work }, { exId: 'side_plank', sec: Math.max(20, work - 10) },
      { exId: 'hollow_hold', sec: Math.max(20, work - 10) }, { exId: 'bird_dog', sec: work }, { exId: 'superman', sec: work },
      { exId: c.level === 'reprise' ? 'crunch' : 'russian_twist', sec: work },
    ];
    const timer = circuit('Abdos et gainage', true, list, rounds, { restSec: rest, restBetweenRoundsSec: 60 });
    const total = timerMin(timer);
    const items = list.map((x, i) => {
      const info = exInfo(x.exId);
      return it(c, x.exId, { sets: rounds, reps: `${x.sec} s${info.sides ? ' par côté' : ''}`, target: info.track === 'time' ? { sec: x.sec } : {}, rest,
        min: i === 0 ? total : 0, core: true, timer: i === 0 ? timer : undefined,
        note: i === 0 ? 'Lance le minuteur : il enchaîne tout le circuit et annonce chaque exercice.' : '' });
    });
    return out(c, items, { intro: `Circuit guidé à la voix : ${rounds} tours de ${list.length} exercices, ${work} s d'effort, ${rest} s de repos. Le minuteur annonce l'exercice suivant, compte « 5, 4, 3, 2, 1 » et bipe.` });
  });

  def('home_rehab', {
    title: 'Maison — Cheville et genou', loc: 'maison', kind: 'rehab', goals: ['general'],
    summary: '15 à 20 min de renforcement de la cheville et du genou, guidé à la voix.', load: 0,
  }, (c) => {
    const ank = !!c.injuries.cheville, kn = !!c.injuries.genou;
    const both = ank === kn;
    const A = [
      { exId: 'single_leg_balance', sec: 30, reps: '30 s par jambe (yeux fermés si facile)' },
      { exId: 'calf_raise_eccentric', sec: 45, reps: '12 lentes (descente en 3 s)', n: 12 },
      { exId: 'ankle_band', sec: 45, reps: '10 par direction', n: 10 },
      { exId: 'tibialis_raise', sec: 40, reps: '15', n: 15 },
    ];
    const K = [
      { exId: 'spanish_squat', sec: 45, reps: '45 s' },
      { exId: 'step_down', sec: 40, reps: '8 lentes par jambe', n: 8 },
      { exId: 'tke_band', sec: 40, reps: '15', n: 15 },
      { exId: 'glute_bridge', sec: 40, reps: '12', n: 12 },
    ];
    const list = both ? [A[0], A[1], A[2], K[0], K[1], K[2]] : ank ? [...A, K[3]] : [...K, A[0]];
    const rounds = c.variant === 'express' || c.vol < 0.6 ? 1 : 2;
    const timer = circuit('Cheville et genou', true, list.map((x) => ({ exId: x.exId, sec: x.sec })), rounds, { restSec: 20, restBetweenRoundsSec: 60 });
    const total = timerMin(timer);
    const items = list.map((x, i) => it(c, x.exId, {
      sets: rounds, reps: x.reps, target: x.n ? { reps: x.n } : { sec: x.sec }, rest: 20, min: i === 0 ? total : 0, core: true,
      timer: i === 0 ? timer : undefined, note: i === 0 ? join('Lance le minuteur : il annonce chaque exercice.', sideFirst(c)) : '',
    }));
    return out(c, items, {
      intro: `Renforcement ${both ? 'de la cheville et du genou' : ank ? 'de la cheville' : 'du genou'} : lent et contrôlé. Douleur acceptable : 3/10 maximum, revenue à la normale le lendemain matin.`,
      safety: ['Ce n\'est pas un soin : si la douleur augmente ou persiste, consulte un professionnel de santé.'],
    });
  });

  def('mobility', {
    title: 'Mobilité', loc: 'maison', kind: 'home', goals: ['general'],
    summary: 'Hanches, dos, épaules, chevilles : 20 min pour récupérer.', load: 0,
  }, (c) => out(c, [
    it(c, 'mob_hips', { reps: '2 min par côté', min: 4, core: true }),
    it(c, 'mob_thoracic', { reps: '2 min', min: 2, core: true }),
    it(c, 'mob_shoulders', { reps: '2 min', min: 2 }),
    it(c, 'ankle_knee_to_wall', { sets: 2, reps: '10 par côté', min: 3, core: true }),
    it(c, 'stretch_hamstrings', { sets: 2, reps: '45 s', target: { sec: 45 }, rest: 15, min: 2 }),
    it(c, 'foam_roll', { reps: '5 min : mollets, cuisses, fessiers, dos', min: 5 }),
  ], { intro: 'Mobilité tranquille : respire lentement, aucune position ne doit faire mal.' }));

  def('test_force', {
    title: 'Maison — Bilan force', loc: 'maison', kind: 'test', goals: ['pompier', 'general'], fixed: true,
    summary: 'Tractions max, pompes en cadence, planche, chaise (Killy), souplesse.', load: 1,
  }, (c) => {
    const express = c.variant === 'express';
    const items = [
      it(c, 'band_warmup', { reps: 'épaules, quelques pompes et 1 ou 2 tractions faciles', min: 5, warm: true }),
      it(c, 'test_pushup_max', { reps: 'max en cadence : 1 pompe toutes les 2 s', min: 3, rest: 240, core: true, bench: 'pushups', test: true,
        note: 'Poitrine à environ 5 cm du sol, corps aligné. Le test s\'arrête quand tu ne tiens plus la cadence.' }),
      it(c, 'test_pullup_max', { reps: 'max strict, bras tendus en bas', min: 2, rest: 240, core: true, bench: 'pullups', test: true, note: 'Menton au-dessus de la barre, pas d\'élan.' }),
      express ? null : it(c, 'test_chinup_max', { reps: 'max en supination (paumes vers toi)', min: 2, rest: 240, bench: 'chinups', test: true, note: 'Pas de pause de plus de 3 s. Saute ce test si tu es trop fatigué.' }),
      it(c, 'test_plank_max', { reps: 'max', min: 4, rest: 180, core: true, bench: 'plank', test: true, note: 'Avant-bras et orteils, corps aligné : arrête dès que les hanches tombent.' }),
      express ? null : it(c, 'test_wall_sit_max', { reps: 'max, cuisses à 90°', min: 4, rest: 180, bench: 'wall_sit', test: true, note: join('Dos plaqué au mur.', kneeNote(c)) }),
      express ? null : it(c, 'sit_and_reach', { reps: 'meilleur de 2 essais', min: 3, bench: 'sit_reach', test: true, note: 'Jambes tendues, pousse sans à-coup. Note en cm.' }),
    ];
    return out(c, items, { intro: 'Bilan force : un essai par test, repos complet entre chaque. Note ton résultat même s\'il est bas : c\'est ton point de départ.' });
  });

  /* ── Événements ── */

  function checklistTexts(id) {
    const list = D.checklists && D.checklists[id];
    return Array.isArray(list) ? list.map((x) => x.text).filter(Boolean) : [];
  }

  def('event_race', {
    title: 'HYROX — jour J', loc: 'autre', kind: 'event', goals: ['hyrox'], fixed: true,
    summary: 'Jour de course : pas d\'entraînement, check-list et résultat officiel.', load: 3, legs: 2, intense: true, run: true,
  }, (c) => {
    const name = (c.goal && c.goal.type === 'hyrox' && c.goal.name) || 'HYROX';
    const fallback = ['Billet, pièce d\'identité, heure de vague notée.', 'Chaussures et tenue déjà portées.', 'Petit-déjeuner habituel, rien de nouveau.', 'Pars le 1er km plus lentement que tu ne le crois.'];
    const cl = checklistTexts('hyrox-jour-j');
    return out(c, [
      it(c, 'run_warmup', { reps: '10 à 15 min de footing + gammes, 2 ou 3 accélérations', min: 15, warm: true }),
      it(c, 'hyrox_run_station', { name: 'Ta course HYROX (temps officiel)', reps: '8 × (1 km + station)', min: 100, core: true, bench: 'hyrox_race', test: true,
        note: 'Note ton temps officiel, et tes temps par station si tu les as.' }),
      it(c, 'run_cooldown', { reps: 'marche 10 min, bois, mange dans l\'heure', min: 10 }),
    ], {
      title: `${name} — jour J`,
      intro: join('Jour J : pas d\'entraînement. Fais-toi confiance, l\'objectif est de finir.', isDoubles(c) ? 'Doubles : pas plus de 10 s d\'écart sur les tapis, vous commencez chaque station ensemble.' : ''),
      checklist: cl.length ? cl : fallback,
      safety: ['Une station non terminée = disqualification. Compte tes tours de piste et tes 4 longueurs de sled.', 'Bois et mange selon ton plan ; arrête-toi si tu as la tête qui tourne.'],
    });
  });

  def('event_ssa', {
    title: 'SSA — jour du test', loc: 'piscine', kind: 'event', goals: ['ssa'], fixed: true,
    summary: "Test d'entrée ou TSA : échauffement, épreuve, résultat.", load: 3, pool: true,
  }, (c) => {
    const kind = (c.ssaEvent && c.ssaEvent.kind) || (c.ssaNext && c.ssaNext.kind) || 'entry';
    const items = [it(c, 'swim_warmup', { reps: '400 à 600 m souple, 2 ou 3 × 25 m à l\'allure du test, 1 départ plongé', min: 15, warm: true })];
    if (kind === 'entry') {
      items.push(it(c, 'ssa_entry_test', { reps: '100 m officiel', min: 4, core: true, bench: 'ssa_entry_test', test: true, note: 'Note ton temps officiel. Attestation valable 1 an : garde-la.' }));
    } else {
      items.push(it(c, 'ssa_tsa_course', { reps: 'parcours 100 m officiel', min: 4, core: true, bench: 'ssa_tsa_course', test: true, note: 'Note ton temps officiel.' }));
      items.push(it(c, 'apnea_breath_dry', { name: 'Récupération entre les deux épreuves', reps: '10 min au moins : bois, reste au chaud', min: 10 }));
      items.push(it(c, 'fins_300', { reps: '300 m palmes officiel, chaussage compris', min: 6, core: true, bench: 'ssa_tsa_fins', test: true, note: 'Tu attends au bord sans tes palmes.' }));
    }
    const cl = checklistTexts(kind === 'entry' ? 'ssa-test' : 'ssa-tsa');
    return out(c, items, {
      title: kind === 'entry' ? "Test d'entrée SSA — jour J" : 'TSA — jour J',
      intro: 'Jour du test : pas d\'entraînement en plus. Échauffe-toi calmement, une inspiration normale avant le plongeon.',
      checklist: cl.length ? cl : ['Convocation, pièce d\'identité, certificat médical si demandé.', 'Maillot, bonnet, serviette ; palmes habituelles pour le TSA.'],
    });
  });

  def('rest', {
    title: 'Repos', loc: 'repos', kind: 'rest', goals: [], fixed: true,
    summary: 'Récupération. Bouger un peu est facultatif.', load: 0,
  }, (c) => out(c, [
    it(c, 'walk_brisk', { reps: '20 à 30 min (facultatif)', target: { sec: 1500 }, min: 25 }),
    it(c, 'mob_hips', { reps: '5 min (facultatif)', min: 5 }),
  ], { intro: 'Repos : c\'est pendant la récupération que tu progresses. Si tu as envie de bouger : marche ou mobilité légère.' }));

  /* ───────── Exposition ───────── */

  D.sessionTemplates = T;
  // Outils partagés avec le planificateur (et les tests).
  D.sessionKit = { exInfo, ctxOf, lapsTxt, SAFETY_APNEA, SAFETY_PAIN, VARIANTS, FALLBACK_IDS: Object.keys(FALLBACK), SIM_STAGES, round5 };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
