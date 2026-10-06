/* Crevare — modèles d'objectifs (SSA, HYROX, pompier, Protection civile, perso), jalons et démarches,
 * courses HYROX connues, standards HYROX par division et check-lists du jour J.
 * Données statiques + fonctions pures, sans DOM. Les dates et la billetterie viennent de
 * docs/recherche-2026-10.md : toujours affichées « à vérifier ». Aucune donnée personnelle en dur :
 * les choix de l'utilisateur passent par `overrides` (questionnaire de départ, écran Objectifs). */
(function (C) {
  'use strict';
  const U = C.util;
  const D = (C.data = C.data || {});

  /* ───────── Courses HYROX connues (saison 26/27) ───────── */

  const HX = {
    roxradar: 'https://www.roxradar.com/hyrox-france',
    parisFp: 'https://france.hyrox.com/event/hyrox-paris-season-26-27-hfkuj6',
    toulouse: 'https://hyrox.com/event/hyrox-toulouse-s26-27/',
    parisGp: 'https://hyrox.com/event/hyrox-paris-grand-palais-s26-27/',
    lyon: 'https://hyrox.com/event/hyrox-lyon-s26-27/',
    calendar: 'https://roxlyfe.com/2026-27-calendar-expands/',
    worlds: 'https://hybridfitnessmedia.com/2026/06/18/hyrox-2027-world-championships-hong-kong/',
    rulesDoubles: 'https://hyroxfrance.com/wp-content/uploads/2026/07/26_27_HYROX_RulebookDoubles_FR_210726.pdf',
    rulesSingles: 'https://hyroxfrance.com/wp-content/uploads/2026/07/26_27_HYROX_RulebookSingles_FR_210726.pdf',
  };

  // ticketStatus : état de la billetterie à la date checkedAt (toujours à revérifier avant de compter dessus).
  const hyroxEvents = [
    { id: 'nice-2026', name: 'HYROX Nice', city: 'Nice', venue: '', country: 'France', start: '2026-10-29', end: '2026-11-01',
      ticketStatus: 'Billets en vente', checkedAt: '2026-10-06', source: HX.roxradar, confidence: 'moyenne' },
    { id: 'paris-fp-2026', name: 'FITNESS PARK HYROX Paris', city: 'Paris', venue: 'Paris Expo Porte de Versailles', country: 'France',
      start: '2026-12-12', end: '2026-12-20', note: '12-13 puis 16-20 décembre.', ticketStatus: 'Complet', checkedAt: '2026-10-06', source: HX.parisFp, confidence: 'moyenne' },
    { id: 'toulouse-2027', name: 'HYROX Toulouse', city: 'Toulouse', venue: 'MEETT', country: 'France', start: '2027-02-03', end: '2027-02-07',
      note: 'Une source parle de mars : date non confirmée.', ticketStatus: 'À vérifier', checkedAt: '2026-10-06', source: HX.toulouse, confidence: 'faible' },
    { id: 'paris-gp-2027', name: 'HYROX Paris Grand Palais', city: 'Paris', venue: 'Grand Palais', country: 'France', start: '2027-04-08', end: '2027-04-12',
      ticketStatus: "Billetterie pas ouverte (liste d'attente)", checkedAt: '2026-09-22', source: HX.parisGp, confidence: 'moyenne' },
    { id: 'lyon-2027', name: 'HYROX Lyon', city: 'Lyon', venue: 'Eurexpo', country: 'France', start: '2027-05-12', end: '2027-05-16',
      ticketStatus: 'Page officielle en ligne, billets pas encore en vente', checkedAt: '2026-10-06', source: HX.lyon, confidence: 'moyenne' },
    { id: 'cracovie-2027', name: 'HYROX Cracovie', city: 'Cracovie', venue: '', country: 'Pologne', start: '2027-05-07', end: '2027-05-09',
      ticketStatus: 'À vérifier', checkedAt: '2026-10-06', source: HX.calendar, confidence: 'moyenne' },
    { id: 'cardiff-2027', name: 'HYROX Cardiff', city: 'Cardiff', venue: '', country: 'Royaume-Uni', start: '2027-05-20', end: '2027-05-29',
      ticketStatus: 'À vérifier', checkedAt: '2026-10-06', source: HX.calendar, confidence: 'moyenne' },
    { id: 'rimini-2027', name: 'HYROX Rimini', city: 'Rimini', venue: '', country: 'Italie', start: '2027-05-27', end: '2027-05-30',
      ticketStatus: 'À vérifier', checkedAt: '2026-10-06', source: HX.calendar, confidence: 'moyenne' },
    { id: 'riga-2027', name: 'HYROX Riga', city: 'Riga', venue: '', country: 'Lettonie', start: '2027-05-28', end: '2027-05-30',
      ticketStatus: 'À vérifier', checkedAt: '2026-10-06', source: HX.calendar, confidence: 'moyenne' },
    { id: 'hong-kong-2027', name: 'Championnats du monde HYROX', city: 'Hong Kong', venue: '', country: 'Chine', start: '2027-06-10', end: '2027-06-13',
      ticketStatus: 'Sur qualification', checkedAt: '2026-10-06', source: HX.worlds, confidence: 'moyenne', qualifOnly: true,
      note: 'Fin de la saison 26/27. Aucune course trouvée en juin-juillet 2027 en Europe ; la saison 27/28 reprendrait vers septembre.' },
  ];
  hyroxEvents.sort((a, b) => a.start.localeCompare(b.start));
  // Jour par défaut : le samedi de l'événement (le jour exact dépend de ton billet).
  for (const ev of hyroxEvents) {
    ev.defaultDay = U.range(ev.start, ev.end).find((k) => U.dow(k) === 5) || ev.start;
    ev.label = `${ev.name}${ev.venue ? ` — ${ev.venue}` : ''}`;
  }
  const hyroxEvent = (id) => hyroxEvents.find((e) => e.id === id) || null;
  // Courses à venir (au moins `minDays` jours avant le jour par défaut), dans l'ordre chronologique.
  function upcomingHyroxEvents(today, opts = {}) {
    const t = U.isKey(today) ? today : U.todayKey();
    const min = opts.minDays || 0;
    return hyroxEvents
      .filter((e) => !e.qualifOnly && U.daysBetween(t, e.defaultDay) >= min && (!opts.country || e.country === opts.country))
      .sort((a, b) => a.defaultDay.localeCompare(b.defaultDay));
  }

  /* ───────── Standards HYROX (charges 26/27, inchangées d'après les sites tiers) ───────── */

  const LOADS = {
    'men-open': { label: 'Hommes Open', sledPushKg: 152, sledPullKg: 103, farmersKg: 24, sandbagKg: 20, wallBallKg: 6, wallBallTargetM: 3, wallBallReps: 100 },
    'women-open': { label: 'Femmes Open', sledPushKg: 102, sledPullKg: 78, farmersKg: 16, sandbagKg: 10, wallBallKg: 4, wallBallTargetM: 2.7, wallBallReps: 100,
      uncertain: { wallBallReps: 'Certaines sources parlent de 75 répétitions depuis 25/26 : à vérifier dans le règlement.' } },
    'women-pro': { label: 'Femmes Pro', sledPushKg: 152, sledPullKg: 103, farmersKg: 24, sandbagKg: 20, wallBallKg: 6, wallBallTargetM: 2.7, wallBallReps: 100,
      uncertain: { wallBallTargetM: 'Une source indique une cible à 3,00 m.' } },
    'men-pro': { label: 'Hommes Pro', sledPushKg: 202, sledPullKg: 153, farmersKg: 32, sandbagKg: 30, wallBallKg: 9, wallBallTargetM: 3, wallBallReps: 100 },
  };

  const STATIONS = [
    { id: 'skierg', n: 1, name: 'SkiErg', amount: '1000 m', exId: 'skierg' },
    { id: 'sled_push', n: 2, name: 'Sled push', amount: '50 m (4 × 12,5 m)', load: 'sledPushKg', exId: 'sled_push', loadNote: 'traîneau compris' },
    { id: 'sled_pull', n: 3, name: 'Sled pull', amount: '50 m (4 × 12,5 m)', load: 'sledPullKg', exId: 'sled_pull', loadNote: 'traîneau compris' },
    { id: 'burpee_broad_jump', n: 4, name: 'Burpee broad jumps', amount: '80 m', exId: 'burpee_broad_jump' },
    { id: 'row', n: 5, name: 'Rameur', amount: '1000 m', exId: 'row_erg' },
    { id: 'farmers_carry', n: 6, name: 'Farmers carry', amount: '200 m', load: 'farmersKg', perHand: true, exId: 'farmers_carry' },
    { id: 'sandbag_lunge', n: 7, name: 'Fentes avec sandbag', amount: '100 m', load: 'sandbagKg', exId: 'sandbag_lunge' },
    { id: 'wall_ball', n: 8, name: 'Wall balls', amount: 'reps', load: 'wallBallKg', exId: 'wall_ball' },
  ];

  const fmtKg = (v) => `${U.fmtNum(v, 1)} kg`;
  // Fiche des stations avec les charges d'un jeu de charges donné.
  function stationsFor(loadKey) {
    const L = LOADS[loadKey];
    return STATIONS.map((s) => {
      let amount = s.amount;
      if (s.id === 'wall_ball') amount = `${L.wallBallReps} répétitions, cible à ${U.fmtNum(L.wallBallTargetM, 2)} m`;
      const load = s.load ? (s.perHand ? `2 × ${fmtKg(L[s.load])}` : fmtKg(L[s.load])) + (s.loadNote ? ` (${s.loadNote})` : '') : '';
      return { id: s.id, n: s.n, name: s.name, amount, load, exId: s.exId };
    });
  }

  const DIVISION_RULES = {
    solo: 'Seul : 8 × (1 km de course + 1 station), toujours dans le même ordre. Tu comptes toi-même tes tours de piste et tes longueurs de sled.',
    doubles: "Les deux partenaires courent les 8 × 1 km ENSEMBLE et se partagent librement les stations (ex. « je fais, tu fais » au rameur). Nouveauté 26/27 : pas plus de 10 s d'écart sur les tapis de chronométrage, et une station ne commence que quand vous êtes réunis.",
    relay: "Équipe de 4 : chacun fait 2 × 1 km et 2 stations. En relais mixte, chacun prend les charges de son sexe.",
  };
  const DIVISION_LABELS = { solo: 'Solo', doubles: 'Doubles', relay: 'Relay (4)' };
  const CATEGORY_LABELS = { men: 'hommes', women: 'femmes', mixed: 'mixte' };
  const LEVEL_LABELS = { open: 'Open', pro: 'Pro' };

  // Jeu de charges selon division × catégorie × niveau (null = combinaison non trouvée).
  const LOAD_MAP = {
    solo: { men: { open: 'men-open', pro: 'men-pro' }, women: { open: 'women-open', pro: 'women-pro' }, mixed: {} },
    doubles: { men: { open: 'men-open', pro: 'men-pro' }, women: { open: 'women-open', pro: 'women-pro' }, mixed: { open: 'men-open' } },
    relay: { men: { open: 'men-open' }, women: { open: 'women-open' }, mixed: { open: 'per-sex' } },
  };
  const COMBO_NOTES = {
    'doubles.men.pro': 'Doubles Pro : charges supposées identiques au Solo Pro, à vérifier dans le règlement Doubles.',
    'doubles.women.pro': 'Doubles Pro : charges supposées identiques au Solo Pro, à vérifier dans le règlement Doubles.',
    'doubles.mixed.open': "Doubles mixte : charges Hommes Open (wall ball 6 kg) d'après les sources ; hauteur de cible pour la partenaire à vérifier.",
  };

  function resolveStandard(division, category, level) {
    const key = LOAD_MAP[division] && LOAD_MAP[division][category] && LOAD_MAP[division][category][level];
    if (!key) return null;
    const base = {
      division, category, level,
      label: `${DIVISION_LABELS[division]} ${CATEGORY_LABELS[category]} ${LEVEL_LABELS[level]}`,
      rule: DIVISION_RULES[division],
      runs: '8 × 1 km',
      notes: COMBO_NOTES[`${division}.${category}.${level}`] ? [COMBO_NOTES[`${division}.${category}.${level}`]] : [],
    };
    if (key === 'per-sex') {
      return { ...base, perSex: { H: { loadsKey: 'men-open', ...LOADS['men-open'], stations: stationsFor('men-open') }, F: { loadsKey: 'women-open', ...LOADS['women-open'], stations: stationsFor('women-open') } },
        notes: base.notes.concat(['Chaque athlète prend les charges de son sexe.']) };
    }
    const L = LOADS[key];
    const uncertain = L.uncertain ? Object.values(L.uncertain) : [];
    return { ...L, ...base, loadsKey: key, loadsLabel: L.label, uncertain, notes: base.notes.concat(uncertain), stations: stationsFor(key) };
  }

  const hyroxStandards = {
    season: '26/27', checkedAt: '2026-10-06', confidence: 'élevée',
    sources: [HX.rulesSingles, HX.rulesDoubles],
    note: "Règlement officiel 26/27 non lu directement : valeurs recoupées sur plusieurs sites. Ergomètres : damper réglé sur 6 par défaut (modifiable).",
    run: { count: 8, km: 1, note: 'Toujours 1 km avant chaque station. En intérieur, chaque km fait plusieurs tours : compte-les (tour oublié = pénalité de temps).' },
    stations: STATIONS.map((s) => ({ ...s })),
    loads: LOADS,
    rules: DIVISION_RULES,
    labels: { division: DIVISION_LABELS, category: CATEGORY_LABELS, level: LEVEL_LABELS },
  };
  for (const div of Object.keys(LOAD_MAP)) {
    hyroxStandards[div] = {};
    for (const cat of ['men', 'women', 'mixed']) {
      hyroxStandards[div][cat] = { open: resolveStandard(div, cat, 'open'), pro: resolveStandard(div, cat, 'pro') };
    }
  }
  // Raccourci : C.data.hyroxLoads('doubles', 'men', 'open') → standard résolu, ou null.
  const hyroxLoads = (division, category, level) => resolveStandard(division || 'solo', category || 'men', level || 'open');

  /* ───────── Check-lists ───────── */

  const CHECKLIST_GROUPS = {
    avant: 'Les jours d\'avant', papiers: 'Papiers', materiel: 'Sac', echauffement: 'Échauffement', reglement: 'Règlement', apres: 'Après',
  };
  const item = (id, group, text) => ({ id, group, text });

  const checklists = {
    'hyrox-jour-j': [
      item('sommeil', 'avant', 'Dors bien les 2 ou 3 nuits d\'avant (la veille compte moins).'),
      item('glucides', 'avant', 'Plus de glucides les 2 jours d\'avant ; rien de nouveau à manger le jour J.'),
      item('vague', 'avant', "Note l'heure de ta vague : partir dans une autre vague = disqualification."),
      item('billet', 'papiers', 'Billet / QR code et pièce d\'identité.'),
      item('binome', 'papiers', 'Doubles : même vague que ton binôme, division et catégorie vérifiées.'),
      item('chaussures', 'materiel', 'Chaussures de course déjà portées (obligatoires, sauf au wall ball : si tu les retires, tu les rapportes jusqu\'à l\'arrivée).'),
      item('tenue', 'materiel', 'Tenue testée à l\'entraînement + vêtements chauds pour après.'),
      item('boire', 'materiel', 'Gourde et petite collation (banane, barre) pour l\'attente.'),
      item('montre', 'materiel', 'Montre chargée (mode multisport), écouteurs non utilisés en course.'),
      item('footing', 'echauffement', '10 à 15 min de footing facile + gammes.'),
      item('stations-legeres', 'echauffement', 'Quelques wall balls légers, fentes et burpees sans forcer.'),
      item('accel', 'echauffement', '2 ou 3 accélérations courtes, puis reste au chaud.'),
      item('premier-km', 'reglement', 'Pars le 1er km plus lentement que tu ne le crois : 70 % des athlètes partent trop vite.'),
      item('tours', 'reglement', 'Compte tes tours de piste et tes 4 longueurs de sled (tour oublié = pénalité de temps).'),
      item('doubles-10s', 'reglement', 'Doubles : pas plus de 10 s d\'écart sur les tapis, la station commence quand vous êtes réunis.'),
      item('magnesie', 'reglement', 'Pas de magnésie au wall ball, pas de crachat ni de mouchage au sol (2 min chacun).'),
      item('standards', 'reglement', 'Wall ball : hanche sous le genou, centre du ballon sur la cible. Fentes : genou arrière au sol. BBJ : poitrine et cuisses au sol, pieds joints.'),
      item('station-finie', 'reglement', 'Une station non terminée = disqualification ; sandbag lâché = 15 s.'),
      item('recup', 'apres', 'Mange et bois dans l\'heure, marche, puis 3 à 7 jours faciles.'),
      item('resultat', 'apres', 'Note ton temps officiel et tes temps par station dans l\'app.'),
    ],
    'ssa-test': [
      item('convocation', 'papiers', 'Convocation, pièce d\'identité, certificat médical si l\'organisme le demande.'),
      item('maillot', 'materiel', 'Maillot de bain, bonnet, serviette, claquettes, gourde.'),
      item('lunettes', 'materiel', "Lunettes : demande AVANT si elles sont autorisées (plusieurs sources disent « sans aucun accessoire »)."),
      item('nage', 'echauffement', '400 à 600 m de nages variées, souples.'),
      item('allure', 'echauffement', '2 ou 3 × 25 m à l\'allure du test, 1 départ plongé, 1 × 25 m dos jambes seules mains hors de l\'eau.'),
      item('pas-apnee-max', 'echauffement', "Pas d'apnée maximale à l'échauffement. Avant le plongeon : 1 ou 2 inspirations normales, jamais d'hyperventilation."),
      item('format', 'reglement', "100 m continu sans appui : 25 m plongé dont au moins 15 m en immersion complète, 50 m crawl en surface, 25 m dos mains hors de l'eau (poignets au-dessus de la surface)."),
      item('temps', 'reglement', '2:45 maximum (à confirmer avec ton organisme), validé par un MNS. Attestation valable 1 an : garde-la.'),
      item('appuis', 'reglement', 'Aucun appui sur le bord, le fond ou la ligne d\'eau.'),
    ],
    'ssa-tsa': [
      item('documents', 'papiers', "Attestation du test d'entrée (valable 1 an), PSE2 à jour, certificat médical."),
      item('palmes', 'materiel', 'Tes palmes habituelles (jamais des neuves), sangles vérifiées ; masque et tuba si tu les utilises.'),
      item('maillot', 'materiel', 'Maillot, bonnet, serviette, vêtement chaud pour la récupération, gourde.'),
      item('echauffement', 'echauffement', '400 à 600 m souples, 2 × 25 m rapides, un canard facile, un chaussage de palmes pour te remettre le geste en tête.'),
      item('parcours', 'reglement', "Épreuve 1 (2:30) : plongeon, 15 m en immersion + 10 m, 25 m crawl, 15 m en immersion + 10 m, approche tête hors de l'eau, canard, mannequin entre 1,80 et 2,80 m, remorquage jusqu'au bord de départ."),
      item('remorquage', 'reglement', 'Remorquage : voies aériennes dégagées, visage du mannequin hors de l\'eau (plus de 3 s d\'immersion = échec).'),
      item('recup-10', 'reglement', 'Au moins 10 min entre les deux épreuves : bois, reste au chaud, respire calmement.'),
      item('palmes-300', 'reglement', "Épreuve 2 (4:30) : tu attends au bord SANS palmes, le chrono part avant le chaussage. Nage ventrale. Palme perdue = distance non comptée."),
      item('apnee', 'reglement', "Jamais d'hyperventilation avant les apnées ; si tu sens des picotements ou ta vision se rétrécir, remonte."),
    ],
    'pompier-tests': [
      item('documents', 'papiers', 'Convocation, pièce d\'identité, permis B, diplômes (PSE1, PSE2), attestation JDC, certificat médical si demandé.'),
      item('tenue', 'materiel', 'Chaussures de course, tenue de sport, rechange.'),
      item('piscine', 'materiel', 'Maillot et bonnet pour le 50 m (lunettes parfois interdites : demande).'),
      item('boire', 'materiel', 'Gourde et collation.'),
      item('footing', 'echauffement', '10 min de footing + gammes, puis 2 ou 3 navettes avec demi-tour.'),
      item('mobilite', 'echauffement', 'Mobilité épaules et hanches, quelques pompes et tractions faciles.'),
      item('leger', 'reglement', 'Luc Léger : demande la version de la bande (départ 8 ou 8,5 km/h) et si les demi-paliers comptent. Sois sur la ligne au bip.'),
      item('tractions', 'reglement', 'Tractions en supination : départ bras tendus, menton au-dessus de la barre, pas de pause de plus de 3 s.'),
      item('pompes', 'reglement', 'Pompes en cadence imposée (environ 1 toutes les 2 s), poitrine à ~5 cm du sol.'),
      item('killy-gainage', 'reglement', 'Killy : dos plaqué, cuisses à 90°. Gainage : avant-bras et orteils, corps aligné.'),
      item('souplesse', 'reglement', 'Souplesse : jambes tendues, pousse la règle sans à-coup.'),
      item('entretien', 'apres', 'Prépare l\'entretien : pourquoi toi, tes disponibilités, ce que tu sais du service.'),
    ],
  };
  const checklistMeta = {
    'hyrox-jour-j': { title: 'HYROX — jour J', icon: '🏁' },
    'ssa-test': { title: "SSA — test d'entrée", icon: '🏊' },
    'ssa-tsa': { title: 'SSA — TSA (certification)', icon: '🛟' },
    'pompier-tests': { title: 'Pompier — tests physiques', icon: '🚒' },
  };

  /* ───────── Modèles d'objectifs ─────────
   * Jalon : { key, title (texte ou fonction(ctx)), note (idem),
   *           offsetDays (par rapport à la date de l'objectif, négatif = avant)
   *         | fromToday (jours après la création) | due (date fixe ou fonction(ctx) → date|null),
   *           skipIfPast (jalon d'entraînement : ignoré s'il tombe avant aujourd'hui),
   *           repeatDays + untilOffsetDays (jalon répété, ex. test chaque trimestre) }
   * ctx = { today, date (date de l'objectif ou null), details, goals } */

  const fmtT = (sec) => U.formatDuration(sec);
  const ssaTargets = (d) => (d && d.targets) || {};

  // Fin juin de la prochaine saison de formation laissant au moins 4 mois de préparation.
  function nextJuneEnd(today) {
    const y = Number(today.slice(0, 4));
    const cand = `${y}-06-30`;
    return U.daysBetween(today, cand) >= 120 ? cand : `${y + 1}-06-30`;
  }

  const goalTemplates = {
    ssa: {
      id: 'ssa', type: 'ssa', name: 'SSA — Surveillant sauveteur aquatique', icon: '🛟', priority: 1,
      description: "Le SSA remplace le BNSSA depuis le 1er octobre 2026 : test d'entrée (100 m en 2:45), formation de 35 h avec évaluation continue, puis TSA (parcours 100 m en 2:30 et 300 m palmes en 4:30). PSE2 à jour obligatoire. Valeurs à confirmer avec ton organisme.",
      defaultDate: nextJuneEnd,
      details: {
        organisme: '', ville: '', mention: 'piscine', entryTestDate: null, trainingStart: null, trainingEnd: null, tsaDate: null,
        targets: { entry: 135, tsa: 125, fins: 235 },
      },
      milestones: [
        { key: 'inscription', title: "T'inscrire à une formation SSA", fromToday: 60,
          note: 'Les places partent vite (moins de sessions cet automne, le temps que les organismes soient réhabilités). Compare 2 ou 3 organismes : FFSS, Protection civile, Croix-Rouge, clubs de sauvetage.' },
        { key: 'pse2-fc', title: "PSE2 : formation continue de l'année à jour",
          due: (c) => (U.isKey(c.details.trainingStart) ? U.addDays(c.details.trainingStart, -14) : U.addDays(c.today, 30)),
          note: 'Le PSE2 à jour est obligatoire pour obtenir le SSA. Vérifie la date de ta dernière formation continue.' },
        { key: 'certificat-medical', title: 'Certificat médical de non contre-indication au sauvetage aquatique',
          due: (c) => (U.isKey(c.details.trainingStart) ? U.addDays(c.details.trainingStart, -21) : null),
          note: "Daté de moins de 3 mois au début du stage (selon l'organisme) : ne le fais pas trop tôt. Date à caler sur le début de ta formation." },
        { key: 'test-entree', title: "Test d'entrée : 100 m en 2:45 max", due: (c) => c.details.entryTestDate || null,
          note: (c) => `Date à saisir (avant ou le 1er jour du stage). Ta cible : ${fmtT(ssaTargets(c.details).entry || 135)}. L'attestation est valable 1 an.` },
        { key: 'formation', title: 'Formation SSA (35 h minimum)', due: (c) => c.details.trainingStart || null,
          note: 'Évaluation continue sur 5 compétences (surveillance, prévention, sauvetage coordonné…) et évaluation théorique (format à confirmer).' },
        { key: 'tsa', title: 'TSA : parcours 100 m (2:30) + 300 m palmes (4:30)', due: (c) => c.details.tsaDate || null,
          note: (c) => `Date à saisir. Au moins 10 min de récupération entre les deux épreuves. Tes cibles : ${fmtT(ssaTargets(c.details).tsa || 125)} et ${fmtT(ssaTargets(c.details).fins || 235)}.` },
        { key: 'certification', title: 'Certification SSA', offsetDays: 0,
          note: "Délivrée par l'organisme de formation après l'évaluation continue et le TSA." },
        { key: 'attestations', title: "Ranger tes attestations (PSE2, test d'entrée, SSA)", offsetDays: 7,
          note: 'Garde les originaux et une photo : employeurs et Protection civile te les demanderont.' },
        { key: 'mention-littoral', title: 'Option : mention « littoral » (SSA L, environ 28 h)', due: null,
          note: 'Pour les postes de secours en plage. Demande le SSA, le PSE2 à jour et un certificat médical. Sessions de 4 à 5 jours selon la météo : date à choisir.' },
        { key: 'fc-ssa', title: '1re formation continue SSA (annuelle)', offsetDays: 365,
          note: 'Sans formation continue annuelle (SSA et PSE2), tu ne peux plus être employé comme surveillant sauveteur.' },
      ],
    },

    hyrox: {
      id: 'hyrox', type: 'hyrox', name: 'HYROX', icon: '🏋️', priority: 2,
      description: "8 × (1 km de course + 1 station). En Doubles, vous courez les 8 km ensemble et vous vous partagez les stations comme vous voulez. Objectif : finir, en commençant doucement.",
      // Jour par défaut de la course choisie (ou de la prochaine course française à plus de 8 semaines).
      defaultDate: (today) => {
        const ev = pickHyroxEvent(goalTemplates.hyrox.details.event, today);
        return ev ? ev.defaultDay : U.addDays(today, 120);
      },
      details: { event: 'lyon-2027', venue: '', raceDate: null, division: 'doubles', category: 'men', level: 'open', partner: '' },
      milestones: [
        { key: 'billetterie', title: "Surveiller l'ouverture de la billetterie", fromToday: 7,
          note: (c) => {
            const ev = hyroxEvent(c.details.event);
            const st = ev ? `${ev.ticketStatus} (vérifié le ${U.fmtLong(ev.checkedAt)}, à revérifier). ` : '';
            return `${st}Les courses françaises affichent souvent complet très vite.`;
          } },
        { key: 'inscription', title: (c) => (c.details.division === 'doubles' ? "T'inscrire avec ton binôme" : "T'inscrire"), fromToday: 45,
          note: (c) => `Dès l'ouverture. Vérifie la division avant de payer : ${(hyroxLoads(c.details.division, c.details.category, c.details.level) || {}).label || 'ta division'}.` },
        { key: 'tests-stations', title: 'Premier test de chaque station', fromToday: 42,
          note: 'SkiErg 1000 m, sled push et pull, burpee broad jumps, rameur 1000 m, farmers, fentes, 100 wall balls : doucement, juste pour avoir un point de départ.' },
        { key: 'demi-simulation', title: 'Demi-simulation (4 × 1 km + station)', offsetDays: -42, skipIfPast: true },
        { key: 'simulation-3-4', title: 'Simulation aux 3/4 (6 × 1 km + station)', offsetDays: -28, skipIfPast: true },
        { key: 'simulation-complete', title: 'Simulation complète (au plus tard J-21)', offsetDays: -21, skipIfPast: true,
          note: 'Si possible avec ton binôme, aux charges de course, pour caler votre répartition des stations.' },
        { key: 'derniere-force', title: 'Dernière séance de force lourde', offsetDays: -6, skipIfPast: true,
          note: 'Entre J-7 et J-5. Ensuite : affûtage, on garde l\'intensité et on baisse le volume.' },
        { key: 'checklist', title: 'Préparer le sac (check-list du jour J)', offsetDays: -2,
          note: 'Heure de vague, billet, chaussures, tenue : voir la check-list HYROX.' },
        { key: 'resultat', title: 'Noter ton résultat officiel', offsetDays: 1 },
        { key: 'recuperation', title: 'Fin de la semaine de récupération', offsetDays: 7,
          note: 'Footing facile, mobilité, sommeil. Pas de séance dure avant d\'avoir récupéré.' },
      ],
    },

    pompier: {
      id: 'pompier', type: 'pompier', name: 'Sapeur-pompier (volontaire ou réserve)', icon: '🚒', priority: 3,
      description: "Il n'existe pas de barème national de recrutement : chaque SDIS (ou la BSPP, le BMPM) fixe ses épreuves. Tests type ICP : Luc Léger, tractions, pompes, gainage, chaise (Killy), souplesse, parfois 50 m nage. Cible par défaut : seuil du barème + 20 %.",
      // Candidature environ 3 ans plus tard (1er octobre) : le temps de préparer les tests et de gagner en expérience.
      defaultDate: (today) => `${Number(today.slice(0, 4)) + 3}-10-01`,
      details: { path: 'indecis', department: '', applyDate: null, bareme: 'sdis91', marginPct: 0.2 },
      milestones: [
        { key: 'renseignements', title: 'Te renseigner sur les épreuves et le calendrier de recrutement du service visé', offsetDays: -365,
          note: "Journée d'information du SDIS, centre de secours proche, page recrutement de la BSPP (réserve indiquée fermée : surveille la réouverture)." },
        { key: 'choisir-voie', title: 'Choisir ta voie (SPV toutes missions ou différencié, réserve BSPP, BMPM, autre)', offsetDays: -122,
          note: 'Pense au département où tu vivras au moment de candidater : les épreuves changent d\'un SDIS à l\'autre.' },
        { key: 'test-icp', title: 'Test complet type ICP', fromToday: 28, repeatDays: 91, untilOffsetDays: -14,
          note: 'Luc Léger, tractions supination, pompes en cadence, gainage, chaise (Killy), souplesse, 50 m nage. Note la version de la bande Luc Léger.' },
        { key: 'medical', title: 'Vaccins à jour et visite médicale à préparer', offsetDays: -90,
          note: "Vaccins cités : hépatite B, diphtérie, tétanos, poliomyélite (grippe à confirmer). L'aptitude est décidée par le médecin du service (règles 2026)." },
        { key: 'dossier', title: 'Préparer le dossier (identité, permis B, JDC, PSE1/PSE2)', offsetDays: -45 },
        { key: 'pse2-fc', title: 'PSE2 à jour (formation continue annuelle)', offsetDays: -30,
          note: 'Exigé dès la signature pour la réserve BSPP.' },
        { key: 'candidature', title: 'Déposer ta candidature', offsetDays: 0 },
      ],
    },

    'protection-civile': {
      id: 'protection-civile', type: 'custom', name: 'Protection civile — secours aquatiques', icon: '⛑️', priority: 3,
      description: "Continuer la Protection civile dans ta future ville (en cas de mutation) et tenir des postes de secours en milieu aquatique (SSA nécessaire).",
      defaultDate: null,
      details: { kind: 'protection-civile', discipline: 'autre', benchId: null, city: '' },
      milestones: [
        { key: 'contact-antenne', title: (c) => (c.details.city ? `Contacter l'antenne de ${c.details.city}` : "Contacter l'antenne de ta future ville"), due: null,
          note: 'Dès que ta mutation se confirme : présente-toi avec ton PSE2 et la liste de tes postes et formations.' },
        { key: 'transfert', title: 'Faire suivre ton dossier et tes attestations', due: null,
          note: 'Demande à ton antenne actuelle comment transférer ton historique.' },
        { key: 'pse2-fc', title: 'Vérifier la date de ta prochaine formation continue PSE2', fromToday: 30,
          note: 'Formation continue annuelle : sans elle, tu ne peux plus tenir de poste.' },
        { key: 'ssa', title: 'Obtenir le SSA (postes de secours aquatiques)',
          due: (c) => { const g = (c.goals || []).find((x) => x && x.type === 'ssa' && x.status !== 'archived'); return g && U.isKey(g.date) ? g.date : null; },
          note: 'Suivi dans ton objectif SSA.' },
        { key: 'mention-littoral', title: 'Option : SSA mention littoral (postes de plage)', due: null,
          note: 'Utile si ta future antenne tient des postes sur le littoral.' },
      ],
    },

    custom: {
      id: 'custom', type: 'custom', name: 'Objectif perso', icon: '🎯', priority: 2,
      description: 'Un objectif libre, par exemple « 10 km en moins de 50 min ». Lie-le à un test pour suivre ta progression.',
      defaultDate: (today) => U.addDays(today, 84),
      details: { discipline: 'course', benchId: null, targetValue: null },
      milestones: [
        { key: 'test-depart', title: 'Test de départ', fromToday: 7, note: 'Mesure ton niveau actuel sur le test lié.' },
        { key: 'test-mi-parcours', title: 'Test à mi-parcours', skipIfPast: true,
          due: (c) => (U.isKey(c.date) ? U.addDays(c.today, Math.round(U.daysBetween(c.today, c.date) / 2)) : null) },
        { key: 'test-final', title: 'Test final', offsetDays: 0 },
      ],
    },
  };
  const TEMPLATE_ORDER = ['ssa', 'hyrox', 'pompier', 'protection-civile', 'custom'];
  const listGoalTemplates = () => TEMPLATE_ORDER.map((id) => goalTemplates[id]);

  const pompierPaths = {
    spv: { label: 'Sapeur-pompier volontaire (toutes missions)' },
    'spv-differencie': { label: 'SPV — engagement différencié (ex. secours à personne seulement)' },
    'protection-civile': { label: 'Rester en Protection civile' },
    bspp: { label: 'Réserve BSPP (Paris)', bareme: 'bspp', note: 'Recrutement indiqué fermé : à surveiller.' },
    bmpm: { label: 'Marins-pompiers de Marseille (BMPM)', bareme: 'bmpm' },
    militaire: { label: 'Sécurité civile militaire (RIISC)' },
    indecis: { label: 'À décider' },
  };
  const ssaMentions = {
    piscine: 'Piscine (socle SSA)', 'eaux-interieures': 'Eaux intérieures (SSA EI, environ 14 h)', littoral: 'Littoral (SSA L, environ 28 h)',
  };

  /* ───────── Création d'un objectif ───────── */

  // Course retenue : celle demandée si elle laisse au moins 8 semaines, sinon la prochaine en France.
  function pickHyroxEvent(id, today) {
    const ev = hyroxEvent(id);
    if (ev && U.daysBetween(today, ev.defaultDay) >= 56) return ev;
    return upcomingHyroxEvents(today, { minDays: 56, country: 'France' })[0] || null;
  }

  // Fusion profonde simple (objets seulement ; tableaux et valeurs remplacés).
  function merge(base, extra) {
    const out = U.clone(base) || {};
    if (!U.isObj(extra)) return out;
    for (const [k, v] of Object.entries(extra)) {
      out[k] = U.isObj(v) && U.isObj(out[k]) ? merge(out[k], v) : U.clone(v);
    }
    return out;
  }

  const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);
  const keyOrNull = (k) => (U.isKey(k) ? k : null);

  function computeDue(m, ctx) {
    if (typeof m.due === 'function') return keyOrNull(m.due(ctx));
    if (U.isKey(m.due)) return m.due;
    if (typeof m.fromToday === 'number') return U.addDays(ctx.today, m.fromToday);
    if (typeof m.offsetDays === 'number') return U.isKey(ctx.date) ? U.addDays(ctx.date, m.offsetDays) : null;
    return null;
  }

  // Tri : par échéance (les jalons sans date à la fin), ordre du modèle sinon (tri stable).
  const byDue = (a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99');

  // Jalons concrets d'un modèle pour un contexte donné (sans id).
  function buildMilestones(tpl, ctx) {
    const out = [];
    for (const m of tpl.milestones || []) {
      if (m.repeatDays) {
        const start = U.addDays(ctx.today, m.fromToday || 0);
        const end = U.isKey(ctx.date) ? U.addDays(ctx.date, m.untilOffsetDays || 0) : U.addDays(ctx.today, 365);
        let i = 1;
        for (let d = start; d <= end && i <= 40; d = U.addDays(d, m.repeatDays), i++) {
          out.push({ key: `${m.key}-${i}`, title: `${resolve(m.title, ctx)} (${U.fmtMonthYear(d)})`, due: d, note: resolve(m.note, ctx) || '' });
        }
        continue;
      }
      let due = computeDue(m, ctx);
      if (due && due < ctx.today) {
        if (m.skipIfPast) continue; // séance-jalon déjà dépassée : inutile
        due = ctx.today; // démarche en retard : à faire dès maintenant
      }
      // Une démarche « dans N jours » ne doit pas tomber après l'objectif.
      if (due && typeof m.fromToday === 'number' && U.isKey(ctx.date) && due > ctx.date) due = ctx.date;
      out.push({ key: m.key, title: resolve(m.title, ctx), due, note: resolve(m.note, ctx) || '' });
    }
    return out.sort(byDue);
  }

  /* createGoalFromTemplate(templateId, overrides, today) → objet goal prêt pour state.goals.
   * overrides : { name, date, dateEnd, priority, status, note, details:{…}, milestones:[…] } (tout facultatif).
   * Lit C.state.goals (si disponible) pour relier les jalons entre objectifs (ex. Protection civile → SSA). */
  function createGoalFromTemplate(templateId, overrides, today) {
    const tpl = goalTemplates[templateId] || goalTemplates.custom;
    const o = U.isObj(overrides) ? overrides : {};
    const t = U.isKey(today) ? today : U.todayKey();
    const details = merge(tpl.details, o.details);
    details.template = tpl.id;

    let date = U.isKey(o.date) ? o.date : null;
    let name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 120) : null;

    if (tpl.type === 'hyrox') {
      if (!date && U.isKey(details.raceDate)) date = details.raceDate;
      if (!date) {
        const ev = pickHyroxEvent(details.event, t);
        details.event = ev ? ev.id : '';
        date = ev ? ev.defaultDay : U.addDays(t, 120);
      }
      const ev = hyroxEvent(details.event);
      if (ev && !details.venue) details.venue = ev.venue ? `${ev.city} — ${ev.venue}` : ev.city;
      details.raceDate = date;
      if (!name) {
        const div = details.division && details.division !== 'solo' ? ` — ${DIVISION_LABELS[details.division] || details.division}` : '';
        name = ev ? `HYROX ${ev.city}${div}` : `HYROX${div}`;
      }
    }
    if (!date && o.date !== null && tpl.defaultDate) date = keyOrNull(resolve(tpl.defaultDate, t));
    if (tpl.type === 'pompier') details.applyDate = date;
    if (tpl.type === 'ssa' && U.isObj(details.targets)) {
      // Cibles par défaut alignées sur les tests de référence (benchmarks.js), sauf valeur fournie.
      const bm = D.getBenchmark ? D.getBenchmark : () => null;
      for (const [k, id] of [['entry', 'ssa_entry_test'], ['tsa', 'ssa_tsa_course'], ['fins', 'ssa_tsa_fins']]) {
        if (U.num(details.targets[k]) == null && bm(id) && bm(id).target) details.targets[k] = bm(id).target.value;
      }
    }

    const goals = Array.isArray(o.goals) ? o.goals : (C.state && Array.isArray(C.state.goals) ? C.state.goals : []);
    const ctx = { today: t, date, details, goals };
    const raw = Array.isArray(o.milestones)
      ? o.milestones.filter((m) => U.isObj(m) && m.title).map((m) => ({ key: m.key, title: String(m.title), due: keyOrNull(m.due), note: m.note || '' })).sort(byDue)
      : buildMilestones(tpl, ctx);
    const milestones = raw.map((m) => ({ id: U.uid(), key: m.key, title: m.title, due: m.due, done: false, doneAt: null, note: m.note || '' }));

    return {
      id: U.uid(),
      type: tpl.type,
      name: name || tpl.name,
      date,
      dateEnd: U.isKey(o.dateEnd) ? o.dateEnd : null,
      priority: [1, 2, 3].includes(o.priority) ? o.priority : tpl.priority || 2,
      status: ['active', 'done', 'archived'].includes(o.status) ? o.status : 'active',
      details,
      note: typeof o.note === 'string' ? o.note : '',
      milestones,
      result: null,
      createdAt: t,
    };
  }

  /* recomputeMilestones(goal, today, { force }) → nouveau tableau de jalons (ne modifie pas goal).
   * Après une saisie (date du TSA, du stage, de la course…) : complète les échéances vides des jalons
   * issus du modèle. Avec force:true, recalcule aussi les échéances des jalons non faits (date d'objectif changée).
   * Les jalons faits et ceux ajoutés à la main (sans clé connue) ne bougent jamais. */
  function recomputeMilestones(goal, today, opts = {}) {
    if (!goal || !Array.isArray(goal.milestones)) return [];
    const tpl = goalTemplates[(goal.details && goal.details.template) || ''] || goalTemplates[goal.type] || null;
    if (!tpl) return goal.milestones.map((m) => ({ ...m }));
    const t = U.isKey(today) ? today : U.todayKey();
    const goals = Array.isArray(opts.goals) ? opts.goals : (C.state && Array.isArray(C.state.goals) ? C.state.goals : []);
    const fresh = buildMilestones(tpl, { today: t, date: goal.date, details: goal.details || {}, goals });
    const byKey = {};
    for (const f of fresh) byKey[f.key] = f;
    return goal.milestones.map((m) => {
      const f = m.key && byKey[m.key];
      if (!f || m.done) return { ...m };
      if (m.due == null || opts.force) return { ...m, due: f.due };
      return { ...m };
    }).sort(byDue);
  }

  Object.assign(D, {
    hyroxEvents, hyroxEvent, upcomingHyroxEvents, hyroxStandards, hyroxLoads,
    checklists, checklistMeta, CHECKLIST_GROUPS,
    goalTemplates, listGoalTemplates, pompierPaths, ssaMentions,
    createGoalFromTemplate, recomputeMilestones,
  });
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
