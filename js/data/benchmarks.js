/* Crevare — tests de référence (benchmarks), barèmes pompier et calcul des cibles.
 * Données statiques + fonctions pures, sans DOM (chargeable dans les tests Node).
 * Faits issus de docs/recherche-2026-10.md : quand une source est incertaine, le libellé le dit
 * (« à confirmer », « à vérifier pour ton département »). Aucune donnée personnelle ici :
 * le profil (sexe, année de naissance) et les objectifs viennent de C.state à l'exécution. */
(function (C) {
  'use strict';
  const U = C.util;
  const D = (C.data = C.data || {});

  /* ───────── Sources (URL) ───────── */

  const SRC = {
    ffss: 'https://www.ffss.fr/public/1016-surveillant-sauveteur-aquatique-ssa.php',
    tsa: 'https://assa26.fr/actualites-secourisme-sauvetage/epreuves-ssa-competences/',
    circulaire: 'https://www.interieur.gouv.fr/sites/minint/files/medias/documents/2026-09/K00_20260901_INTE2623119C.pdf',
    apnee: 'https://www.cdc.gov/mmwr/preview/mmwrhtml/mm6419a4.htm',
    hyroxTimes: 'https://hyroxdatalab.com/articles/what-is-a-good-hyrox-time',
    hyroxStations: 'https://hyroxdatalab.com/articles/average-hyrox-station-times',
    hyroxDoubles: 'https://roxfit.app/blog/whats-a-good-hyrox-doubles-time',
    hyroxPacing: 'https://roxlyfe.com/how-to-pace-your-running-at-hyrox/',
    sdis91: 'https://sdis91.fr/wp-content/uploads/2025/04/epreuves_aptitude_physique_spv_gpvec.pdf',
    icpH: 'https://securite-civile.gouv.nc/sites/default/files/documents/Bar%C3%A8mes%20ICP%20MASCULINS%20%20DSCGR.pdf',
    icpF: 'https://securite-civile.gouv.nc/sites/default/files/documents/Bar%C3%A8mes%20ICP%20FEMININS%20%20DSCGR.pdf',
    icpProtocole: 'https://enasis.fr/pluginfile.php/6486/mod_folder/content/0/ICP%20DE%20RECRUTEMENT%20SPV/guide%20accompagnement%20ICP%20v4%2004_02_2025.pdf',
    sdis35: 'https://sapeurs-pompiers35.fr/content/uploads/2021/04/guide-de-preparation-candidats-jar-1.pdf',
    sdis27: 'https://www.sapeurspompiers27.fr/wp-content/uploads/Guide-de-preparation-tests-recrutement-SPV.pdf',
    sdis45: 'https://test-pompier.fr/guides/devenir-sapeur-pompier-volontaire-spv-2026',
    sdis78: 'https://www.sdis78.fr/rejoignez-le-sdis78/sapeurs-pompiers-volontaires',
    bspp: 'https://www.terre.defense.gouv.fr/pompiers-paris/recrutement-stages/devenir-reserviste',
    bmpm: 'https://www.marinspompiersdemarseille.com/sites/default/files/contributeur_upload/Docs/bareme-et-protocole-recrutement.pdf',
  };

  /* ───────── Unités, tranches d'âge, marges ───────── */

  // Pas de mesure par unité (sert à arrondir les cibles).
  const UNIT_STEP = { time: 1, reps: 1, palier: 0.5, m: 0.5, cm: 0.5, kg: 0.5, km: 0.01 };

  // Tranches d'âge des barèmes ICP / SDIS (18-29, 30-39, 40-49, 50 et plus).
  const AGE_BANDS = ['<29', '30-39', '40-49', '50+'];
  const AGE_BAND_LABELS = { '<29': '29 ans et moins', '30-39': '30-39 ans', '40-49': '40-49 ans', '50+': '50 ans et plus' };
  const SEX_LABELS = { H: 'hommes', F: 'femmes' };

  // Règle par défaut pour le pompier : minimum du barème + 20 % de marge.
  const DEFAULT_MARGIN = 0.2;
  const DEFAULT_BAREME = 'sdis91';

  /* ───────── Barèmes pompier ─────────
   * values: { benchId: { H: { '<29': v, '30-39': v, '40-49': v, '50+': v }, F: {…} } }
   * Une tranche absente = valeur non trouvée (jamais inventée). */

  const allAges = (v) => ({ '<29': v, '30-39': v, '40-49': v, '50+': v });

  const baremes = [
    {
      id: 'sdis91', label: 'SDIS 91 (Essonne) — SPV toutes missions', short: 'SDIS 91', kind: 'recrutement',
      source: SRC.sdis91, date: '2025-04', dateLabel: 'avril 2025', confidence: 'moyenne',
      note: "Exemple de recrutement le plus complet trouvé (document d'avril 2025). VAMEVAL accepté à la place du Luc Léger. Souplesse et gainage notés sans seuil dans l'extrait. À vérifier pour ton département.",
      values: {
        swim_50: { H: { '<29': 75, '30-39': 90, '40-49': 105, '50+': 120 }, F: { '<29': 90, '30-39': 105, '40-49': 120, '50+': 135 } },
        wall_sit: { H: { '<29': 100, '30-39': 90 }, F: { '<29': 100, '30-39': 90 } },
        chinups: { H: { '<29': 7, '30-39': 6, '40-49': 5, '50+': 4 }, F: { '<29': 4, '30-39': 3, '40-49': 2, '50+': 1 } },
        pushups: { H: { '<29': 13 }, F: { '<29': 8 } },
        luc_leger: { H: { '<29': 8 }, F: { '<29': 6 } },
      },
      benchNotes: {
        wall_sit: "Valeur donnée sans distinction de sexe dans l'extrait ; plus basse après 39 ans (valeurs non trouvées).",
        pushups: 'Seulement si aucune traction n\'est réussie.',
        luc_leger: "Valeurs des autres tranches d'âge non trouvées.",
      },
    },
    {
      id: 'icp', label: 'ICP — niveau standard (barème DSCGR, proche du national)', short: 'ICP standard', kind: 'suivi',
      source: SRC.icpH, date: null, confidence: 'moyenne',
      note: 'Indicateurs de condition physique suivis chaque année en service : bien plus exigeants que les tests de recrutement. Paliers Luc Léger non trouvés.',
      values: {
        wall_sit: { H: { '<29': 120, '30-39': 110, '40-49': 96, '50+': 72 }, F: { '<29': 120 } },
        pushups: { H: { '<29': 20, '30-39': 18, '40-49': 16, '50+': 14 }, F: { '<29': 11 } },
        chinups: { H: { '<29': 15 } },
        plank: { H: { '<29': 120 } },
        sit_reach: { H: { '<29': 26 } },
      },
      benchNotes: {
        pushups: 'Femmes 18-29 ans : 8 à 10 = « moyen », donc 11 = premier niveau suffisant (déduit, à vérifier).',
        sit_reach: '23 à 25,5 cm = « moyen ».',
      },
    },
    {
      id: 'sdis34', label: 'SDIS 34 (Hérault) — à compléter', short: 'SDIS 34', kind: 'a-completer',
      source: '', date: null, confidence: 'faible', toComplete: true,
      note: "Aucun barème trouvé pour l'Hérault. Renseigne-toi (journée de recrutement, centre de secours) et note les seuils. En attendant, les cibles s'appuient sur l'exemple du SDIS 91.",
      values: {},
    },
    {
      id: 'bspp', label: 'Réserve BSPP (Paris) — secours à personne', short: 'Réserve BSPP', kind: 'reserve',
      source: SRC.bspp, date: null, confidence: 'faible', noPhysicalTest: true,
      note: "Pas de tests physiques selon un témoignage (fiabilité faible) : visite médicale BSPP, PSE2 à jour exigé à la signature, au moins 10 gardes de 24 h par an, habiter en Île-de-France. La page officielle indique que le recrutement est fermé (date de la mention inconnue) : surveille la réouverture. Les cibles s'appuient sur l'exemple du SDIS 91.",
      values: {},
    },
    {
      id: 'sdis35', label: 'SDIS 35 (Ille-et-Vilaine) — guide 2019', short: 'SDIS 35', kind: 'recrutement',
      source: SRC.sdis35, date: '2019', dateLabel: '2019', confidence: 'faible',
      note: "Guide de 2019, a pu changer. Tractions OU pompes. 50 m de nage ventrale sans lunettes (pas de temps dans l'extrait). Pas de tranches d'âge dans l'extrait.",
      values: {
        luc_leger: { H: allAges(6), F: allAges(5) },
        chinups: { H: allAges(6), F: allAges(2) },
        pushups: { H: allAges(13), F: allAges(6) },
      },
    },
    {
      id: 'sdis27', label: 'SDIS 27 (Eure)', short: 'SDIS 27', kind: 'recrutement',
      source: SRC.sdis27, date: null, confidence: 'moyenne',
      note: "Aussi : 2 000 m à courir en 12 min sur piste, écrits (français, maths sans calculatrice) et entretien. Le SDIS fournit un guide de préparation de 7 semaines. Pas de tranches d'âge dans l'extrait.",
      values: { chinups: { H: allAges(5), F: allAges(3) } },
    },
    {
      id: 'sdis45', label: 'SDIS 45 (Loiret) — source secondaire', short: 'SDIS 45', kind: 'recrutement',
      source: SRC.sdis45, date: null, confidence: 'faible',
      note: "Source secondaire, à vérifier. Pas de tranches d'âge dans l'extrait.",
      values: {
        luc_leger: { H: allAges(4), F: allAges(4) },
        plank: { H: allAges(45), F: allAges(45) },
        pushups: { H: allAges(4), F: allAges(3) },
        wall_sit: { H: allAges(45), F: allAges(45) },
      },
    },
    {
      id: 'sdis78-diff', label: 'SDIS 78 (Yvelines) — engagement différencié (secours à personne)', short: 'SDIS 78 différencié', kind: 'recrutement',
      source: SRC.sdis78, date: null, confidence: 'moyenne',
      note: 'Plus un test de sauvetage aquatique : 50 m nage libre puis sauvetage d\'un mannequin sans remorquage.',
      values: { luc_leger: { H: allAges(4), F: allAges(4) } },
    },
    {
      id: 'sdis78', label: 'SDIS 78 (Yvelines) — toutes missions', short: 'SDIS 78', kind: 'recrutement',
      source: SRC.sdis78, date: null, confidence: 'moyenne',
      note: "Luc Léger palier 6,5 à 8 selon l'âge (détail par tranche non trouvé), parcours professionnel, sauvetage aquatique, gainage, souplesse, tests en hauteur et en espace confiné. Les cibles s'appuient sur l'exemple du SDIS 91.",
      values: {},
    },
    {
      id: 'bmpm', label: 'BMPM (Marseille) — recrutement d\'active', short: 'BMPM', kind: 'recrutement',
      source: SRC.bmpm, date: null, confidence: 'faible',
      note: "18 à 25 ans. Luc Léger, natation 50 m, abdominaux, au moins 3 tractions ; une note sous 6 est éliminatoire (barème peut-être ancien). Épreuve de vertige et tests psychotechniques. La réserve vise surtout d'anciens marins-pompiers.",
      values: { pullups: { H: { '<29': 3 }, F: { '<29': 3 } } },
    },
  ];

  const getBareme = (id) => baremes.find((b) => b.id === id) || null;

  // Valeur d'un barème pour un test, un sexe et une tranche d'âge (ou null si inconnue).
  function baremeValue(bareme, benchId, sex, band) {
    const b = typeof bareme === 'string' ? getBareme(bareme) : bareme;
    const v = b && b.values && b.values[benchId] && b.values[benchId][sex] && b.values[benchId][sex][band];
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  /* ───────── Calculs purs ───────── */

  // Tranche d'âge à une date (seule l'année de naissance est connue : âge = année − naissance).
  function ageBand(birthYear, atDate) {
    const by = Number(birthYear);
    if (!Number.isInteger(by) || by < 1900) return null;
    const key = U.isKey(atDate) ? atDate : atDate instanceof Date ? U.dateKey(atDate) : U.todayKey();
    const age = Number(key.slice(0, 4)) - by;
    if (age < 0 || age > 120) return null;
    if (age <= 29) return '<29';
    if (age <= 39) return '30-39';
    if (age <= 49) return '40-49';
    return '50+';
  }

  // Ajoute une marge (20 % par défaut) dans le bon sens, arrondie au pas de mesure
  // sans jamais perdre de marge : plus haut = arrondi au-dessus, plus bas = arrondi en dessous.
  function withMargin(value, lower, unit, pct = DEFAULT_MARGIN) {
    if (value == null || !isFinite(value)) return null;
    const step = UNIT_STEP[unit] || 1;
    const raw = lower ? value * (1 - pct) : value * (1 + pct);
    const q = U.round(raw / step, 6); // évite 12.000000001 → 13
    const r = (lower ? Math.floor(q) : Math.ceil(q)) * step;
    return U.round(r, 2);
  }

  /* ───────── Repères HYROX (indicatifs) ─────────
   * Temps moyens d'après des agrégateurs de résultats (fourchettes variables selon la source). */
  const HYROX_REF = {
    solo: { men: { value: 5700, label: 'moyenne Solo Open hommes ≈ 1:35' }, women: { value: 6600, label: 'moyenne Solo Open femmes ≈ 1:50' } },
    doubles: {
      men: { value: 4740, label: 'moyenne Doubles hommes ≈ 1:19' },
      mixed: { value: 5100, label: 'moyenne Doubles mixte ≈ 1:25' },
      women: { value: 5280, label: 'moyenne Doubles femmes ≈ 1:28' },
    },
  };
  function hyroxReference(division, category) {
    const d = HYROX_REF[division] || null;
    return (d && d[category]) || null;
  }

  /* ───────── Définition des tests ───────── */

  const ICP_NOTE = 'à vérifier pour ton département';

  const benchmarks = [
    // — SSA (valeurs officielles : extraits d'organismes, circulaire non lue → confiance moyenne)
    {
      id: 'ssa_entry_test', name: "Test d'entrée SSA (100 m)", short: "Test d'entrée", unit: 'time', lower: true, goal: 'ssa', cat: 'sauvetage',
      protocol: "Bassin de 25 ou 50 m, 100 m continu sans appui : départ plongé, 25 m dont au moins 15 m en immersion complète, 50 m de crawl, 25 m sur le dos mains hors de l'eau. Chrono du signal au toucher. Apnée seulement accompagné, sans hyperventiler.",
      official: { value: 165, label: "2:45 maximum, validé par un MNS. Une source cite 2:00 : fais confirmer par ton organisme.", source: SRC.ffss, confidence: 'moyenne' },
      target: { value: 135, label: "2:15 : 30 s de marge pour passer même un jour sans (stress, plongeon raté). Si ton organisme annonce 2:00, vise 1:50." },
      exId: 'ssa_entry_test',
    },
    {
      id: 'ssa_tsa_course', name: 'TSA — parcours de sauvetage 100 m', short: 'Parcours TSA', unit: 'time', lower: true, goal: 'ssa', cat: 'sauvetage',
      protocol: "Plongeon, 15 m en immersion + 10 m de nage, 25 m de crawl, 15 m en immersion + 10 m, approche tête hors de l'eau, canard jusqu'au mannequin (1,80 à 2,80 m), remorquage jusqu'au bord de départ. Visage du mannequin immergé plus de 3 s = échec. Uniquement encadré.",
      official: { value: 150, label: '2:30 maximum (épreuve 1 du TSA). Valeur à confirmer avec la circulaire.', source: SRC.tsa, confidence: 'moyenne' },
      target: { value: 125, label: '2:05 : 25 s de marge. La remontée et le remorquage du mannequin coûtent plus cher le jour J.' },
      exId: 'ssa_tsa_course',
    },
    {
      id: 'ssa_tsa_fins', name: 'TSA — 300 m palmes (chaussage compris)', short: '300 m palmes', unit: 'time', lower: true, goal: 'ssa', cat: 'sauvetage',
      protocol: "Tu attends au bord sans tes palmes : le chrono part au signal, chaussage compris. 300 m en nage ventrale (lunettes, masque et tuba autorisés). Si tu perds une palme, la distance nagée sans elle ne compte pas.",
      official: { value: 270, label: '4:30 maximum (épreuve 2 du TSA, au moins 10 min après le parcours). Une source cite 5:30 : à confirmer.', source: SRC.ffss, confidence: 'moyenne' },
      target: { value: 235, label: '3:55 : 35 s de marge, soit ~1:13 au 100 m avec ~15 s de chaussage.' },
      exId: 'fins_300',
    },
    {
      id: 'apnea_dyn', name: 'Apnée dynamique', short: 'Apnée', unit: 'm', lower: false, goal: 'ssa', cat: 'apnee',
      protocol: "Distance nagée en immersion complète (poussée au mur ou plongeon : précise-le en note). Jamais seul : binôme ou MNS prévenu qui te regarde, 1 à 2 inspirations normales, pas d'hyperventilation. Arrête au moindre signe (picotements, vision qui se rétrécit).",
      official: { value: 15, label: "Au moins 15 m en immersion complète, deux fois dans le parcours TSA et une fois au test d'entrée.", source: SRC.ffss, confidence: 'moyenne' },
      target: { value: 18, label: "18 m : 3 m de marge, pas plus. Au-delà, le risque de syncope augmente sans rien t'apporter pour l'examen (+1 à 2,5 m par semaine au maximum)." },
      exId: 'apnea_dynamic', safety: true,
    },
    {
      id: 'duck_depth', name: 'Profondeur en plongée canard', short: 'Canard', unit: 'm', lower: false, goal: 'ssa', cat: 'apnee',
      protocol: "Profondeur (en m) à laquelle tu remontes un objet lesté ou le mannequin après une plongée canard depuis la surface. Note la profondeur de la fosse. Toujours accompagné.",
      official: { value: 2.8, label: 'Le mannequin repose entre 1,80 et 2,80 m : tu dois pouvoir aller le chercher au plus profond.', source: SRC.tsa, confidence: 'moyenne' },
      target: { value: 3, label: '3 m si la fosse le permet (sinon la profondeur maximale de ta piscine), pour être à l\'aise à 2,80 m.' },
      exId: 'duck_dive_depth', safety: true,
    },
    {
      id: 'swim_100', name: '100 m crawl', short: '100 m', unit: 'time', lower: true, goal: 'ssa', cat: 'natation',
      protocol: "100 m crawl en surface, sans palmes, départ dans l'eau (ou plongé : note-le). Chrono du départ au toucher.",
      official: null,
      target: { value: 100, label: "1:40 : pas d'exigence officielle, mais certains clubs demandent moins de 1:30 en sélection. Vise 1:30 si ton organisme l'exige." },
      exId: 'swim_100_test',
    },
    {
      id: 'swim_400', name: '400 m crawl', short: '400 m', unit: 'time', lower: true, goal: 'ssa', cat: 'natation',
      protocol: "400 m crawl continu à allure régulière, départ dans l'eau. C'est ton repère d'endurance en natation.",
      official: null,
      target: { value: 450, label: "7:30 : repère personnel (≈ 1:52 au 100 m), pas d'exigence officielle. À ajuster après ton premier test." },
      exId: 'swim_400_test',
    },
    {
      id: 'swim_50', name: '50 m nage libre', short: '50 m', unit: 'time', lower: true, goal: 'pompier', goals: ['pompier', 'ssa'], cat: 'natation',
      protocol: "50 m nage libre, départ plongé ou dans l'eau selon le service (certains SDIS interdisent les lunettes). Chrono du signal au toucher.",
      exId: 'swim_50_test', bareme: true,
    },
    {
      id: 'swim_back_25', name: '25 m dos jambes seules (mains hors de l\'eau)', short: '25 m dos', unit: 'time', lower: true, goal: 'ssa', cat: 'natation',
      protocol: "25 m sur le dos, les deux mains hors de l'eau, poignets au-dessus de la surface : seules les jambes avancent (rétropédalage ou ciseaux). C'est le segment le plus lent du test d'entrée.",
      official: null,
      target: { value: 45, label: "45 s : repère (pas d'exigence séparée). Ça laisse ~1:30 pour le 25 m plongé et le 50 m crawl dans ton objectif de 2:15." },
      exId: 'swim_back_25_test',
    },

    // — HYROX (objectif « finir » : aucun chrono imposé, cibles = repères indicatifs)
    {
      id: 'run_1k', name: '1 km course', short: '1 km', unit: 'time', lower: true, goal: 'hyrox', goals: ['hyrox', 'general'], cat: 'course',
      protocol: '1 km à fond après 10 à 15 min d\'échauffement, sur piste ou parcours plat (ou tapis à 1 % de pente : note-le).',
      official: null,
      target: { value: 270, label: 'Repère indicatif (objectif : finir) : ~4:30 à frais. En course, ne pars jamais le 1er km à cette allure : 70 % des athlètes partent trop vite.', indicative: true },
      exId: 'run_1k_test',
    },
    {
      id: 'run_5k', name: '5 km course', short: '5 km', unit: 'time', lower: true, goal: 'hyrox', goals: ['hyrox', 'general'], cat: 'course',
      protocol: '5 km chronométré sur parcours plat, allure régulière, après échauffement.',
      official: null,
      target: { value: 1500, label: 'Repère indicatif : 25:00 (5:00/km). En HYROX, l\'allure de course est ~15 à 30 s/km plus lente que ton allure 5 km.', indicative: true },
      exId: 'run_5k_test',
    },
    {
      id: 'run_10k', name: '10 km course', short: '10 km', unit: 'time', lower: true, goal: 'hyrox', goals: ['hyrox', 'general'], cat: 'course',
      protocol: '10 km chronométré (course ou sortie test), parcours plat de préférence.',
      official: null,
      target: { value: 3300, label: 'Repère indicatif d\'endurance : 55:00. Une course HYROX dure plus d\'1 h : un 10 km confortable montre que la base est là.', indicative: true },
      exId: null,
    },
    {
      id: 'row_1000', name: 'Rameur 1000 m', short: 'Rameur', unit: 'time', lower: true, goal: 'hyrox', cat: 'hyrox',
      protocol: '1000 m au rameur, départ arrêté, damper vers 6 (réglage par défaut en course).',
      official: null,
      target: { value: 240, label: 'Repère indicatif : ~4:00 à frais. En course, la moyenne hommes Open est ~4:45 (fatigué). En Doubles, vous vous relayez.', indicative: true },
      exId: 'row_1000_test',
    },
    {
      id: 'skierg_1000', name: 'SkiErg 1000 m', short: 'SkiErg', unit: 'time', lower: true, goal: 'hyrox', cat: 'hyrox',
      protocol: '1000 m au SkiErg, départ arrêté, damper vers 6.',
      official: null,
      target: { value: 255, label: 'Repère indicatif : ~4:15 à frais. En course, la moyenne est ~4:20-4:30 chez les hommes Open, ~5:05 chez les femmes.', indicative: true },
      exId: 'skierg_1000_test',
    },
    {
      id: 'wall_balls_100', name: '100 wall balls', short: 'Wall balls', unit: 'time', lower: true, goal: 'hyrox', cat: 'hyrox',
      protocol: "100 wall balls au poids de ta division (Open : 6 kg à 3 m pour les hommes, 4 kg à 2,70 m pour les femmes). Hanche sous le genou en bas, centre du ballon sur la cible. Fractionne comme tu veux, le chrono tourne.",
      official: null,
      target: { value: 360, label: 'Repère indicatif : ~6:00 à frais. En course, la moyenne est 6:00 à 7:30. En Doubles, vous vous partagez les 100.', indicative: true },
      exId: 'wall_balls_100_test',
    },
    {
      id: 'hyrox_sim', name: 'Simulation HYROX complète', short: 'Simulation', unit: 'time', lower: true, goal: 'hyrox', cat: 'hyrox',
      protocol: '8 × (1 km + station) dans l\'ordre officiel, aux distances et charges de ta division. Si c\'est une simulation partielle ou à deux, note-le.',
      official: null,
      target: {
        value: 6840, indicative: true, bySex: { H: 6840, F: 7800 },
        label: 'Repère indicatif pour une simulation seul aux charges Open : sous 1:54 (hommes) ou 2:10 (femmes) = niveau débutant. À deux, le temps baisse.',
      },
      exId: null,
    },
    {
      id: 'hyrox_race', name: 'Course HYROX (temps officiel)', short: 'Course HYROX', unit: 'time', lower: true, goal: 'hyrox', cat: 'hyrox',
      protocol: 'Ton temps officiel total (course + stations + Roxzone). Note la division et la catégorie.',
      official: null,
      target: { value: 5700, indicative: true, bySex: { H: 5700, F: 6600 }, label: 'Objectif : finir. Repère indicatif : moyenne Solo Open ≈ 1:35 (hommes), 1:50 (femmes).' },
      exId: null,
    },

    // — Pompier (seuils = barèmes ; official/target statiques calculés plus bas pour la catégorie de référence)
    {
      id: 'luc_leger', name: 'Luc Léger (navette 20 m)', short: 'Luc Léger', unit: 'palier', lower: false, goal: 'pompier', goals: ['pompier', 'general'], cat: 'course',
      protocol: "Navettes de 20 m au rythme des bips, +0,5 km/h chaque minute. Ton score = dernier palier (ou demi-palier) terminé. Note la version de la bande (départ 8,5 ou 8 km/h) : le même palier n'a pas la même vitesse.",
      exId: 'luc_leger', bareme: true,
    },
    {
      id: 'chinups', name: 'Tractions supination (ICP)', short: 'Tractions supi.', unit: 'reps', lower: false, goal: 'pompier', cat: 'force',
      protocol: 'Prise en supination (paumes vers toi), départ bras tendus, menton au-dessus de la barre à chaque répétition, sans élan, pas de pause de plus de 3 s.',
      exId: 'test_chinup_max', bareme: true,
    },
    {
      id: 'pullups', name: 'Tractions pronation', short: 'Tractions', unit: 'reps', lower: false, goal: 'pompier', goals: ['pompier', 'hyrox', 'general'], cat: 'force',
      protocol: "Prise en pronation (paumes vers l'avant), départ bras tendus, menton au-dessus de la barre, sans élan. Les tests pompier se passent souvent en supination : fais aussi ce test-là.",
      exId: 'test_pullup_max', bareme: true,
      fallbackTarget: { value: 10, label: '10 tractions strictes : repère de bon niveau (pas de seuil connu en pronation, sauf « au moins 3 » au BMPM).' },
    },
    {
      id: 'pushups', name: 'Pompes en cadence (ICP)', short: 'Pompes', unit: 'reps', lower: false, goal: 'pompier', goals: ['pompier', 'general'], cat: 'force',
      protocol: 'Pompes à cadence imposée (environ 1 toutes les 2 s, au métronome), poitrine à ~5 cm du sol, corps gainé. Le test s\'arrête quand tu décroches de la cadence.',
      exId: 'pushup_cadence', bareme: true,
    },
    {
      id: 'plank', name: 'Gainage (planche)', short: 'Gainage', unit: 'time', lower: false, goal: 'pompier', goals: ['pompier', 'general'], cat: 'gainage',
      protocol: 'Planche sur les avant-bras et les orteils, pieds écartés d\'environ 10 cm, corps aligné. Tiens le plus longtemps possible ; arrêt dès que le bassin monte ou s\'affaisse.',
      exId: 'test_plank_max', bareme: true,
    },
    {
      id: 'wall_sit', name: 'Chaise contre le mur (Killy)', short: 'Killy', unit: 'time', lower: false, goal: 'pompier', cat: 'force',
      protocol: 'Dos plaqué au mur, cuisses à 90°, sans appui des mains sur les cuisses. Tiens le plus longtemps possible.',
      exId: 'test_wall_sit_max', bareme: true,
    },
    {
      id: 'sit_reach', name: 'Souplesse (flexion avant)', short: 'Souplesse', unit: 'cm', lower: false, goal: 'pompier', cat: 'mobilite',
      protocol: "Assis jambes tendues (genoux maintenus), pieds contre la boîte, pousse la règle le plus loin possible sans à-coup. Mesure en cm sur une boîte graduée (protocole ICP : zéro décalé de 15 cm par rapport aux pieds, à vérifier avec ton service).",
      exId: 'sit_and_reach', bareme: true,
    },

    // — Archivés (historique de la v1, non comparables)
    {
      id: 'ssa_test_v1', name: 'Ancien test SSA (v1, non comparable)', short: 'Ancien test SSA', unit: 'time', lower: true, goal: 'ssa', cat: 'sauvetage',
      protocol: "Ancien format de la v1 (100 m en moins de 3:45, repris du test TASA de l'Éducation nationale) : ce n'est pas l'épreuve SSA. Gardé pour l'historique.",
      official: null, target: null, exId: null, archived: true,
    },
    {
      id: 'swim_300', name: '300 m crawl (v1)', short: '300 m', unit: 'time', lower: true, goal: 'ssa', cat: 'natation',
      protocol: '300 m crawl continu (test de la v1, gardé pour l\'historique).',
      official: null, target: null, exId: null, archived: true,
    },
  ];

  // Anciens identifiants (v1) → identifiants actuels.
  const BENCH_ALIASES = { ssa_test: 'ssa_test_v1', apnea: 'apnea_dyn', leger: 'luc_leger' };

  const byId = {};
  for (const b of benchmarks) {
    b.goals = b.goals || [b.goal];
    b.step = UNIT_STEP[b.unit] || 1;
    byId[b.id] = b;
  }
  const getBenchmark = (id) => byId[id] || byId[BENCH_ALIASES[id]] || null;

  /* ───────── Mise en forme et comparaison ───────── */

  // Valeur lisible (texte brut, à échapper avant insertion HTML) : "2:45", "palier 9,5", "18 m", "26 cm", "12".
  function formatBench(idOrUnit, value) {
    const b = getBenchmark(idOrUnit);
    const unit = b ? b.unit : idOrUnit;
    if (value == null || value === '' || !isFinite(value)) return '—';
    switch (unit) {
      case 'time': return U.formatDuration(value);
      case 'reps': return U.fmtNum(value, 0);
      case 'palier': return `palier ${U.fmtNum(value, 1)}`;
      case 'm': return `${U.fmtNum(value, 2)} m`;
      case 'cm': return `${U.fmtNum(value, 1)} cm`;
      case 'kg': return `${U.fmtNum(value, 1)} kg`;
      case 'km': return `${U.fmtNum(value, 2)} km`;
      default: return U.fmtNum(value, 2);
    }
  }

  // a meilleur que b ?
  function isBetter(benchId, a, b) {
    const bm = getBenchmark(benchId);
    if (a == null || !isFinite(a)) return false;
    if (b == null || !isFinite(b)) return true;
    return bm && bm.lower ? a < b : a > b;
  }
  // value atteint le seuil ?
  function meets(benchId, value, threshold) {
    const bm = getBenchmark(benchId);
    if (value == null || threshold == null || !isFinite(value) || !isFinite(threshold)) return false;
    return bm && bm.lower ? value <= threshold : value >= threshold;
  }

  /* ───────── Cibles statiques des tests pompier (catégorie de référence) ─────────
   * Catégorie « hommes, 29 ans et moins », barème SDIS 91 + 20 %. targetFor() personnalise. */
  for (const b of benchmarks.filter((x) => x.bareme)) {
    const v = baremeValue(DEFAULT_BAREME, b.id, 'H', '<29');
    const icp = baremeValue('icp', b.id, 'H', '<29');
    const src = getBareme(DEFAULT_BAREME);
    b.official = v == null ? null : {
      value: v, label: `${src.short} (${src.dateLabel}), hommes 29 ans et moins : ${formatBench(b.id, v)} — ${ICP_NOTE}.`,
      note: (src.benchNotes && src.benchNotes[b.id]) || '', source: src.source, confidence: src.confidence,
    };
    if (v != null) b.target = { value: withMargin(v, b.lower, b.unit), label: `${formatBench(b.id, v)} + 20 % de marge (règle par défaut).` };
    else if (icp != null) b.target = { value: icp, label: `Niveau ICP standard (hommes 18-29 ans) : pas de seuil de recrutement connu pour ce test.` };
    else b.target = b.fallbackTarget || null;
  }

  /* ───────── Cible personnalisée ───────── */

  const activeGoals = (opts) => {
    const list = Array.isArray(opts.goals) ? opts.goals : (C.state && Array.isArray(C.state.goals) ? C.state.goals : []);
    return list.filter((g) => g && g.status !== 'archived' && g.status !== 'done')
      .sort((a, b) => (a.priority || 2) - (b.priority || 2));
  };
  const firstGoal = (opts, type) => (opts.goal && opts.goal.type === type ? opts.goal : activeGoals(opts).find((g) => g.type === type) || null);

  // Barème à utiliser : option explicite (id ou objet) → barème de l'objectif pompier → service visé → SDIS 91 (exemple).
  const PATH_BAREME = { bspp: 'bspp', bmpm: 'bmpm', 'spv-differencie': null };
  function resolveBareme(choice, goal) {
    if (choice && typeof choice === 'object' && choice.values) return choice;
    if (typeof choice === 'string' && getBareme(choice)) return getBareme(choice);
    const d = (goal && goal.details) || {};
    if (d.bareme && getBareme(d.bareme)) return getBareme(d.bareme);
    if (PATH_BAREME[d.path]) return getBareme(PATH_BAREME[d.path]);
    const digits = String(d.department || '').replace(/\D/g, '');
    if (digits && getBareme('sdis' + digits.padStart(2, '0'))) return getBareme('sdis' + digits.padStart(2, '0'));
    return getBareme(DEFAULT_BAREME);
  }

  const SSA_TARGET_KEYS = { ssa_entry_test: 'entry', ssa_tsa_course: 'tsa', ssa_tsa_fins: 'fins' };

  // Objectif perso lié à ce test (goal.type 'custom', details.benchId + details.targetValue).
  function customTarget(benchId, opts) {
    const g = activeGoals(opts).find((x) => x.type === 'custom' && x.details && x.details.benchId === benchId && U.num(x.details.targetValue) != null);
    return g ? { value: U.num(g.details.targetValue), label: `Ton objectif perso : ${g.name || 'objectif'}.`, personal: true } : null;
  }

  function summary(b, official, target, extra) {
    const parts = [];
    if (official) parts.push(`Seuil : ${formatBench(b.id, official.value)}`);
    if (target) parts.push(`${target.indicative ? 'Repère' : 'Cible'} : ${formatBench(b.id, target.value)}`);
    if (extra) parts.push(extra);
    return parts.join(' · ') || 'Pas de seuil connu : suis ta progression.';
  }

  /* targetFor(benchId, profile, { bareme, atDate, goals, goal, margin })
   * → { official, target, label, bareme, icp, sex, ageBand, assumed:[…] } ou null si test inconnu.
   * Pompier : seuil du barème (sexe + tranche d'âge à la date de candidature) + 20 % de marge par défaut,
   * et la valeur ICP standard si elle est connue. Pour les tests « plus bas = mieux », la marge réduit le temps. */
  function targetFor(benchId, profile, opts = {}) {
    const b = getBenchmark(benchId);
    if (!b) return null;
    const p = profile || {};
    const o = opts || {};
    const assumed = [];
    const sex = p.sex === 'H' || p.sex === 'F' ? p.sex : null;

    if (!b.bareme) {
      let target = b.target ? { ...b.target } : null;
      if (target && target.bySex) {
        const s = sex || 'H';
        if (!sex) assumed.push('sexe');
        target.value = target.bySex[s];
      }
      if (b.id === 'hyrox_race' || b.id === 'hyrox_sim') {
        const hg = firstGoal(o, 'hyrox');
        const d = (hg && hg.details) || {};
        const ref = b.id === 'hyrox_race' && hyroxReference(d.division, d.category);
        if (ref) target = { value: ref.value, indicative: true, label: `Objectif : finir. Repère indicatif : ${ref.label} (pas un objectif).` };
      }
      const sg = SSA_TARGET_KEYS[b.id] && firstGoal(o, 'ssa');
      const own = sg && sg.details && sg.details.targets && U.num(sg.details.targets[SSA_TARGET_KEYS[b.id]]);
      if (own != null && own > 0) target = { value: own, label: 'Ta cible (réglée dans ton objectif SSA).', personal: true };
      const perso = customTarget(b.id, o);
      if (perso) target = perso;
      return { official: b.official ? { ...b.official } : null, target, label: summary(b, b.official, target), bareme: null, icp: null, sex, ageBand: null, assumed };
    }

    // — Pompier
    const goal = firstGoal(o, 'pompier');
    const gd = (goal && goal.details) || {};
    const atDate = U.isKey(o.atDate) ? o.atDate : U.isKey(gd.applyDate) ? gd.applyDate : goal && U.isKey(goal.date) ? goal.date : U.todayKey();
    const s = sex || 'H';
    if (!sex) assumed.push('sexe');
    let band = ageBand(p.birthYear, atDate);
    if (!band) { band = '<29'; assumed.push('âge'); }
    const pct = U.num(o.margin) != null ? U.num(o.margin) : U.num(gd.marginPct) != null ? U.num(gd.marginPct) : DEFAULT_MARGIN;

    const chosen = resolveBareme(o.bareme, goal);
    let used = chosen;
    let v = baremeValue(chosen, b.id, s, band);
    let fallback = false;
    if (v == null && chosen.id !== DEFAULT_BAREME && (chosen.toComplete || chosen.noPhysicalTest || !Object.keys(chosen.values || {}).length)) {
      // Barème vide (à compléter, pas de test physique connu) : on s'appuie sur l'exemple par défaut.
      const v2 = baremeValue(DEFAULT_BAREME, b.id, s, band);
      if (v2 != null) { v = v2; used = getBareme(DEFAULT_BAREME); fallback = true; }
    }
    const cat = `${SEX_LABELS[s]}, ${AGE_BAND_LABELS[band]}`;
    const icpV = baremeValue('icp', b.id, s, band);
    const noteOf = (bar) => (bar && bar.benchNotes && bar.benchNotes[b.id]) || '';
    const icp = icpV == null ? null : {
      value: icpV, label: `ICP standard (${cat}) : ${formatBench(b.id, icpV)}`, note: noteOf(getBareme('icp')),
      source: s === 'F' ? SRC.icpF : SRC.icpH, confidence: 'moyenne',
    };

    const official = v == null ? null : {
      value: v,
      label: `${used.short}${used.dateLabel ? ` (${used.dateLabel})` : ''}, ${cat} : ${formatBench(b.id, v)}${fallback ? ` — exemple en attendant ton barème (${chosen.short})` : ''} — ${ICP_NOTE}.`,
      note: noteOf(used), source: used.source, confidence: used.confidence, baremeId: used.id,
    };
    const pctTxt = `${Math.round(pct * 100)} %`;
    let target = null;
    if (official) target = { value: withMargin(v, b.lower, b.unit, pct), label: `${formatBench(b.id, v)} + ${pctTxt} de marge (pour passer dans la majorité des cas).` };
    else if (icp) target = { value: icpV, label: `Pas de seuil connu dans ce barème : vise le niveau ICP standard (${formatBench(b.id, icpV)}), plus exigeant que le recrutement.` };
    else if (b.fallbackTarget) target = { ...b.fallbackTarget };
    const perso = customTarget(b.id, o);
    if (perso) target = perso;

    return {
      official, target,
      label: summary(b, official, target, icp && icp.value !== (target && target.value) ? `ICP standard : ${formatBench(b.id, icp.value)}` : ''),
      bareme: { id: chosen.id, label: chosen.label, short: chosen.short, confidence: chosen.confidence, note: chosen.note, fallback, toComplete: !!chosen.toComplete },
      icp, sex: s, ageBand: band, assumed, marginPct: pct,
    };
  }

  /* benchStatus(benchId, value, ref) → { level, text } où ref = targetFor(…) ou { official, target }.
   * level : 'cible' (marge atteinte) · 'reussi' (seuil atteint) · 'proche' (à moins de 10 %) · 'loin' · null (pas de mesure). */
  function benchStatus(benchId, value, ref) {
    const b = getBenchmark(benchId);
    if (!b || value == null || !isFinite(value)) return { level: null, text: 'Pas encore de mesure.' };
    const off = ref && ref.official ? ref.official.value : null;
    const tgt = ref && ref.target ? ref.target.value : null;
    if (tgt != null && meets(benchId, value, tgt)) return { level: 'cible', text: ref.target.indicative ? 'Repère atteint.' : 'Cible atteinte, avec de la marge.' };
    if (off != null && meets(benchId, value, off)) return { level: 'reussi', text: 'Seuil atteint, pas encore la marge.' };
    const ref1 = off != null ? off : tgt;
    if (ref1 == null) return { level: null, text: 'Pas de seuil connu.' };
    const near = b.lower ? value <= ref1 * 1.1 : value >= ref1 * 0.9;
    return near ? { level: 'proche', text: off != null ? 'Presque au seuil.' : 'Presque au repère.' } : { level: 'loin', text: 'Encore du travail.' };
  }

  /* ───────── Luc Léger : vitesse et VMA estimée (version adulte 1988, départ 8,5 km/h) ───────── */
  // Vitesse de navette au palier p (km/h). version '8' = bande « militaire » qui part à 8 km/h.
  function legerSpeed(palier, version = '8.5') {
    const p = U.num(palier);
    if (p == null || p < 1) return null;
    const start = String(version) === '8' ? 8 : 8.5;
    return U.round(start + 0.5 * (p - 1), 2);
  }
  // VMA piste approximative (km/h) : VO2max = −24,4 + 6 × V ; VMA ≈ VO2max / 3,5. Estimation, à prendre avec prudence.
  function legerVma(palier, version) {
    const v = legerSpeed(palier, version);
    return v == null ? null : U.round((-24.4 + 6 * v) / 3.5, 1);
  }

  Object.assign(D, {
    benchmarks, baremes, BENCH_ALIASES, AGE_BANDS, AGE_BAND_LABELS, BENCH_UNIT_STEP: UNIT_STEP, DEFAULT_BAREME, DEFAULT_MARGIN,
    getBenchmark, getBareme, baremeValue, ageBand, withMargin, targetFor, formatBench, isBetter, meets, benchStatus,
    hyroxReference, legerSpeed, legerVma,
  });
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
