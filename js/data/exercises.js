/* Crevare — bibliothèque d'exercices (données statiques + recherche).
 * Contrat : docs/ARCHITECTURE.md, section « js/data/exercises.js → C.data ».
 * Chaque exercice décrit le geste (consignes, erreurs fréquentes, sécurité), son type de saisie (track),
 * son impact (0 = aucun choc, 1 = course/appuis, 2 = sauts/réceptions), les zones sollicitées (stress),
 * ses progressions (easier/harder) et ses remplacements (alt, du plus proche au plus éloigné).
 * Faits (SSA, HYROX, ICP pompiers, science) : docs/recherche-2026-10.md. Les valeurs non confirmées
 * par un texte officiel sont signalées « à confirmer » dans le texte affiché.
 * Les objets de la bibliothèque sont gelés : copier (U.clone) avant de modifier. */
(function (C) {
  'use strict';
  const U = C.util;

  /* ───────── Référentiels ───────── */

  const EXERCISE_CATS = {
    natation:   { label: 'Natation',        icon: '🏊', order: 1 },
    apnee:      { label: 'Apnée',           icon: '🫧', order: 2 },
    sauvetage:  { label: 'Sauvetage',       icon: '🛟', order: 3 },
    course:     { label: 'Course',          icon: '🏃', order: 4 },
    cardio:     { label: 'Cardio',          icon: '❤️', order: 5 },
    hyrox:      { label: 'HYROX',           icon: '🛷', order: 6 },
    force:      { label: 'Force',           icon: '🏋️', order: 7 },
    gainage:    { label: 'Abdos / gainage', icon: '🧱', order: 8 },
    prevention: { label: 'Prévention',      icon: '🛡️', order: 9 },
    mobilite:   { label: 'Mobilité',        icon: '🧘', order: 10 },
    test:       { label: 'Tests',           icon: '⏱️', order: 11 },
  };

  // common : présent partout (maison) ; gym : présent dans une salle de musculation classique.
  const EQUIPMENT = {
    barre:           { label: 'Barre de traction', gym: true },
    elastiques:      { label: 'Élastiques' },
    halteres:        { label: 'Haltères', gym: true },
    kettlebell:      { label: 'Kettlebell', gym: true },
    lest:            { label: 'Lest (gilet ou sac à dos chargé)' },
    step:            { label: 'Step ou marche', common: true, gym: true },
    corde:           { label: 'Corde à sauter' },
    tapis:           { label: 'Tapis de sol', gym: true },
    chaise:          { label: 'Chaise solide (ou banc)', common: true, gym: true },
    coussin:         { label: 'Coussin ou serviette pliée', common: true, gym: true },
    escalier:        { label: 'Escaliers', common: true },
    plots:           { label: 'Deux repères à 20 m (plots, bouteilles)', common: true },
    regle:           { label: 'Règle ou mètre ruban', common: true },
    rouleau:         { label: 'Rouleau de massage', gym: true },
    banc:            { label: 'Banc de musculation', gym: true },
    barre_olympique: { label: 'Barre olympique et rack', gym: true },
    poulie:          { label: 'Poulie (vis-à-vis)', gym: true },
    presse:          { label: 'Presse à cuisses', gym: true },
    machine:         { label: 'Machine guidée', gym: true },
    tapis_course:    { label: 'Tapis de course', gym: true },
    velo:            { label: 'Vélo ou elliptique', gym: true },
    skierg:          { label: 'SkiErg', gym: true },
    rameur:          { label: 'Rameur', gym: true },
    sled:            { label: 'Sled (traîneau)', gym: true },
    wall_ball:       { label: 'Wall ball et cible', gym: true },
    sandbag:         { label: 'Sandbag', gym: true },
    palmes:          { label: 'Palmes' },
    masque_tuba:     { label: 'Masque et tuba' },
    mannequin:       { label: 'Mannequin de sauvetage' },
    objet_leste:     { label: 'Objet lesté (brique, anneau)' },
    bouee_tube:      { label: 'Bouée tube' },
    partenaire:      { label: 'Un partenaire' },
  };

  const TRACKS = {
    reps:   { label: 'Répétitions', fields: ['reps'] },
    load:   { label: 'Charge et répétitions', fields: ['kg', 'reps'] },
    time:   { label: 'Temps', fields: ['sec'] },
    dist:   { label: 'Distance (m)', fields: ['m'] },
    run:    { label: 'Distance (km) et temps', fields: ['km', 'sec'] },
    palier: { label: 'Palier', fields: ['palier'] },
    cm:     { label: 'Centimètres', fields: ['cm'] },
    check:  { label: 'Fait / pas fait', fields: [] },
  };

  const GOALS = ['ssa', 'hyrox', 'pompier', 'general'];
  const GOAL_LABELS = { ssa: 'SSA sauvetage', hyrox: 'HYROX', pompier: 'Pompier', general: 'Général' };
  const LOCS = ['maison', 'salle', 'piscine', 'dehors'];
  const STRESS_ZONES = ['genou', 'cheville', 'epaule', 'dos', 'poignet'];
  const CUSTOM_PREFIX = 'perso:';

  /* ───────── Textes partagés ───────── */

  const APNEA_SAFETY = [
    'Uniquement accompagné : club, binôme ou maître-nageur prévenu qui te regarde depuis le bord.',
    'Jamais d’hyperventilation : 1 à 2 inspirations normales avant de partir, pas de série de respirations forcées.',
    'Récupère au moins 2 fois la durée de l’apnée (60 s minimum), jusqu’à respirer normalement.',
    'Arrêt de l’apnée pour la journée au moindre signe : picotements, vision qui se trouble, vertige, envie irrépressible de respirer.',
    'Pas d’apnée en fin de séance épuisante, ni fatigué, malade ou après de l’alcool. Progression de 2,5 m par semaine au maximum.',
  ];
  const IMPACT_SAFETY = 'Douleur au genou ou à la cheville au-delà de 3/10, ou qui augmente : arrête et passe à l’alternative sans impact.';
  const KNEE_SAFETY = 'Genou sensible : amplitude réduite et charge plus légère, douleur 3/10 au maximum.';
  const SSA_CONFIRM = 'Valeurs à confirmer auprès de ton organisme de formation.';

  /* ───────── Exercices ─────────
   * Champs omis : easier/harder/alt/safety/muscles/stress/equipment = [], short = name, apnea = false. */

  const RAW = [
    /* ═════ Natation ═════ */
    {
      id: 'swim_warmup', name: 'Échauffement nages variées', short: 'Échauffement natation', cat: 'natation',
      goals: ['ssa', 'pompier', 'general'], locs: ['piscine'], track: 'dist',
      defaultSets: 1, defaultReps: '200–300 m', defaultRest: 0, impact: 0,
      description: 'Mise en route progressive dans l’eau : crawl souple, dos et brasse en alternance. Prépare épaules, souffle et sensations avant le travail du jour.',
      cues: ['Commence très lentement, allonge-toi dans l’eau.', 'Alterne 50 m crawl, 50 m dos, 50 m au choix.', 'Respire tous les 3 temps en crawl pour équilibrer les deux côtés.'],
      mistakes: ['Partir vite dès la première longueur.'],
      muscles: ['épaules', 'dorsaux'],
    },
    {
      id: 'swim_drills', name: 'Éducatifs crawl', cat: 'natation',
      goals: ['ssa', 'pompier', 'general'], locs: ['piscine'], track: 'check',
      defaultSets: 4, defaultReps: '50 m (un éducatif par 50 m)', defaultRest: 20, impact: 0,
      description: 'Exercices de technique pour un crawl plus économique : chaque éducatif isole un détail du mouvement.',
      cues: ['Rattrapé : une main attend l’autre devant avant de tirer.', 'Poings fermés : tu sens le travail de l’avant-bras.', 'Battements sur le côté, bras devant : apprends à respirer sans lever la tête.', 'Compte tes mouvements de bras par longueur : moins = plus efficace.'],
      mistakes: ['Aller vite au lieu de soigner le geste.', 'Lever la tête pour respirer (les jambes coulent).'],
      harder: ['swim_crawl_easy'],
    },
    {
      id: 'swim_crawl_easy', name: 'Crawl souple', cat: 'natation',
      goals: ['ssa', 'pompier', 'general'], locs: ['piscine'], track: 'dist',
      defaultSets: 1, defaultReps: '400–800 m', defaultRest: 0, impact: 0,
      description: 'Crawl continu à allure facile, où tu pourrais parler entre deux longueurs. Construit l’endurance et l’aisance dans l’eau.',
      cues: ['Expire dans l’eau en continu, inspire sur le côté.', 'Allonge chaque mouvement et glisse.', 'Si tu dois t’arrêter, fais 25 m de dos puis repars.'],
      mistakes: ['Retenir sa respiration sous l’eau (essoufflement rapide).'],
      easier: ['swim_drills'], harder: ['swim_crawl_200', 'swim_crawl_400'],
      muscles: ['épaules', 'dorsaux'],
    },
    {
      id: 'swim_crawl_25', name: '25 m crawl rapide', cat: 'natation',
      goals: ['ssa', 'pompier'], locs: ['piscine'], track: 'time',
      defaultSets: 6, defaultReps: '25 m', defaultRest: 30, impact: 0,
      description: 'Sprint court en crawl pour la vitesse et la puissance de nage. Récupère bien entre chaque répétition.',
      cues: ['Poussée du mur, coulée courte, puis accélère.', 'Respire tous les 2 ou 3 mouvements, garde des jambes rapides.', 'Note tes temps : ils doivent rester proches du premier au dernier.'],
      mistakes: ['Récupération trop courte : la qualité chute.'],
      harder: ['swim_crawl_50'], alt: ['swim_25_pace'],
    },
    {
      id: 'swim_crawl_50', name: '50 m crawl soutenu', cat: 'natation',
      goals: ['ssa', 'pompier'], locs: ['piscine'], track: 'time',
      defaultSets: 6, defaultReps: '50 m', defaultRest: 30, impact: 0,
      description: 'Répétitions de 50 m à allure soutenue mais régulière. Cœur du travail de vitesse pour le SSA et le 50 m des recrutements pompiers.',
      cues: ['Même allure sur toutes les répétitions.', 'Virage propre (ou touche du mur et poussée) sans t’accrocher.', 'Note le temps moyen et l’écart entre la 1re et la dernière.'],
      mistakes: ['Faire la première très vite et exploser ensuite.'],
      easier: ['swim_crawl_25'], harder: ['swim_crawl_100'],
    },
    {
      id: 'swim_crawl_100', name: '100 m crawl', cat: 'natation',
      goals: ['ssa', 'general'], locs: ['piscine'], track: 'time',
      defaultSets: 4, defaultReps: '100 m', defaultRest: 45, impact: 0,
      description: 'Répétitions de 100 m, la distance du test d’entrée SSA. Apprends l’allure que tu peux tenir.',
      cues: ['Pars à l’allure visée, pas plus vite.', 'Respiration régulière tous les 2 ou 3 temps.', 'Repère ton temps de passage au 50 m.'],
      mistakes: ['Respiration bloquée sur la fin.'],
      easier: ['swim_crawl_50'], harder: ['swim_crawl_200'],
    },
    {
      id: 'swim_crawl_200', name: '200 m crawl', cat: 'natation',
      goals: ['ssa', 'general'], locs: ['piscine'], track: 'time',
      defaultSets: 2, defaultReps: '200 m', defaultRest: 60, impact: 0,
      description: 'Effort continu de 200 m pour l’endurance de vitesse. Avec un 400 m, il sert à calculer ton allure seuil.',
      cues: ['Découpe-le en 4 × 50 m dans ta tête, à allure égale.', 'Battements légers pour économiser les jambes.'],
      mistakes: ['Allure qui s’effondre après 100 m.'],
      easier: ['swim_crawl_100'], harder: ['swim_crawl_400'],
    },
    {
      id: 'swim_crawl_400', name: '400 m crawl', cat: 'natation',
      goals: ['ssa', 'general'], locs: ['piscine'], track: 'time',
      defaultSets: 1, defaultReps: '400 m', defaultRest: 0, impact: 0,
      description: 'Nage continue de 400 m en crawl à allure régulière. Mesure ton endurance de nage.',
      cues: ['Pars prudemment, accélère sur les 100 derniers mètres.', 'Compte tes longueurs : 16 en bassin de 25 m, 8 en bassin de 50 m.'],
      mistakes: ['Se tromper dans le nombre de longueurs.'],
      easier: ['swim_crawl_200'], harder: ['swim_400_test'],
    },
    {
      id: 'swim_kick', name: 'Battements ventral sans planche', short: 'Battements ventral', cat: 'natation',
      goals: ['ssa', 'general'], locs: ['piscine'], track: 'check',
      defaultSets: 4, defaultReps: '25 m', defaultRest: 20, impact: 0,
      description: 'Jambes seules sur le ventre, bras devant ou le long du corps. Renforce les battements utiles au remorquage et aux palmes.',
      cues: ['Battements depuis la hanche, jambes presque tendues, chevilles souples.', 'Pieds qui fouettent juste sous la surface.', 'Pour respirer : lève brièvement la tête ou passe sur le côté.'],
      mistakes: ['Pédaler genoux pliés.'],
      harder: ['fins_kick'],
      muscles: ['quadriceps', 'fessiers', 'abdos'],
    },
    {
      id: 'swim_back_legs', name: 'Dos jambes seules, mains hors de l’eau', short: 'Dos jambes seules', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], track: 'time',
      defaultSets: 4, defaultReps: '25 m', defaultRest: 30, impact: 0, stress: ['genou'],
      description: 'Sur le dos, mains et poignets au-dessus de la surface : seules les jambes te font avancer (rétropédalage ou ciseaux). C’est la dernière partie du test d’entrée SSA (25 m).',
      cues: ['Bassin haut, menton légèrement rentré, regard vers le plafond.', 'Rétropédalage (jambes alternées en cercle) ou ciseaux réguliers.', 'Progression : mains à la surface, puis poignets au-dessus, puis avant-bras hors de l’eau.'],
      mistakes: ['Mains qui retombent dans l’eau pour s’aider.', 'Assis dans l’eau (bassin bas) : tu n’avances plus.'],
      easier: ['swim_eggbeater'], harder: ['swim_back_25_test'], alt: ['fins_back_kick'],
      muscles: ['quadriceps', 'adducteurs', 'abdos'],
    },
    {
      id: 'swim_eggbeater', name: 'Rétropédalage', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], track: 'time',
      defaultSets: 4, defaultReps: '30 s', defaultRest: 30, impact: 0, stress: ['genou'],
      description: 'Maintien vertical dans l’eau en pédalant les jambes en alternance, comme les joueurs de water-polo. Te garde haut sans les mains : utile pour le remorquage et le dos mains hors de l’eau.',
      cues: ['Genoux écartés : une jambe tourne dans un sens, l’autre dans l’autre.', 'Buste droit, épaules hors de l’eau.', 'Progression : mains à la surface, puis hors de l’eau, puis bras levés.'],
      mistakes: ['Pédaler comme à vélo, de haut en bas : tu coules.'],
      safety: ['Genou sensible : réduis l’amplitude ou passe aux battements sur le dos.'],
      harder: ['swim_back_legs'], alt: ['fins_back_kick', 'swim_kick'],
      muscles: ['adducteurs', 'quadriceps', 'fessiers'],
    },
    {
      id: 'swim_breast_glide', name: 'Brasse coulée longue glisse', short: 'Brasse coulée', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], track: 'check',
      defaultSets: 6, defaultReps: '50 m', defaultRest: 20, impact: 0, stress: ['genou'],
      description: 'Brasse avec une longue glisse immergée après chaque mouvement. Développe l’aisance sous l’eau et l’économie, utiles avant les apnées.',
      cues: ['Après la poussée des jambes, reste allongé 2 à 3 s, bras devant.', 'Expire doucement par le nez pendant la glisse.', 'Tête dans l’axe, regard vers le fond.'],
      mistakes: ['Enchaîner les mouvements sans glisse.'],
      safety: ['Genou sensible : le coup de pied de brasse peut gêner ; remplace par du crawl.'],
      harder: ['apnea_dynamic'], alt: ['swim_crawl_easy'],
    },
    {
      id: 'swim_dive_start', name: 'Plongeon du bord', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], track: 'check',
      defaultSets: 4, defaultReps: '1 plongeon + 10 m', defaultRest: 30, impact: 0,
      description: 'Départ plongé depuis le bord, entrée dans l’eau allongée puis coulée. Premier geste du test d’entrée et du TSA.',
      cues: ['Orteils accrochés au bord, regard vers l’eau, bras devant.', 'Entrée par les mains puis tout le corps « dans le même trou ».', 'Coulée bras tendus avant de commencer à nager.'],
      mistakes: ['Tomber à plat sur le ventre (douloureux et lent).', 'Entrée trop verticale et trop profonde.'],
      safety: ['Plonge uniquement en zone profonde où le plongeon est autorisé, jamais dans un petit bain.', 'Demande au maître-nageur si tu n’es pas sûr de la profondeur.'],
      harder: ['apnea_dive_15'], alt: ['rescue_entries'],
    },
    {
      id: 'swim_25_pace', name: '25 m à l’allure du test', short: 'Allure test 25 m', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], track: 'time',
      defaultSets: 8, defaultReps: '25 m', defaultRest: 20, impact: 0,
      description: 'Répétitions de 25 m à l’allure du temps visé divisé par 4 (2:30 visé → environ 37 s au 25 m). La récupération diminue au fil des semaines jusqu’au 100 m continu.',
      cues: ['Calcule ton allure : temps visé ÷ 4.', 'Récupération de 20 s ; quand toutes les répétitions sont dans l’allure, enlève 5 s.', 'Note chaque temps pour vérifier ta régularité.'],
      mistakes: ['Faire la première trop vite.'],
      easier: ['swim_crawl_25'], harder: ['swim_100_test'], alt: ['swim_crawl_25'],
    },
    {
      id: 'swim_cooldown', name: 'Retour au calme (nage)', cat: 'natation',
      goals: ['ssa', 'pompier', 'general'], locs: ['piscine'], track: 'check',
      defaultSets: 1, defaultReps: '100–200 m souple', defaultRest: 0, impact: 0,
      description: 'Nage très facile pour faire redescendre le cœur et détendre les épaules.',
      cues: ['Alterne dos et brasse, très lentement.', 'Allonge-toi et respire calmement.'],
      mistakes: ['Le sauter quand on est pressé.'],
    },
    {
      id: 'fins_kick', name: 'Battements avec palmes', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], equipment: ['palmes'], track: 'check',
      defaultSets: 4, defaultReps: '50 m', defaultRest: 20, impact: 0, stress: ['cheville'],
      description: 'Jambes seules avec palmes, sur le ventre, pour trouver un battement ample et efficace avant les séries longues.',
      cues: ['Battement depuis la hanche, genoux presque tendus.', 'Pointes de pied tendues, chevilles relâchées.', 'Avec masque et tuba : tête dans l’eau, concentre-toi sur les jambes.'],
      mistakes: ['Pédaler genoux pliés.', 'Battements trop rapides et trop courts.'],
      safety: ['Crampe au mollet : arrête et tire la pointe de pied vers toi.'],
      easier: ['swim_kick'], harder: ['fins_100'], alt: ['swim_kick'],
      muscles: ['quadriceps', 'fessiers', 'mollets'],
    },
    {
      id: 'fins_back_kick', name: 'Battements palmes sur le dos', short: 'Palmes sur le dos', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], equipment: ['palmes'], track: 'check',
      defaultSets: 4, defaultReps: '50 m', defaultRest: 20, impact: 0, stress: ['cheville'],
      description: 'Battements avec palmes sur le dos, bras le long du corps ou mains hors de l’eau. Renforce les jambes pour le remorquage et le dos du test d’entrée.',
      cues: ['Bassin haut, oreilles dans l’eau, regard au plafond.', 'Genoux qui restent sous la surface.', 'Progression : mains sorties de l’eau, comme pendant un remorquage.'],
      mistakes: ['Genoux qui sortent de l’eau (pédalage).'],
      harder: ['manikin_tow'], alt: ['swim_back_legs', 'swim_kick'],
    },
    {
      id: 'fins_100', name: '100 m palmes', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], equipment: ['palmes'], track: 'time',
      defaultSets: 4, defaultReps: '100 m', defaultRest: 40, impact: 0, stress: ['cheville'],
      description: 'Répétitions de 100 m en nage ventrale avec palmes, pour apprendre l’allure du 300 m du TSA (environ 1:25 au 100 m).',
      cues: ['Allure cible : 1:25 à 1:30 au 100 m.', 'Bras en crawl relâchés : ce sont les palmes qui font le travail.', 'Entraîne-toi avec le matériel que tu utiliseras le jour J (masque, tuba ou lunettes).'],
      mistakes: ['Partir en 1:15 et finir en 1:40.'],
      easier: ['fins_kick'], harder: ['fins_300'], alt: ['swim_crawl_100'],
    },
    {
      id: 'fins_300', name: '300 m palmes', cat: 'natation',
      goals: ['ssa'], locs: ['piscine'], equipment: ['palmes'], track: 'time', bench: 'ssa_tsa_fins',
      defaultSets: 1, defaultReps: '300 m (chaussage compris)', defaultRest: 0, impact: 0, stress: ['cheville'],
      description: 'Épreuve 2 du TSA : 300 m de nage ventrale avec palmes en 4:30 maximum, chaussage compris (tu attends au bord sans palmes, le chrono part au signal). ' + SSA_CONFIRM,
      cues: ['Chaussage rapide hors de l’eau (10 à 20 s), puis entrée dans l’eau.', 'Allure régulière d’environ 1:25 au 100 m ; vise 4:10 à l’entraînement pour avoir de la marge.', 'Lunettes, masque et tuba autorisés (à confirmer).', 'Au TSA, au moins 10 min de récupération après le parcours de sauvetage.'],
      mistakes: ['Perdre une palme : la distance nagée sans elle ne compte pas.', 'Nager sur le dos ou en brasse : la nage doit être ventrale.'],
      easier: ['fins_100'], alt: ['fins_100'],
    },

    /* ═════ Apnée (toujours accompagné) ═════ */
    {
      id: 'apnea_breath_dry', name: 'Respiration et récupération à sec (assis)', short: 'Respiration à sec', cat: 'apnee',
      goals: ['ssa'], locs: ['maison', 'piscine'], track: 'check',
      defaultSets: 1, defaultReps: '5 min', defaultRest: 0, impact: 0,
      description: 'Exercice assis, hors de l’eau : apprendre à respirer calmement avant une apnée et à bien récupérer après. Aucune apnée maximale ici.',
      cues: ['Respiration ventrale lente : inspire 4 s, expire 6 à 8 s.', 'Avant une apnée dans l’eau : 1 à 2 inspirations normales, pas plus.', 'Récupération : inspire franchement, bloque une seconde, expire ; recommence 2 à 3 fois.'],
      mistakes: ['Enchaîner des respirations rapides et forcées (hyperventilation).'],
      safety: ['Jamais de rétention de souffle maximale : ni assis, ni dans le bain, ni seul dans l’eau.'],
      harder: ['apnea_dynamic'],
    },
    {
      id: 'apnea_dynamic', name: 'Apnée dynamique', cat: 'apnee',
      goals: ['ssa'], locs: ['piscine'], track: 'dist', apnea: true, bench: 'apnea_dyn',
      defaultSets: 6, defaultReps: '8–12 m', defaultRest: 90, impact: 0,
      description: 'Nage sous l’eau à faible profondeur, départ du mur, sur une distance courte et confortable. Prépare les 15 m d’immersion du test d’entrée et du TSA.',
      cues: ['Poussée du mur, coulée, puis brasse coulée ou ondulations amples et lentes.', 'Relâche-toi : moins tu te crispes, moins tu consommes d’oxygène.', 'Remonte avant l’inconfort, pas au bout de toi.', 'Ajoute 1 à 2,5 m par semaine au maximum, seulement si les répétitions étaient faciles.'],
      mistakes: ['Hyperventiler avant de partir.', 'Chercher la distance maximale : ce n’est pas un défi.'],
      safety: APNEA_SAFETY,
      easier: ['apnea_breath_dry'], harder: ['apnea_dive_15'], alt: ['swim_crawl_easy', 'swim_breast_glide', 'swim_crawl_25'],
    },
    {
      id: 'apnea_dive_15', name: 'Plongeon + 15 m en immersion', short: 'Plongeon + 15 m apnée', cat: 'apnee',
      goals: ['ssa'], locs: ['piscine'], track: 'time', apnea: true,
      defaultSets: 4, defaultReps: '1 plongeon + 15 m immergé + 10 m nagés', defaultRest: 120, impact: 0,
      description: 'Départ plongé, au moins 15 m en immersion complète, puis 10 m de nage en surface : premier segment du test d’entrée et du TSA.',
      cues: ['Plongeon allongé, coulée longue avant le premier mouvement.', 'Reste à environ 1 m de profondeur, pas plus bas.', 'Repère les 15 m (marque au fond ou au bord) avant de partir.'],
      mistakes: ['Remonter à 13 ou 14 m : non validé. À l’entraînement, une petite marge suffit (18 m environ), pas davantage.'],
      safety: APNEA_SAFETY,
      easier: ['apnea_dynamic'], harder: ['apnea_15_second'], alt: ['swim_dive_start', 'swim_crawl_25'],
    },
    {
      id: 'apnea_15_second', name: '2e apnée de 15 m (sous fatigue)', short: '2e apnée de 15 m', cat: 'apnee',
      goals: ['ssa'], locs: ['piscine'], track: 'time', apnea: true,
      defaultSets: 3, defaultReps: '25 m crawl + 15 m immergé + 10 m nagés', defaultRest: 150, impact: 0,
      description: 'Deuxième apnée du parcours TSA : après 25 m de crawl, 15 m en immersion complète puis 10 m de nage. En bassin de 25 m elle part du mur ; en bassin de 50 m, d’un canard en pleine eau.',
      cues: ['Ralentis un peu les 5 derniers mètres de crawl pour reprendre ton souffle.', 'Bassin de 50 m : canard court, puis coulée à faible profondeur.', 'Garde la même nage sous l’eau que pour la 1re apnée.'],
      mistakes: ['Arriver à bout de souffle à cause d’un crawl trop rapide.'],
      safety: [...APNEA_SAFETY, 'C’est l’apnée la plus exigeante : travaille-la seulement quand les 15 m après plongeon sont devenus faciles.'],
      easier: ['apnea_dive_15'], harder: ['ssa_tsa_course'], alt: ['swim_crawl_25'],
    },
    {
      id: 'duck_dive', name: 'Plongée canard', cat: 'apnee',
      goals: ['ssa'], locs: ['piscine'], track: 'reps', apnea: true,
      defaultSets: 6, defaultReps: '1 canard jusqu’au fond', defaultRest: 60, impact: 0,
      description: 'Passer de la nage en surface à une descente verticale, jambes hors de l’eau, pour rejoindre le fond. Progresse de 1,80 m vers 2,80 m (profondeur maximale du mannequin au TSA, à confirmer).',
      cues: ['Bras devant, casse-toi à 90° aux hanches, puis lève les jambes à la verticale : leur poids te fait descendre.', 'Équilibre tes oreilles dès le début de la descente (pince le nez et souffle doucement).', 'Remonte en regardant la surface, une main au-dessus de la tête.'],
      mistakes: ['Jambes qui restent à plat : tu restes en surface.', 'Forcer malgré une douleur aux oreilles : remonte et recommence plus doucement.'],
      safety: APNEA_SAFETY,
      harder: ['duck_dive_object'], alt: ['swim_eggbeater'],
    },
    {
      id: 'duck_dive_object', name: 'Canard + objet lesté au fond', short: 'Canard + objet lesté', cat: 'apnee',
      goals: ['ssa'], locs: ['piscine'], equipment: ['objet_leste'], track: 'reps', apnea: true,
      defaultSets: 6, defaultReps: '1 objet remonté', defaultRest: 60, impact: 0,
      description: 'Canard jusqu’au fond pour ramasser un objet lesté et le remonter. Remplace le mannequin quand il n’y en a pas ; progresse vers 2,80 m de profondeur.',
      cues: ['Descends à la verticale de l’objet en le regardant.', 'Saisis-le à deux mains, pousse sur le fond avec les jambes.', 'Remonte en le tenant contre toi, une main vers la surface.'],
      mistakes: ['Chercher l’objet longtemps au fond : remonte et recommence.'],
      safety: [...APNEA_SAFETY, 'Vérifie la profondeur de la fosse avec le maître-nageur.'],
      easier: ['duck_dive'], harder: ['manikin_lift'], alt: ['duck_dive', 'swim_eggbeater'],
    },
    {
      id: 'duck_dive_depth', name: 'Canard : profondeur atteinte', short: 'Canard (profondeur)', cat: 'apnee',
      goals: ['ssa'], locs: ['piscine'], equipment: ['objet_leste'], track: 'dist', apnea: true, bench: 'duck_depth',
      defaultSets: 3, defaultReps: '1 canard, note la profondeur', defaultRest: 90, impact: 0,
      description: 'Profondeur (en m) à laquelle tu remontes à l’aise un objet lesté ou le mannequin après un canard ; lis-la sur le marquage de la fosse. Repère : le mannequin du TSA peut être posé jusqu’à 2,80 m (à confirmer).',
      cues: ['Note une profondeur atteinte confortablement, pas une profondeur forcée.', 'Équilibre les oreilles dès la surface, puis souvent pendant la descente.', 'Remonte dès que tu as touché le fond.'],
      mistakes: ['Forcer malgré une douleur aux oreilles.'],
      safety: APNEA_SAFETY,
      easier: ['duck_dive'], alt: ['swim_eggbeater'],
    },

    /* ═════ Sauvetage ═════ */
    {
      id: 'swim_head_up', name: 'Crawl tête hors de l’eau (nage d’approche)', short: 'Nage d’approche', cat: 'sauvetage',
      goals: ['ssa', 'pompier'], locs: ['piscine'], track: 'time',
      defaultSets: 4, defaultReps: '25 m', defaultRest: 30, impact: 0, stress: ['epaule'],
      description: 'Crawl la tête hors de l’eau, regard fixé devant : c’est la nage d’approche vers une victime, pour ne jamais la perdre de vue.',
      cues: ['Menton à la surface, yeux sur la cible (un repère au bord ou un partenaire).', 'Battements plus rapides pour garder les jambes hautes.', 'Bras plus courts et plus fréquents qu’en crawl normal.'],
      mistakes: ['Tête qui plonge à chaque mouvement : tu perds la victime de vue.'],
      harder: ['rescue_grips'], alt: ['swim_crawl_25'],
      muscles: ['épaules', 'nuque', 'dorsaux'],
    },
    {
      id: 'manikin_lift', name: 'Remontée du mannequin (saisie, mise en surface)', short: 'Remontée du mannequin', cat: 'sauvetage',
      goals: ['ssa'], locs: ['piscine'], equipment: ['mannequin'], track: 'reps', apnea: true,
      defaultSets: 4, defaultReps: '1 remontée', defaultRest: 90, impact: 0,
      description: 'Canard jusqu’au mannequin posé au fond, saisie, puis remontée en poussant sur le fond, visage du mannequin sorti le plus vite possible. Au TSA il est posé entre 1,80 et 2,80 m (à confirmer).',
      cues: ['Arrive au-dessus de la tête du mannequin, saisis-le sous les aisselles ou par le menton.', 'Pieds au fond, pousse fort vers la surface en gardant le mannequin contre toi.', 'Dès la surface : visage du mannequin hors de l’eau, puis enchaîne le remorquage.'],
      mistakes: ['Remonter sans pousser sur le fond (épuisant).', 'Laisser le mannequin retomber face dans l’eau.'],
      safety: [...APNEA_SAFETY, 'Mannequin réglementaire : demande au club ou au maître-nageur.'],
      easier: ['duck_dive_object'], harder: ['ssa_tsa_course'], alt: ['duck_dive_object', 'manikin_tow'],
    },
    {
      id: 'manikin_tow', name: 'Remorquage du mannequin', short: 'Remorquage mannequin', cat: 'sauvetage',
      goals: ['ssa', 'pompier'], locs: ['piscine'], equipment: ['mannequin'], track: 'time',
      defaultSets: 4, defaultReps: '25 m', defaultRest: 60, impact: 0,
      description: 'Remorquage du mannequin jusqu’au bord, sur le dos ou sur le côté. Critère SSA : voies aériennes dégagées et visage hors de l’eau ; plus de 3 s d’immersion d’affilée fait échouer l’épreuve (à confirmer).',
      cues: ['Prise ferme sous le menton ou sous les aisselles, bras tendu.', 'Toi sur le côté ou sur le dos, jambes en ciseaux ou en rétropédalage.', 'Regarde régulièrement le visage du mannequin.', 'Un partenaire au bord compte les immersions du visage.'],
      mistakes: ['Bras plié : le visage du mannequin plonge.', 'Nager en crawl en tirant le mannequin derrière soi.'],
      easier: ['rescue_tube_tow', 'partner_tow'], harder: ['ssa_tsa_course'], alt: ['partner_tow', 'rescue_tube_tow'],
      muscles: ['jambes', 'dorsaux', 'épaules'],
    },
    {
      id: 'partner_tow', name: 'Remorquage d’un partenaire', short: 'Remorquage partenaire', cat: 'sauvetage',
      goals: ['ssa', 'pompier'], locs: ['piscine'], equipment: ['partenaire'], track: 'time',
      defaultSets: 4, defaultReps: '25 m', defaultRest: 60, impact: 0,
      description: 'Remorquage d’un partenaire qui joue la victime, à défaut de mannequin. Même technique et même critère : son visage reste toujours hors de l’eau.',
      cues: ['Le partenaire reste détendu, allongé sur le dos.', 'Prise sous le menton ou aux aisselles, ton bras tendu.', 'Changez de rôle à chaque longueur.'],
      mistakes: ['Partenaire qui aide en battant des jambes (trop facile).'],
      harder: ['manikin_tow'], alt: ['manikin_tow', 'rescue_tube_tow'],
    },
    {
      id: 'rescue_tube_tow', name: 'Remorquage avec bouée tube', short: 'Remorquage bouée tube', cat: 'sauvetage',
      goals: ['ssa'], locs: ['piscine'], equipment: ['bouee_tube', 'partenaire'], track: 'time',
      defaultSets: 4, defaultReps: '25 m', defaultRest: 60, impact: 0,
      description: 'Remorquage d’un partenaire (ou du mannequin) avec une bouée tube, matériel courant en surveillance. Plus facile qu’à mains nues : idéal pour apprendre la position.',
      cues: ['Bandoulière en travers du buste, bouée glissée sous les aisselles de la victime.', 'Nage en crawl ou en ciseaux sur le côté, regard vers la victime.', 'Vérifie la fermeture de la bouée avant de partir.'],
      mistakes: ['Bandoulière trop longue : la bouée flotte loin derrière.'],
      harder: ['manikin_tow'], alt: ['partner_tow'],
    },
    {
      id: 'rescue_entries', name: 'Entrées à l’eau de sauvetage', short: 'Entrées à l’eau', cat: 'sauvetage',
      goals: ['ssa', 'pompier'], locs: ['piscine'], track: 'check',
      defaultSets: 4, defaultReps: '1 entrée de chaque type', defaultRest: 30, impact: 0,
      description: 'Différentes façons d’entrer dans l’eau en gardant la victime en vue : saut écarté, entrée glissée, plongeon. Le choix dépend de la profondeur et de la situation.',
      cues: ['Saut écarté : un pied devant, bras écartés, la tête reste hors de l’eau et les yeux sur la victime.', 'Entrée assise glissée quand la profondeur est inconnue.', 'Plongeon seulement en eau profonde connue.'],
      mistakes: ['Perdre la victime de vue en entrant dans l’eau.'],
      safety: ['Jamais de saut ni de plongeon sans connaître la profondeur ; demande au maître-nageur où c’est autorisé.'],
      harder: ['rescue_grips'],
    },
    {
      id: 'rescue_grips', name: 'Saisies de la victime', cat: 'sauvetage',
      goals: ['ssa'], locs: ['piscine'], equipment: ['partenaire'], track: 'check',
      defaultSets: 4, defaultReps: '1 saisie de chaque type', defaultRest: 30, impact: 0,
      description: 'Approche puis saisie d’une victime consciente ou inconsciente (par l’arrière, retournement face vers le ciel), avec un partenaire. À apprendre et corriger avec ton club ou ton formateur.',
      cues: ['Arrête-toi à 2 m d’une victime consciente, parle-lui, puis passe derrière elle.', 'Victime face dans l’eau : retourne-la d’abord pour dégager son visage.', 'Saisie sous les aisselles ou au menton, ton corps derrière le sien.'],
      mistakes: ['Arriver de face au contact d’une victime paniquée : elle s’agrippe à toi.'],
      safety: ['Avec un partenaire coopératif et un encadrant ; arrêtez au moindre signe de panique réelle.'],
      easier: ['swim_head_up'], harder: ['rescue_releases'], alt: ['partner_tow'],
    },
    {
      id: 'rescue_releases', name: 'Dégagements (se libérer d’une prise)', short: 'Dégagements', cat: 'sauvetage',
      goals: ['ssa'], locs: ['piscine'], equipment: ['partenaire'], track: 'check',
      defaultSets: 4, defaultReps: '1 dégagement par prise', defaultRest: 45, impact: 0,
      description: 'Techniques pour te libérer d’une victime paniquée qui s’agrippe (poignet, cou, buste), puis reprendre le contrôle. Se travaille lentement, avec un partenaire et un formateur.',
      cues: ['Premier réflexe : inspire et descends sous l’eau, la victime te lâche souvent.', 'Dégage-toi en direction du pouce de la main qui te tient.', 'Une fois libre, éloigne-toi, puis repasse derrière la victime.'],
      mistakes: ['Lutter en force en surface contre la victime.'],
      safety: ['Convenez d’un signal d’arrêt (deux tapes) : le partenaire lâche aussitôt.', 'Uniquement encadré par ton club ou ton formateur.'],
      easier: ['rescue_grips'], alt: ['rescue_grips'],
    },
    {
      id: 'victim_extraction', name: 'Sortie de l’eau d’une victime', short: 'Sortie d’eau victime', cat: 'sauvetage',
      goals: ['ssa', 'pompier'], locs: ['piscine'], equipment: ['partenaire'], track: 'check',
      defaultSets: 3, defaultReps: '1 sortie', defaultRest: 60, impact: 0, stress: ['dos'],
      description: 'Sortir une victime de l’eau par le bord ou l’échelle, seul ou à deux, en protégeant sa tête et ton dos. Technique de la formation SSA, à apprendre avec un formateur.',
      cues: ['Mains de la victime posées sur le bord : tu sors, puis tu la hisses en la tenant par les poignets.', 'Remonte avec les jambes, pas avec le dos : genoux fléchis, dos droit.', 'Protège la tête de la victime au moment de la poser sur le bord.'],
      mistakes: ['Tirer le dos rond.', 'Laisser la tête de la victime cogner le bord.'],
      safety: ['Victime traumatisée (chute, plongeon) : on ne la sort pas ainsi ; tête maintenue dans l’axe et alerte (vu en formation).', 'Travaille avec un partenaire léger et un encadrant.'],
      easier: ['rescue_grips'],
    },
    {
      id: 'fins_don', name: 'Chaussage des palmes chronométré', short: 'Chaussage des palmes', cat: 'sauvetage',
      goals: ['ssa'], locs: ['piscine'], equipment: ['palmes'], track: 'time',
      defaultSets: 5, defaultReps: '1 chaussage', defaultRest: 30, impact: 0,
      description: 'Enfiler ses palmes le plus vite possible hors de l’eau, au signal : au TSA, ce temps compte dans les 4:30 du 300 m palmes (à confirmer).',
      cues: ['Palmes posées devant toi, ouverture vers toi, gauche et droite au bon endroit.', 'Assis au bord : pied dans le chausson, puis tire le talon.', 'Entraîne-toi pieds mouillés, c’est plus dur.', 'Vise 10 à 20 s.'],
      mistakes: ['Palmes inversées.', 'Talon mal tiré : la palme part à la première longueur.'],
      harder: ['fins_300'],
    },

    /* ═════ Tests natation et SSA ═════ */
    {
      id: 'swim_50_test', name: '50 m nage libre chrono', short: '50 m chrono', cat: 'test',
      goals: ['pompier', 'ssa', 'general'], locs: ['piscine'], track: 'time', bench: 'swim_50',
      defaultSets: 1, defaultReps: '50 m', defaultRest: 0, impact: 0,
      description: 'Test de vitesse sur 50 m. C’est une épreuve de nombreux recrutements de sapeurs-pompiers volontaires.',
      cues: ['Échauffement complet avant (au moins 200 m et 2 accélérations).', 'Note le bassin (25 ou 50 m) et le départ (plongé ou dans l’eau) : ils changent le temps.', 'Certains SDIS imposent la nage ventrale sans lunettes : renseigne-toi.'],
      mistakes: ['Tester sans échauffement.'],
      easier: ['swim_crawl_50'], alt: ['swim_crawl_50'],
    },
    {
      id: 'swim_100_test', name: '100 m nage libre chrono', short: '100 m chrono', cat: 'test',
      goals: ['ssa', 'general'], locs: ['piscine'], track: 'time', bench: 'swim_100',
      defaultSets: 1, defaultReps: '100 m', defaultRest: 0, impact: 0,
      description: 'Test de 100 m en nage libre, départ du mur ou plongé (note lequel). Repère de vitesse pour suivre tes progrès en crawl.',
      cues: ['Échauffement d’au moins 200 m avant.', 'Note le bassin (25 ou 50 m) et le type de départ.', 'Allure régulière : passage au 50 m proche de la moitié du temps final.'],
      mistakes: ['Changer de type de départ d’un test à l’autre (temps non comparables).'],
      easier: ['swim_crawl_100'], alt: ['swim_crawl_100'],
    },
    {
      id: 'swim_400_test', name: '400 m crawl chrono', short: '400 m chrono', cat: 'test',
      goals: ['ssa', 'general'], locs: ['piscine'], track: 'time', bench: 'swim_400',
      defaultSets: 1, defaultReps: '400 m', defaultRest: 0, impact: 0,
      description: 'Test d’endurance sur 400 m de crawl. Avec ton temps au 200 m, il donne ton allure seuil (vitesse critique).',
      cues: ['Allure régulière, accélère sur le dernier 100 m.', 'Compte les longueurs : 16 en bassin de 25 m, 8 en bassin de 50 m.', 'Allure seuil au 100 m ≈ (temps du 400 − temps du 200) ÷ 2.'],
      mistakes: ['Partir à l’allure d’un 100 m.'],
      easier: ['swim_crawl_400'], alt: ['swim_crawl_400'],
    },
    {
      id: 'swim_back_25_test', name: '25 m dos mains hors de l’eau (chrono)', short: 'Dos 25 m chrono', cat: 'test',
      goals: ['ssa'], locs: ['piscine'], track: 'time', bench: 'swim_back_25',
      defaultSets: 1, defaultReps: '25 m', defaultRest: 0, impact: 0, stress: ['genou'],
      description: 'Chrono du dernier segment du test d’entrée SSA : 25 m sur le dos, mains et poignets hors de l’eau, propulsion par les jambes seules.',
      cues: ['Départ dans l’eau, dos au mur.', 'Poignets au-dessus de la surface jusqu’au bout.', 'Rétropédalage ou ciseaux : garde ce qui va le plus vite pour toi.'],
      mistakes: ['Mains qui touchent l’eau.'],
      easier: ['swim_back_legs'], alt: ['swim_back_legs'],
    },
    {
      id: 'ssa_entry_test', name: 'Test d’entrée SSA complet (100 m)', short: 'Test d’entrée SSA', cat: 'test',
      goals: ['ssa'], locs: ['piscine'], track: 'time', apnea: true, bench: 'ssa_entry_test',
      defaultSets: 1, defaultReps: '100 m continu, sans appui', defaultRest: 0, impact: 0,
      description: 'Parcours continu de 100 m sans appui, en 2:45 maximum : 25 m départ plongé dont au moins 15 m en immersion complète, 50 m de crawl, puis 25 m sur le dos mains hors de l’eau. ' + SSA_CONFIRM,
      cues: ['Plongeon allongé et coulée : repère à l’avance la marque des 15 m.', 'Crawl régulier sur le 50 m : garde des jambes pour le dos.', 'Sur le dos : poignets au-dessus de la surface, rétropédalage ou ciseaux.', 'Vise 2:30 ou moins à l’entraînement pour passer avec de la marge.'],
      mistakes: ['Remonter avant 15 m : épreuve non validée.', 'Se tenir au bord ou au fond pendant le parcours.', 'Mains qui retombent dans l’eau sur le dos.'],
      safety: [...APNEA_SAFETY, 'Le test officiel est encadré et validé par un maître-nageur sauveteur.'],
      easier: ['apnea_dive_15', 'swim_back_legs'], alt: ['swim_crawl_100', 'swim_back_legs'],
    },
    {
      id: 'ssa_tsa_course', name: 'Parcours de sauvetage TSA (100 m)', short: 'Parcours TSA', cat: 'test',
      goals: ['ssa'], locs: ['piscine'], equipment: ['mannequin'], track: 'time', apnea: true, bench: 'ssa_tsa_course',
      defaultSets: 1, defaultReps: '100 m', defaultRest: 0, impact: 0,
      description: 'Épreuve 1 du TSA, 100 m en 2:30 maximum : plongeon + 15 m d’apnée + 10 m, 25 m de crawl, 15 m d’apnée + 10 m, nage d’approche, canard vers le mannequin posé au fond (1,80 à 2,80 m), puis remorquage jusqu’au bord de départ, visage du mannequin jamais immergé plus de 3 s d’affilée. ' + SSA_CONFIRM,
      cues: ['Approche tête hors de l’eau, yeux sur le mannequin.', 'Canard à la verticale du mannequin, saisie ferme, poussée sur le fond pour remonter.', 'Remorquage bras tendu, visage du mannequin toujours au-dessus de l’eau.', 'Note tes temps par segment : apnée 1, crawl, apnée 2, approche et canard, remorquage.'],
      mistakes: ['Visage du mannequin immergé plus de 3 s d’affilée : épreuve échouée.', 'Partir trop vite sur le crawl et arriver essoufflé à la 2e apnée.', 'Lâcher le mannequin pendant le remorquage.'],
      safety: APNEA_SAFETY,
      easier: ['manikin_lift', 'manikin_tow'], alt: ['manikin_tow', 'swim_head_up'],
    },

    /* ═════ Course ═════ */
    {
      id: 'run_warmup', name: 'Échauffement footing + gammes', short: 'Échauffement course', cat: 'course',
      goals: ['hyrox', 'pompier', 'general'], locs: ['dehors', 'salle'], track: 'check',
      defaultSets: 1, defaultReps: '10 min de footing + 5 min de gammes', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'Footing très facile puis quelques gammes pour préparer muscles et articulations avant une séance de course ou de navettes.',
      cues: ['8 à 10 min de footing en aisance respiratoire.', 'Puis montées de genoux, talons-fesses et pas chassés sur 20 m.', 'Finis par 2 accélérations progressives.'],
      mistakes: ['Commencer directement par l’intensité.'],
      safety: [IMPACT_SAFETY],
      alt: ['bike_easy', 'walk_brisk'],
    },
    {
      id: 'run_drills', name: 'Gammes athlétiques', cat: 'course',
      goals: ['pompier', 'hyrox', 'general'], locs: ['dehors'], track: 'check',
      defaultSets: 2, defaultReps: '4 gammes × 20 m', defaultRest: 30, impact: 1, stress: ['genou', 'cheville'],
      description: 'Exercices de technique de course (montées de genoux, talons-fesses, foulées bondissantes légères) pour une foulée plus efficace et des appuis plus réactifs.',
      cues: ['Contacts brefs sur l’avant du pied, sous le bassin.', 'Buste droit, bras actifs.', 'La qualité avant la vitesse : 20 m, retour en marchant.'],
      mistakes: ['Faire les gammes fatigué, en fin de séance.'],
      safety: [IMPACT_SAFETY],
      alt: ['walk_brisk', 'ankle_knee_to_wall'],
    },
    {
      id: 'run_easy', name: 'Footing en endurance fondamentale', short: 'Footing facile', cat: 'course',
      goals: ['hyrox', 'pompier', 'general'], locs: ['dehors'], track: 'run',
      defaultSets: 1, defaultReps: '30–45 min', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'Course lente et confortable, où tu peux parler en phrases complètes. C’est la base de ton endurance : environ 80 % de ta course devrait se faire à cette allure.',
      cues: ['Allure où tu peux parler (60 à 75 % de ta VMA).', 'Petites foulées, cadence vive, pied posé sous le corps.', 'Note la distance et le temps à la fin.'],
      mistakes: ['Courir trop vite « pour que ça compte ».'],
      safety: [IMPACT_SAFETY],
      easier: ['walk_brisk'], harder: ['run_long', 'run_fartlek'], alt: ['treadmill_easy', 'bike_easy', 'walk_brisk'],
      muscles: ['quadriceps', 'mollets', 'fessiers'],
    },
    {
      id: 'run_long', name: 'Sortie longue', cat: 'course',
      goals: ['hyrox', 'general'], locs: ['dehors'], track: 'run',
      defaultSets: 1, defaultReps: '60–75 min', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'La sortie la plus longue de la semaine, à allure facile. Développe l’endurance nécessaire aux 8 km de l’HYROX.',
      cues: ['Même allure que le footing, voire plus lente.', 'Allonge de 5 à 10 min par semaine au maximum, avec une semaine plus courte toutes les 3 à 4 semaines.', 'Emporte de l’eau au-delà d’une heure.'],
      mistakes: ['Augmenter la distance de plus de 30 % en deux semaines.'],
      safety: [IMPACT_SAFETY],
      easier: ['run_easy'], alt: ['bike_easy', 'walk_brisk'],
    },
    {
      id: 'run_strides', name: 'Lignes droites accélérées', short: 'Lignes droites', cat: 'course',
      goals: ['hyrox', 'pompier', 'general'], locs: ['dehors'], track: 'check',
      defaultSets: 6, defaultReps: '80–100 m', defaultRest: 60, impact: 1, stress: ['genou', 'cheville'],
      description: 'Accélérations progressives sur 80 à 100 m jusqu’à environ 90 % de ta vitesse maximale, puis retour en marchant. Améliore la foulée sans fatiguer.',
      cues: ['Accélère sur les deux premiers tiers, garde la vitesse, puis relâche.', 'Reste relâché : épaules basses, mâchoire détendue.', 'Récupération complète en marchant.'],
      mistakes: ['Sprinter à fond dès le départ.'],
      safety: [IMPACT_SAFETY],
      harder: ['run_3030'], alt: ['bike_intervals'],
    },
    {
      id: 'run_3030', name: '30 s vite / 30 s lent', short: '30/30', cat: 'course',
      goals: ['pompier', 'hyrox', 'general'], locs: ['dehors'], track: 'check',
      defaultSets: 2, defaultReps: '8 à 10 × (30 s vite + 30 s lent)', defaultRest: 180, impact: 1, stress: ['genou', 'cheville'],
      description: 'Fractionné court en alternant 30 s rapides (vers ta VMA) et 30 s de footing lent. Efficace pour développer la VMA, utile au Luc Léger.',
      cues: ['30 s vite : allure soutenue mais tenable sur toute la série (100 à 105 % de VMA).', '30 s lent : footing, pas de marche.', 'Si l’allure chute nettement, arrête la série.'],
      mistakes: ['Faire les premières répétitions trop vite.'],
      safety: [IMPACT_SAFETY],
      easier: ['run_strides'], harder: ['run_400'], alt: ['bike_intervals'],
    },
    {
      id: 'run_400', name: '400 m rapide', cat: 'course',
      goals: ['pompier', 'hyrox', 'general'], locs: ['dehors'], track: 'time',
      defaultSets: 6, defaultReps: '400 m', defaultRest: 90, impact: 1, stress: ['genou', 'cheville'],
      description: 'Répétitions de 400 m à allure VMA (95 à 100 %), récupération en trottinant. Développe la vitesse aérobie.',
      cues: ['Même temps sur toutes les répétitions.', 'Récupération active : footing très lent ou marche.', 'Sur piste, 1 tour = 400 m.'],
      mistakes: ['Plus de 5 s d’écart entre la 1re et la dernière.'],
      safety: [IMPACT_SAFETY],
      easier: ['run_3030'], harder: ['run_1k_rep'], alt: ['bike_intervals', 'row_erg'],
    },
    {
      id: 'run_1k_rep', name: '1 km allure soutenue (fractionné)', short: '1 km fractionné', cat: 'course',
      goals: ['hyrox', 'general'], locs: ['dehors', 'salle'], track: 'time',
      defaultSets: 4, defaultReps: '1 km', defaultRest: 120, impact: 1, stress: ['genou', 'cheville'],
      description: 'Répétitions de 1 km à allure soutenue (allure 5 à 10 km), proches de l’allure de course HYROX. Travaille ta capacité à tenir un rythme.',
      cues: ['Environ 85 à 90 % de ta VMA, allure régulière.', 'Récupération : 2 min trottinées.', 'Note chaque temps pour suivre ta régularité.'],
      mistakes: ['Courir le premier km comme un test.'],
      safety: [IMPACT_SAFETY],
      easier: ['run_400'], harder: ['run_tempo'], alt: ['treadmill_1k', 'bike_intervals'],
    },
    {
      id: 'run_tempo', name: 'Allure seuil', cat: 'course',
      goals: ['hyrox', 'general'], locs: ['dehors'], track: 'run',
      defaultSets: 1, defaultReps: '15–25 min à allure seuil', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'Course continue à allure « confortablement difficile » (80 à 88 % de VMA) : tu peux dire quelques mots, pas des phrases. Repousse le moment où tu t’essouffles.',
      cues: ['Échauffe-toi 10 min avant.', 'Allure constante, respiration rythmée.', 'Termine par 10 min faciles.'],
      mistakes: ['Glisser vers une allure de course (trop vite).'],
      safety: [IMPACT_SAFETY],
      easier: ['run_fartlek'], alt: ['row_erg', 'bike_intervals'],
    },
    {
      id: 'run_fartlek', name: 'Fartlek (jeu d’allures)', short: 'Fartlek', cat: 'course',
      goals: ['hyrox', 'general'], locs: ['dehors'], track: 'run',
      defaultSets: 1, defaultReps: '30–40 min dont 6 à 10 accélérations', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'Footing dans lequel tu glisses des accélérations libres (jusqu’au prochain lampadaire, une côte, 1 min…). Travail de rythme ludique, sans chrono strict.',
      cues: ['Accélérations de 30 s à 2 min, à l’envie.', 'Récupère en footing jusqu’à respirer normalement.', 'Garde au moins 70 % du temps en allure facile.'],
      mistakes: ['Transformer chaque accélération en sprint.'],
      safety: [IMPACT_SAFETY],
      easier: ['run_easy'], harder: ['run_tempo'], alt: ['bike_intervals'],
    },
    {
      id: 'run_hills', name: 'Côtes', cat: 'course',
      goals: ['hyrox', 'pompier', 'general'], locs: ['dehors'], track: 'check',
      defaultSets: 1, defaultReps: '8 × 30 s en montée, retour en marchant', defaultRest: 90, impact: 1, stress: ['genou', 'cheville'],
      description: 'Montées courtes et dynamiques sur une pente modérée. Renforce jambes et mollets, avec moins de chocs qu’en plat à vitesse égale.',
      cues: ['Pente de 5 à 8 %, 30 à 45 s de montée.', 'Buste légèrement penché, genoux montés, bras actifs.', 'Descente en marchant ou en trottinant très doucement.'],
      mistakes: ['Redescendre vite en courant (le genou encaisse).'],
      safety: [IMPACT_SAFETY],
      easier: ['run_strides'], alt: ['bike_intervals', 'step_up'],
      muscles: ['fessiers', 'quadriceps', 'mollets'],
    },
    {
      id: 'run_shuttle', name: 'Navettes 20 m avec demi-tour', short: 'Navettes 20 m', cat: 'course',
      goals: ['pompier'], locs: ['dehors'], equipment: ['plots'], track: 'reps',
      defaultSets: 3, defaultReps: '10 navettes', defaultRest: 120, impact: 2, stress: ['genou', 'cheville'],
      description: 'Allers-retours de 20 m avec demi-tour, à allure soutenue. Prépare le Luc Léger : changements de direction et relances.',
      cues: ['Demi-tour en pivot, appui bas, sans freinage brutal.', 'Change de pied de pivot à chaque navette.', 'Allure : un peu plus vite que ton dernier palier au Luc Léger.'],
      mistakes: ['Toujours tourner du même côté : cheville et genou chargés d’un seul côté.'],
      safety: [IMPACT_SAFETY, 'Cheville ou genou fragile : remplace par du vélo fractionné.'],
      easier: ['run_3030'], harder: ['luc_leger'], alt: ['run_3030', 'bike_intervals'],
    },
    {
      id: 'treadmill_easy', name: 'Tapis en endurance', cat: 'course',
      goals: ['hyrox', 'general'], locs: ['salle'], equipment: ['tapis_course'], track: 'run',
      defaultSets: 1, defaultReps: '30–40 min', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'Footing facile sur tapis de course : pratique par mauvais temps ou pour contrôler l’allure. Mets 1 % de pente pour te rapprocher de la course dehors.',
      cues: ['Pente de 1 %, vitesse où tu peux parler.', 'Regarde devant toi, pas tes pieds.', 'Note la distance et le temps affichés.'],
      mistakes: ['Se tenir aux barres.'],
      safety: [IMPACT_SAFETY],
      harder: ['treadmill_1k'], alt: ['bike_easy', 'walk_brisk'],
    },
    {
      id: 'treadmill_1k', name: '1 km sur tapis', cat: 'course',
      goals: ['hyrox'], locs: ['salle'], equipment: ['tapis_course'], track: 'time',
      defaultSets: 4, defaultReps: '1 km', defaultRest: 120, impact: 1, stress: ['genou', 'cheville'],
      description: 'Répétitions de 1 km sur tapis à l’allure de course HYROX visée, souvent enchaînées avec une station.',
      cues: ['Pente de 1 %.', 'Vitesse en km/h = 60 ÷ allure en min/km (5:00/km = 12 km/h).', 'Descends du tapis seulement à l’arrêt complet.'],
      mistakes: ['Sauter sur les côtés du tapis en marche.'],
      safety: [IMPACT_SAFETY],
      easier: ['treadmill_easy'], harder: ['hyrox_run_station'], alt: ['bike_intervals', 'row_erg'],
    },
    {
      id: 'run_cooldown', name: 'Retour au calme (course)', short: 'Retour au calme course', cat: 'course',
      goals: ['hyrox', 'pompier', 'general'], locs: ['dehors', 'salle'], track: 'check',
      defaultSets: 1, defaultReps: '5–10 min', defaultRest: 0, impact: 0,
      description: 'Footing très lent ou marche, puis quelques mobilisations, pour redescendre progressivement.',
      cues: ['5 min de footing très lent ou de marche.', 'Mobilise hanches et chevilles, sans étirement forcé.'],
      mistakes: ['S’arrêter net après un fractionné.'],
    },

    /* ═════ Cardio sans impact et circuits ═════ */
    {
      id: 'bike_easy', name: 'Vélo / elliptique (sans impact)', short: 'Vélo / elliptique', cat: 'cardio',
      goals: ['hyrox', 'general'], locs: ['salle'], equipment: ['velo'], track: 'time',
      defaultSets: 1, defaultReps: '30–45 min', defaultRest: 0, impact: 0,
      description: 'Cardio sans impact sur vélo ou elliptique : entretient l’endurance quand le genou ou la cheville ne supportent pas la course.',
      cues: ['Selle à hauteur de hanche : jambe presque tendue en bas.', 'Résistance modérée, 80 à 90 tours par minute.', 'Même règle qu’en course facile : tu dois pouvoir parler.'],
      mistakes: ['Selle trop basse : genou très plié, il souffre.'],
      harder: ['bike_intervals'], alt: ['row_erg', 'walk_brisk'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'bike_intervals', name: 'Vélo fractionné (sans impact)', short: 'Vélo fractionné', cat: 'cardio',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle'], equipment: ['velo'], track: 'time',
      defaultSets: 1, defaultReps: '10 × (30 s fort + 30 s facile)', defaultRest: 0, impact: 0,
      description: 'Fractionné court sur vélo ou elliptique : même effet cardio que le 30/30 en course, sans choc pour le genou ni la cheville.',
      cues: ['30 s fort (résistance haute ou cadence élevée), 30 s très facile.', 'Échauffe-toi 10 min avant.', 'Essoufflé pendant l’effort, mais capable de répéter.'],
      mistakes: ['Résistance si haute que la cadence s’effondre.'],
      easier: ['bike_easy'], alt: ['row_erg', 'skierg_intervals'],
    },
    {
      id: 'walk_brisk', name: 'Marche rapide', cat: 'cardio',
      goals: ['general'], locs: ['dehors'], track: 'time',
      defaultSets: 1, defaultReps: '30–45 min', defaultRest: 0, impact: 0,
      description: 'Marche à allure soutenue, sans impact. Récupération active, ou remplacement de la course en cas de douleur.',
      cues: ['Pas rapides, bras actifs.', 'Respiration un peu accélérée : tu peux encore parler.', 'Ajoute des côtes pour augmenter l’effort.'],
      mistakes: ['Traîner : aucun effet cardio.'],
      harder: ['run_easy'], alt: ['bike_easy'],
    },
    {
      id: 'stair_climb_weighted', name: 'Montée d’escaliers lestée', short: 'Escaliers lestés', cat: 'cardio',
      goals: ['pompier'], locs: ['dehors', 'salle'], equipment: ['lest', 'escalier'], track: 'time',
      defaultSets: 4, defaultReps: '1 min de montée', defaultRest: 90, impact: 1, stress: ['genou', 'cheville'],
      description: 'Monter des escaliers avec un sac à dos lesté ou un gilet, pour simuler l’effort d’intervention en tenue (10 à 20 kg). Redescends en marchant calmement.',
      cues: ['Commence sans lest, puis ajoute 5 kg à la fois.', 'Marche par marche, buste droit, appui sur tout le pied.', 'Redescente lente : c’est elle qui charge le plus le genou.'],
      mistakes: ['Courir en descente.'],
      safety: ['Genou douloureux : montée sur banc ou vélo à la place, et jamais de descente lestée.'],
      easier: ['step_up'], alt: ['step_up', 'bike_easy'],
      muscles: ['quadriceps', 'fessiers', 'mollets'],
    },
    {
      id: 'burpee', name: 'Burpees', cat: 'cardio',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle', 'maison'], track: 'reps',
      defaultSets: 4, defaultReps: '10', defaultRest: 60, impact: 2, stress: ['genou', 'cheville', 'poignet'],
      description: 'Squat, mains au sol, planche, poitrine au sol, retour debout et petit saut. Exercice complet de cardio et d’endurance musculaire.',
      cues: ['Poitrine et cuisses touchent le sol.', 'Pieds ramenés près des mains, puis saut léger, mains au-dessus de la tête.', 'Rythme régulier plutôt que des séries rapides suivies d’arrêts.'],
      mistakes: ['Dos creusé en planche.', 'Réception jambes tendues.'],
      safety: [IMPACT_SAFETY],
      easier: ['burpee_step_back'], harder: ['burpee_broad_jump'], alt: ['burpee_step_back', 'mountain_climber'],
      muscles: ['jambes', 'pectoraux', 'épaules', 'abdos'],
    },
    {
      id: 'burpee_step_back', name: 'Burpee sans saut (pas en arrière)', short: 'Burpee sans saut', cat: 'cardio',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle', 'maison'], track: 'reps',
      defaultSets: 4, defaultReps: '10', defaultRest: 60, impact: 0, stress: ['poignet'],
      description: 'Version sans impact du burpee : mains au sol, tu recules les pieds un par un, poitrine au sol, puis tu reviens en avançant les pieds et tu te relèves sans sauter.',
      cues: ['Un pied après l’autre, en arrière puis en avant.', 'Poitrine au sol si possible, sinon planche haute.', 'Relève-toi complètement, hanches tendues.'],
      mistakes: ['Dos rond en posant les mains.'],
      harder: ['burpee'], alt: ['pushup', 'squat_bw'],
    },
    {
      id: 'jumping_jack', name: 'Jumping jacks', cat: 'cardio',
      goals: ['general'], locs: ['maison'], track: 'time', workSec: 30,
      defaultSets: 3, defaultReps: '30 s', defaultRest: 30, impact: 2, stress: ['genou', 'cheville'],
      description: 'Sauts en écartant bras et jambes, puis retour. Échauffement cardio rapide.',
      cues: ['Sur l’avant des pieds, sauts légers.', 'Bras tendus au-dessus de la tête.', 'Rythme régulier.'],
      mistakes: ['Réceptions lourdes sur les talons.'],
      safety: [IMPACT_SAFETY],
      alt: ['mountain_climber', 'burpee_step_back'],
    },

    /* ═════ HYROX ═════ */
    {
      id: 'skierg', name: 'SkiErg', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle'], equipment: ['skierg'], track: 'time',
      defaultSets: 4, defaultReps: '250 m', defaultRest: 60, impact: 0, stress: ['epaule', 'dos'],
      description: 'Ergomètre de ski de fond : on tire les poignées vers le bas avec tout le corps. 1re station de l’HYROX (1000 m).',
      cues: ['Bras tendus en haut, tire en pliant légèrement les hanches et en serrant les abdos.', 'Finis le geste mains près des cuisses, puis remonte en te grandissant.', 'En course, le damper est réglé sur 6 par défaut (modifiable).'],
      mistakes: ['Tirer seulement avec les bras.', 'Squat profond à chaque tirage : cuisses épuisées pour la suite.'],
      easier: ['band_straight_arm_pulldown'], harder: ['skierg_intervals'], alt: ['band_straight_arm_pulldown', 'row_erg'],
      muscles: ['dorsaux', 'triceps', 'abdos'],
    },
    {
      id: 'skierg_intervals', name: 'SkiErg intervalles', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle'], equipment: ['skierg'], track: 'time',
      defaultSets: 6, defaultReps: '1 min fort', defaultRest: 60, impact: 0, stress: ['epaule', 'dos'],
      description: 'Intervalles courts au SkiErg pour la puissance et l’endurance du haut du corps, sans impact.',
      cues: ['Effort soutenu mais régulier sur chaque intervalle.', 'Note la distance par intervalle ou l’allure aux 500 m.', 'Récupération : tirages très légers.'],
      mistakes: ['Partir à fond sur le premier.'],
      easier: ['skierg'], harder: ['skierg_1000_test'], alt: ['row_erg', 'band_straight_arm_pulldown'],
    },
    {
      id: 'band_straight_arm_pulldown', name: 'Tirage bras tendus à l’élastique', short: 'Tirage bras tendus', cat: 'hyrox',
      goals: ['hyrox'], locs: ['maison', 'salle'], equipment: ['elastiques', 'barre'], track: 'reps',
      defaultSets: 4, defaultReps: '15', defaultRest: 45, impact: 0, stress: ['epaule'],
      description: 'Élastique accroché en hauteur (à la barre de traction), tirage bras tendus jusqu’aux cuisses. Imite le geste du SkiErg à la maison.',
      cues: ['Bras presque tendus, léger pli de hanche.', 'Tire avec les dorsaux et les abdos, mains jusqu’aux cuisses.', 'Remonte lentement.'],
      mistakes: ['Plier les coudes : ça devient un exercice de triceps.'],
      harder: ['skierg'], alt: ['lat_pulldown'],
      muscles: ['dorsaux', 'triceps', 'abdos'],
    },
    {
      id: 'row_erg', name: 'Rameur', cat: 'hyrox',
      goals: ['hyrox', 'general'], locs: ['salle'], equipment: ['rameur'], track: 'time',
      defaultSets: 4, defaultReps: '500 m', defaultRest: 60, impact: 0, stress: ['dos'],
      description: 'Ergomètre d’aviron : poussée des jambes puis tirage. 5e station de l’HYROX (1000 m) et excellent cardio sans impact.',
      cues: ['Aller : jambes, puis buste, puis bras.', 'Retour : bras, puis buste, puis jambes.', 'Cadence modérée (24 à 30 coups par minute), poussée puissante.'],
      mistakes: ['Tirer avec les bras avant d’avoir poussé les jambes.', 'Dos rond en fin de tirage.'],
      harder: ['row_1000_test'], alt: ['skierg', 'bike_easy'],
      muscles: ['quadriceps', 'dorsaux', 'fessiers'],
    },
    {
      id: 'sled_push', name: 'Sled push', cat: 'hyrox',
      goals: ['hyrox', 'pompier'], locs: ['salle'], equipment: ['sled'], track: 'load',
      defaultSets: 4, defaultReps: '12,5 m (× 4 = 50 m)', defaultRest: 90, impact: 1, stress: ['genou', 'cheville'],
      description: 'Pousser un traîneau chargé sur 4 longueurs de 12,5 m. En course : 152 kg traîneau compris pour les hommes Open et les doubles hommes ou mixtes.',
      cues: ['Corps penché à 45°, bras tendus ou fléchis, dos plat.', 'Petits pas rapides sur l’avant du pied, sans t’arrêter.', 'Le sol de course freine plus que celui de la salle : garde de la marge.'],
      mistakes: ['Grands pas lents, buste trop droit.', 'S’arrêter au milieu : redémarrer coûte très cher.', 'Sortir de son couloir (pénalité).'],
      safety: ['Genou ou cheville douloureux : presse à cuisses à la place.'],
      easier: ['sled_push_light'], alt: ['leg_press', 'sled_push_light'],
      muscles: ['quadriceps', 'fessiers', 'mollets'],
    },
    {
      id: 'sled_push_light', name: 'Sled push léger (technique)', short: 'Sled push léger', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle'], equipment: ['sled'], track: 'load',
      defaultSets: 6, defaultReps: '12,5 m', defaultRest: 60, impact: 1, stress: ['genou', 'cheville'],
      description: 'Sled poussé avec une charge modérée pour soigner la position et la fréquence des pas, ou pour débuter en douceur.',
      cues: ['Charge que tu pousses sans t’arrêter ni ralentir.', 'Hanches basses, dos plat, regard au sol 2 m devant.', 'Augmente la charge seulement si la technique reste propre.'],
      mistakes: ['Monter la charge trop vite.'],
      harder: ['sled_push'], alt: ['leg_press'],
    },
    {
      id: 'sled_pull', name: 'Sled pull', cat: 'hyrox',
      goals: ['hyrox', 'pompier'], locs: ['salle'], equipment: ['sled'], track: 'load',
      defaultSets: 4, defaultReps: '12,5 m (× 4 = 50 m)', defaultRest: 90, impact: 0, stress: ['dos'],
      description: 'Tirer un traîneau vers soi à la corde, main sur main, en restant dans sa zone. En course : 103 kg traîneau compris pour les hommes Open et les doubles hommes ou mixtes.',
      cues: ['Reste dans ta zone de tirage et ne marche pas sur sa ligne avant.', 'Pieds écartés, fesses basses : tire avec les jambes et le dos, pas seulement les bras.', 'Recule d’un pas pour reprendre de la corde, garde-la dans ton couloir.'],
      mistakes: ['Tirer debout, bras seuls : avant-bras brûlés.', 'Corde qui sort du couloir (pénalité).'],
      alt: ['seated_row', 'db_row'],
      muscles: ['dorsaux', 'biceps', 'fessiers', 'avant-bras'],
    },
    {
      id: 'burpee_broad_jump', name: 'Burpee broad jumps', short: 'Burpee broad jump', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle'], track: 'time',
      defaultSets: 4, defaultReps: '20 m', defaultRest: 90, impact: 2, stress: ['genou', 'cheville', 'poignet'],
      description: 'Burpee puis saut en longueur pieds joints, enchaînés. 4e station de l’HYROX : 80 m en course.',
      cues: ['Poitrine et cuisses touchent le sol en même temps.', 'Mains posées à 30 cm maximum devant les pieds (un avant-bras).', 'Saut vers l’avant, départ et réception pieds joints, sans pas intermédiaire.', 'Se relever en posant un pied après l’autre est autorisé.'],
      mistakes: ['Mains trop loin devant les pieds : no-rep.', 'Petit pas de rattrapage entre la réception et le burpee suivant.', 'Partir trop vite : c’est une station où l’on perd beaucoup de temps.'],
      safety: [IMPACT_SAFETY],
      easier: ['burpee'], alt: ['burpee_step_back', 'db_walking_lunge'],
    },
    {
      id: 'farmers_carry', name: 'Farmers carry', cat: 'hyrox',
      goals: ['hyrox', 'pompier'], locs: ['salle'], equipment: ['kettlebell'], track: 'load',
      defaultSets: 4, defaultReps: '50 m', defaultRest: 60, impact: 0, stress: ['dos'],
      description: 'Marcher en portant une charge lourde dans chaque main. 6e station de l’HYROX : 200 m avec 2 × 24 kg (hommes Open). Excellent pour le port de matériel des pompiers.',
      cues: ['Épaules basses et en arrière, gainé, regard devant.', 'Pas courts et rapides.', 'Tu peux poser les charges autant de fois que nécessaire : préfère une pause courte à un lâcher.'],
      mistakes: ['Épaules qui remontent vers les oreilles.', 'Pauses longues à chaque tour.'],
      easier: ['suitcase_carry'], alt: ['suitcase_carry', 'sandbag_carry'],
      muscles: ['avant-bras', 'trapèzes', 'abdos', 'fessiers'],
    },
    {
      id: 'sandbag_lunge', name: 'Fentes avec sandbag', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle'], equipment: ['sandbag'], track: 'load',
      defaultSets: 4, defaultReps: '25 m', defaultRest: 90, impact: 1, stress: ['genou'],
      description: 'Fentes marchées avec un sac lesté sur les épaules. 7e station de l’HYROX : 100 m avec 20 kg (hommes Open).',
      cues: ['Le sac reste sur les épaules ; chaque chute coûte 15 s de pénalité (règle 2026-27, à confirmer).', 'Le genou arrière touche le sol à chaque fente.', 'Hanche complètement tendue en haut, avant la fente suivante.'],
      mistakes: ['Genou arrière qui ne touche pas : no-rep.', 'Buste qui s’effondre vers l’avant.'],
      safety: [KNEE_SAFETY],
      easier: ['db_walking_lunge'], alt: ['split_squat_db', 'reverse_lunge'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'db_walking_lunge', name: 'Fentes marchées haltères', short: 'Fentes marchées', cat: 'hyrox',
      goals: ['hyrox', 'general'], locs: ['salle'], equipment: ['halteres'], track: 'load',
      defaultSets: 3, defaultReps: '20 m', defaultRest: 90, impact: 1, stress: ['genou'],
      description: 'Fentes en avançant, un haltère dans chaque main. Prépare les fentes avec sandbag de l’HYROX avec une charge plus stable.',
      cues: ['Grand pas, genou arrière qui frôle ou touche le sol.', 'Genou avant dans l’axe du 2e orteil, sans rentrer vers l’intérieur.', 'Buste droit, pousse sur le talon avant pour te relever.'],
      mistakes: ['Genou avant qui part vers l’intérieur.', 'Pas trop courts.'],
      safety: [KNEE_SAFETY],
      easier: ['reverse_lunge'], harder: ['sandbag_lunge'], alt: ['split_squat_db', 'reverse_lunge'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'wall_ball', name: 'Wall balls', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle'], equipment: ['wall_ball'], track: 'reps',
      defaultSets: 5, defaultReps: '20', defaultRest: 60, impact: 1, stress: ['genou', 'epaule'],
      description: 'Squat avec un médecine-ball puis lancer vers une cible au mur. Dernière station de l’HYROX : 100 répétitions, ballon de 6 kg et cible à 3 m pour les hommes Open et les doubles hommes ou mixtes.',
      cues: ['Pli de hanche sous le genou en bas du squat.', 'Le centre du ballon touche la cible ; rattrape-le et enchaîne dans le squat.', 'Découpe tes séries dès le début (10 × 10, ou 25-20-20-15-10-10).'],
      mistakes: ['Squat trop haut : pas d’avertissement, c’est no-rep directement.', 'Ballon sous la cible.', 'Magnésie au wall ball en course : pénalité.'],
      easier: ['wall_ball_low'], harder: ['wall_balls_100_test'], alt: ['db_thruster', 'goblet_squat'],
      muscles: ['quadriceps', 'fessiers', 'épaules'],
    },
    {
      id: 'wall_ball_low', name: 'Wall balls cible basse', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle'], equipment: ['wall_ball'], track: 'reps',
      defaultSets: 5, defaultReps: '15', defaultRest: 60, impact: 1, stress: ['genou', 'epaule'],
      description: 'Wall balls avec une cible plus basse ou un ballon plus léger, pour apprendre le geste et la profondeur de squat avant le standard de course.',
      cues: ['Cible 30 à 50 cm plus bas, ou ballon de 4 kg.', 'Même profondeur qu’en course : pli de hanche sous le genou.', 'Enchaîne squat et lancer en un seul mouvement.'],
      mistakes: ['Garder un squat trop haut parce que c’est « juste de l’entraînement ».'],
      easier: ['goblet_squat'], harder: ['wall_ball'], alt: ['db_thruster', 'goblet_squat'],
    },
    {
      id: 'db_thruster', name: 'Thrusters haltères', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle', 'maison'], equipment: ['halteres'], track: 'load',
      defaultSets: 4, defaultReps: '12', defaultRest: 75, impact: 0, stress: ['genou', 'epaule'],
      description: 'Squat avec haltères aux épaules, enchaîné d’une poussée au-dessus de la tête. Remplace les wall balls quand il n’y a ni ballon ni cible.',
      cues: ['Haltères sur les épaules, coudes devant.', 'Descends au moins à la profondeur des wall balls.', 'Utilise l’élan des jambes pour pousser les haltères.'],
      mistakes: ['Dos qui se creuse en poussant.'],
      safety: [KNEE_SAFETY],
      easier: ['goblet_squat'], harder: ['wall_ball'], alt: ['goblet_squat', 'wall_ball_low'],
      muscles: ['quadriceps', 'fessiers', 'épaules', 'triceps'],
    },
    {
      id: 'hyrox_run_station', name: '1 km + station (enchaîné)', short: '1 km + station', cat: 'hyrox',
      goals: ['hyrox'], locs: ['salle'], equipment: ['tapis_course'], track: 'time',
      defaultSets: 4, defaultReps: '1 km + 1 station', defaultRest: 120, impact: 1, stress: ['genou', 'cheville'],
      description: 'Course de 1 km enchaînée directement avec une station (ou l’inverse) : tu apprends à courir avec les jambes lourdes, comme en course.',
      cues: ['Allure du km : ton allure de course visée, pas plus vite.', 'Transition rapide mais calme entre le tapis et la station.', 'Note le temps total et celui de la station.'],
      mistakes: ['Courir le km trop vite et subir la station.'],
      safety: [IMPACT_SAFETY],
      easier: ['treadmill_1k'], harder: ['hyrox_simulation'], alt: ['row_erg', 'bike_easy'],
    },

    /* ═════ Tests course et HYROX ═════ */
    {
      id: 'run_1k_test', name: '1 km chrono', cat: 'test',
      goals: ['hyrox', 'pompier', 'general'], locs: ['dehors', 'salle'], track: 'time', bench: 'run_1k',
      defaultSets: 1, defaultReps: '1 km', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'Test de 1 km le plus vite possible, sur piste ou sur tapis. Sert à calibrer tes allures et à suivre ta vitesse.',
      cues: ['Échauffement complet : 10 min et 2 à 3 accélérations.', 'Note le lieu (piste, route, tapis) : il change le temps.', 'Pars vite mais contrôlé, accélère sur les 300 derniers mètres.'],
      mistakes: ['Partir en sprint et exploser à 600 m.'],
      safety: [IMPACT_SAFETY],
      easier: ['run_1k_rep'], alt: ['treadmill_1k', 'row_1000_test'],
    },
    {
      id: 'run_5k_test', name: '5 km chrono', cat: 'test',
      goals: ['hyrox', 'general'], locs: ['dehors'], track: 'time', bench: 'run_5k',
      defaultSets: 1, defaultReps: '5 km', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'Test de 5 km à l’allure maximale tenable. Il permet d’estimer tes allures d’entraînement et ton allure de course HYROX (environ 15 à 30 s/km plus lente).',
      cues: ['Parcours plat et mesuré (piste, ou application GPS fiable).', 'Allure régulière : premier km pas plus rapide que les autres.', 'Échauffement de 10 min avant.'],
      mistakes: ['Premier km trop rapide.'],
      safety: [IMPACT_SAFETY],
      easier: ['run_tempo'], alt: ['run_1k_test', 'row_1000_test'],
    },
    {
      id: 'run_10k_test', name: '10 km chrono', cat: 'test',
      goals: ['hyrox', 'general'], locs: ['dehors'], track: 'time', bench: 'run_10k',
      defaultSets: 1, defaultReps: '10 km', defaultRest: 0, impact: 1, stress: ['genou', 'cheville'],
      description: 'Test d’endurance sur 10 km, en course officielle ou seul sur un parcours mesuré.',
      cues: ['Allure cible : environ ton allure 5 km + 10 à 20 s/km.', 'Bois un peu avant le départ ; pas besoin de ravitaillement sous une heure.', 'Note le parcours et la météo.'],
      mistakes: ['Le tenter sans avoir couru au moins 8 km à l’entraînement.'],
      safety: [IMPACT_SAFETY],
      easier: ['run_long'], alt: ['run_5k_test', 'bike_easy'],
    },
    {
      id: 'luc_leger', name: 'Test Luc Léger', cat: 'test',
      goals: ['pompier'], locs: ['dehors'], equipment: ['plots'], track: 'palier', bench: 'luc_leger',
      defaultSets: 1, defaultReps: 'jusqu’à ne plus tenir le rythme', defaultRest: 0, impact: 2, stress: ['genou', 'cheville'],
      description: 'Course en navette de 20 m au rythme d’une bande sonore ; la vitesse augmente de 0,5 km/h chaque minute. Ton résultat est le dernier palier atteint (demi-paliers comptés selon les SDIS).',
      cues: ['Note la version de la bande : départ à 8,5 km/h (version d’origine) ou à 8 km/h (version militaire).', 'À chaque bip, un pied sur ou derrière la ligne ; demi-tour en pivot.', 'Pars calmement : les premiers paliers sont lents, c’est voulu.'],
      mistakes: ['Arriver très en avance et s’épuiser en relances inutiles.', 'Manquer deux bips de suite : fin du test.'],
      safety: [IMPACT_SAFETY, 'Test maximal : seulement en forme, sans douleur, après un vrai échauffement.'],
      easier: ['run_shuttle'], alt: ['run_1k_test', 'bike_intervals'],
    },
    {
      id: 'skierg_1000_test', name: '1000 m SkiErg chrono', short: 'SkiErg 1000 m chrono', cat: 'test',
      goals: ['hyrox'], locs: ['salle'], equipment: ['skierg'], track: 'time', bench: 'skierg_1000',
      defaultSets: 1, defaultReps: '1000 m', defaultRest: 0, impact: 0, stress: ['epaule', 'dos'],
      description: 'Test de 1000 m au SkiErg, la distance de la 1re station HYROX. Note le réglage du damper.',
      cues: ['Damper sur 6 comme en course, sauf choix contraire à noter.', 'Allure régulière aux 500 m ; accélère sur les 200 derniers mètres.', 'Échauffement de 5 min avant.'],
      mistakes: ['Changer de damper d’un test à l’autre.'],
      easier: ['skierg_intervals'], alt: ['row_1000_test'],
    },
    {
      id: 'row_1000_test', name: '1000 m rameur chrono', short: 'Rameur 1000 m chrono', cat: 'test',
      goals: ['hyrox', 'general'], locs: ['salle'], equipment: ['rameur'], track: 'time', bench: 'row_1000',
      defaultSets: 1, defaultReps: '1000 m', defaultRest: 0, impact: 0, stress: ['dos'],
      description: 'Test de 1000 m au rameur, la distance de la 5e station HYROX.',
      cues: ['Damper sur 6 sauf choix contraire, à noter.', 'Départ : 5 coups puissants, puis allure régulière.', 'Surveille ton allure aux 500 m et garde-la stable.'],
      mistakes: ['Cadence trop élevée avec une poussée faible.'],
      easier: ['row_erg'], alt: ['skierg_1000_test'],
    },
    {
      id: 'wall_balls_100_test', name: '100 wall balls chrono', cat: 'test',
      goals: ['hyrox'], locs: ['salle'], equipment: ['wall_ball'], track: 'time', bench: 'wall_balls_100',
      defaultSets: 1, defaultReps: '100 répétitions', defaultRest: 0, impact: 1, stress: ['genou', 'epaule'],
      description: 'Temps pour 100 wall balls au standard de course (6 kg, cible à 3 m pour les hommes Open), comme la dernière station.',
      cues: ['Choisis ta découpe en séries avant de commencer et tiens-la.', 'Repos courts et prévus (5 à 10 respirations).', 'Seules les répétitions au standard comptent.'],
      mistakes: ['Faire une première série trop longue.'],
      easier: ['wall_ball'], alt: ['wall_ball_low', 'db_thruster'],
    },
    {
      id: 'hyrox_simulation', name: 'Simulation HYROX complète', short: 'Simulation HYROX', cat: 'test',
      goals: ['hyrox'], locs: ['salle'], equipment: ['tapis_course', 'skierg', 'sled', 'rameur', 'kettlebell', 'sandbag', 'wall_ball'],
      track: 'time', bench: 'hyrox_sim',
      defaultSets: 1, defaultReps: '8 × (1 km + 1 station)', defaultRest: 0, impact: 2, stress: ['genou', 'cheville', 'poignet'],
      description: 'Course complète dans l’ordre officiel : 8 fois 1 km suivi d’une station (SkiErg 1000 m, sled push 50 m, sled pull 50 m, burpee broad jumps 80 m, rameur 1000 m, farmers 200 m, fentes 100 m, 100 wall balls). Les temps ne sont comparables que si tout est complet.',
      cues: ['Au plus tard 2 à 3 semaines avant la course, après des demi-simulations.', 'En doubles : répartissez le travail des stations comme prévu le jour J.', 'Note chaque km, chaque station et le temps total.'],
      mistakes: ['Partir trop vite au 1er km : la plupart des gens le font.'],
      safety: [IMPACT_SAFETY],
      easier: ['hyrox_run_station'], alt: ['hyrox_run_station', 'row_erg'],
    },

    /* ═════ Force (salle) ═════ */
    {
      id: 'goblet_squat', name: 'Squat goblet', cat: 'force',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle'], equipment: ['kettlebell'], track: 'load',
      defaultSets: 3, defaultReps: '8–12', defaultRest: 90, impact: 0, stress: ['genou'],
      description: 'Squat en tenant un haltère ou un kettlebell contre la poitrine. Apprend un squat profond et droit, base des wall balls.',
      cues: ['Charge contre le sternum, coudes vers le bas.', 'Descends entre les talons, genoux dans l’axe des pieds.', 'Remonte en poussant le sol, buste droit.'],
      mistakes: ['Genoux qui rentrent vers l’intérieur.', 'Talons qui décollent.'],
      safety: [KNEE_SAFETY],
      easier: ['squat_bw'], harder: ['back_squat'], alt: ['leg_press', 'squat_bw'],
      muscles: ['quadriceps', 'fessiers', 'abdos'],
    },
    {
      id: 'back_squat', name: 'Squat barre', cat: 'force',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle'], equipment: ['barre_olympique'], track: 'load',
      defaultSets: 4, defaultReps: '5–8', defaultRest: 150, impact: 0, stress: ['genou', 'dos'],
      description: 'Squat avec la barre sur le haut du dos, exercice de base de la force des jambes.',
      cues: ['Barre sur les trapèzes, mains serrées, coudes sous la barre.', 'Inspire, gaine, descends hanches en arrière et genoux dans l’axe.', 'Garde 2 répétitions en réserve sur les séries de travail.'],
      mistakes: ['Dos qui s’arrondit en bas.', 'Charger trop vite au détriment de la profondeur.'],
      safety: ['Règle les sécurités du rack à la bonne hauteur.', KNEE_SAFETY],
      easier: ['goblet_squat'], alt: ['leg_press', 'goblet_squat'],
      muscles: ['quadriceps', 'fessiers', 'lombaires'],
    },
    {
      id: 'leg_press', name: 'Presse à cuisses', cat: 'force',
      goals: ['hyrox', 'general'], locs: ['salle'], equipment: ['presse'], track: 'load',
      defaultSets: 3, defaultReps: '10–12', defaultRest: 90, impact: 0, stress: ['genou'],
      description: 'Poussée des jambes sur une machine guidée, dos calé : charge les cuisses sans charger le dos.',
      cues: ['Pieds largeur de hanches, au milieu du plateau.', 'Descends tant que le bassin reste collé au dossier.', 'Ne verrouille pas complètement les genoux en haut.'],
      mistakes: ['Bassin qui décolle en bas (dos rond).'],
      safety: ['Genou sensible : pieds plus hauts sur le plateau et amplitude réduite.'],
      harder: ['back_squat'], alt: ['goblet_squat', 'hip_thrust'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'split_squat_db', name: 'Fente arrière aux haltères', short: 'Fente arrière haltères', cat: 'force',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle'], equipment: ['halteres'], track: 'load',
      defaultSets: 3, defaultReps: '8–10 par jambe', defaultRest: 90, impact: 0, stress: ['genou'],
      description: 'Fente en reculant une jambe, un haltère dans chaque main. Renforce chaque jambe séparément et corrige les écarts entre gauche et droite.',
      cues: ['Recule d’un grand pas, genou arrière vers le sol.', 'Poids sur le talon avant, genou avant au-dessus du pied.', 'Commence par la jambe la plus faible.'],
      mistakes: ['Genou avant qui rentre vers l’intérieur.'],
      safety: [KNEE_SAFETY],
      easier: ['reverse_lunge'], harder: ['sandbag_lunge'], alt: ['step_up', 'leg_press'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'rdl', name: 'Soulevé de terre jambes semi-tendues', short: 'Soulevé jambes tendues', cat: 'force',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle'], equipment: ['halteres'], track: 'load',
      defaultSets: 3, defaultReps: '8–10', defaultRest: 90, impact: 0, stress: ['dos'],
      description: 'Flexion des hanches, charge le long des jambes, genoux légèrement fléchis. Renforce ischios, fessiers et bas du dos.',
      cues: ['Pousse les fesses en arrière, dos plat.', 'Charge qui frôle les cuisses ; descends jusqu’à mi-tibia.', 'Remonte en serrant les fessiers.'],
      mistakes: ['Dos rond.', 'Plier les genoux comme un squat.'],
      alt: ['hip_thrust', 'glute_bridge'],
      muscles: ['ischios', 'fessiers', 'lombaires'],
    },
    {
      id: 'hip_thrust', name: 'Hip thrust', cat: 'force',
      goals: ['hyrox', 'general'], locs: ['salle'], equipment: ['barre_olympique', 'banc'], track: 'load',
      defaultSets: 3, defaultReps: '8–12', defaultRest: 90, impact: 0,
      description: 'Haut du dos sur un banc, barre sur les hanches, tu montes le bassin. Renforce fortement les fessiers sans charger les genoux.',
      cues: ['Omoplates sur le banc, pieds à plat, tibias verticaux en haut.', 'Monte en serrant les fessiers, menton rentré.', 'Pause d’1 s en haut.'],
      mistakes: ['Cambrer le bas du dos au lieu de serrer les fessiers.'],
      easier: ['glute_bridge'], alt: ['glute_bridge'],
      muscles: ['fessiers', 'ischios'],
    },
    {
      id: 'leg_curl', name: 'Leg curl', cat: 'force',
      goals: ['general'], locs: ['salle'], equipment: ['machine'], track: 'load',
      defaultSets: 3, defaultReps: '10–12', defaultRest: 75, impact: 0,
      description: 'Flexion des genoux sur machine pour renforcer les ischio-jambiers, qui protègent le genou en course.',
      cues: ['Genoux alignés avec l’axe de la machine.', 'Monte en 1 s, redescends en 3 s.'],
      mistakes: ['Décoller les hanches du banc.'],
      harder: ['nordic_hamstring'], alt: ['nordic_hamstring', 'glute_bridge'],
      muscles: ['ischios'],
    },
    {
      id: 'step_up', name: 'Montée sur banc', cat: 'force',
      goals: ['pompier', 'hyrox', 'general'], locs: ['salle'], equipment: ['banc', 'halteres'], track: 'load',
      defaultSets: 3, defaultReps: '8–10 par jambe', defaultRest: 90, impact: 0, stress: ['genou'],
      description: 'Monter sur un banc ou une box d’une jambe, haltères en main. Prépare escaliers et appuis sur une jambe.',
      cues: ['Tout le pied sur le banc, genou au-dessus du pied.', 'Pousse avec la jambe du haut, sans sauter avec celle du bas.', 'Redescends lentement.'],
      mistakes: ['Banc trop haut : genou au-dessus de la hanche.'],
      safety: [KNEE_SAFETY],
      easier: ['step_down'], harder: ['stair_climb_weighted'], alt: ['leg_press', 'glute_bridge'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'calf_raise', name: 'Mollets debout', cat: 'force',
      goals: ['hyrox', 'general'], locs: ['salle', 'maison'], equipment: ['step'], track: 'load',
      defaultSets: 3, defaultReps: '12–15', defaultRest: 60, impact: 0,
      description: 'Montées sur la pointe des pieds au bord d’une marche, pour des mollets et des tendons d’Achille solides (course, sled, palmes).',
      cues: ['Monte haut, descends sous le niveau de la marche.', 'Descente lente, en 3 s.', 'Ajoute un haltère dans une main quand 15 répétitions sont faciles.'],
      mistakes: ['Rebondir en bas.'],
      harder: ['calf_raise_eccentric'], alt: ['soleus_raise'],
      muscles: ['mollets'],
    },
    {
      id: 'bench_press', name: 'Développé couché', cat: 'force',
      goals: ['general'], locs: ['salle'], equipment: ['barre_olympique', 'banc'], track: 'load',
      defaultSets: 4, defaultReps: '6–10', defaultRest: 120, impact: 0, stress: ['epaule'],
      description: 'Poussée d’une barre allongé sur un banc : force des pectoraux, des épaules et des triceps.',
      cues: ['Omoplates serrées et basses, pieds au sol.', 'Barre vers le bas des pectoraux, coudes à environ 45°.', 'Garde 2 répétitions en réserve.'],
      mistakes: ['Coudes écartés à 90° : épaules exposées.', 'Rebond sur la poitrine.'],
      safety: ['Avec un pareur ou les sécurités du banc dès que la charge est lourde.'],
      easier: ['pushup'], alt: ['pushup'],
      muscles: ['pectoraux', 'triceps', 'épaules'],
    },
    {
      id: 'db_press', name: 'Développé militaire haltères', short: 'Développé militaire', cat: 'force',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle'], equipment: ['halteres'], track: 'load',
      defaultSets: 3, defaultReps: '8–10', defaultRest: 90, impact: 0, stress: ['epaule'],
      description: 'Poussée des haltères au-dessus de la tête, debout ou assis. Renforce les épaules pour les wall balls et le port de matériel.',
      cues: ['Gainé, côtes rentrées, pas de cambrure.', 'Haltères au-dessus de la tête, biceps près des oreilles.', 'Descends jusqu’au niveau du menton.'],
      mistakes: ['Se cambrer pour pousser.'],
      alt: ['pushup', 'db_thruster'],
      muscles: ['épaules', 'triceps'],
    },
    {
      id: 'lat_pulldown', name: 'Tirage vertical', cat: 'force',
      goals: ['pompier', 'general'], locs: ['salle'], equipment: ['poulie'], track: 'load',
      defaultSets: 3, defaultReps: '8–12', defaultRest: 90, impact: 0,
      description: 'Tirage d’une barre vers le haut de la poitrine, assis à la machine. Renforce les muscles des tractions.',
      cues: ['Poitrine sortie, tire les coudes vers les hanches.', 'Barre jusqu’au haut de la poitrine.', 'Remontée contrôlée, bras presque tendus.'],
      mistakes: ['Se pencher très en arrière et tirer avec l’élan.'],
      harder: ['assisted_pullup'], alt: ['pullup_band', 'band_row'],
      muscles: ['dorsaux', 'biceps'],
    },
    {
      id: 'seated_row', name: 'Tirage horizontal', cat: 'force',
      goals: ['hyrox', 'ssa', 'general'], locs: ['salle'], equipment: ['poulie'], track: 'load',
      defaultSets: 3, defaultReps: '10–12', defaultRest: 75, impact: 0,
      description: 'Tirage assis d’une poignée vers le ventre. Renforce le dos et équilibre le travail de poussée et de natation.',
      cues: ['Dos droit, poitrine haute.', 'Tire les coudes en arrière en serrant les omoplates.', 'Retour lent sans arrondir le dos.'],
      mistakes: ['Balancer le buste.'],
      alt: ['db_row', 'band_row'],
      muscles: ['dorsaux', 'rhomboïdes', 'biceps'],
    },
    {
      id: 'db_row', name: 'Rowing haltère', cat: 'force',
      goals: ['hyrox', 'general'], locs: ['salle'], equipment: ['halteres', 'banc'], track: 'load',
      defaultSets: 3, defaultReps: '10 par bras', defaultRest: 60, impact: 0,
      description: 'Tirage d’un haltère vers la hanche, un genou et une main posés sur un banc. Renforce le dos un côté à la fois.',
      cues: ['Dos plat, parallèle au sol.', 'Tire le coude vers la hanche.', 'Pas de rotation du buste.'],
      mistakes: ['Tirer avec l’élan du buste.'],
      alt: ['seated_row', 'band_row'],
      muscles: ['dorsaux', 'biceps'],
    },
    {
      id: 'assisted_pullup', name: 'Traction assistée (machine)', short: 'Traction assistée', cat: 'force',
      goals: ['pompier', 'general'], locs: ['salle'], equipment: ['machine'], track: 'load',
      defaultSets: 3, defaultReps: '6–10', defaultRest: 90, impact: 0,
      description: 'Traction avec contrepoids sur machine : plus le contrepoids est lourd, plus c’est facile. Note l’assistance en kg (plus bas = mieux).',
      cues: ['Genoux sur la plateforme, prise au choix (paumes vers l’avant ou vers toi).', 'Menton au-dessus de la barre, descente complète bras tendus.', 'Réduis l’assistance de 2,5 à 5 kg quand toutes les séries sont réussies.'],
      mistakes: ['Garder la même assistance pendant des semaines.'],
      easier: ['lat_pulldown'], harder: ['pullup_strict'], alt: ['pullup_band', 'lat_pulldown'],
      muscles: ['dorsaux', 'biceps'],
    },
    {
      id: 'cable_face_pull', name: 'Face pull à la poulie', cat: 'prevention',
      goals: ['ssa', 'hyrox', 'general'], locs: ['salle'], equipment: ['poulie'], track: 'load',
      defaultSets: 3, defaultReps: '12–15', defaultRest: 60, impact: 0,
      description: 'Tirage d’une corde vers le visage à la poulie haute, coudes hauts. Renforce l’arrière des épaules, précieux quand on nage et qu’on fait des tractions.',
      cues: ['Poulie à hauteur des yeux, corde tirée vers le front.', 'Coudes hauts ; finis en tournant les mains vers l’arrière.', 'Charge légère, mouvement contrôlé.'],
      mistakes: ['Charge trop lourde : tu tires avec le dos.'],
      alt: ['band_face_pull'],
      muscles: ['deltoïdes postérieurs', 'coiffe des rotateurs'],
    },
    {
      id: 'pallof_press', name: 'Pallof press', cat: 'gainage',
      goals: ['hyrox', 'pompier', 'general'], locs: ['salle'], equipment: ['poulie'], track: 'load', sides: true,
      defaultSets: 3, defaultReps: '10 par côté', defaultRest: 45, impact: 0,
      description: 'Debout de profil à la poulie, tu pousses la poignée devant toi sans laisser le buste tourner. Gainage anti-rotation, utile pour porter et tirer.',
      cues: ['Pieds largeur d’épaules, fessiers serrés.', 'Pousse les mains droit devant, tiens 2 s, ramène.', 'Le buste ne doit pas pivoter vers la poulie.'],
      mistakes: ['Charge trop lourde : le buste tourne.'],
      alt: ['side_plank', 'suitcase_carry'],
      muscles: ['obliques', 'abdos'],
    },
    {
      id: 'sandbag_carry', name: 'Port de sandbag sur l’épaule', short: 'Port de sandbag', cat: 'force',
      goals: ['pompier', 'hyrox'], locs: ['salle'], equipment: ['sandbag'], track: 'load',
      defaultSets: 4, defaultReps: '40 m', defaultRest: 60, impact: 0, stress: ['dos'],
      description: 'Marcher avec un sac lourd posé sur une épaule, comme un rouleau de tuyau ou du matériel. Travaille le gainage et le port de charge des pompiers.',
      cues: ['Ramasse le sac jambes fléchies, dos plat, puis hisse-le sur l’épaule.', 'Gainage fort : ne te penche pas sur le côté.', 'Change d’épaule à chaque aller.'],
      mistakes: ['Soulever le dos rond.'],
      easier: ['farmers_carry'], alt: ['farmers_carry', 'suitcase_carry'],
      muscles: ['trapèzes', 'abdos', 'fessiers'],
    },

    /* ═════ Maison : tirage (barre, élastiques) ═════ */
    {
      id: 'band_warmup', name: 'Échauffement épaules à l’élastique', short: 'Échauffement épaules', cat: 'prevention',
      goals: ['ssa', 'pompier', 'hyrox', 'general'], locs: ['maison', 'salle'], equipment: ['elastiques'], track: 'check',
      defaultSets: 2, defaultReps: '15 écartés + 10 rotations', defaultRest: 30, impact: 0,
      description: 'Activation des épaules avant la natation, les tractions ou le SkiErg : écartés, rotations externes et passages par-dessus la tête.',
      cues: ['Élastique léger, bras tendus.', '15 écartés, 10 rotations externes par bras, 10 passages bras tendus au-dessus de la tête.', 'Mouvements lents, sans douleur.'],
      mistakes: ['Élastique trop dur.'],
      alt: ['mob_shoulders'],
      muscles: ['coiffe des rotateurs', 'deltoïdes postérieurs'],
    },
    {
      id: 'dead_hang', name: 'Suspension à la barre', cat: 'force',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['barre'], track: 'time',
      defaultSets: 3, defaultReps: '20–40 s', defaultRest: 60, impact: 0,
      description: 'Suspendu bras tendus à la barre de traction. Renforce la prise et habitue les épaules : première étape vers les tractions.',
      cues: ['Prise ferme, pouces autour de la barre.', 'Épaules légèrement engagées, pas complètement relâchées.', 'Respire calmement.'],
      mistakes: ['Épaules collées aux oreilles, complètement passives.'],
      harder: ['scap_pullup'],
      muscles: ['avant-bras', 'dorsaux'],
    },
    {
      id: 'scap_pullup', name: 'Tractions scapulaires', cat: 'force',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['barre'], track: 'reps',
      defaultSets: 3, defaultReps: '6–10', defaultRest: 60, impact: 0,
      description: 'Suspendu bras tendus, tu abaisses et rapproches les omoplates pour monter de quelques centimètres, sans plier les coudes. Apprend le début de chaque traction.',
      cues: ['Bras tendus tout du long.', 'Tire les épaules vers le bas, loin des oreilles.', 'Tiens 1 s en haut.'],
      mistakes: ['Plier les coudes.'],
      easier: ['dead_hang'], harder: ['pullup_negative'],
      muscles: ['dorsaux', 'trapèzes'],
    },
    {
      id: 'pullup_negative', name: 'Traction négative (descente lente)', short: 'Traction négative', cat: 'force',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['barre'], track: 'reps',
      defaultSets: 4, defaultReps: '3 descentes de 5 s', defaultRest: 90, impact: 0,
      description: 'Monte menton au-dessus de la barre (petit saut ou chaise), puis descends le plus lentement possible jusqu’aux bras tendus. Construit la force des tractions.',
      cues: ['Descente de 3 à 5 s, contrôlée jusqu’en bas.', 'Paumes vers l’avant, ou vers toi si tu prépares l’épreuve pompier.', 'Arrête quand tu ne contrôles plus la descente.'],
      mistakes: ['Se laisser tomber sur la fin.'],
      easier: ['scap_pullup'], harder: ['pullup_band'], alt: ['assisted_pullup', 'lat_pulldown'],
      muscles: ['dorsaux', 'biceps'],
    },
    {
      id: 'pullup_band', name: 'Traction avec élastique', short: 'Traction élastique', cat: 'force',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['barre', 'elastiques'], track: 'reps',
      defaultSets: 3, defaultReps: '5–8', defaultRest: 90, impact: 0,
      description: 'Traction complète avec un élastique sous le genou ou le pied pour t’aider. Passe à un élastique plus fin quand tu fais 8 répétitions propres.',
      cues: ['Élastique bouclé sur la barre, pied ou genou dedans.', 'Départ bras tendus, menton au-dessus de la barre.', 'Descente contrôlée.'],
      mistakes: ['Rebondir en bas avec l’élastique.'],
      easier: ['pullup_negative'], harder: ['pullup_strict'], alt: ['assisted_pullup', 'lat_pulldown'],
      muscles: ['dorsaux', 'biceps'],
    },
    {
      id: 'pullup_strict', name: 'Traction stricte (pronation)', short: 'Traction pronation', cat: 'force',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['barre'], track: 'reps',
      defaultSets: 5, defaultReps: '1–3', defaultRest: 120, impact: 0,
      description: 'Traction complète paumes vers l’avant, sans élan : bras tendus en bas, menton au-dessus de la barre en haut. Tant que tu en fais peu, enchaîne des séries courtes de 1 à 2.',
      cues: ['Départ bras tendus, épaules engagées.', 'Tire les coudes vers les côtes, menton au-dessus de la barre.', 'Petites séries répétées, récupération complète.'],
      mistakes: ['Balancer les jambes (kipping).', 'Demi-répétitions.'],
      easier: ['pullup_band'], harder: ['pullup_weighted'], alt: ['chinup_strict', 'assisted_pullup'],
      muscles: ['dorsaux', 'biceps', 'avant-bras'],
    },
    {
      id: 'chinup_strict', name: 'Traction supination (ICP)', short: 'Traction supination', cat: 'force',
      goals: ['pompier'], locs: ['maison'], equipment: ['barre'], track: 'reps',
      defaultSets: 5, defaultReps: '1–3', defaultRest: 120, impact: 0,
      description: 'Traction paumes vers toi, comme l’épreuve des indicateurs de condition physique (ICP) des pompiers : départ bras tendus, menton au-dessus de la barre.',
      cues: ['Paumes vers toi, mains écartées de la largeur des épaules.', 'Bras complètement tendus en bas à chaque répétition.', 'Pas de pause de plus de 3 s (protocole ICP).'],
      mistakes: ['Ne pas tendre les bras en bas.', 'Élan des jambes.'],
      easier: ['pullup_band', 'pullup_negative'], harder: ['pullup_weighted'], alt: ['pullup_strict', 'assisted_pullup'],
      muscles: ['dorsaux', 'biceps'],
    },
    {
      id: 'pullup_weighted', name: 'Traction lestée', cat: 'force',
      goals: ['pompier', 'general'], locs: ['maison', 'salle'], equipment: ['barre', 'lest'], track: 'load',
      defaultSets: 4, defaultReps: '3–6', defaultRest: 150, impact: 0,
      description: 'Traction stricte avec un lest (sac à dos, ceinture). Pour quand tu fais 10 tractions strictes ou plus ; note le lest en kg.',
      cues: ['Lest serré contre le corps (sac à dos bien ajusté).', 'Mêmes standards : bras tendus en bas, menton au-dessus de la barre.', 'Ajoute 1 à 2,5 kg quand toutes les séries sont réussies.'],
      mistakes: ['Perdre l’amplitude à cause du lest.'],
      easier: ['pullup_strict'], alt: ['pullup_strict'],
      muscles: ['dorsaux', 'biceps', 'avant-bras'],
    },
    {
      id: 'band_row', name: 'Rowing à l’élastique', cat: 'force',
      goals: ['ssa', 'pompier', 'general'], locs: ['maison'], equipment: ['elastiques'], track: 'reps',
      defaultSets: 3, defaultReps: '12–15', defaultRest: 60, impact: 0,
      description: 'Tirage d’un élastique fixé devant toi vers le ventre. Renforce le dos à la maison et équilibre les pompes.',
      cues: ['Élastique accroché à hauteur de poitrine (porte, barre).', 'Serre les omoplates, coudes près du corps.', 'Tiens 1 s, relâche lentement.'],
      mistakes: ['Hausser les épaules.'],
      alt: ['seated_row', 'db_row'],
      muscles: ['dorsaux', 'rhomboïdes', 'biceps'],
    },
    {
      id: 'band_face_pull', name: 'Face pull à l’élastique', short: 'Face pull élastique', cat: 'prevention',
      goals: ['ssa', 'general'], locs: ['maison'], equipment: ['elastiques'], track: 'reps',
      defaultSets: 3, defaultReps: '15', defaultRest: 45, impact: 0,
      description: 'Tirage de l’élastique vers le visage, coudes hauts. Protège les épaules qui nagent et qui tirent.',
      cues: ['Élastique fixé à hauteur des yeux.', 'Tire vers le front, coudes hauts ; finis mains vers l’arrière.', 'Lent et contrôlé.'],
      mistakes: ['Élastique trop dur.'],
      alt: ['cable_face_pull', 'band_pull_apart'],
      muscles: ['deltoïdes postérieurs', 'coiffe des rotateurs'],
    },
    {
      id: 'band_pull_apart', name: 'Écartés à l’élastique', cat: 'prevention',
      goals: ['ssa', 'general'], locs: ['maison'], equipment: ['elastiques'], track: 'reps',
      defaultSets: 3, defaultReps: '15–20', defaultRest: 45, impact: 0,
      description: 'Bras tendus devant toi, tu écartes l’élastique jusqu’à la poitrine. Renforce le haut du dos et l’arrière des épaules.',
      cues: ['Bras tendus à hauteur d’épaules.', 'Écarte en serrant les omoplates, élastique contre la poitrine.', 'Épaules basses.'],
      mistakes: ['Cambrer le dos.'],
      alt: ['band_face_pull'],
      muscles: ['rhomboïdes', 'deltoïdes postérieurs'],
    },

    /* ═════ Maison : poussée et jambes ═════ */
    {
      id: 'pushup', name: 'Pompes', cat: 'force',
      goals: ['pompier', 'hyrox', 'general'], locs: ['maison'], track: 'reps',
      defaultSets: 4, defaultReps: '10–15', defaultRest: 75, impact: 0, stress: ['poignet', 'epaule'],
      description: 'Pompes classiques au sol, corps gainé de la tête aux pieds.',
      cues: ['Mains un peu plus larges que les épaules, doigts vers l’avant.', 'Corps en planche : fessiers et abdos serrés.', 'Poitrine à un poing du sol, coudes à environ 45°.'],
      mistakes: ['Bassin qui s’affaisse.', 'Coudes écartés à 90°.'],
      easier: ['pushup_incline'], harder: ['pushup_cadence', 'pushup_hand_release'], alt: ['pushup_incline', 'bench_press'],
      muscles: ['pectoraux', 'triceps', 'épaules', 'abdos'],
    },
    {
      id: 'pushup_incline', name: 'Pompes inclinées', cat: 'force',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['chaise'], track: 'reps',
      defaultSets: 3, defaultReps: '12–15', defaultRest: 60, impact: 0, stress: ['poignet'],
      description: 'Pompes les mains sur un support surélevé (chaise, banc, rebord) : plus facile, pour soigner la technique ou finir une séance.',
      cues: ['Mains sur un support stable.', 'Corps aligné, poitrine vers le bord du support.', 'Plus le support est haut, plus c’est facile.'],
      mistakes: ['Support qui glisse.'],
      harder: ['pushup'], alt: ['pushup'],
      muscles: ['pectoraux', 'triceps'],
    },
    {
      id: 'pushup_cadence', name: 'Pompes en cadence (ICP)', short: 'Pompes en cadence', cat: 'force',
      goals: ['pompier'], locs: ['maison'], track: 'reps',
      defaultSets: 3, defaultReps: '10–15 au rythme imposé', defaultRest: 90, impact: 0, stress: ['poignet', 'epaule'],
      description: 'Pompes à rythme imposé, environ une toutes les 2 s, comme l’épreuve des ICP : poitrine à environ 5 cm du sol. Le protocole exact varie selon le SDIS (à confirmer).',
      cues: ['Suis un métronome ou un bip toutes les 2 s.', 'Poitrine à environ 5 cm du sol à chaque répétition.', 'Corps gainé du début à la fin.'],
      mistakes: ['Accélérer pour « se débarrasser » des répétitions.'],
      easier: ['pushup'], harder: ['pushup_decline'], alt: ['pushup'],
      muscles: ['pectoraux', 'triceps', 'épaules'],
    },
    {
      id: 'pushup_hand_release', name: 'Pompes mains décollées', cat: 'force',
      goals: ['hyrox', 'general'], locs: ['maison'], track: 'reps',
      defaultSets: 3, defaultReps: '10', defaultRest: 75, impact: 0, stress: ['poignet', 'epaule'],
      description: 'Pompe complète avec poitrine au sol et mains décollées un instant, puis poussée. Format du test de condition physique HYROX (30 répétitions).',
      cues: ['Poitrine et cuisses au sol, décolle les mains.', 'Repose-les et pousse en gardant le corps gainé.', 'Bras tendus en haut.'],
      mistakes: ['Monter les fesses en premier (« ver de terre »).'],
      easier: ['pushup'], harder: ['pushup_decline'], alt: ['pushup'],
      muscles: ['pectoraux', 'triceps', 'épaules'],
    },
    {
      id: 'pushup_decline', name: 'Pompes pieds surélevés', cat: 'force',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['chaise'], track: 'reps',
      defaultSets: 3, defaultReps: '8–12', defaultRest: 90, impact: 0, stress: ['poignet', 'epaule'],
      description: 'Pompes avec les pieds posés sur une chaise ou un banc : plus de charge sur le haut des pectoraux et les épaules.',
      cues: ['Corps aligné, pas de cambrure.', 'Plus les pieds sont hauts, plus c’est dur.'],
      mistakes: ['Bassin qui s’affaisse.'],
      easier: ['pushup_cadence', 'pushup'], alt: ['pushup'],
      muscles: ['pectoraux', 'épaules', 'triceps'],
    },
    {
      id: 'chair_dips', name: 'Dips entre deux chaises', short: 'Dips sur chaises', cat: 'force',
      goals: ['general'], locs: ['maison'], equipment: ['chaise'], track: 'reps',
      defaultSets: 3, defaultReps: '8–12', defaultRest: 75, impact: 0, stress: ['epaule', 'poignet'],
      description: 'Mains sur deux chaises stables, tu descends en pliant les coudes puis tu remontes. Renforce triceps et épaules.',
      cues: ['Chaises calées contre un mur.', 'Descends jusqu’à ce que les bras fassent 90°, pas plus bas.', 'Épaules basses, poitrine ouverte.'],
      mistakes: ['Descendre trop bas : épaule en avant, douleur.'],
      safety: ['Douleur à l’avant de l’épaule : arrête et remplace par des pompes.'],
      alt: ['pushup', 'bench_press'],
      muscles: ['triceps', 'pectoraux', 'épaules'],
    },
    {
      id: 'squat_bw', name: 'Squat au poids du corps', short: 'Squat', cat: 'force',
      goals: ['pompier', 'hyrox', 'general'], locs: ['maison'], track: 'reps',
      defaultSets: 3, defaultReps: '15–20', defaultRest: 60, impact: 0, stress: ['genou'],
      description: 'Squat sans charge, pieds largeur d’épaules. Base de tous les mouvements de jambes.',
      cues: ['Hanches en arrière, genoux dans l’axe des pieds.', 'Talons au sol, dos droit.', 'Descends au moins cuisses parallèles si c’est indolore.'],
      mistakes: ['Genoux qui rentrent.', 'Talons qui décollent.'],
      safety: [KNEE_SAFETY],
      harder: ['goblet_squat', 'squat_jump'], alt: ['wall_sit', 'glute_bridge'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'split_squat_bw', name: 'Fente statique', cat: 'force',
      goals: ['pompier', 'hyrox', 'general'], locs: ['maison'], track: 'reps',
      defaultSets: 3, defaultReps: '10 par jambe', defaultRest: 60, impact: 0, stress: ['genou'],
      description: 'Un pied devant, un pied derrière, tu descends et remontes sur place. Renforce chaque jambe séparément.',
      cues: ['Pieds écartés comme sur des rails, pas sur une même ligne.', 'Genou arrière vers le sol, buste droit.', 'Poids sur le talon avant.'],
      mistakes: ['Genou avant qui part vers l’intérieur.'],
      safety: [KNEE_SAFETY],
      harder: ['reverse_lunge'], alt: ['glute_bridge', 'spanish_squat'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'reverse_lunge', name: 'Fente arrière', cat: 'force',
      goals: ['pompier', 'hyrox', 'general'], locs: ['maison'], track: 'reps',
      defaultSets: 3, defaultReps: '10 par jambe', defaultRest: 60, impact: 0, stress: ['genou'],
      description: 'Fente en reculant une jambe, puis retour debout. Plus douce pour le genou que la fente avant.',
      cues: ['Grand pas en arrière, genou arrière vers le sol.', 'Pousse sur le talon avant pour revenir.', 'Buste droit, regard devant.'],
      mistakes: ['Pas trop court : genou avant très en avant.'],
      safety: [KNEE_SAFETY],
      easier: ['split_squat_bw'], harder: ['split_squat_db', 'db_walking_lunge'], alt: ['split_squat_bw', 'glute_bridge'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'wall_sit', name: 'Chaise contre le mur (Killy)', short: 'Chaise (Killy)', cat: 'force',
      goals: ['pompier'], locs: ['maison'], track: 'time', workSec: 45,
      defaultSets: 3, defaultReps: '30–60 s', defaultRest: 60, impact: 0, stress: ['genou'],
      description: 'Dos plaqué au mur, cuisses à 90°, tu tiens la position. C’est l’épreuve « Killy » des ICP pompiers.',
      cues: ['Dos et tête contre le mur, cuisses parallèles au sol.', 'Genoux au-dessus des chevilles.', 'Bras le long du corps, sans appui sur les cuisses.'],
      mistakes: ['Mains sur les cuisses.', 'Cuisses trop hautes.'],
      safety: ['Genou douloureux : remonte un peu (angle plus ouvert) ou passe au squat espagnol.'],
      harder: ['test_wall_sit_max'], alt: ['spanish_squat', 'glute_bridge'],
      muscles: ['quadriceps', 'fessiers'],
    },
    {
      id: 'glute_bridge', name: 'Pont fessier', cat: 'force',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['tapis'], track: 'reps',
      defaultSets: 3, defaultReps: '12–15', defaultRest: 45, impact: 0,
      description: 'Allongé sur le dos, pieds au sol, tu montes le bassin en serrant les fessiers. Renforce les fessiers sans charger les genoux.',
      cues: ['Pieds proches des fesses, largeur de hanches.', 'Monte jusqu’à aligner genoux, hanches et épaules.', 'Pause de 2 s en haut.'],
      mistakes: ['Cambrer le bas du dos.'],
      harder: ['hip_thrust'],
      muscles: ['fessiers', 'ischios'],
    },
    {
      id: 'squat_jump', name: 'Squats sautés', cat: 'force',
      goals: ['pompier', 'hyrox'], locs: ['maison'], track: 'reps',
      defaultSets: 3, defaultReps: '8', defaultRest: 90, impact: 2, stress: ['genou', 'cheville'],
      description: 'Squat puis saut vertical, réception souple. Développe l’explosivité.',
      cues: ['Réception sur l’avant du pied, genoux fléchis et dans l’axe.', 'Stabilise-toi avant le saut suivant.', 'Arrête dès que la réception devient lourde.'],
      mistakes: ['Réception jambes tendues ou genoux qui rentrent.'],
      safety: [IMPACT_SAFETY, 'Débutant : 80 à 100 contacts au sol par séance au maximum, et 48 h entre deux séances de sauts.'],
      easier: ['squat_bw'], alt: ['squat_bw', 'goblet_squat'],
      muscles: ['quadriceps', 'fessiers', 'mollets'],
    },
    {
      id: 'suitcase_carry', name: 'Marche valise (une main)', short: 'Marche valise', cat: 'force',
      goals: ['pompier', 'hyrox', 'general'], locs: ['salle', 'maison'], equipment: ['kettlebell'], track: 'load', sides: true,
      defaultSets: 3, defaultReps: '30 m par côté', defaultRest: 60, impact: 0,
      description: 'Marcher avec une charge dans une seule main, sans pencher le buste. Gainage latéral et prise, comme pour porter du matériel d’un côté.',
      cues: ['Buste droit : ne te penche ni vers la charge ni à l’opposé.', 'Épaule basse, pas réguliers.', 'Change de main à chaque aller.'],
      mistakes: ['Se pencher du côté de la charge.'],
      harder: ['farmers_carry'], alt: ['side_plank'],
      muscles: ['obliques', 'avant-bras', 'trapèzes'],
    },

    /* ═════ Abdos / gainage ═════ */
    {
      id: 'plank', name: 'Planche', cat: 'gainage',
      goals: ['pompier', 'hyrox', 'ssa', 'general'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 45,
      defaultSets: 3, defaultReps: '30–60 s', defaultRest: 45, impact: 0,
      description: 'Gainage sur les avant-bras et les orteils, corps aligné. Base de la solidité du tronc.',
      cues: ['Coudes sous les épaules.', 'Serre fessiers et abdos, rentre légèrement le bassin.', 'Respire normalement.'],
      mistakes: ['Bassin qui s’affaisse ou fesses en l’air.', 'Retenir sa respiration.'],
      easier: ['plank_knees'], harder: ['plank_shoulder_tap', 'plank_icp'], alt: ['dead_bug'],
      muscles: ['abdos', 'transverse', 'épaules'],
    },
    {
      id: 'plank_knees', name: 'Planche sur les genoux', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 30,
      defaultSets: 3, defaultReps: '30 s', defaultRest: 30, impact: 0,
      description: 'Planche sur les avant-bras et les genoux : version plus facile pour apprendre l’alignement.',
      cues: ['Genoux, hanches et épaules alignés.', 'Abdos serrés, ne laisse pas tomber le bassin.'],
      mistakes: ['Fesses en l’air.'],
      harder: ['plank'], alt: ['dead_bug'],
      muscles: ['abdos', 'transverse'],
    },
    {
      id: 'plank_icp', name: 'Gainage ICP (protocole)', short: 'Gainage ICP', cat: 'gainage',
      goals: ['pompier'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 60,
      defaultSets: 3, defaultReps: '45–60 s', defaultRest: 60, impact: 0,
      description: 'Planche sur les avant-bras et les orteils, pieds écartés d’environ 10 cm, corps aligné, comme l’épreuve de gainage des ICP. À l’entraînement, reste sous ton maximum.',
      cues: ['Coudes sous les épaules, avant-bras parallèles.', 'Pieds écartés d’environ 10 cm.', 'Épaules, bassin et chevilles alignés ; regard vers le sol.'],
      mistakes: ['Bassin qui monte ou qui s’affaisse : au test, l’épreuve s’arrête.'],
      easier: ['plank'], harder: ['test_plank_max'], alt: ['plank'],
      muscles: ['abdos', 'transverse', 'épaules'],
    },
    {
      id: 'plank_shoulder_tap', name: 'Planche + touches d’épaules', short: 'Planche touche épaule', cat: 'gainage',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 30,
      defaultSets: 3, defaultReps: '30 s', defaultRest: 30, impact: 0, stress: ['poignet'],
      description: 'En planche bras tendus, tu touches l’épaule opposée avec une main, en alternance, sans laisser le bassin bouger.',
      cues: ['Pieds écartés pour plus de stabilité.', 'Bassin immobile : imagine un verre d’eau posé sur ton dos.', 'Lent et contrôlé.'],
      mistakes: ['Bassin qui se balance.'],
      easier: ['plank'], alt: ['bird_dog'],
      muscles: ['abdos', 'obliques', 'épaules'],
    },
    {
      id: 'plank_up_down', name: 'Planche haute-basse', cat: 'gainage',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 30,
      defaultSets: 3, defaultReps: '30 s', defaultRest: 30, impact: 0, stress: ['poignet', 'epaule'],
      description: 'Passer de la planche sur les avant-bras à la planche bras tendus, une main après l’autre, puis revenir. Gainage et épaules.',
      cues: ['Change de bras de départ à chaque répétition.', 'Bassin stable, pieds écartés.'],
      mistakes: ['Bassin qui tourne à chaque passage.'],
      easier: ['plank'], alt: ['plank'],
      muscles: ['abdos', 'triceps', 'épaules'],
    },
    {
      id: 'side_plank', name: 'Planche latérale', cat: 'gainage',
      goals: ['pompier', 'hyrox', 'general'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 30, sides: true,
      defaultSets: 3, defaultReps: '20–40 s par côté', defaultRest: 30, impact: 0,
      description: 'Sur un avant-bras et le côté des pieds, corps aligné. Renforce les obliques et la stabilité du bassin.',
      cues: ['Coude sous l’épaule.', 'Bassin haut, corps droit de la tête aux pieds.', 'Pieds superposés, ou décalés (plus facile).'],
      mistakes: ['Bassin qui tombe ou qui part en arrière.'],
      easier: ['side_plank_knee'], harder: ['copenhagen_plank'], alt: ['bird_dog'],
      muscles: ['obliques', 'moyen fessier'],
    },
    {
      id: 'side_plank_knee', name: 'Planche latérale sur genou', short: 'Latérale sur genou', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 25, sides: true,
      defaultSets: 3, defaultReps: '20–30 s par côté', defaultRest: 30, impact: 0,
      description: 'Planche latérale en appui sur le coude et le genou : plus facile, même alignement.',
      cues: ['Coude sous l’épaule, genoux pliés.', 'Monte le bassin : corps aligné des genoux à la tête.'],
      mistakes: ['Bassin qui tombe.'],
      harder: ['side_plank'], alt: ['bird_dog'],
      muscles: ['obliques'],
    },
    {
      id: 'hollow_hold', name: 'Hollow hold', cat: 'gainage',
      goals: ['ssa', 'general'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 30,
      defaultSets: 3, defaultReps: '20–30 s', defaultRest: 45, impact: 0,
      description: 'Allongé sur le dos, bas du dos plaqué au sol, bras et jambes tendus décollés. Gainage très utile pour garder une position allongée dans l’eau.',
      cues: ['Bas du dos collé au sol avant tout.', 'Bras tendus derrière la tête, jambes tendues à 30 cm du sol.', 'Plus facile : genoux pliés ou jambes plus hautes.'],
      mistakes: ['Bas du dos qui décolle.'],
      easier: ['dead_bug'], harder: ['hollow_rock'], alt: ['dead_bug'],
      muscles: ['abdos', 'transverse'],
    },
    {
      id: 'hollow_rock', name: 'Hollow rock', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 20,
      defaultSets: 3, defaultReps: '20 s', defaultRest: 45, impact: 0,
      description: 'En position hollow, tu te balances d’avant en arrière comme une barque, sans perdre la forme. Version plus dure du hollow hold.',
      cues: ['Garde exactement la forme du hollow hold.', 'Petits balancements réguliers.'],
      mistakes: ['Se plier en deux pendant le balancement.'],
      easier: ['hollow_hold'], alt: ['hollow_hold'],
      muscles: ['abdos', 'transverse'],
    },
    {
      id: 'dead_bug', name: 'Dead bug', cat: 'gainage',
      goals: ['general', 'ssa'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 40,
      defaultSets: 3, defaultReps: '10 par côté', defaultRest: 45, impact: 0,
      description: 'Sur le dos, bras vers le plafond et genoux à 90°, tu tends un bras et la jambe opposée sans décoller le bas du dos. Gainage doux pour le dos.',
      cues: ['Bas du dos collé au sol.', 'Bras et jambe opposés, lentement.', 'Expire en tendant.'],
      mistakes: ['Aller trop vite.'],
      harder: ['hollow_hold'], alt: ['bird_dog'],
      muscles: ['abdos', 'transverse'],
    },
    {
      id: 'bird_dog', name: 'Bird dog', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 40,
      defaultSets: 3, defaultReps: '10 par côté', defaultRest: 45, impact: 0,
      description: 'À quatre pattes, tu tends un bras et la jambe opposée sans bouger le bassin. Stabilité du dos et coordination.',
      cues: ['Mains sous les épaules, genoux sous les hanches.', 'Tends bras et jambe opposés, dos plat comme une table.', 'Tiens 2 s.'],
      mistakes: ['Bassin qui tourne.'],
      alt: ['dead_bug'],
      muscles: ['lombaires', 'fessiers', 'abdos'],
    },
    {
      id: 'superman', name: 'Superman', cat: 'gainage',
      goals: ['general', 'ssa'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 30,
      defaultSets: 3, defaultReps: '12', defaultRest: 45, impact: 0, stress: ['dos'],
      description: 'Allongé sur le ventre, tu décolles bras et jambes tendus. Renforce le dos et les fessiers.',
      cues: ['Regard vers le sol, nuque longue.', 'Décolle bras et jambes de quelques centimètres seulement.', 'Tiens 2 s.'],
      mistakes: ['Cambrer fort en levant la tête.'],
      alt: ['bird_dog'],
      muscles: ['lombaires', 'fessiers'],
    },
    {
      id: 'crunch', name: 'Crunch', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 40,
      defaultSets: 3, defaultReps: '15–20', defaultRest: 45, impact: 0,
      description: 'Sur le dos, genoux pliés, tu enroules le haut du dos pour décoller les épaules.',
      cues: ['Mains aux tempes ou croisées sur la poitrine, sans tirer sur la nuque.', 'Enroule en expirant, les épaules décollent.', 'Redescends lentement.'],
      mistakes: ['Tirer sur la nuque.'],
      harder: ['bicycle_crunch', 'sit_up'], alt: ['dead_bug'],
      muscles: ['abdos'],
    },
    {
      id: 'bicycle_crunch', name: 'Crunch vélo', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 40,
      defaultSets: 3, defaultReps: '20 (10 par côté)', defaultRest: 45, impact: 0,
      description: 'Coude vers le genou opposé en pédalant, épaules décollées. Abdos et obliques.',
      cues: ['Épaules décollées tout du long.', 'Tourne le buste, pas seulement le coude.', 'Jambe tendue loin du sol.'],
      mistakes: ['Aller trop vite, mouvement bâclé.'],
      easier: ['crunch'], alt: ['dead_bug'],
      muscles: ['abdos', 'obliques'],
    },
    {
      id: 'reverse_crunch', name: 'Crunch inversé', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 40,
      defaultSets: 3, defaultReps: '12–15', defaultRest: 45, impact: 0,
      description: 'Sur le dos, genoux pliés, tu enroules le bassin pour ramener les genoux vers la poitrine. Bas des abdos, doux pour la nuque.',
      cues: ['Bras au sol le long du corps.', 'Décolle le bas du dos en enroulant.', 'Redescends lentement sans laisser tomber les jambes.'],
      mistakes: ['Balancer les jambes.'],
      harder: ['leg_raise_floor'], alt: ['dead_bug'],
      muscles: ['abdos'],
    },
    {
      id: 'russian_twist', name: 'Rotations russes', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 40,
      defaultSets: 3, defaultReps: '20 (10 par côté)', defaultRest: 45, impact: 0, stress: ['dos'],
      description: 'Assis, buste incliné en arrière, tu tournes les épaules d’un côté à l’autre. Travail des obliques.',
      cues: ['Dos droit, pas rond.', 'Tourne les épaules, pas seulement les bras.', 'Plus dur : pieds décollés ou un poids en main.'],
      mistakes: ['Dos arrondi qui s’effondre.'],
      alt: ['bicycle_crunch', 'side_plank'],
      muscles: ['obliques', 'abdos'],
    },
    {
      id: 'leg_raise_floor', name: 'Relevés de jambes au sol', short: 'Relevés de jambes', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 40,
      defaultSets: 3, defaultReps: '10–15', defaultRest: 45, impact: 0,
      description: 'Sur le dos, jambes tendues, tu les montes à la verticale puis tu redescends sans toucher le sol.',
      cues: ['Mains sous les fesses si le bas du dos décolle.', 'Descente lente, bas du dos plaqué.', 'Genoux légèrement fléchis pour commencer.'],
      mistakes: ['Bas du dos qui se creuse.'],
      easier: ['reverse_crunch'], harder: ['hanging_knee_raise'], alt: ['dead_bug'],
      muscles: ['abdos', 'fléchisseurs de hanche'],
    },
    {
      id: 'flutter_kicks', name: 'Battements de jambes au sol', short: 'Battements au sol', cat: 'gainage',
      goals: ['ssa', 'general'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 30,
      defaultSets: 3, defaultReps: '30 s', defaultRest: 30, impact: 0,
      description: 'Sur le dos, jambes tendues décollées, petits battements alternés rapides, comme en crawl. Gainage et endurance des jambes pour la nage.',
      cues: ['Bas du dos plaqué (mains sous les fesses si besoin).', 'Petits battements, jambes tendues.', 'Plus facile : jambes plus hautes.'],
      mistakes: ['Dos creusé.'],
      easier: ['dead_bug'], alt: ['dead_bug'],
      muscles: ['abdos', 'fléchisseurs de hanche'],
    },
    {
      id: 'sit_up', name: 'Relevés de buste (sit-up)', short: 'Sit-up', cat: 'gainage',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['tapis'], track: 'reps', workSec: 40,
      defaultSets: 3, defaultReps: '15–20', defaultRest: 45, impact: 0, stress: ['dos'],
      description: 'Sur le dos, genoux pliés, tu te relèves jusqu’à la position assise puis tu redescends. Certaines épreuves de recrutement (marins-pompiers par exemple) comptent des abdominaux de ce type (protocole à vérifier).',
      cues: ['Pieds au sol, calés ou non selon le protocole.', 'Enroule le dos en montant, déroule en descendant.', 'Mains croisées sur la poitrine ou aux tempes, sans tirer.'],
      mistakes: ['Lancer les bras pour monter.', 'Tirer sur la nuque.'],
      easier: ['crunch'], alt: ['crunch', 'dead_bug'],
      muscles: ['abdos', 'fléchisseurs de hanche'],
    },
    {
      id: 'mountain_climber', name: 'Mountain climbers', cat: 'gainage',
      goals: ['hyrox', 'general'], locs: ['maison'], track: 'time', workSec: 30,
      defaultSets: 3, defaultReps: '30 s', defaultRest: 30, impact: 1, stress: ['poignet'],
      description: 'En planche bras tendus, tu ramènes les genoux vers la poitrine en alternance, rapidement. Cardio et gainage.',
      cues: ['Mains sous les épaules, bassin bas.', 'Genoux vers la poitrine, pieds légers.', 'Ralentis si le bassin rebondit.'],
      mistakes: ['Fesses qui montent.'],
      easier: ['plank'], alt: ['dead_bug', 'plank'],
      muscles: ['abdos', 'épaules', 'fléchisseurs de hanche'],
    },
    {
      id: 'hanging_knee_raise', name: 'Relevés de genoux à la barre', short: 'Relevés de genoux', cat: 'gainage',
      goals: ['general', 'pompier'], locs: ['maison'], equipment: ['barre'], track: 'reps',
      defaultSets: 3, defaultReps: '8–12', defaultRest: 60, impact: 0,
      description: 'Suspendu à la barre, tu remontes les genoux vers la poitrine en enroulant le bassin. Abdos et prise de main.',
      cues: ['Pas d’élan : jambes immobiles avant chaque répétition.', 'Enroule le bassin, genoux vers la poitrine.', 'Descente lente.'],
      mistakes: ['Se balancer.'],
      easier: ['leg_raise_floor'], harder: ['hanging_leg_raise'], alt: ['reverse_crunch'],
      muscles: ['abdos', 'avant-bras'],
    },
    {
      id: 'hanging_leg_raise', name: 'Relevés de jambes à la barre', short: 'Relevés jambes barre', cat: 'gainage',
      goals: ['general'], locs: ['maison'], equipment: ['barre'], track: 'reps',
      defaultSets: 3, defaultReps: '6–10', defaultRest: 75, impact: 0,
      description: 'Suspendu, tu montes les jambes tendues à l’horizontale ou plus haut. Version difficile des relevés de genoux.',
      cues: ['Aucun balancement.', 'Jambes tendues, au moins jusqu’à l’horizontale.', 'Descente lente.'],
      mistakes: ['Utiliser l’élan.'],
      easier: ['hanging_knee_raise'], alt: ['leg_raise_floor'],
      muscles: ['abdos', 'fléchisseurs de hanche', 'avant-bras'],
    },

    /* ═════ Prévention genou, cheville, épaule ═════ */
    {
      id: 'single_leg_balance', name: 'Équilibre sur une jambe', short: 'Équilibre 1 jambe', cat: 'prevention',
      goals: ['general', 'pompier', 'hyrox'], locs: ['maison'], track: 'time', workSec: 30, sides: true,
      defaultSets: 3, defaultReps: '30–45 s par jambe', defaultRest: 15, impact: 0,
      description: 'Tenir debout sur une jambe, genou légèrement fléchi. Le travail d’équilibre réduit nettement le risque d’entorse de cheville.',
      cues: ['Pied à plat, orteils détendus, genou légèrement fléchi.', 'Progression : yeux fermés, puis en tournant la tête, puis sur un coussin.', 'Astuce : fais-le pendant le brossage de dents.'],
      mistakes: ['Bloquer le genou en extension.'],
      easier: ['ankle_band'], harder: ['balance_cushion'],
      muscles: ['chevilles', 'moyen fessier'],
    },
    {
      id: 'balance_cushion', name: 'Équilibre sur surface instable', short: 'Équilibre instable', cat: 'prevention',
      goals: ['general', 'pompier', 'hyrox'], locs: ['maison'], equipment: ['coussin'], track: 'time', workSec: 30, sides: true,
      defaultSets: 3, defaultReps: '30 s par jambe', defaultRest: 15, impact: 0,
      description: 'Équilibre sur une jambe, sur un coussin ou une serviette pliée : la cheville travaille en permanence pour te stabiliser.',
      cues: ['Genou légèrement fléchi, regard fixe.', 'Plus dur : ajoute des mouvements de bras ou passe un objet d’une main à l’autre.'],
      mistakes: ['Surface trop instable dès le début.'],
      easier: ['single_leg_balance'], harder: ['balance_star'], alt: ['single_leg_balance'],
      muscles: ['chevilles', 'moyen fessier'],
    },
    {
      id: 'balance_star', name: 'Équilibre en étoile (Y-balance)', short: 'Équilibre en étoile', cat: 'prevention',
      goals: ['general', 'pompier', 'hyrox'], locs: ['maison'], track: 'reps', sides: true,
      defaultSets: 2, defaultReps: '5 touches par direction', defaultRest: 30, impact: 0,
      description: 'Sur une jambe, tu vas toucher le sol le plus loin possible avec l’autre pied : devant, en arrière à gauche, en arrière à droite. Équilibre et force de la cheville et du genou.',
      cues: ['Genou d’appui dans l’axe du pied.', 'Touche légère, sans prendre appui.', 'Note la distance atteinte pour suivre tes progrès.'],
      mistakes: ['Talon d’appui qui décolle.'],
      easier: ['balance_cushion'], alt: ['single_leg_balance'],
      muscles: ['chevilles', 'quadriceps', 'moyen fessier'],
    },
    {
      id: 'calf_raise_eccentric', name: 'Mollets excentriques sur une marche', short: 'Mollets excentriques', cat: 'prevention',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['step'], track: 'reps', sides: true,
      defaultSets: 3, defaultReps: '12–15 par jambe', defaultRest: 60, impact: 0,
      description: 'Monter sur deux pieds au bord d’une marche, puis redescendre lentement sur une seule jambe. Renforce le mollet et le tendon d’Achille.',
      cues: ['Monte à deux pieds, redescends en 3 à 4 s sur un pied.', 'Talon sous le niveau de la marche en bas.', 'Tiens-toi au mur pour l’équilibre.'],
      mistakes: ['Descente rapide.'],
      safety: ['Douleur du tendon acceptable jusqu’à 5/10 si elle revient à la normale le lendemain matin ; sinon, réduis.'],
      easier: ['calf_raise'], alt: ['soleus_raise'],
      muscles: ['mollets', 'tendon d’Achille'],
    },
    {
      id: 'soleus_raise', name: 'Mollets genoux fléchis (soléaire)', short: 'Mollets genoux fléchis', cat: 'prevention',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['step'], track: 'reps',
      defaultSets: 3, defaultReps: '15', defaultRest: 45, impact: 0,
      description: 'Montées sur la pointe des pieds genoux fléchis, assis ou en demi-squat : renforce le soléaire, très sollicité en course et au sled.',
      cues: ['Genoux fléchis à environ 45°.', 'Monte haut, descends lentement.', 'Ajoute un poids sur les cuisses quand c’est facile.'],
      mistakes: ['Rebondir.'],
      harder: ['calf_raise_eccentric'], alt: ['calf_raise'],
      muscles: ['mollets'],
    },
    {
      id: 'tibialis_raise', name: 'Relevés de pointe de pied (tibial)', short: 'Relevés de pointe', cat: 'prevention',
      goals: ['general'], locs: ['maison'], track: 'reps',
      defaultSets: 3, defaultReps: '15–20', defaultRest: 45, impact: 0,
      description: 'Dos contre un mur, talons en avant, tu relèves la pointe des pieds. Renforce l’avant de la jambe et stabilise la cheville.',
      cues: ['Fesses et dos au mur, talons à 30 cm du mur.', 'Relève les orteils au maximum, redescends lentement.'],
      mistakes: ['Décoller les fesses du mur.'],
      alt: ['ankle_band'],
      muscles: ['tibial antérieur'],
    },
    {
      id: 'ankle_band', name: 'Cheville à l’élastique (4 directions)', short: 'Cheville à l’élastique', cat: 'prevention',
      goals: ['general'], locs: ['maison'], equipment: ['elastiques'], track: 'reps', sides: true,
      defaultSets: 2, defaultReps: '15 par direction', defaultRest: 30, impact: 0,
      description: 'Assis jambe tendue, élastique autour du pied : tu pousses le pied vers le bas, vers le haut, vers l’intérieur et vers l’extérieur. Renforce tous les muscles qui tiennent la cheville.',
      cues: ['Élastique fixé (pied de table) ou tenu dans les mains.', 'Seule la cheville bouge, le genou reste immobile.', 'Lent : 2 s aller, 2 s retour.'],
      mistakes: ['Tourner la jambe au lieu du pied.'],
      harder: ['single_leg_balance'], alt: ['tibialis_raise'],
      muscles: ['chevilles', 'mollets', 'tibial antérieur'],
    },
    {
      id: 'ankle_knee_to_wall', name: 'Mobilité cheville genou-au-mur', short: 'Cheville genou au mur', cat: 'prevention',
      goals: ['general', 'hyrox', 'ssa'], locs: ['maison'], track: 'reps', sides: true,
      defaultSets: 2, defaultReps: '10 par jambe', defaultRest: 0, impact: 0,
      description: 'Pied face au mur, tu avances le genou pour toucher le mur sans décoller le talon. Améliore la flexion de cheville (squat, course, palmes).',
      cues: ['Talon collé au sol.', 'Genou dans l’axe du 2e orteil.', 'Recule le pied quand c’est facile ; note la distance.'],
      mistakes: ['Talon qui décolle.'],
      alt: ['stretch_calves'],
      muscles: ['chevilles', 'mollets'],
    },
    {
      id: 'spanish_squat', name: 'Squat espagnol isométrique (élastique)', short: 'Squat espagnol', cat: 'prevention',
      goals: ['general'], locs: ['maison'], equipment: ['elastiques'], track: 'time', workSec: 45,
      defaultSets: 4, defaultReps: '30–45 s', defaultRest: 60, impact: 0,
      description: 'Élastique solide derrière les genoux, accroché devant toi : tu t’assois en arrière, tibias verticaux, et tu tiens. Charge le genou en douceur, souvent bien toléré quand il est sensible.',
      cues: ['Élastique épais fixé à un point solide, à hauteur des genoux.', 'Recule pour tendre l’élastique, puis assieds-toi, tibias verticaux.', 'Douleur de 3/10 au maximum pendant l’exercice.'],
      mistakes: ['Élastique trop lâche : les genoux partent en avant.'],
      easier: ['tke_band'], harder: ['wall_sit'], alt: ['tke_band', 'glute_bridge'],
      muscles: ['quadriceps'],
    },
    {
      id: 'tke_band', name: 'Extension terminale du genou à l’élastique', short: 'Genou élastique (TKE)', cat: 'prevention',
      goals: ['general'], locs: ['maison'], equipment: ['elastiques'], track: 'reps', sides: true,
      defaultSets: 3, defaultReps: '15 par jambe', defaultRest: 30, impact: 0,
      description: 'Élastique derrière le genou, tu tends complètement la jambe contre la résistance. Réveille le quadriceps qui stabilise la rotule.',
      cues: ['Élastique fixé devant toi, à hauteur du genou.', 'Pars genou légèrement fléchi, tends-le complètement en serrant la cuisse.', 'Tiens 2 s.'],
      mistakes: ['Élastique trop faible.'],
      harder: ['spanish_squat'], alt: ['spanish_squat'],
      muscles: ['quadriceps'],
    },
    {
      id: 'step_down', name: 'Descente de marche contrôlée', short: 'Descente de marche', cat: 'prevention',
      goals: ['general', 'pompier'], locs: ['maison'], equipment: ['step'], track: 'reps', sides: true,
      defaultSets: 3, defaultReps: '8–10 par jambe', defaultRest: 60, impact: 0, stress: ['genou'],
      description: 'Debout sur une marche sur une jambe, tu descends lentement l’autre talon vers le sol puis tu remontes. Contrôle du genou en descente (escaliers, course).',
      cues: ['Genou d’appui dans l’axe du 2e orteil, sans rentrer.', 'Descente en 3 s, toucher léger du talon.', 'Commence avec une marche basse.'],
      mistakes: ['Genou qui part vers l’intérieur.', 'Bassin qui bascule.'],
      safety: [KNEE_SAFETY],
      easier: ['tke_band'], harder: ['step_up'], alt: ['spanish_squat', 'glute_bridge'],
      muscles: ['quadriceps', 'moyen fessier'],
    },
    {
      id: 'band_lateral_walk', name: 'Marche latérale à l’élastique', short: 'Marche latérale', cat: 'prevention',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['elastiques'], track: 'reps',
      defaultSets: 3, defaultReps: '10 pas par côté', defaultRest: 45, impact: 0,
      description: 'Élastique autour des genoux ou des chevilles, pas chassés en demi-squat. Renforce le moyen fessier, qui empêche le genou de rentrer vers l’intérieur.',
      cues: ['Demi-squat, dos droit, élastique tendu en permanence.', 'Petits pas, pieds parallèles.', 'Pousse les genoux vers l’extérieur.'],
      mistakes: ['Pieds qui se touchent : l’élastique se relâche.'],
      alt: ['glute_bridge'],
      muscles: ['moyen fessier'],
    },
    {
      id: 'nordic_hamstring', name: 'Nordic hamstring (assisté)', short: 'Nordic hamstring', cat: 'prevention',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['tapis'], track: 'reps',
      defaultSets: 3, defaultReps: '4–6', defaultRest: 120, impact: 0,
      description: 'À genoux, chevilles bloquées (meuble lourd ou partenaire), tu te penches lentement en avant en freinant avec l’arrière des cuisses. Réduit d’environ moitié les blessures des ischio-jambiers.',
      cues: ['Corps droit des genoux à la tête.', 'Descends le plus lentement possible, rattrape-toi avec les mains.', 'Pour commencer, aide-toi d’un élastique accroché devant toi.'],
      mistakes: ['Plier les hanches : fesses en arrière.'],
      safety: ['Fortes courbatures les premières fois : commence par 2 séries de 3.'],
      easier: ['leg_curl'], alt: ['leg_curl', 'glute_bridge'],
      muscles: ['ischios'],
    },
    {
      id: 'copenhagen_plank', name: 'Planche de Copenhague (adducteurs)', short: 'Planche Copenhague', cat: 'prevention',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['chaise'], track: 'time', workSec: 20, sides: true,
      defaultSets: 3, defaultReps: '15–30 s par côté', defaultRest: 45, impact: 0,
      description: 'Planche latérale avec la jambe du dessus posée sur une chaise ou un banc : renforce les adducteurs et protège l’aine et le genou.',
      cues: ['Version courte : genou du dessus sur la chaise (plus facile, moins de contrainte au genou).', 'Version longue : cheville sur la chaise.', 'Corps aligné, bassin haut.'],
      mistakes: ['Bassin qui tombe.'],
      safety: ['Genou sensible : reste en version courte, appui au genou.'],
      easier: ['side_plank'], alt: ['side_plank'],
      muscles: ['adducteurs', 'obliques'],
    },
    {
      id: 'band_external_rotation', name: 'Rotation externe à l’élastique', short: 'Rotation externe', cat: 'prevention',
      goals: ['ssa', 'hyrox', 'general'], locs: ['maison'], equipment: ['elastiques'], track: 'reps', sides: true,
      defaultSets: 3, defaultReps: '15 par bras', defaultRest: 30, impact: 0,
      description: 'Coude collé au corps et plié à 90°, tu tournes l’avant-bras vers l’extérieur contre l’élastique. Renforce la coiffe des rotateurs : 2 fois par semaine quand tu nages et tires beaucoup.',
      cues: ['Serviette roulée entre le coude et le corps.', 'L’avant-bras tourne, le coude reste immobile.', 'Élastique léger : 2 s aller, 2 s retour.'],
      mistakes: ['Coude qui s’écarte du corps.'],
      alt: ['band_face_pull'],
      muscles: ['coiffe des rotateurs'],
    },

    /* ═════ Mobilité / souplesse ═════ */
    {
      id: 'mob_hips', name: 'Mobilité hanches (90/90)', short: 'Hanches 90/90', cat: 'mobilite',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['tapis'], track: 'check',
      defaultSets: 1, defaultReps: '2–3 min', defaultRest: 0, impact: 0,
      description: 'Assis au sol, une jambe pliée à 90° devant toi et l’autre à 90° sur le côté, tu passes d’un côté à l’autre. Assouplit la rotation des hanches.',
      cues: ['Buste droit, mains au sol derrière toi si besoin.', 'Bascule les genoux d’un côté à l’autre, lentement.', 'Penche-toi sur la jambe avant pour étirer.'],
      mistakes: ['Forcer sur un genou douloureux.'],
      safety: ['Genou sensible : réduis l’angle ou fais l’exercice allongé.'],
      alt: ['worlds_greatest_stretch'],
    },
    {
      id: 'mob_thoracic', name: 'Mobilité thoracique', cat: 'mobilite',
      goals: ['ssa', 'hyrox', 'general'], locs: ['maison'], equipment: ['tapis'], track: 'check',
      defaultSets: 1, defaultReps: '10 par côté', defaultRest: 0, impact: 0,
      description: 'Rotations du haut du dos, allongé sur le côté (« livre ouvert ») ou à quatre pattes. Améliore la respiration en crawl et la position bras au-dessus de la tête.',
      cues: ['Livre ouvert : allongé sur le côté, genoux pliés, ouvre le bras du dessus vers l’arrière.', 'Suis ta main du regard.', 'Garde les genoux collés au sol.'],
      mistakes: ['Tourner le bassin en même temps que les épaules.'],
      alt: ['worlds_greatest_stretch'],
    },
    {
      id: 'mob_shoulders', name: 'Mobilité épaules', cat: 'mobilite',
      goals: ['ssa', 'general'], locs: ['maison'], equipment: ['elastiques'], track: 'check',
      defaultSets: 1, defaultReps: '2–3 min', defaultRest: 0, impact: 0,
      description: 'Cercles de bras, passages d’un élastique par-dessus la tête et ouverture de la poitrine, avant et après la natation.',
      cues: ['Mouvements amples et lents.', 'Élastique tenu large, bras tendus : passe derrière puis devant.', 'Jamais de douleur.'],
      mistakes: ['Prise trop serrée pour les passages.'],
      alt: ['band_warmup'],
    },
    {
      id: 'stretch_hamstrings', name: 'Étirement ischios (flexion avant)', short: 'Étirement ischios', cat: 'mobilite',
      goals: ['pompier', 'general'], locs: ['maison'], track: 'time', workSec: 30,
      defaultSets: 2, defaultReps: '30–45 s', defaultRest: 15, impact: 0,
      description: 'Jambes tendues, buste penché vers l’avant à partir des hanches. Entretient la souplesse mesurée par l’épreuve des ICP.',
      cues: ['Penche-toi dos plat, à partir des hanches.', 'Étirement modéré, jamais de douleur.', 'Respire lentement, relâche à l’expiration.'],
      mistakes: ['Faire des à-coups.'],
      harder: ['sit_and_reach'], alt: ['mob_hips'],
      muscles: ['ischios'],
    },
    {
      id: 'sit_and_reach', name: 'Souplesse : flexion avant jambes tendues (mesure)', short: 'Souplesse (mesure)', cat: 'mobilite',
      goals: ['pompier'], locs: ['maison'], equipment: ['regle'], track: 'cm', bench: 'sit_reach',
      defaultSets: 1, defaultReps: '3 essais, le meilleur compte', defaultRest: 30, impact: 0,
      description: 'Assis jambes tendues, plante des pieds contre une boîte ou une marche, tu pousses une règle le plus loin possible. C’est l’épreuve de souplesse des ICP pompiers.',
      cues: ['Échauffe-toi avant (5 min et étirements doux).', 'Genoux tendus, mains superposées, poussée lente.', 'Au protocole ICP, toucher tes orteils vaut 15 cm (zéro placé 15 cm avant les pieds, à confirmer).', 'Garde toujours la même référence de mesure.'],
      mistakes: ['À-coup pour gagner quelques centimètres.', 'Genoux qui se plient.'],
      easier: ['stretch_hamstrings'], alt: ['stretch_hamstrings'],
      muscles: ['ischios', 'lombaires'],
    },
    {
      id: 'stretch_hip_flexors', name: 'Étirement fléchisseurs de hanche', short: 'Étirement psoas', cat: 'mobilite',
      goals: ['general', 'hyrox'], locs: ['maison'], equipment: ['tapis'], track: 'time', workSec: 30, sides: true,
      defaultSets: 2, defaultReps: '30–45 s par côté', defaultRest: 0, impact: 0,
      description: 'En fente basse, genou arrière au sol, tu avances le bassin en serrant le fessier. Utile quand on passe la journée assis.',
      cues: ['Genou arrière sur un coussin.', 'Serre le fessier du côté du genou au sol, bassin rentré.', 'Avance légèrement, buste droit.'],
      mistakes: ['Cambrer le bas du dos.'],
      safety: ['Genou sensible : coussin épais, ou étirement debout.'],
      alt: ['worlds_greatest_stretch'],
      muscles: ['fléchisseurs de hanche'],
    },
    {
      id: 'stretch_calves', name: 'Étirement mollets', cat: 'mobilite',
      goals: ['general', 'hyrox', 'ssa'], locs: ['maison'], track: 'time', workSec: 30, sides: true,
      defaultSets: 2, defaultReps: '30 s par jambe, genou tendu puis fléchi', defaultRest: 0, impact: 0,
      description: 'Mains au mur, une jambe en arrière talon au sol : genou tendu pour le mollet, puis genou fléchi pour le soléaire.',
      cues: ['Talon arrière collé au sol.', 'Pied arrière bien droit.', '30 s genou tendu, puis 30 s genou fléchi.'],
      mistakes: ['Pied arrière tourné vers l’extérieur.'],
      alt: ['ankle_knee_to_wall'],
      muscles: ['mollets'],
    },
    {
      id: 'worlds_greatest_stretch', name: 'Grand étirement dynamique', short: 'Grand étirement', cat: 'mobilite',
      goals: ['general', 'hyrox', 'pompier'], locs: ['maison'], track: 'check',
      defaultSets: 1, defaultReps: '5 par côté', defaultRest: 0, impact: 0,
      description: 'Fente avant, main au sol, rotation du buste bras vers le ciel, puis bascule sur la jambe arrière : hanches, dos et chevilles mobilisés en une minute. Idéal à l’échauffement.',
      cues: ['Fente longue, genou arrière décollé ou posé.', 'Coude vers le pied avant, puis rotation bras vers le plafond.', 'Lent : respire à chaque position.'],
      mistakes: ['Aller trop vite.'],
      safety: ['Genou sensible : genou arrière posé sur un coussin.'],
      alt: ['mob_hips'],
    },
    {
      id: 'foam_roll', name: 'Rouleau de massage', cat: 'mobilite',
      goals: ['general'], locs: ['maison', 'salle'], equipment: ['rouleau'], track: 'check',
      defaultSets: 1, defaultReps: '5 min', defaultRest: 0, impact: 0,
      description: 'Auto-massage au rouleau sur les cuisses, les mollets et le dos. Aide à se sentir moins raide ; à faire en douceur.',
      cues: ['30 à 60 s par zone, roulement lent.', 'Pression modérée, respiration calme.', 'Évite les articulations et le bas du dos.'],
      mistakes: ['Appuyer très fort sur une zone douloureuse.'],
      alt: ['stretch_calves'],
    },

    /* ═════ Tests maison / salle (ICP) ═════ */
    {
      id: 'test_pullup_max', name: 'Tractions max (pronation)', short: 'Tractions max', cat: 'test',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['barre'], track: 'reps', bench: 'pullups',
      defaultSets: 1, defaultReps: 'max', defaultRest: 0, impact: 0,
      description: 'Nombre maximum de tractions strictes paumes vers l’avant, sans élan, en une série. À refaire environ toutes les 4 semaines.',
      cues: ['Échauffement : suspension et 2 séries faciles.', 'Bras tendus en bas, menton au-dessus de la barre en haut.', 'Seules les répétitions complètes comptent.'],
      mistakes: ['Élan des jambes (kipping).'],
      easier: ['pullup_strict'], alt: ['test_chinup_max'],
    },
    {
      id: 'test_chinup_max', name: 'Tractions max (supination, ICP)', short: 'Supination max (ICP)', cat: 'test',
      goals: ['pompier'], locs: ['maison'], equipment: ['barre'], track: 'reps', bench: 'chinups',
      defaultSets: 1, defaultReps: 'max', defaultRest: 0, impact: 0,
      description: 'Nombre maximum de tractions paumes vers toi selon le protocole ICP : départ bras tendus, menton au-dessus de la barre, pas de pause de plus de 3 s.',
      cues: ['Échauffement : suspension et 2 séries faciles.', 'Bras complètement tendus à chaque répétition.', 'Le test s’arrête à la première pause de plus de 3 s.'],
      mistakes: ['Demi-répétitions.'],
      easier: ['chinup_strict'], alt: ['test_pullup_max'],
    },
    {
      id: 'test_pushup_max', name: 'Pompes max', short: 'Pompes max (cadence)', cat: 'test',
      goals: ['pompier', 'general'], locs: ['maison'], track: 'reps', bench: 'pushups',
      defaultSets: 1, defaultReps: 'max à la cadence', defaultRest: 0, impact: 0, stress: ['poignet', 'epaule'],
      description: 'Nombre maximum de pompes à la cadence imposée (environ une toutes les 2 s), comme l’épreuve des ICP : le test s’arrête quand tu décroches du rythme. Le protocole exact varie selon le SDIS (à confirmer).',
      cues: ['Métronome ou bip toutes les 2 s : descends et remonte au rythme.', 'Poitrine à environ 5 cm du sol, bras tendus en haut.', 'Corps gainé du début à la fin.'],
      mistakes: ['Prendre de l’avance sur le bip puis attendre en haut.', 'Amplitude qui diminue sur la fin.'],
      easier: ['pushup_cadence'], alt: ['pushup_cadence'],
    },
    {
      id: 'test_plank_max', name: 'Planche max', cat: 'test',
      goals: ['pompier', 'general'], locs: ['maison'], equipment: ['tapis'], track: 'time', bench: 'plank',
      defaultSets: 1, defaultReps: 'max', defaultRest: 0, impact: 0,
      description: 'Durée maximale en planche selon le protocole ICP : avant-bras et orteils, pieds écartés d’environ 10 cm, corps aligné.',
      cues: ['Le test s’arrête quand le bassin monte ou s’affaisse.', 'Fais-toi surveiller ou filme-toi.', 'Respire normalement.'],
      mistakes: ['Continuer en position dégradée.'],
      easier: ['plank_icp'], alt: ['plank'],
    },
    {
      id: 'test_wall_sit_max', name: 'Chaise max (Killy)', cat: 'test',
      goals: ['pompier'], locs: ['maison'], track: 'time', bench: 'wall_sit',
      defaultSets: 1, defaultReps: 'max', defaultRest: 0, impact: 0, stress: ['genou'],
      description: 'Durée maximale en chaise contre le mur, cuisses à 90°, comme l’épreuve Killy des ICP.',
      cues: ['Dos plaqué au mur, cuisses à 90°, genoux au-dessus des chevilles.', 'Bras le long du corps, sans appui sur les cuisses.', 'Le test s’arrête quand tu te relèves ou poses les mains.'],
      mistakes: ['Mains sur les cuisses.', 'Angle trop ouvert (cuisses trop hautes).'],
      safety: ['Arrête si la douleur au genou dépasse 3/10.'],
      easier: ['wall_sit'], alt: ['spanish_squat'],
    },
  ];

  /* ───────── Normalisation ───────── */

  const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
  const intIn = (v, lo, hi, dflt) => { const n = U.num(v); return n == null ? dflt : U.clamp(Math.round(n), lo, hi); };

  // Met n'importe quel objet à la forme du contrat (champs garantis, enums valides).
  // Utilisé pour la bibliothèque et pour les exercices perso (sans jamais jeter).
  function normalizeExercise(raw, opts = {}) {
    const o = U.isObj(raw) ? raw : {};
    const name = String(o.name ?? '').trim().slice(0, 80) || 'Exercice';
    let short = String(o.short ?? '').trim() || name;
    if (short.length > 22) short = short.slice(0, 21).trimEnd() + '…';
    const goals = strList(o.goals).filter((g) => GOALS.includes(g));
    const locs = strList(o.locs).filter((l) => LOCS.includes(l));
    const ex = {
      id: String(o.id ?? ''),
      name,
      short,
      cat: EXERCISE_CATS[o.cat] ? o.cat : 'force',
      goals: goals.length ? goals : ['general'],
      locs: locs.length ? locs : ['maison'],
      equipment: strList(o.equipment),
      track: TRACKS[o.track] ? o.track : 'reps',
      defaultSets: intIn(o.defaultSets, 1, 30, 3),
      defaultReps: String(o.defaultReps ?? '').slice(0, 80),
      defaultRest: intIn(o.defaultRest, 0, 1800, 60),
      impact: [0, 1, 2].includes(o.impact) ? o.impact : 0,
      stress: strList(o.stress).filter((z) => STRESS_ZONES.includes(z)),
      apnea: o.apnea === true,
      description: String(o.description ?? '').slice(0, 1000),
      cues: strList(o.cues),
      mistakes: strList(o.mistakes),
      safety: strList(o.safety),
      easier: strList(o.easier),
      harder: strList(o.harder),
      alt: strList(o.alt),
      muscles: strList(o.muscles),
    };
    if (o.bench) ex.bench = String(o.bench);
    const work = U.num(o.workSec);
    if (work) ex.workSec = U.clamp(Math.round(work), 5, 600);
    if (o.sides === true) ex.sides = true;
    if (opts.custom) ex.custom = true;
    return ex;
  }

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
  }

  const exercises = deepFreeze(RAW.map((r) => normalizeExercise(r)));
  const BY_ID = new Map(exercises.map((e) => [e.id, e]));
  deepFreeze(EXERCISE_CATS); deepFreeze(EQUIPMENT); deepFreeze(TRACKS);

  /* ───────── Accès ───────── */

  // Exercices perso de l'utilisateur (C.state.customExercises), normalisés.
  function customExercises() {
    const list = C.state && Array.isArray(C.state.customExercises) ? C.state.customExercises : [];
    return list.filter((e) => U.isObj(e) && e.id && e.name).map((e) => normalizeExercise(e, { custom: true }));
  }

  // Bibliothèque d'abord, puis exercices perso. null si inconnu.
  function getExercise(id) {
    if (id == null || id === '') return null;
    const key = String(id);
    if (BY_ID.has(key)) return BY_ID.get(key);
    const list = C.state && Array.isArray(C.state.customExercises) ? C.state.customExercises : [];
    const raw = list.find((e) => U.isObj(e) && String(e.id) === key && e.name);
    return raw ? normalizeExercise(raw, { custom: true }) : null;
  }

  // Nom lisible même pour un identifiant inconnu (historique v1, exercice perso supprimé).
  function exerciseName(id, opts = {}) {
    const ex = getExercise(id);
    if (ex) return opts.short ? ex.short : ex.name;
    const s = String(id ?? '');
    const v1 = s.startsWith('v1:') && C.legacyV1 && C.legacyV1.exercises && C.legacyV1.exercises[s.slice(3)];
    if (v1) return v1[0];
    return s.replace(/^(v1:|perso:)/, '').replace(/_/g, ' ') || 'Exercice';
  }

  // Exercice faisable avec ce matériel ? (le matériel « courant » est toujours considéré présent)
  function isDoable(ex, available) {
    if (!ex) return false;
    const have = new Set(Array.isArray(available) ? available : []);
    return (ex.equipment || []).every((it) => have.has(it) || (EQUIPMENT[it] && EQUIPMENT[it].common));
  }

  // Lieu : un exercice « maison » reste faisable en salle si son matériel y est présent.
  function fitsLoc(ex, loc, strict) {
    if (ex.locs.includes(loc)) return true;
    if (strict || loc !== 'salle' || !ex.locs.includes('maison')) return false;
    return ex.equipment.every((it) => EQUIPMENT[it] && (EQUIPMENT[it].gym || EQUIPMENT[it].common));
  }

  /* ───────── Recherche ───────── */

  // Texte comparable : minuscules, sans accents ni ligatures, apostrophes unifiées.
  const fold = (s) => U.normalize(s).replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[’‘`´]/g, '\'');
  // « tractions » → « traction » : le pluriel ne doit pas empêcher de trouver.
  const stem = (t) => (t.length > 3 && /[sx]$/.test(t) ? t.slice(0, -1) : t);
  const tokensOf = (q) => fold(q).split(/[^a-z0-9]+/).filter((t) => t.length >= 2).map(stem);

  function haystackOf(ex) {
    return {
      title: fold([ex.name, ex.short, ex.id.replace(/_/g, ' ')].join(' ')),
      tags: fold([...ex.muscles, ...ex.equipment.map((it) => (EQUIPMENT[it] ? EQUIPMENT[it].label : it)),
        EXERCISE_CATS[ex.cat] ? EXERCISE_CATS[ex.cat].label : '', ...ex.goals.map((g) => GOAL_LABELS[g] || g)].join(' ')),
      text: fold([ex.description, ...ex.cues, ...ex.mistakes].join(' ')),
    };
  }
  const HAY = new Map(exercises.map((e) => [e.id, haystackOf(e)]));

  // Score de pertinence (0 = un mot cherché est absent). Titre (début de mot > milieu) > muscles/matériel/catégorie > texte.
  // tokens : [{ t, wordStart: RegExp }] préparés une fois par recherche.
  function scoreOf(hay, tokens) {
    let score = 0;
    for (const { t, wordStart } of tokens) {
      if (hay.title.includes(t)) score += wordStart.test(hay.title) ? 8 : 5;
      else if (hay.tags.includes(t)) score += 2;
      else if (hay.text.includes(t)) score += 1;
      else return 0;
    }
    return score;
  }

  const asList = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);

  // Filtres : q (texte libre, sans accents), goal, loc, cat (valeur ou liste), lowImpact (impact < 2),
  // equipment (utilise au moins un de ces matériels), available (faisable avec ce matériel), track,
  // includeCustom (défaut true, exercices perso en premier), strictLoc (désactive « maison → salle »).
  function searchExercises(opts = {}) {
    const o = U.isObj(opts) ? opts : {};
    const goals = asList(o.goal), cats = asList(o.cat), equip = asList(o.equipment), tracks = asList(o.track);
    const custom = o.includeCustom === false ? [] : customExercises();
    let list = [...custom, ...exercises];
    if (goals.length) list = list.filter((e) => e.goals.some((g) => goals.includes(g)));
    if (cats.length) list = list.filter((e) => cats.includes(e.cat));
    if (o.loc) list = list.filter((e) => fitsLoc(e, o.loc, !!o.strictLoc));
    if (o.lowImpact) list = list.filter((e) => e.impact < 2);
    if (equip.length) list = list.filter((e) => e.equipment.some((it) => equip.includes(it)));
    if (Array.isArray(o.available)) list = list.filter((e) => isDoable(e, o.available));
    if (tracks.length) list = list.filter((e) => tracks.includes(e.track));
    const tokens = (o.q ? tokensOf(o.q) : []).map((t) => ({ t, wordStart: new RegExp('(^|[^a-z0-9])' + t) }));
    if (!tokens.length) return list;
    return list
      .map((e, i) => ({ e, i, s: scoreOf(HAY.get(e.id) || haystackOf(e), tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.e);
  }

  /* ───────── Alternatives et progressions ───────── */

  // Premier remplacement qui respecte les contraintes, en suivant l'ordre de `alt`
  // puis les remplacements des remplacements. opts : { maxImpact, avoid:[zones], noApnea, available }.
  // Si aucun ne respecte `avoid`, renvoie le premier qui respecte le reste. → id ou null.
  function findAlternative(id, opts = {}) {
    const ex = getExercise(id);
    if (!ex) return null;
    const maxImpact = opts.maxImpact == null ? 2 : opts.maxImpact;
    const avoid = asList(opts.avoid);
    const seen = new Set([ex.id]);
    const candidates = [];
    const queue = [...ex.alt];
    while (queue.length && candidates.length < 30) {
      const cid = queue.shift();
      if (seen.has(cid)) continue;
      seen.add(cid);
      const c = getExercise(cid);
      if (!c) continue;
      candidates.push(c);
      queue.push(...c.alt);
    }
    const base = (c) => c.impact <= maxImpact && !(opts.noApnea && c.apnea) && (!Array.isArray(opts.available) || isDoable(c, opts.available));
    const best = candidates.find((c) => base(c) && !c.stress.some((z) => avoid.includes(z))) || candidates.find(base);
    return best ? best.id : null;
  }

  // Échelle de progression contenant l'exercice, du plus facile au plus dur
  // (suit easier[0] vers le bas et harder[0] vers le haut).
  function progressionChain(id) {
    const ex = getExercise(id);
    if (!ex) return [];
    const seen = new Set([ex.id]);
    const down = [];
    for (let cur = ex; cur && cur.easier[0] && !seen.has(cur.easier[0]);) {
      seen.add(cur.easier[0]); down.unshift(cur.easier[0]); cur = getExercise(cur.easier[0]);
    }
    const up = [];
    for (let cur = ex; cur && cur.harder[0] && !seen.has(cur.harder[0]);) {
      seen.add(cur.harder[0]); up.push(cur.harder[0]); cur = getExercise(cur.harder[0]);
    }
    return [...down, ex.id, ...up];
  }

  // Crée un exercice perso valide (id « perso:… »), à partir d'une saisie ou d'une copie d'un exercice.
  function makeCustomExercise(input = {}) {
    const o = U.isObj(input) ? U.clone(input) : {};
    const id = typeof o.id === 'string' && o.id.startsWith(CUSTOM_PREFIX) ? o.id : CUSTOM_PREFIX + U.uid();
    const ex = normalizeExercise({ ...o, id }, { custom: true });
    delete ex.bench; // un exercice perso n'alimente pas les tests de référence officiels
    ex.createdAt = U.todayKey();
    return ex;
  }

  /* ───────── Circuits chronométrés (abdos / gainage, voix) ───────── */

  // Circuits prêts à lancer dans le chrono (voix activée). sec = durée de travail de l'exercice.
  const ABS_CIRCUITS = [
    {
      id: 'abdos_decouverte', name: 'Abdos découverte', level: 'débutant', rounds: 2, restSec: 20, restBetweenRoundsSec: 60,
      items: [{ exId: 'dead_bug', sec: 40 }, { exId: 'plank', sec: 30 }, { exId: 'crunch', sec: 40 },
        { exId: 'side_plank_knee', sec: 25 }, { exId: 'bird_dog', sec: 40 }, { exId: 'reverse_crunch', sec: 30 }],
    },
    {
      id: 'abdos_classique', name: 'Abdos classique', level: 'intermédiaire', rounds: 2, restSec: 15, restBetweenRoundsSec: 60,
      items: [{ exId: 'plank', sec: 45 }, { exId: 'bicycle_crunch', sec: 40 }, { exId: 'side_plank', sec: 30 },
        { exId: 'reverse_crunch', sec: 40 }, { exId: 'hollow_hold', sec: 30 }, { exId: 'russian_twist', sec: 40 },
        { exId: 'flutter_kicks', sec: 30 }],
    },
    {
      id: 'abdos_express', name: 'Abdos express', level: 'tous niveaux', rounds: 1, restSec: 10, restBetweenRoundsSec: 0,
      items: [{ exId: 'mountain_climber', sec: 30 }, { exId: 'plank', sec: 40 }, { exId: 'bicycle_crunch', sec: 30 },
        { exId: 'side_plank', sec: 25 }, { exId: 'hollow_hold', sec: 25 }, { exId: 'reverse_crunch', sec: 30 },
        { exId: 'flutter_kicks', sec: 30 }],
    },
    {
      id: 'gainage_icp', name: 'Gainage ICP', level: 'pompier', rounds: 2, restSec: 20, restBetweenRoundsSec: 90,
      items: [{ exId: 'plank_icp', sec: 60 }, { exId: 'side_plank', sec: 40 }, { exId: 'superman', sec: 30 },
        { exId: 'dead_bug', sec: 40 }, { exId: 'plank_shoulder_tap', sec: 30 }],
    },
  ];

  // Construit une séquence pour C.timer.open(spec) à partir d'un circuit (id ou objet) ou d'une liste
  // d'exercices (ids ou { exId, sec }). Les exercices unilatéraux (sides) donnent un côté gauche puis droit.
  function circuitSpec(input, opts = {}) {
    const preset = typeof input === 'string' ? ABS_CIRCUITS.find((c) => c.id === input)
      : Array.isArray(input) ? { name: 'Circuit', items: input } : (U.isObj(input) ? input : null);
    if (!preset || !Array.isArray(preset.items)) return null;
    const restSec = Math.max(0, Math.round(opts.restSec ?? preset.restSec ?? 20));
    const steps = [];
    for (const it of preset.items) {
      const exId = typeof it === 'string' ? it : it && it.exId;
      const ex = getExercise(exId);
      if (!ex) continue;
      const sec = Math.max(5, Math.round((it && it.sec) || opts.workSec || ex.workSec || 40));
      const label = ex.short || ex.name;
      const sides = ex.sides ? ['côté gauche', 'côté droit'] : [null];
      sides.forEach((side, k) => {
        if (k > 0) steps.push({ label: 'Change de côté', sec: 5, kind: 'rest' });
        else if (steps.length && restSec) steps.push({ label: 'Repos', sec: restSec, kind: 'rest' });
        steps.push({ label: side ? `${label}, ${side}` : label, sec, kind: 'work', exId: ex.id });
      });
    }
    if (!steps.length) return null;
    return {
      name: opts.name || preset.name || 'Circuit',
      voice: opts.voice ?? true,
      prepSec: Math.max(0, Math.round(opts.prepSec ?? preset.prepSec ?? 10)),
      rounds: Math.max(1, Math.round(opts.rounds ?? preset.rounds ?? 1)),
      restBetweenRoundsSec: Math.max(0, Math.round(opts.restBetweenRoundsSec ?? preset.restBetweenRoundsSec ?? 60)),
      steps,
    };
  }

  // Durée totale d'une séquence (s) : préparation + tours + repos entre les tours.
  function circuitDuration(spec) {
    if (!spec || !Array.isArray(spec.steps)) return 0;
    const round = spec.steps.reduce((a, s) => a + (s.sec || 0), 0);
    const rounds = spec.rounds || 1;
    return (spec.prepSec || 0) + round * rounds + (spec.restBetweenRoundsSec || 0) * (rounds - 1);
  }

  for (const c of ABS_CIRCUITS) c.minutes = Math.round(circuitDuration(circuitSpec(c)) / 60);
  deepFreeze(ABS_CIRCUITS);

  /* ───────── Exposition ───────── */

  C.data = C.data || {};
  Object.assign(C.data, {
    exercises, getExercise, searchExercises, EXERCISE_CATS, EQUIPMENT, TRACKS,
    EXERCISE_GOALS: GOALS, EXERCISE_LOCS: LOCS, STRESS_ZONES, CUSTOM_PREFIX,
    exerciseName, customExercises, isDoable, findAlternative, progressionChain,
    normalizeExercise, makeCustomExercise, absCircuits: ABS_CIRCUITS, circuitSpec, circuitDuration,
  });
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
