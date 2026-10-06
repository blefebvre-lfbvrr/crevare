# Crevare v2 — architecture et contrats entre modules

Application web mobile (PWA) **sans build, sans dépendance, sans serveur**. Données **uniquement** dans le
`localStorage` de l'appareil. Cible principale : iPhone (Safari / app installée sur l'écran d'accueil).
Aussi publiable en page unique (`tools/build_single.py`) dans un cadre claude.ai : pas de service worker,
pas de `confirm()/alert()/prompt()`, pas de téléchargement direct, URL non modifiable.

Langue de l'interface : **français**, tutoiement, phrases courtes, pas de jargon technique.

## Règles de code (obligatoires)

- Scripts classiques (pas de modules ES). Chaque fichier est enveloppé :
  ```js
  (function (C) {
    'use strict';
    const U = C.util; const esc = U.esc;
    // …
    C.monModule = { … };
  })(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
  ```
  Aucune variable globale hors `window.Crevare` (alias `C`).
- Ordre de chargement : voir `index.html` (core → data → platform → ui → app.js en dernier).
  Un module peut référencer un autre module **à l'exécution** (dans une fonction), jamais au chargement
  du fichier (sauf `C.util`, `C.schema`, `C.ui`, `C.route`, `C.action`… qui sont disponibles : `app.js`
  définit `C.route/C.action` en dernier, donc **enregistrer routes et actions dans un `C.bootHooks.push(() => {…})`**
  OU en appelant `C.route` etc. après chargement — voir « Enregistrement » ci-dessous).
- **Tout texte dynamique inséré en HTML passe par `esc()`**, y compris nombres et identifiants venant de l'état.
- Jamais de `confirm/alert/prompt` : utiliser `await C.ui.ask(message, libelléOui, {danger})`.
- Jamais de `innerHTML` partiel hors de la vue courante, sauf zones dédiées (minuteur, toasts) identifiées par id.
- Dates : clés locales `AAAA-MM-JJ` via `C.util` (jamais `toISOString().slice(0,10)`, qui est en UTC).
- Durées : secondes (nombre). Saisie via `C.ui.timeInput({...})`, lecture via `C.ui.readTime(input)` ou `U.parseDuration`.
- Distances : mètres pour la natation (`m`), kilomètres pour la course (`km`). Charges : kg.
- Accessibilité : boutons = `<button>`, libellés sur tous les champs (`aria-label` ou `<label>`), cibles ≥ 44 px,
  états avec `aria-pressed` / `aria-current`, contrastes via les jetons CSS de `css/base.css` uniquement.
- CSS : un fichier par module (`css/<module>.css`), n'utilisant que les variables de `base.css`
  (`--bg --surface --surface-2 --surface-3 --border --text --muted --accent --accent-2 --ok --warn --danger --info
  --loc-* --goal-*`). Préfixer les classes par le module (`.ses-…`, `.tmr-…`, `.prg-…`).
  Classes partagées disponibles : `.card .card-head .btn(.ghost .small .block .danger .danger-solid) .icon-btn
  .badge .tag .pill(.ok .warn .danger) .note(.warn .danger .ok) .field(.inline) .check-row .seg .list .menu
  .muted .small .tiny .center .num .row .col .between .end .gap .gap-lg .wrap .grow .mt .mb .top .back .empty`.
- Pas de bibliothèque externe. Pas de requête réseau.

## Enregistrement (routes, actions, menu)

`js/app.js` est chargé en dernier mais **définit `C.route`, `C.action`, `C.onChange`, `C.onInput`, `C.onSubmit`,
`C.menuItem` dès son exécution**, puis démarre. Les modules doivent donc s'enregistrer via :

```js
(C.bootHooks = C.bootHooks || []).push(() => {
  C.route('#/progres', viewProgress, { tab: '#/progres', title: 'Progrès' });
  C.action('progres.ajouter', (el) => { … });
  C.menuItem({ hash: '#/habitudes', icon: '✅', label: 'Habitudes', desc: 'Suivi quotidien', order: 30 });
});
```
Les `bootHooks` s'exécutent après le chargement des données (`C.state` disponible), avant le premier rendu.

- `C.route(pattern, view, {tab, title})` : `view(params)` renvoie une chaîne HTML **ou** `{ html, after($app) }`
  (`after` sert à brancher des écouteurs spécifiques, démarrer une animation…). Paramètres `:nom` et query `?a=b`.
- Noms d'actions **préfixés par module** (`seance.`, `biblio.`, `chrono.`, `progres.`, `habit.`, `corps.`,
  `objectif.`, `profil.`, `reglages.`, `sante.`, `plan.`, `today.`).
  - `data-action="x"` → `C.action('x', (el, ev) => …)` (clic)
  - `data-change="x"` → `C.onChange('x', (el, ev) => …)`
  - `data-input="x"` → `C.onInput('x', (el, ev) => …)`
  - `<form data-form="x">` → `C.onSubmit('x', (form, formData, ev) => …)`
- Navigation : liens `<a href="#/...">` ou `C.go('#/...')`. Retour : `C.back(fallback)`.
- Re-rendu : `C.store.update(fn)` enregistre **et re-rend** la vue ; `C.store.update(fn, {silent:true})`
  enregistre sans re-rendre (saisie en cours dans un champ). `C.rerender()` force un rendu en gardant le défilement.

## Routes (propriétaire)

| Route | Contenu | Module |
|---|---|---|
| `#/` | Aujourd'hui | `ui/today.js` |
| `#/plan`, `#/plan/:monday` | Semaine (plan) | `ui/plan.js` |
| `#/plan-apercu` | Vue d'ensemble des blocs jusqu'aux objectifs | `ui/plan.js` |
| `#/jour/:date` | Aperçu d'un jour, changer/déplacer la séance, démarrer | `ui/plan.js` |
| `#/seance/:id` | Séance en cours / terminée (saisie) | `ui/session.js` |
| `#/bibliotheque` | Bibliothèque d'exercices (filtres) | `ui/library.js` |
| `#/exercice/:id` | Fiche exercice + historique | `ui/library.js` |
| `#/mes-seances`, `#/mes-seances/:id` | Séances perso (liste, création, édition) | `ui/library.js` |
| `#/chrono`, `#/chrono/:mode` | Chronomètre, minuteur, intervalles, tests chronométrés | `ui/timer.js` |
| `#/progres`, `#/progres/:benchId` | Tests de référence, charge, régularité | `ui/progress.js` |
| `#/habitudes` | Habitudes | `ui/habits.js` |
| `#/corps` | Poids et alimentation, check-in | `ui/habits.js` |
| `#/objectifs`, `#/objectifs/:id` | Objectifs, jalons, démarches | `ui/goals.js` |
| `#/bienvenue` | Questionnaire de départ (affiché tant que `profile.onboarded` est faux) | `ui/onboarding.js` |
| `#/reglages` | Profil, piscines, matériel, dispos, blessures, thème, voix | `ui/settings.js` |
| `#/sante` | Import Apple Santé (Raccourcis iOS), export calendrier | `ui/settings.js` + `platform/health.js` |
| `#/donnees` | Sauvegarde / restauration | `ui/settings.js` |
| `#/agenda`, `#/agenda/:date` | Agenda (cours, Protection civile, sport, révisions) jour/semaine | `ui/agenda.js` |
| `#/agenda-reglages` | Calendriers importés, matières, examens, règles de révision | `ui/agenda.js` |
| `#/plus` | Menu (fourni par `app.js`) — « Progrès » y figure en premier | `app.js` |

Onglets du bas : Aujourd'hui `#/` · Sport `#/plan` · Agenda `#/agenda` · Chrono `#/chrono` · Plus `#/plus`.
`#/progres` est atteint depuis « Plus » (entrée `order: 1`) et depuis la carte de progression d'« Aujourd'hui » ;
la route `#/progres` déclare `{ tab: '#/plus' }`.

## Modèle de données (état v2)

Défini dans `js/core/schema.js` (`defaultState`, `migrate`, `sanitize`). Accès : `C.state`. Modification :
`C.store.update(st => { … })`. Résumé :

```
profile: { onboarded, firstName, birthYear, sex:'H'|'F'|null, department, futureLocations,
           injuries:[{id, zone:'genou'|'cheville'|…, side, note, active, since}],
           equipment:{ home:['barre','elastiques','halteres','kettlebell','lest','corde','step','tapis'], gym:{name, hyrox:bool} },
           pools:[{id, name, length:25|50, deepM, mannequin}], apneaBuddy:'' (club/binôme ; vide = personne),
           sessionsPerWeek, availableDays:[0..6] (0 = lundi), maxSessionMin, levels:{swim, run, strength} }
goals: [{ id, type:'ssa'|'hyrox'|'pompier'|'custom', name, date, dateEnd, priority:1|2|3, status:'active'|'done'|'archived',
          details:{…selon type, voir ci-dessous}, note, milestones:[{id, key?, title, due, done, doneAt, note}], result, createdAt }]
plan: { startDate, overrides: { [date]: { templateId } | { customSessionId } | { rest:true } | { free:true } } }
sessions: { [id]: Session }            // voir js/core/sessions.js
customExercises: [Exercise]           // même forme que la bibliothèque, id préfixé 'perso:'
customSessions: [{ id, name, loc, goals:[], intro, exercises:[{ exId, sets, reps, rest, note, target }], createdAt }]
timers: [{ id, name, voice:bool, rounds, prepSec, restBetweenRoundsSec, steps:[{ label, sec, kind:'work'|'rest' }] }]
habits: [{ id, name, icon, type:'check'|'number'|'avoid', target, unit, perWeek, cue, createdAt, archivedAt }]
habitLog: { [date]: { [habitId]: true | number } }
body: { [date]: { weight, food:'peu'|'normal'|'beaucoup' } }
checkins: { [date]: { sleep:1-5, energy:1-5, soreness:1-5, pain:{ genou:0-10, cheville:0-10, … }, note } }
benchmarks: { [benchId]: [{ id, date, value, context:'test'|'entrainement'|'officiel'|'ancien'|'sante', source, note }] }
health: { lastImportAt, workouts:[{ id, date, type, durationMin, distanceKm, kcal, hrAvg, linkedSessionId }] }
settings: { sound, voice, theme:'auto'|'light'|'dark', lastExportAt, exportReminderDays }
agenda: { sources:[{ id, name, url, kind:'cours'|'protection-civile'|'perso'|'sport', color, busy, lastSyncAt, lastError, count }],
          events:[{ id, sourceId, uid, title, start:'AAAA-MM-JJTHH:MM' (heure locale) | 'AAAA-MM-JJ' (journée), end, allDay, location, categories, status }],
          revision:{ enabled, latestEnd:'22:00', weekdayStart, weekendStart, bufferAfterMin, bufferBeforeMin, blockMin, breakMin,
                     minSlotMin, maxWeekdayMin, maxWeekendMin, meal:{start,end}, daysOff:[0..6], avoidTrainingDays, spacing:[0,1,7,30], horizonDays },
          subjects:[{ id, name, color, match:[mots-clés], ignore, weight:1|2|3 }], exams:[{ id, subjectId, date, title, source }],
          tasks:{ [id]: { id, subjectId, kind:'relecture'|'exercices'|'synthese'|'examen'|'libre', title, due, durationMin, sourceEventId, done, doneAt, skipped } },
          blocks:{ [blockId]: { done, doneAt, note } } }
```

`goal.details` par type :
- `ssa` : `{ organisme, ville, mention:'piscine'|'eaux-interieures'|'littoral', entryTestDate, trainingStart, trainingEnd, tsaDate, targets:{ entry, tsa, fins } }` (secondes)
- `hyrox` : `{ event, venue, raceDate, division:'solo'|'doubles'|'relay', category:'men'|'women'|'mixed', level:'open'|'pro', partner }`
- `pompier` : `{ path:'spv'|'spv-differencie'|'protection-civile'|'bspp'|'bmpm'|'militaire'|'indecis', department, applyDate }`
- `custom` : `{ discipline:'course'|'natation'|'force'|'autre', benchId }`

Session (instance enregistrée) :
```
{ id, date, source:'plan'|'perso'|'libre'|'v1', templateId, customSessionId, variant:'normal'|'allege'|'express'|'doux',
  title, loc, kind, goals:[], plannedMin, intro, safety:[texte], exercises:[ExerciseItem], log:{ [item.key]: [SetLog] },
  status:'in_progress'|'done'|'skipped', startedAt(ms), finishedAt(ms), durationMin, rpe(0-10), pain:{zone:0-10},
  feeling:'facile'|'ok'|'dur'|null, notes, poolId, poolLength, watch:{ hrAvg, kcal, distanceKm } | null }
ExerciseItem : { key, exId, name, track, sets, reps (texte de prescription), target:{reps, kg, sec, m, km}, rest (s),
  note, bench?: benchId, test?: bool (mesure de test → alimente « meilleur »), apnea?: bool, impact?: 0|1|2,
  timer?: TimerSpec (lancer le minuteur pour cet exercice), alt?: [exId] }
SetLog : { done:bool, measured:bool (false = « fait, non mesuré »), reps, kg, sec, m, km, palier, cm }
```

### Types de saisie (`track`)
`reps` {reps} · `load` {kg, reps} · `time` {sec} · `dist` {m} · `run` {km, sec} · `palier` {palier (ex. 8.5)} · `cm` {cm} · `check` {}

## Contrats entre modules

Chaque module **doit** exposer exactement ces fonctions (d'autres peuvent s'y ajouter).

### `js/data/exercises.js` → `C.data`
- `C.data.exercises` : tableau d'**exercices** :
  ```
  { id, name, short?, cat:'natation'|'apnee'|'sauvetage'|'course'|'hyrox'|'force'|'gainage'|'mobilite'|'prevention'|'cardio'|'test',
    goals:['ssa'|'hyrox'|'pompier'|'general'], locs:['maison'|'salle'|'piscine'|'dehors'], equipment:[…],
    track, defaultSets, defaultReps (texte), defaultRest (s), impact:0|1|2 (2 = sauts/réceptions), stress:['genou','cheville','epaule','dos','poignet'],
    apnea?:true (exige un accompagnement), description, cues:[…], mistakes:[…], safety?:[…],
    easier?:[exId], harder?:[exId], alt?:[exId] (remplacements, du plus proche au plus éloigné), muscles?:[…], bench?: benchId }
  ```
- `C.data.getExercise(id)` → exercice (bibliothèque **ou** `C.state.customExercises`) ou `null`.
- `C.data.searchExercises({ q, goal, loc, cat, lowImpact })` → tableau filtré.
- `C.data.EXERCISE_CATS` : `{ id: { label, icon } }`.
- **Identifiants obligatoires** : voir la liste canonique en bas de ce document (les séances y font référence).

### `js/data/benchmarks.js` → `C.data`
- `C.data.benchmarks` : `[{ id, name, unit:'time'|'reps'|'m'|'cm'|'kg'|'palier'|'km', lower:bool (plus bas = mieux),
  goal:'ssa'|'hyrox'|'pompier'|'general', cat, protocol (texte), official:{ value, label, source, confidence } | null,
  target:{ value, label } | null, exId?: exercice de test associé }]`
- `C.data.getBenchmark(id)`, `C.data.baremes` (barèmes pompier par source/âge/sexe), `C.data.targetFor(benchId, profile)`
  → `{ official, target, label }` en tenant compte de l'âge et du sexe quand c'est pertinent.

### `js/data/goals.js` → `C.data`
- `C.data.goalTemplates` : modèles d'objectifs (SSA, HYROX, pompier/protection civile, perso) avec jalons et démarches.
- `C.data.createGoalFromTemplate(templateId, overrides)` → objet goal prêt à insérer dans `state.goals`.
- `C.data.hyroxEvents` : courses connues (nom, lieu, dates, statut billetterie « à vérifier le … »).
- `C.data.hyroxStandards` : charges/distances par division et catégorie.

### `js/data/sessions.js` → `C.data.sessionTemplates`
- Objet `{ [templateId]: { id, title, loc, kind:'swim'|'gym'|'run'|'home'|'rehab'|'test'|'rest'|'event', goals, summary,
  build(ctx) → { title?, durationMin, intro, safety?:[…], exercises:[ExerciseItem sans key] } } }`.
- `ctx` (fourni par le planificateur) : `{ date, phase, weekInPhase, weekIndex, deload, taper, variant, profile, goals,
  goal (objectif principal du moment), hyrox (détails de l'objectif HYROX ou null), ssa (idem), level:'reprise'|'base'|'dev'|'spe',
  injuries:{ genou:bool, cheville:bool, … }, poolLength, best(benchId) → meilleure valeur connue ou null }`.

### `js/core/planner.js` → `C.planner`
- `C.planner.phase(date)` → `{ key:'reprise'|'base'|'developpement'|'specifique'|'affutage'|'jour-j'|'recuperation'|'entretien',
  label, goal (objet goal prioritaire ou null), weekInPhase, weekIndex (depuis plan.startDate), deload:bool, taper:bool, notes:[texte] }`
- `C.planner.day(date)` → `DayPlan { date, kind:'session'|'rest'|'event', templateId|null, customSessionId|null, title, loc,
  durationMin, optional:bool, bonus:[templateId] (mini-séances facultatives), event:{ goalId, title }|null, overridden:bool, reason }`
- `C.planner.week(monday)` → `[DayPlan × 7]`
- `C.planner.instantiate(date, { templateId?, customSessionId?, variant? })` → `{ templateId, title, loc, kind, goals, durationMin, intro,
  safety, exercises:[ExerciseItem] }` (contenu concret : séries/répétitions/charges cibles, adaptations blessures, allègement).
  Sans `templateId` ni `customSessionId` : la séance prévue ce jour-là (`day(date)`), overrides compris.
- `C.planner.macro(from, to)` → `[{ start, end, key, label, goalId }]` (frise des blocs).
- `C.planner.setOverride(date, override|null)` ; `C.planner.swapDays(dateA, dateB)`.
- `C.planner.choices(date)` → liste de `{ templateId|customSessionId, title, loc, durationMin, goals }` pour « changer la séance ».
- Variantes : `'normal'`, `'allege'` (−⅓ de volume), `'express'` (≤ 30 min, l'essentiel), `'doux'` (sans impact : remplace
  `impact ≥ 2` par la 1re alternative sans impact, course → vélo/elliptique/marche rapide si genou/cheville douloureux).

### `js/core/sessions.js` → `C.sessions` (fourni)
`all, get(id), forDate(date), main(date), isDone(date), doneBetween(from,to), build(date, opts), create(date, opts) → id,
open(date, opts) → id, remove(id), patchSet(id, key, i, patch), patch(id, fields, opts), addExercise(id, exId, item), durationOf(s)`.

### `js/core/metrics.js` → `C.metrics`
- `benchEntries(benchId, { contexts })`, `benchBest(benchId)` (contextes test + officiel), `benchLast(benchId)`,
  `benchTrend(benchId)` → `{ perMonth, direction:'mieux'|'moins-bien'|'stable', n }` ou `null`.
- `addBench(benchId, { date, value, context, source, note })` (remplace une entrée de même `source` et même `date`).
- `recordsFromSession(session)` → écrit les entrées de tests liées aux exercices `bench` d'une séance terminée.
- `exerciseHistory(exId, { limit })` → `[{ date, sessionId, sets }]` ; `lastPerformance(exId, beforeDate)` ;
  `suggestNext(item, history)` → `{ text, target }` (double progression : charge +2,5 kg haut / +5 kg bas quand toutes
  les séries atteignent le haut de la fourchette ; tractions : passer de négatives → élastique → strictes).
- `sessionLoad(session)` = durée (min) × RPE ; `weekLoad(monday)` ; `weekSummary(monday)` → `{ done, planned, minutes, load, byKind }`.
- `regularity(weeks)` → % séances faites / prévues (jours passés seulement, depuis `plan.startDate`).
- `habitStreak(habitId)` (série **tolérante** : un seul jour manqué ne casse pas la série ; deux jours de suite oui),
  `habitRate(habitId, days)` (depuis `createdAt` seulement).
- `weightSeries(days)` → `[{ date, weight, avg7 }]`.
- `readiness(date)` → `{ level:'vert'|'orange'|'rouge'|null, reasons:[…], suggestion:'normal'|'allege'|'doux'|'repos' }`
  à partir du check-in du jour (sommeil, énergie, courbatures, douleurs).

### `js/platform/audio.js` → `C.audio`
`unlock()` (à appeler au premier toucher ; un seul AudioContext), `beep({ freq, ms, count, gap })`, `say(text)` (voix française,
`speechSynthesis`, coupe la file précédente), `cancelSpeech()`, `wakeLock.request()/release()`, `vibrate(pattern)` (sans effet sur iOS).

### `js/ui/timer.js` → `C.timer`
- `C.timer.open(spec)` : ouvre le minuteur plein écran avec une séquence `TimerSpec` :
  `{ name, voice:bool, prepSec, rounds, restBetweenRoundsSec, steps:[{ label, sec, kind:'work'|'rest' }], onFinish?(result) }`.
  Annonce vocale du prochain exercice, décompte « 5, 4, 3, 2, 1 » + bip à chaque changement.
- `C.timer.rest(sec, label)` : repos entre séries (barre compacte en bas, +15 s, passer).

### Widgets pour « Aujourd'hui » (chaînes HTML)
- `C.habitsUI.todayCard(date)` (habitudes du jour) — `ui/habits.js`
- `C.bodyUI.todayCard(date)` (poids + « peu / normal / beaucoup mangé ») — `ui/habits.js`
- `C.bodyUI.checkinCard(date)` (check-in matinal facultatif, 30 s) — `ui/habits.js`
- `C.goalsUI.countdownCard()` (prochains objectifs et jalons/démarches à échéance) — `ui/goals.js`
- `C.backupUI.reminderCard()` (rappel d'export si > `exportReminderDays`) — `ui/settings.js`

### `js/core/agenda.js` → `C.agenda` (fonctions pures + accès à `C.state.agenda`)
- `parseICS(text, sourceId)` → `{ events:[…], errors:[…], isHTML:bool }` : VEVENT, DTSTART/DTEND (UTC `Z` converti en heure locale,
  `TZID=…` traité comme heure locale, `VALUE=DATE` = journée), DURATION, RRULE (FREQ DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT, UNTIL, BYDAY),
  EXDATE, STATUS:CANCELLED ignoré, lignes repliées, échappements `\n \, \;`. Fenêtre d'expansion : −30 j / +180 j.
- `parseBundle(text)` → plusieurs calendriers collés d'un coup (format du Raccourci iOS : blocs `--CREVARE-SOURCE <kind> <nom>`), ou un seul ICS.
- `sync(sourceId)` → tente `fetch(url)` (échoue souvent à cause de CORS : renvoie une erreur explicite) ; `importText(text, sourceId?)` → remplace
  les événements de la source ; `addSource({ name, url, kind })`.
- `eventsOn(date)` → événements du jour triés (toutes sources) ; `busyIntervals(date)` → `[{ start:'HH:MM', end:'HH:MM', title, kind }]`
  (événements `busy` + séance de sport prévue avec son créneau) ; `dayInfo(date)` → `{ events, busyMin, hasCivilProtection, firstStart, lastEnd, freeEveningFrom }`.
- `trainingSlot(date, durationMin)` → `{ start, end } | null` : meilleur créneau pour la séance de sport du jour (après les cours, avant 21 h si possible).
- `subjectsFromEvents()` → déduit les matières des titres de cours (retire « CM, TD, TP, Cours, Examen… », codes entre parenthèses) ;
  `detectExams()` → événements « Examen, Partiel, DS, Contrôle, CC, Évaluation, Soutenance ».
- `buildTasks(today)` → crée/actualise les tâches de révision espacée à partir des cours passés (J0 relecture 20–30 min, J+1, J+7 exercices,
  J+30 synthèse) et des examens (montée en charge les 14 jours avant) ; ne supprime jamais une tâche faite.
- `schedule(from, to)` → `[{ id (stable), date, start, end, subjectId, title, taskIds, kind, done }]` : place les tâches par priorité
  (échéance, examen proche, poids de la matière) dans les créneaux libres : après `weekdayStart`/`weekendStart`, hors événements
  (+ marges), hors repas, hors créneau de sport, **fin ≤ `latestEnd`** (22:00 par défaut, jamais dépassé), dans la limite quotidienne.
  Déterministe : mêmes données → mêmes blocs.
- `markBlock(blockId, done)` → coche le bloc et ses tâches.
- `icsForRevisions(from, to)` → texte `.ics` des blocs (avec rappel 10 min avant).
- Le planificateur (`C.planner`) utilise `C.agenda.dayInfo(date)` s'il existe : il évite de placer une séance de sport un jour avec un
  événement Protection civile ≥ 4 h ou une journée de cours finissant après 19 h, en la décalant sur un autre jour disponible de la semaine.

### Widget agenda pour « Aujourd'hui »
- `C.agendaUI.todayCard(date)` (cours/événements du jour + blocs de révision à cocher + créneau de sport suggéré) — `ui/agenda.js`

### `js/platform/health.js` → `C.health`
`parse(text)` → `{ weights, steps, sleep, workouts, errors }`, `apply(parsed)` → résumé, `guideHTML()` (pas-à-pas Raccourcis iOS),
`icsForPlan(from, to)` → texte `.ics`, `shareFile(name, text, mime)` (Web Share avec fichier, sinon copie).

## Sécurité apnée (non négociable)
Tout exercice `apnea:true` : avant de démarrer la séance, confirmation « Je suis accompagné (club, binôme ou MNS au bord) ».
Sans confirmation → l'exercice est remplacé par de la nage en surface. Rappels : jamais d'hyperventilation, récupération ≥ 2 × la
durée de l'apnée et ≥ 60 s, arrêt immédiat au moindre signe (picotements, vision, envie irrépressible de respirer), pas d'apnée en
fin de séance épuisante, progression ≤ 2,5 m par semaine.

## Blessures (genou / cheville)
Si `profile.injuries` contient une zone active : les exercices `impact:2` sollicitant cette zone sont remplacés par leur alternative
sans impact (avec la mention « adapté : cheville gauche ») ; progression de course plafonnée ; mini-séance de renforcement proposée en
bonus ; question de douleur 0–10 en fin de séance ; douleur ≥ 4 ou en hausse le lendemain → variante « douce » proposée pendant 3 jours,
et conseil de consulter si ça persiste. Jamais de diagnostic.

## Liste canonique des identifiants d'exercices

Les séances (`sessions.js`) n'utilisent que ces identifiants ; `exercises.js` doit tous les définir (il peut en ajouter).
Format : `id` — nom — track — lieux — impact.

Natation / apnée / sauvetage (piscine)
- `swim_warmup` — Échauffement nages variées — dist — piscine — 0
- `swim_drills` — Éducatifs crawl — check — piscine — 0
- `swim_crawl_easy` — Crawl souple — dist — piscine — 0
- `swim_crawl_25` — 25 m crawl rapide — time — piscine — 0
- `swim_crawl_50` — 50 m crawl soutenu — time — piscine — 0
- `swim_crawl_100` — 100 m crawl — time — piscine — 0
- `swim_crawl_200` — 200 m crawl — time — piscine — 0
- `swim_crawl_400` — 400 m crawl — time — piscine — 0
- `swim_kick` — Battements ventral sans planche — check — piscine — 0
- `swim_back_legs` — Dos jambes seules, mains hors de l'eau — time — piscine — 0
- `swim_eggbeater` — Rétropédalage — time — piscine — 0
- `swim_breast_glide` — Brasse coulée longue glisse — check — piscine — 0
- `swim_head_up` — Crawl tête hors de l'eau (nage d'approche) — time — piscine — 0
- `swim_dive_start` — Plongeon du bord — check — piscine — 0
- `swim_50_test` — 50 m nage libre chrono — time — piscine — 0
- `swim_cooldown` — Retour au calme — check — piscine — 0
- `apnea_breath_dry` — Respiration et récupération à sec (assis) — check — maison/piscine — 0
- `apnea_dynamic` — Apnée dynamique — dist — piscine — 0 — apnea
- `apnea_dive_15` — Plongeon + 15 m en immersion — time — piscine — 0 — apnea
- `duck_dive` — Plongée canard — reps — piscine — 0 — apnea
- `duck_dive_object` — Canard + objet lesté au fond — reps — piscine — 0 — apnea
- `manikin_lift` — Remontée du mannequin (saisie, mise en surface) — reps — piscine — 0 — apnea
- `manikin_tow` — Remorquage du mannequin — time — piscine — 0
- `partner_tow` — Remorquage d'un partenaire — time — piscine — 0
- `rescue_entries` — Entrées à l'eau de sauvetage — check — piscine — 0
- `fins_don` — Chaussage des palmes chronométré — time — piscine — 0
- `fins_kick` — Battements avec palmes — check — piscine — 0
- `fins_100` — 100 m palmes — time — piscine — 0
- `fins_300` — 300 m palmes — time — piscine — 0
- `ssa_entry_test` — Test d'entrée SSA complet (100 m) — time — piscine — 0 — apnea
- `ssa_tsa_course` — Parcours de sauvetage TSA (100 m) — time — piscine — 0 — apnea

Course / cardio
- `run_warmup` — Échauffement footing + gammes — check — dehors/salle — 1
- `run_drills` — Gammes athlétiques — check — dehors — 1
- `run_easy` — Footing en endurance fondamentale — run — dehors — 1
- `run_long` — Sortie longue — run — dehors — 1
- `run_strides` — Lignes droites accélérées — check — dehors — 1
- `run_3030` — 30 s vite / 30 s lent — check — dehors — 1
- `run_400` — 400 m rapide — time — dehors — 1
- `run_1k_rep` — 1 km allure soutenue (fractionné) — time — dehors/salle — 1
- `run_tempo` — Allure seuil — run — dehors — 1
- `run_1k_test` — 1 km chrono — time — dehors/salle — 1
- `run_5k_test` — 5 km chrono — time — dehors — 1
- `run_shuttle` — Navettes 20 m avec demi-tour — reps — dehors — 2
- `luc_leger` — Test Luc Léger — palier — dehors — 2
- `treadmill_easy` — Tapis en endurance — run — salle — 1
- `treadmill_1k` — 1 km sur tapis — time — salle — 1
- `bike_easy` — Vélo / elliptique (sans impact) — time — salle — 0
- `walk_brisk` — Marche rapide — time — dehors — 0
- `run_cooldown` — Retour au calme — check — dehors/salle — 0

HYROX (salle)
- `skierg` — SkiErg — time — salle — 0
- `row_erg` — Rameur — time — salle — 0
- `sled_push` — Sled push — load — salle — 1
- `sled_pull` — Sled pull — load — salle — 0
- `burpee_broad_jump` — Burpee broad jumps — time — salle — 2
- `burpee` — Burpees — reps — salle/maison — 2
- `burpee_step_back` — Burpee sans saut (pas en arrière) — reps — salle/maison — 0
- `farmers_carry` — Farmers carry — load — salle — 0
- `sandbag_lunge` — Fentes avec sandbag — load — salle — 1
- `wall_ball` — Wall balls — reps — salle — 1
- `hyrox_run_station` — 1 km + station (enchaîné) — time — salle — 1

Force (salle)
- `goblet_squat` — Squat goblet — load — salle — 0
- `back_squat` — Squat barre — load — salle — 0
- `leg_press` — Presse à cuisses — load — salle — 0
- `split_squat_db` — Fente arrière aux haltères — load — salle — 0
- `rdl` — Soulevé de terre jambes semi-tendues — load — salle — 0
- `hip_thrust` — Hip thrust — load — salle — 0
- `leg_curl` — Leg curl — load — salle — 0
- `step_up` — Montée sur banc — load — salle — 0
- `calf_raise` — Mollets debout — load — salle/maison — 0
- `bench_press` — Développé couché — load — salle — 0
- `db_press` — Développé militaire haltères — load — salle — 0
- `lat_pulldown` — Tirage vertical — load — salle — 0
- `seated_row` — Tirage horizontal — load — salle — 0
- `db_row` — Rowing haltère — load — salle — 0
- `assisted_pullup` — Traction assistée (machine) — load — salle — 0
- `cable_face_pull` — Face pull à la poulie — load — salle — 0
- `pallof_press` — Pallof press — load — salle — 0

Maison (barre, élastiques, poids du corps)
- `band_warmup` — Échauffement épaules à l'élastique — check — maison/salle — 0
- `dead_hang` — Suspension à la barre — time — maison — 0
- `scap_pullup` — Tractions scapulaires — reps — maison — 0
- `pullup_negative` — Traction négative (descente lente) — reps — maison — 0
- `pullup_band` — Traction avec élastique — reps — maison — 0
- `pullup_strict` — Traction stricte (pronation) — reps — maison — 0
- `chinup_strict` — Traction supination (ICP) — reps — maison — 0
- `band_row` — Rowing à l'élastique — reps — maison — 0
- `band_face_pull` — Face pull à l'élastique — reps — maison — 0
- `band_pull_apart` — Écartés à l'élastique — reps — maison — 0
- `pushup` — Pompes — reps — maison — 0
- `pushup_incline` — Pompes inclinées — reps — maison — 0
- `pushup_cadence` — Pompes en cadence (ICP) — reps — maison — 0
- `chair_dips` — Dips entre deux chaises — reps — maison — 0
- `squat_bw` — Squat au poids du corps — reps — maison — 0
- `split_squat_bw` — Fente statique — reps — maison — 0
- `reverse_lunge` — Fente arrière — reps — maison — 0
- `wall_sit` — Chaise contre le mur (Killy) — time — maison — 0
- `glute_bridge` — Pont fessier — reps — maison — 0
- `hanging_knee_raise` — Relevés de genoux à la barre — reps — maison — 0
- `squat_jump` — Squats sautés — reps — maison — 2
- `jumping_jack` — Jumping jacks — time — maison — 2
- `mountain_climber` — Mountain climbers — time — maison — 1

Gainage (abdos)
- `plank` — Planche — time — maison — 0
- `side_plank` — Planche latérale — time — maison — 0
- `hollow_hold` — Hollow hold — time — maison — 0
- `dead_bug` — Dead bug — reps — maison — 0
- `bird_dog` — Bird dog — reps — maison — 0
- `superman` — Superman — reps — maison — 0
- `crunch` — Crunch — reps — maison — 0
- `russian_twist` — Rotations russes — reps — maison — 0
- `leg_raise_floor` — Relevés de jambes au sol — reps — maison — 0

Prévention / renforcement genou-cheville
- `single_leg_balance` — Équilibre sur une jambe — time — maison — 0
- `calf_raise_eccentric` — Mollets excentriques sur une marche — reps — maison — 0
- `tibialis_raise` — Relevés de pointe de pied (tibial) — reps — maison — 0
- `ankle_band` — Cheville à l'élastique (4 directions) — reps — maison — 0
- `ankle_knee_to_wall` — Mobilité cheville genou-au-mur — reps — maison — 0
- `spanish_squat` — Squat espagnol isométrique (élastique) — time — maison — 0
- `step_down` — Descente de marche contrôlée — reps — maison — 0
- `tke_band` — Extension terminale du genou à l'élastique — reps — maison — 0
- `nordic_hamstring` — Nordic hamstring (assisté) — reps — maison — 0
- `copenhagen_plank` — Planche de Copenhague (adducteurs) — time — maison — 0

Mobilité / souplesse
- `mob_hips` — Mobilité hanches (90/90) — check — maison — 0
- `mob_thoracic` — Mobilité thoracique — check — maison — 0
- `mob_shoulders` — Mobilité épaules — check — maison — 0
- `stretch_hamstrings` — Étirement ischios (flexion avant) — time — maison — 0
- `sit_and_reach` — Souplesse : flexion avant jambes tendues (mesure) — cm — maison — 0
- `foam_roll` — Rouleau de massage — check — maison/salle — 0

Tests (maison/salle)
- `test_pullup_max` — Tractions max (pronation) — reps — maison — 0
- `test_chinup_max` — Tractions max (supination, ICP) — reps — maison — 0
- `test_pushup_max` — Pompes max — reps — maison — 0
- `test_plank_max` — Planche max — time — maison — 0
- `test_wall_sit_max` — Chaise max (Killy) — time — maison — 0

## Identifiants des tests de référence (benchmarks)

`ssa_entry_test`, `ssa_tsa_course`, `ssa_tsa_fins`, `apnea_dyn`, `duck_depth` (m), `swim_100`, `swim_400`, `swim_50`, `swim_back_25`,
`run_1k`, `run_5k`, `run_10k`, `row_1000`, `skierg_1000`, `wall_balls_100`, `hyrox_sim`, `hyrox_race`,
`luc_leger`, `chinups`, `pullups`, `pushups`, `plank`, `wall_sit`, `sit_reach`,
`ssa_test_v1` (archivé, ancien format, non comparable). Le poids est dans `state.body`.
