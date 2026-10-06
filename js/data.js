// Bibliothèque de séances, planning par phase, habitudes et tests de référence.
// track : 'reps' | 'load' (kg + reps) | 'time' (mm:ss) | 'dist' (m) | 'check'
// bench : identifiant d'un test de référence alimenté automatiquement en fin de séance.

const LOCATIONS = {
  maison:  { label: 'Maison',       icon: '🏠', color: '#22c55e' },
  salle:   { label: 'Fitness Park', icon: '🏋️', color: '#f97316' },
  piscine: { label: 'Piscine',      icon: '🏊', color: '#38bdf8' },
  dehors:  { label: 'Extérieur',    icon: '🏃', color: '#eab308' },
  repos:   { label: 'Repos',        icon: '🧘', color: '#a78bfa' },
};

const GOAL_TAGS = {
  ssa:     { label: 'SSA',     color: '#38bdf8' },
  hyrox:   { label: 'Hyrox',   color: '#f97316' },
  pompier: { label: 'Pompier', color: '#ef4444' },
};

const SESSIONS = {
  // ───────────── PISCINE ─────────────
  swim_tech: {
    title: 'Natation — Technique & aisance',
    loc: 'piscine', duration: 50, goals: ['ssa', 'pompier'],
    intro: 'Construire un crawl économique : c\'est lui qui te fera gagner du temps sur le test SSA.',
    exercises: [
      { id: 'swim_warm', name: 'Échauffement', sets: 1, reps: '200 m nages variées', track: 'check' },
      { id: 'swim_drills', name: 'Éducatifs crawl', sets: 4, reps: '50 m', rest: 20, track: 'check',
        note: 'Rattrapé, poing fermé, respiration 3 temps, battements sur le côté.' },
      { id: 'swim_50', name: '50 m crawl soutenu', sets: 8, reps: '50 m', rest: 30, track: 'time',
        note: 'Note ton temps moyen. Objectif : régularité entre la 1re et la 8e.' },
      { id: 'swim_kick', name: 'Jambes ventral (sans planche)', sets: 4, reps: '25 m', rest: 20, track: 'check',
        note: 'Bras devant ou le long du corps : tes jambes feront le travail au remorquage.' },
      { id: 'swim_300', name: '300 m crawl continu', sets: 1, reps: '300 m', track: 'time', bench: 'swim_300' },
      { id: 'swim_cool', name: 'Retour au calme', sets: 1, reps: '100 m souple', track: 'check' },
    ],
  },
  swim_ssa: {
    title: 'Natation — Spécifique test SSA',
    loc: 'piscine', duration: 60, goals: ['ssa'],
    intro: 'Test d\'entrée : 100 m sans appui en moins de 3:45 — plongeon, 25 m crawl, 2 × 7,50 m en immersion, recherche du mannequin (≈2 m) puis 25 m de remorquage. ⚠️ Jamais d\'apnée seul : toujours un partenaire ou un MNS prévenu.',
    exercises: [
      { id: 'swim_warm', name: 'Échauffement', sets: 1, reps: '300 m (dont 4 × 25 m accélérés)', track: 'check' },
      { id: 'apnea_dyn', name: 'Apnée dynamique progressive', sets: 6, reps: '8 → 15 m', rest: 60, track: 'dist', bench: 'apnea',
        note: 'Coulée longue, expiration lente par le nez. Récupération complète entre chaque, jamais d\'hyperventilation.' },
      { id: 'duck_dive', name: 'Canard + récupération d\'objet au fond', sets: 6, reps: '1 objet lesté à 2 m', rest: 45, track: 'reps',
        note: 'Canard groupé, bras tendus, remonter avec l\'objet contre la poitrine.' },
      { id: 'tow', name: 'Remorquage mannequin / partenaire', sets: 4, reps: '25 m', rest: 60, track: 'time',
        note: 'Dos du mannequin contre ta poitrine, visage TOUJOURS hors de l\'eau. Ciseaux ou jambes de brasse.' },
      { id: 'dive_combo', name: 'Plongeon + 25 m + 7,50 m en immersion', sets: 4, reps: '1 enchaînement', rest: 90, track: 'time' },
      { id: 'ssa_sim', name: 'Simulation du test complet (100 m)', sets: 1, reps: 'objectif < 3:45', track: 'time', bench: 'ssa_test',
        note: 'Une semaine sur deux. Les autres semaines : 2 × 50 m d\'enchaînement (immersion + remorquage).' },
      { id: 'swim_cool', name: 'Retour au calme', sets: 1, reps: '200 m souple', track: 'check' },
    ],
  },
  swim_endurance: {
    title: 'Natation — Endurance',
    loc: 'piscine', duration: 45, goals: ['ssa', 'pompier'],
    intro: 'Volume aérobie dans l\'eau. Respiration régulière, allure que tu peux tenir.',
    exercises: [
      { id: 'swim_warm', name: 'Échauffement', sets: 1, reps: '200 m', track: 'check' },
      { id: 'swim_300r', name: '300 m crawl', sets: 3, reps: '300 m', rest: 45, track: 'time' },
      { id: 'breast_glide', name: 'Brasse coulée (longue glisse immergée)', sets: 6, reps: '50 m', rest: 20, track: 'check',
        note: 'Prépare l\'aisance sous l\'eau pour les passages en immersion.' },
      { id: 'swim_sprint', name: 'Sprint crawl', sets: 4, reps: '25 m', rest: 40, track: 'time' },
      { id: 'swim_100', name: '100 m crawl chrono', sets: 1, reps: '100 m', track: 'time', bench: 'swim_100' },
      { id: 'swim_cool', name: 'Retour au calme', sets: 1, reps: '100 m souple', track: 'check' },
    ],
  },

  // ───────────── MAISON ─────────────
  home_upper: {
    title: 'Maison — Haut du corps (barre + élastiques)',
    loc: 'maison', duration: 45, goals: ['pompier', 'ssa'],
    intro: 'Tractions et pompes : deux épreuves des indicateurs de condition physique (ICP) pompiers.',
    exercises: [
      { id: 'band_warm', name: 'Échauffement épaules à l\'élastique', sets: 2, reps: '15 pull-aparts + 10 dislocations', track: 'check' },
      { id: 'pullup', name: 'Tractions pronation', sets: 5, reps: 'max − 1', rest: 120, track: 'reps',
        note: 'Moins de 5 reps ? Élastique d\'assistance sous les pieds, ou négatives en 5 s.' },
      { id: 'pushup', name: 'Pompes', sets: 4, reps: 'max − 2', rest: 90, track: 'reps', note: 'Corps gainé, poitrine à 1 poing du sol.' },
      { id: 'band_row', name: 'Rowing élastique', sets: 4, reps: '12–15', rest: 60, track: 'reps' },
      { id: 'chair_dips', name: 'Dips entre deux chaises', sets: 3, reps: '8–12', rest: 60, track: 'reps' },
      { id: 'face_pull', name: 'Face pull élastique', sets: 3, reps: '15', rest: 45, track: 'reps' },
      { id: 'dead_hang', name: 'Suspension à la barre (grip)', sets: 3, reps: 'max', rest: 60, track: 'time',
        note: 'La poigne sert partout : remorquage, farmer carry, échelle.' },
    ],
  },
  home_lower: {
    title: 'Maison — Jambes & explosivité',
    loc: 'maison', duration: 40, goals: ['hyrox', 'pompier'],
    intro: 'Jambes solides et explosives : fentes Hyrox, burpee broad jumps, montées d\'escaliers en tenue.',
    exercises: [
      { id: 'home_warm', name: 'Échauffement', sets: 1, reps: '3 min jumping jacks + mobilité hanches', track: 'check' },
      { id: 'bulgarian', name: 'Squat bulgare', sets: 4, reps: '10 / jambe', rest: 60, track: 'reps',
        note: 'Ajoute un élastique ou un sac à dos lesté quand 12 reps deviennent faciles.' },
      { id: 'jump_squat', name: 'Squats sautés', sets: 4, reps: '10', rest: 60, track: 'reps' },
      { id: 'glute_bridge', name: 'Pont fessier unilatéral', sets: 3, reps: '15 / jambe', rest: 45, track: 'reps' },
      { id: 'walk_lunge', name: 'Fentes marchées', sets: 3, reps: '20 pas', rest: 60, track: 'reps' },
      { id: 'bbj', name: 'Burpee broad jumps', sets: 4, reps: '8', rest: 90, track: 'reps' },
      { id: 'calf', name: 'Mollets sur une marche', sets: 3, reps: '20', rest: 30, track: 'reps' },
    ],
  },
  home_core: {
    title: 'Maison — Gainage & souplesse (ICP)',
    loc: 'maison', duration: 30, goals: ['pompier', 'hyrox'],
    intro: 'Gainage et souplesse sont évalués aux ICP. Ils protègent aussi ton dos sous le sac et le sled.',
    exercises: [
      { id: 'plank', name: 'Planche', sets: 4, reps: '45–90 s', rest: 45, track: 'time', bench: 'plank' },
      { id: 'side_plank', name: 'Planche latérale', sets: 3, reps: '30–45 s / côté', rest: 30, track: 'time' },
      { id: 'hollow', name: 'Hollow hold', sets: 3, reps: '30 s', rest: 30, track: 'time' },
      { id: 'leg_raise', name: 'Relevés de jambes à la barre', sets: 3, reps: '10', rest: 60, track: 'reps' },
      { id: 'superman', name: 'Superman (gainage dorsal)', sets: 3, reps: '15', rest: 30, track: 'reps' },
      { id: 'sit_reach', name: 'Flexion avant jambes tendues', sets: 3, reps: '45 s', rest: 15, track: 'check',
        note: 'Épreuve de souplesse des ICP. Expire en descendant, ne force pas en à-coups.' },
      { id: 'stretch', name: 'Étirements ischios, psoas, pectoraux', sets: 1, reps: '10 min', track: 'check' },
    ],
  },
  home_circuit: {
    title: 'Maison — Circuit pompier',
    loc: 'maison', duration: 35, goals: ['pompier', 'hyrox'],
    intro: 'Cardio et force en même temps, comme en intervention.',
    exercises: [
      { id: 'home_warm', name: 'Échauffement', sets: 1, reps: '5 min progressif', track: 'check' },
      { id: 'amrap', name: 'AMRAP 20 min : 5 tractions · 10 pompes · 15 squats · 20 mountain climbers', sets: 1, reps: 'tours complets', track: 'reps',
        note: 'Note le nombre de tours. Bats ce score la prochaine fois.' },
      { id: 'burpee_int', name: 'Burpees 30 s / repos 30 s', sets: 5, reps: 'max en 30 s', track: 'reps' },
      { id: 'plank', name: 'Planche', sets: 2, reps: '60 s', rest: 30, track: 'time' },
    ],
  },

  // ───────────── FITNESS PARK ─────────────
  gym_lower: {
    title: 'Fitness Park — Force jambes & chaîne postérieure',
    loc: 'salle', duration: 60, goals: ['hyrox', 'pompier'],
    intro: 'Charges lourdes, technique propre. Augmente de 2,5 kg quand toutes les séries sont réussies.',
    exercises: [
      { id: 'gym_warm', name: 'Échauffement rameur ou vélo + mobilité', sets: 1, reps: '8 min', track: 'check' },
      { id: 'back_squat', name: 'Squat barre', sets: 5, reps: '5', rest: 150, track: 'load' },
      { id: 'rdl', name: 'Soulevé de terre jambes tendues (RDL)', sets: 4, reps: '8', rest: 120, track: 'load' },
      { id: 'db_lunge', name: 'Fentes marchées haltères', sets: 3, reps: '12 / jambe', rest: 90, track: 'load' },
      { id: 'leg_press', name: 'Presse à cuisses', sets: 3, reps: '12', rest: 90, track: 'load' },
      { id: 'leg_curl', name: 'Leg curl', sets: 3, reps: '12', rest: 60, track: 'load' },
      { id: 'pallof', name: 'Pallof press (poulie)', sets: 3, reps: '12 / côté', rest: 45, track: 'load' },
    ],
  },
  gym_upper: {
    title: 'Fitness Park — Force haut du corps',
    loc: 'salle', duration: 60, goals: ['pompier', 'hyrox'],
    intro: 'Pousser, tirer, porter : tout ce que demande le terrain.',
    exercises: [
      { id: 'gym_warm', name: 'Échauffement rameur + élastique', sets: 1, reps: '6 min', track: 'check' },
      { id: 'bench', name: 'Développé couché', sets: 5, reps: '5', rest: 150, track: 'load' },
      { id: 'w_pullup', name: 'Tractions lestées (ou tirage vertical)', sets: 4, reps: '6–8', rest: 120, track: 'load' },
      { id: 'db_press', name: 'Développé militaire haltères', sets: 3, reps: '8–10', rest: 90, track: 'load' },
      { id: 'db_row', name: 'Rowing haltère', sets: 3, reps: '10 / bras', rest: 60, track: 'load' },
      { id: 'dips', name: 'Dips', sets: 3, reps: 'max', rest: 90, track: 'reps' },
      { id: 'farmer', name: 'Farmer carry lourd', sets: 4, reps: '40 m', rest: 90, track: 'load' },
    ],
  },
  gym_hyrox: {
    title: 'Fitness Park — Stations Hyrox',
    loc: 'salle', duration: 70, goals: ['hyrox'],
    intro: 'Course + station en enchaînement. Charges Open : wall ball 6 kg (H) / 4 kg (F), fentes 20 kg / 10 kg, farmer 2 × 24 kg / 2 × 16 kg.',
    exercises: [
      { id: 'gym_warm_run', name: 'Échauffement tapis progressif', sets: 1, reps: '10 min', track: 'check' },
      { id: 'hx_round1', name: '1 km tapis + 500 m SkiErg', sets: 1, reps: 'enchaîné', track: 'time',
        note: 'Pas de SkiErg ? 50 slam balls ou 40 tirages poulie haute bras tendus.' },
      { id: 'hx_round2', name: '1 km tapis + 500 m rameur', sets: 1, reps: 'enchaîné', track: 'time' },
      { id: 'hx_round3', name: '1 km tapis + sled push/pull 2 × 25 m', sets: 1, reps: 'enchaîné', track: 'time',
        note: 'Pas de sled ? Pousser le tapis éteint 4 × 20 s, ou presse lourde 20 reps.' },
      { id: 'hx_round4', name: '1 km tapis + 30 wall balls', sets: 1, reps: 'enchaîné', track: 'time' },
      { id: 'sandbag_lunge', name: 'Fentes sandbag / haltère sur les épaules', sets: 4, reps: '20 m', rest: 60, track: 'load' },
      { id: 'farmer', name: 'Farmer carry', sets: 2, reps: '100 m', rest: 60, track: 'load' },
      { id: 'gym_cool', name: 'Retour au calme + étirements', sets: 1, reps: '8 min', track: 'check' },
    ],
  },
  gym_hyrox_sim: {
    title: 'Fitness Park — Simulation Hyrox (demi-course)',
    loc: 'salle', duration: 75, goals: ['hyrox'],
    intro: 'Moitié de course à allure cible : 4 × (1 km + station complète). Garde un rythme que tu pourrais tenir 8 fois.',
    exercises: [
      { id: 'gym_warm_run', name: 'Échauffement tapis progressif', sets: 1, reps: '10 min', track: 'check' },
      { id: 'sim_ski', name: '1 km + 1000 m SkiErg', sets: 1, reps: 'enchaîné', track: 'time' },
      { id: 'sim_bbj', name: '1 km + 40 m burpee broad jumps', sets: 1, reps: 'enchaîné', track: 'time' },
      { id: 'sim_row', name: '1 km + 1000 m rameur', sets: 1, reps: 'enchaîné', track: 'time' },
      { id: 'sim_wb', name: '1 km + 50 wall balls', sets: 1, reps: 'enchaîné', track: 'time' },
      { id: 'gym_cool', name: 'Retour au calme + étirements', sets: 1, reps: '10 min', track: 'check' },
    ],
  },

  // ───────────── COURSE ─────────────
  run_easy: {
    title: 'Course — Endurance fondamentale',
    loc: 'dehors', duration: 50, goals: ['hyrox', 'pompier'],
    intro: 'Allure où tu peux parler en phrases complètes. C\'est la base de tout : n\'accélère pas.',
    exercises: [
      { id: 'run_ef', name: 'Footing en aisance respiratoire', sets: 1, reps: '40–60 min', track: 'dist',
        note: 'Note la distance (m). Ajoute 5 min chaque semaine sauf en semaine allégée.' },
      { id: 'strides', name: 'Lignes droites accélérées', sets: 4, reps: '80 m', rest: 60, track: 'check' },
    ],
  },
  run_vma: {
    title: 'Course — Fractionné VMA (Luc Léger)',
    loc: 'dehors', duration: 45, goals: ['pompier', 'hyrox'],
    intro: 'Développe ta VMA : c\'est elle qui détermine ton palier au Luc Léger.',
    exercises: [
      { id: 'run_warm', name: 'Échauffement footing + gammes', sets: 1, reps: '15 min', track: 'check',
        note: 'Montées de genoux, talons-fesses, pas chassés.' },
      { id: 'vma_3030', name: '30 s vite / 30 s trot', sets: 2, reps: '10 répétitions', rest: 180, track: 'check' },
      { id: 'shuttle', name: 'Navettes 20 m avec demi-tour', sets: 3, reps: '2 min', rest: 90, track: 'reps',
        note: 'Spécifique Luc Léger : pivot rapide, pied qui touche la ligne. Note le nombre d\'allers.' },
      { id: 'run_cool', name: 'Retour au calme', sets: 1, reps: '10 min trot', track: 'check' },
    ],
  },
  run_threshold: {
    title: 'Course — Seuil / allure Hyrox',
    loc: 'dehors', duration: 50, goals: ['hyrox'],
    intro: 'Courir vite en étant déjà fatigué : la clé d\'un bon chrono Hyrox.',
    exercises: [
      { id: 'run_warm', name: 'Échauffement footing + gammes', sets: 1, reps: '15 min', track: 'check' },
      { id: 'km_hx', name: '1 km allure Hyrox', sets: 5, reps: '1 km', rest: 75, track: 'time', bench: 'run_1k',
        note: 'Entre chaque km : 15 squats sautés ou 10 burpees à la place du repos passif.' },
      { id: 'run_cool', name: 'Retour au calme', sets: 1, reps: '10 min trot', track: 'check' },
    ],
  },

  // ───────────── REPOS / TESTS ─────────────
  mobility: {
    title: 'Repos actif — Mobilité',
    loc: 'repos', duration: 20, goals: [],
    intro: 'La récupération fait partie de l\'entraînement. Marche, mobilité, sommeil.',
    exercises: [
      { id: 'walk', name: 'Marche', sets: 1, reps: '30 min', track: 'check' },
      { id: 'mob_hips', name: 'Mobilité hanches (90/90, fente du coureur)', sets: 2, reps: '1 min / côté', track: 'check' },
      { id: 'mob_shoulders', name: 'Mobilité épaules et thoracique', sets: 2, reps: '10 rotations', track: 'check' },
      { id: 'mob_ham', name: 'Étirement ischios / flexion avant', sets: 3, reps: '45 s', track: 'check' },
    ],
  },
  rest: {
    title: 'Repos complet',
    loc: 'repos', duration: 0, goals: [],
    intro: 'Aucune séance. Dors, mange bien, hydrate-toi.',
    exercises: [],
  },
  test_day: {
    title: 'Journée tests (bilan mensuel)',
    loc: 'maison', duration: 60, goals: ['ssa', 'hyrox', 'pompier'],
    intro: 'Bilan de fin de bloc. Tes résultats sont enregistrés automatiquement dans « Progrès ». Fais le test natation lors de ta prochaine séance piscine.',
    exercises: [
      { id: 'test_warm', name: 'Échauffement complet', sets: 1, reps: '15 min', track: 'check' },
      { id: 'test_pullup', name: 'Tractions max (bras tendus → menton au-dessus)', sets: 1, reps: 'max', track: 'reps', bench: 'pullups' },
      { id: 'test_pushup', name: 'Pompes max sans pause', sets: 1, reps: 'max', track: 'reps', bench: 'pushups' },
      { id: 'test_plank', name: 'Planche max', sets: 1, reps: 'max', track: 'time', bench: 'plank' },
      { id: 'test_run', name: '1 km chrono (ou Luc Léger si dispo)', sets: 1, reps: '1 km', track: 'time', bench: 'run_1k' },
    ],
  },
};

// Planning par défaut : index 0 = lundi … 6 = dimanche.
const DEFAULT_SCHEDULE = {
  ssa:     ['swim_tech', 'home_upper', 'run_easy', 'swim_ssa', 'gym_lower', 'swim_endurance', 'mobility'],
  hyrox:   ['gym_hyrox', 'home_upper', 'run_vma', 'gym_lower', 'swim_endurance', 'run_threshold', 'mobility'],
  pompier: ['gym_upper', 'run_vma', 'home_circuit', 'gym_lower', 'swim_endurance', 'run_easy', 'home_core'],
};

const PHASES = {
  ssa: {
    label: 'Bloc 1 — Priorité SSA',
    focus: 'Natation 3×/semaine (technique, apnée, remorquage) + entretien force et cardio.',
  },
  hyrox: {
    label: 'Bloc 2 — Priorité Hyrox',
    focus: 'Course + stations, force jambes, VMA. 1 séance piscine pour garder tes acquis SSA.',
  },
  pompier: {
    label: 'Bloc 3 — Priorité Pompier',
    focus: 'Indicateurs ICP : Luc Léger, tractions/pompes, gainage, souplesse + natation.',
  },
};

const DEFAULT_HABITS = [
  { id: 'sleep',    name: 'Sommeil ≥ 7 h',             icon: '😴' },
  { id: 'water',    name: 'Eau ≥ 2 L',                 icon: '💧' },
  { id: 'protein',  name: 'Protéines à chaque repas',  icon: '🍗' },
  { id: 'mobility', name: '10 min de mobilité',        icon: '🧘' },
  { id: 'steps',    name: '8 000 pas',                 icon: '👟' },
];

// unit : 'reps' | 'time' (secondes) | 'm' | 'kg' | 'palier'
const BENCHMARKS = [
  { id: 'ssa_test', name: 'Test SSA 100 m',      unit: 'time', lower: true,  target: 225, goal: 'ssa' },
  { id: 'apnea',    name: 'Apnée dynamique',     unit: 'm',    lower: false, target: 15,  goal: 'ssa' },
  { id: 'swim_100', name: '100 m crawl',         unit: 'time', lower: true,  target: 105, goal: 'ssa' },
  { id: 'swim_300', name: '300 m crawl',         unit: 'time', lower: true,  target: 360, goal: 'ssa' },
  { id: 'pullups',  name: 'Tractions max',       unit: 'reps', lower: false, target: 12,  goal: 'pompier' },
  { id: 'pushups',  name: 'Pompes max',          unit: 'reps', lower: false, target: 40,  goal: 'pompier' },
  { id: 'plank',    name: 'Planche',             unit: 'time', lower: false, target: 180, goal: 'pompier' },
  { id: 'leger',    name: 'Luc Léger',           unit: 'palier', lower: false, target: 10, goal: 'pompier' },
  { id: 'run_1k',   name: '1 km course',         unit: 'time', lower: true,  target: 240, goal: 'hyrox' },
  { id: 'run_5k',   name: '5 km course',         unit: 'time', lower: true,  target: 1380, goal: 'hyrox' },
  { id: 'row_1000', name: 'Rameur 1000 m',       unit: 'time', lower: true,  target: 225, goal: 'hyrox' },
  { id: 'weight',   name: 'Poids de corps',      unit: 'kg',   lower: null,  target: null, goal: null },
];
