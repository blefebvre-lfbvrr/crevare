/* Crevare — réglages (#/reglages), sauvegarde (#/donnees), Apple Santé & calendrier (#/sante),
 * widget C.backupUI.reminderCard() pour « Aujourd'hui ».
 * Les données restent sur le téléphone : export en fichier (feuille de partage iOS), import avec aperçu,
 * copie de secours automatique (C.store), demande de stockage persistant. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Accès défensifs ───────── */

  const st = () => C.state || {};
  const prof = () => st().profile || {};
  function safe(fn, fallback) { try { return fn(); } catch (e) { console.error(e); return fallback; } }

  /* ───────── Libellés partagés (aussi utilisés par le questionnaire) ───────── */

  const ZONES = [
    { value: 'cheville', label: 'Cheville' }, { value: 'genou', label: 'Genou' }, { value: 'epaule', label: 'Épaule' },
    { value: 'dos', label: 'Dos' }, { value: 'hanche', label: 'Hanche' }, { value: 'poignet', label: 'Poignet' },
    { value: 'coude', label: 'Coude' }, { value: 'nuque', label: 'Nuque' }, { value: 'autre', label: 'Autre' },
  ];
  const SIDES = [{ value: 'gauche', label: 'Gauche' }, { value: 'droite', label: 'Droite' }, { value: 'les deux', label: 'Les deux' }];
  const EQUIPMENT = [
    { id: 'barre', label: 'Barre de traction' }, { id: 'elastiques', label: 'Élastiques' }, { id: 'halteres', label: 'Haltères' },
    { id: 'kettlebell', label: 'Kettlebell' }, { id: 'lest', label: 'Gilet lesté' }, { id: 'corde', label: 'Corde à sauter' },
    { id: 'step', label: 'Step / marche' }, { id: 'tapis', label: 'Tapis de sol' },
  ];
  const SWIM_LEVELS = [
    { value: 'inconnu', label: 'Je ne sais pas' }, { value: 'debutant', label: 'Débutant' },
    { value: 'a-l-aise', label: "À l'aise" }, { value: 'confirme', label: 'Confirmé' },
  ];
  const DURATIONS = [45, 60, 90, 120, 180].map((m) => ({ value: m, label: m < 60 ? `${m} min` : `${U.fmtNum(m / 60, 1)} h` }));
  const PER_WEEK = [2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }));
  const THEMES = [{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }];
  const REMINDERS = [{ value: 0, label: 'Jamais' }, { value: 7, label: '7 jours' }, { value: 14, label: '14 jours' }, { value: 30, label: '30 jours' }];
  const POOL_LENGTHS = [{ value: 25, label: '25 m' }, { value: 50, label: '50 m' }, { value: 33, label: '33 m' }];
  const YES_NO = [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }];
  const YES_NO_UNKNOWN = [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }, { value: '', label: 'Je ne sais pas' }];
  const WATCH_TYPES = ['Course', 'Natation', 'Musculation', 'Entraînement fonctionnel', 'HIIT', 'Rameur', 'Vélo', 'Marche', 'Autre'];
  const zoneLabel = (z) => (ZONES.find((x) => x.value === z) || { label: z }).label;

  /* ───────── Fonctions pures ───────── */

  const maxBirthYear = () => Number(U.todayKey().slice(0, 4)) - 10;
  const txt = (max) => (p, v, path) => { setPath(p, path, String(v ?? '').trim().slice(0, max)); };
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (const k of keys.slice(0, -1)) { if (!U.isObj(o[k])) o[k] = {}; o = o[k]; }
    o[keys[keys.length - 1]] = value;
  }

  /* Champs du profil : chemin dans profile, validation (renvoie false si invalide), re-rendu ou non.
   * Partagé avec le questionnaire via C.settingsUI.applyProfileField. */
  const PROFILE_FIELDS = {
    firstName: { path: 'firstName', set: txt(40), silent: true },
    birthYear: { path: 'birthYear', silent: true, set: (p, v) => {
      const raw = String(v ?? '').trim();
      if (!raw) { p.birthYear = null; return true; }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1930 || n > maxBirthYear()) return false;
      p.birthYear = n; return true;
    } },
    sex: { path: 'sex', set: (p, v) => { if (v !== 'H' && v !== 'F') return false; p.sex = v; return true; } },
    department: { path: 'department', set: txt(40), silent: true },
    futureLocations: { path: 'futureLocations', set: txt(200), silent: true },
    sessionsPerWeek: { path: 'sessionsPerWeek', set: (p, v) => { const n = Math.round(U.num(v)); if (!(n >= 1 && n <= 7)) return false; p.sessionsPerWeek = n; return true; } },
    maxSessionMin: { path: 'maxSessionMin', set: (p, v) => { const n = Math.round(U.num(v)); if (!(n >= 20 && n <= 300)) return false; p.maxSessionMin = n; return true; } },
    apneaBuddy: { path: 'apneaBuddy', set: txt(120), silent: true },
    gymName: { path: 'equipment.gym.name', set: txt(80), silent: true },
    gymHyrox: { path: 'equipment.gym.hyrox', set: (p, v) => { setPath(p, 'equipment.gym.hyrox', v === 'oui' || v === true); return true; } },
    swim: { path: 'levels.swim', set: (p, v) => { if (!SWIM_LEVELS.some((x) => x.value === v)) return false; setPath(p, 'levels.swim', v); return true; } },
    run: { path: 'levels.run', set: txt(200), silent: true },
    strength: { path: 'levels.strength', set: txt(200), silent: true },
  };
  // Applique un champ au profil. Renvoie false si la valeur est refusée.
  function applyProfileField(profile, f, value) {
    const def = Object.prototype.hasOwnProperty.call(PROFILE_FIELDS, f) ? PROFILE_FIELDS[f] : null;
    if (!def) return false;
    const r = def.set(profile, value, def.path);
    return r !== false;
  }

  // Jours disponibles : ajoute/retire un jour (0 = lundi), garde au moins un jour, trie.
  function toggleDay(days, d) {
    const n = Number(d);
    if (!Number.isInteger(n) || n < 0 || n > 6) return (days || []).slice();
    const set = new Set(Array.isArray(days) ? days : []);
    if (set.has(n)) { if (set.size > 1) set.delete(n); } else set.add(n);
    return [...set].sort((a, b) => a - b);
  }
  function toggleItem(list, id) {
    const arr = Array.isArray(list) ? list.slice() : [];
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    return arr;
  }

  // Piscine depuis un formulaire : { name, length, deepM, mannequin } ou null si invalide.
  function poolFromForm(v) {
    const name = String(v.name || '').trim().slice(0, 60);
    const length = [25, 50, 33].includes(Number(v.length)) ? Number(v.length) : null;
    if (!length) return null;
    const deepRaw = String(v.deepM ?? '').trim();
    const deepM = deepRaw ? U.num(deepRaw) : null;
    if (deepRaw && (deepM == null || deepM < 0.5 || deepM > 10)) return null;
    return { name: name || `Piscine ${length} m`, length, deepM: deepM == null ? null : U.round(deepM, 2), mannequin: v.mannequin === 'oui' ? true : v.mannequin === 'non' ? false : null };
  }

  const exportName = (today) => `crevare-sauvegarde-${today}.json`;
  const isoToKey = (iso) => { const d = new Date(iso); return isNaN(d) ? null : U.dateKey(d); };

  // Jours depuis le dernier export (ou depuis la création des données si jamais exporté).
  function daysSinceExport(state, today) {
    const s = state || {};
    const last = s.settings && s.settings.lastExportAt ? isoToKey(s.settings.lastExportAt) : null;
    const ref = last || (U.isKey(s.createdAt) ? s.createdAt : null);
    return ref ? Math.max(0, U.daysBetween(ref, today)) : null;
  }
  function needsBackupReminder(state, today) {
    const n = state && state.settings ? Number(state.settings.exportReminderDays) : 14;
    if (!n) return false;
    const since = daysSinceExport(state, today);
    return since != null && since >= n;
  }

  const fmtBytes = (n) => (n == null ? '—' : n < 1024 ? `${n} o` : n < 1048576 ? `${U.fmtNum(n / 1024, n < 10240 ? 1 : 0)} Ko` : `${U.fmtNum(n / 1048576, 1)} Mo`);

  /* Aperçu d'une sauvegarde avant import → { ok:true, state, info } ou { ok:false, error }.
   * info : { from, updatedAt, sessions, done, goals:[noms], benchmarks, habits, body, events, onboarded, firstName } */
  function backupPreview(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return { ok: false, error: 'Rien à importer : choisis un fichier ou colle le texte.' };
    let next;
    try { next = C.schema.fromAny(raw); } catch (e) { return { ok: false, error: e && e.message ? e.message : 'Sauvegarde illisible.' }; }
    let fromV1 = false;
    try { fromV1 = JSON.parse(raw).version === 1; } catch (e) { /* déjà validé */ }
    const sessions = Object.values(next.sessions || {});
    return {
      ok: true, state: next,
      info: {
        from: fromV1 ? 'Crevare v1 (sera convertie)' : 'Crevare v2',
        updatedAt: next.updatedAt, createdAt: next.createdAt,
        sessions: sessions.length, done: sessions.filter((s) => s.status === 'done').length,
        goals: (next.goals || []).map((g) => g.name),
        benchmarks: Object.values(next.benchmarks || {}).reduce((a, l) => a + l.length, 0),
        habits: (next.habits || []).filter((h) => !h.archivedAt).length,
        body: Object.keys(next.body || {}).length,
        events: ((next.agenda || {}).events || []).length,
        onboarded: !!(next.profile && next.profile.onboarded), firstName: (next.profile && next.profile.firstName) || '',
      },
    };
  }

  /* ───────── État d'écran (le temps de la visite) ───────── */

  let pendingImport = null; // { text, preview }
  let healthPending = null; // { parsed }
  let healthResult = null; // [phrases]
  let healthManual = false; // zone de collage manuel ouverte

  /* ───────── Petits éléments ───────── */

  const seg = (f, options, current, action = 'reglages.profil') => C.ui.segmented(`set-${f}`, options, current, `data-change="${esc(action)}" data-f="${esc(f)}"`);
  const textField = (label, f, value, extra = '', hint = '') => `<label class="field"><span>${esc(label)}</span>
    <input type="text" class="set-in" id="set-${esc(f)}" data-change="reglages.profil" data-f="${esc(f)}" value="${esc(value ?? '')}" autocomplete="off" ${extra}>
    ${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
  const chip = (label, pressed, action, data) => `<button type="button" class="set-chip" aria-pressed="${pressed ? 'true' : 'false'}" data-action="${esc(action)}"
    ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(label)}</button>`;
  const dayChips = (days, action) => `<div class="set-days" role="group" aria-label="Jours disponibles">${U.DAYS_SHORT.map((d, i) => `<button type="button" class="set-day"
    aria-pressed="${days.includes(i) ? 'true' : 'false'}" aria-label="${esc(U.DAYS[i])}" data-action="${esc(action)}" data-d="${i}">${esc(d)}</button>`).join('')}</div>`;

  function versionText() {
    const v = C.version || C.APP_VERSION || null;
    return `${v ? `Version ${v}` : 'Crevare v2'} · données v${(C.schema && C.schema.VERSION) || 2}`;
  }

  /* ───────── Vue : Réglages ───────── */

  function poolRow(pl) {
    const meta = [`${pl.length} m`, pl.deepM ? `fosse ${U.fmtNum(pl.deepM, 1)} m` : '', pl.mannequin === true ? 'mannequin dispo' : pl.mannequin === false ? 'pas de mannequin' : ''].filter(Boolean).join(' · ');
    return `<li class="set-row"><span class="grow"><b>🏊 ${esc(pl.name)}</b><small class="muted">${esc(meta)}</small></span>
      <button type="button" class="btn ghost small" data-action="reglages.piscine-modifier" data-id="${esc(pl.id)}">Modifier</button></li>`;
  }
  function injuryRow(inj) {
    return `<li class="set-row ${inj.active ? '' : 'is-off'}"><span class="grow"><b>${esc(zoneLabel(inj.zone))}${inj.side ? ` ${esc(inj.side)}` : ''}</b>
      <small class="muted">${inj.active ? 'Prise en compte dans le plan' : 'Guérie : plus d\'adaptation'}${inj.note ? ` · ${esc(inj.note)}` : ''}</small></span>
      <button type="button" class="btn ghost small" aria-pressed="${inj.active ? 'true' : 'false'}" data-action="reglages.blessure-active" data-id="${esc(inj.id)}">${inj.active ? 'Active' : 'Inactive'}</button>
      <button type="button" class="icon-btn small" data-action="reglages.blessure-modifier" data-id="${esc(inj.id)}" aria-label="${esc(`Modifier : ${zoneLabel(inj.zone)}`)}">✎</button></li>`;
  }

  function viewSettings() {
    const p = prof();
    const s = st().settings || {};
    const plan = st().plan || {};
    const eq = p.equipment || { home: [], gym: {} };
    const home = Array.isArray(eq.home) ? eq.home : [];
    const days = Array.isArray(p.availableDays) ? p.availableDays : [];
    const pools = Array.isArray(p.pools) ? p.pools : [];
    const injuries = Array.isArray(p.injuries) ? p.injuries : [];
    const levels = p.levels || {};
    const fewDays = days.length < (p.sessionsPerWeek || 0);
    return `<header class="top"><a class="back" href="#/plus">‹ Plus</a><h1>Réglages</h1></header>

      <section class="card"><h2>Profil</h2>
        ${textField('Prénom (facultatif)', 'firstName', p.firstName, 'maxlength="40" autocapitalize="words"')}
        ${textField('Année de naissance', 'birthYear', p.birthYear || '', 'inputmode="numeric" maxlength="4" placeholder="AAAA"', 'Sert à choisir ta tranche d\'âge dans les barèmes.')}
        <div class="field"><span>Catégorie des barèmes</span>${seg('sex', [{ value: 'H', label: 'Hommes' }, { value: 'F', label: 'Femmes' }], p.sex || '')}</div>
        ${textField('Département', 'department', p.department, 'maxlength="40" placeholder="Ex. 94"')}
        ${textField('Où tu pourrais habiter plus tard', 'futureLocations', p.futureLocations, 'maxlength="200" placeholder="Ex. Montpellier ou Paris"')}
      </section>

      <section class="card"><h2>Disponibilités</h2>
        <div class="field"><span>Séances par semaine</span>${seg('sessionsPerWeek', PER_WEEK, p.sessionsPerWeek)}</div>
        <div class="field"><span>Jours possibles</span>${dayChips(days, 'reglages.jour')}</div>
        ${fewDays ? '<p class="note warn small">Moins de jours que de séances : le plan ne mettra jamais deux séances le même jour, il en prévoira donc moins.</p>' : ''}
        <div class="field"><span>Durée maximale d'une séance</span>${seg('maxSessionMin', DURATIONS, p.maxSessionMin)}</div>
        <label class="field"><span>Début du plan</span><input type="date" class="set-in" id="set-start" data-change="reglages.debut" value="${esc(U.isKey(plan.startDate) ? plan.startDate : '')}">
          <small class="muted">Les 3 premières semaines sont plus douces.</small></label>
      </section>

      <section class="card"><div class="card-head"><h2>Blessures</h2></div>
        ${injuries.length ? `<ul class="set-list">${injuries.map(injuryRow).join('')}</ul>` : '<p class="muted small">Aucune zone fragile notée.</p>'}
        <button type="button" class="btn ghost small mt" data-action="reglages.blessure-ajouter">＋ Ajouter une zone</button>
        <p class="tiny muted">Les exercices à impact sont remplacés. Ce n'est pas un diagnostic : consulte si la douleur dure.</p>
      </section>

      <section class="card"><div class="card-head"><h2>Piscines</h2></div>
        ${pools.length ? `<ul class="set-list">${pools.map(poolRow).join('')}</ul>` : '<p class="muted small">Aucune piscine : l\'app te demandera la longueur du bassin à chaque séance.</p>'}
        <div class="row gap wrap mt">
          <button type="button" class="btn ghost small" data-action="reglages.piscine-ajouter" data-len="25">＋ Piscine 25 m</button>
          <button type="button" class="btn ghost small" data-action="reglages.piscine-ajouter" data-len="50">＋ Piscine 50 m</button>
        </div>
      </section>

      <section class="card"><h2>Salle</h2>
        ${textField('Nom du club', 'gymName', (eq.gym || {}).name, 'maxlength="80" placeholder="Ex. Fitness Park …"')}
        <div class="field"><span>Zone HYROX (SkiErg, sled, wall balls…)</span>${seg('gymHyrox', YES_NO, (eq.gym || {}).hyrox ? 'oui' : 'non')}</div>
      </section>

      <section class="card"><h2>Matériel à la maison</h2>
        <div class="set-chips">${EQUIPMENT.map((x) => chip(x.label, home.includes(x.id), 'reglages.materiel', { id: x.id })).join('')}</div>
      </section>

      <section class="card"><h2>Apnée : accompagnement</h2>
        ${textField('Qui t\'accompagne ?', 'apneaBuddy', p.apneaBuddy, 'maxlength="120" placeholder="Club, binôme ou MNS au bord"',
          'Vide = personne. Sans accompagnement confirmé, les exercices d\'apnée sont remplacés par de la nage en surface. Jamais d\'apnée seul.')}
      </section>

      <section class="card"><h2>Niveau</h2>
        <div class="field"><span>Natation</span>${seg('swim', SWIM_LEVELS, levels.swim || 'inconnu')}</div>
        ${textField('Course', 'run', levels.run, 'maxlength="200" placeholder="Ex. 2 à 3 sorties par semaine, 7 à 10 km"')}
        ${textField('Force', 'strength', levels.strength, 'maxlength="200" placeholder="Ex. 1 traction, 30 pompes, gainage 1 min"')}
        <p class="tiny muted">Tes mesures précises sont dans <a class="link" href="#/progres">Progrès</a>.</p>
      </section>

      <section class="card"><h2>Son, voix et affichage</h2>
        <label class="check-row"><input type="checkbox" data-change="reglages.reglage" data-f="sound" ${s.sound !== false ? 'checked' : ''}> <span>Bips (minuteur, repos)</span></label>
        <label class="check-row"><input type="checkbox" data-change="reglages.reglage" data-f="voice" ${s.voice !== false ? 'checked' : ''}> <span>Annonces vocales (séances d'abdos et minuteurs avec voix)</span></label>
        <div class="field"><span>Thème</span>${seg('theme', THEMES, s.theme || 'auto', 'reglages.reglage')}</div>
        <div class="field"><span>Rappel de sauvegarde</span>${seg('exportReminderDays', REMINDERS, s.exportReminderDays ?? 14, 'reglages.reglage')}</div>
      </section>

      <section class="card"><h2>Autres réglages</h2>
        <ul class="menu set-links">
          <li><a class="menu-item" href="#/donnees"><span class="menu-icon" aria-hidden="true">💾</span><span class="menu-text"><b>Sauvegarde</b><small class="muted">Exporter, importer, copie de secours</small></span><span aria-hidden="true">›</span></a></li>
          <li><a class="menu-item" href="#/sante"><span class="menu-icon" aria-hidden="true">⌚️</span><span class="menu-text"><b>Apple Santé & calendrier</b><small class="muted">Raccourci iOS, export .ics</small></span><span aria-hidden="true">›</span></a></li>
          <li><a class="menu-item" href="#/objectifs"><span class="menu-icon" aria-hidden="true">🎯</span><span class="menu-text"><b>Objectifs</b><small class="muted">Dates, jalons, démarches</small></span><span aria-hidden="true">›</span></a></li>
        </ul>
        <button type="button" class="btn ghost block mt" data-action="reglages.questionnaire">Refaire le questionnaire de départ</button>
      </section>

      <section class="card"><h2>À propos</h2>
        <p class="small">${esc(versionText())}</p>
        <p class="small muted">Tes données restent uniquement sur ce téléphone. Repères d'entraînement généraux, pas un avis médical.
          Valeurs officielles (SSA, HYROX, pompiers) à confirmer auprès des organismes.</p>
      </section>`;
  }

  /* ───────── Vue : Sauvegarde ───────── */

  function previewHTML(pv) {
    if (!pv) return '';
    if (!pv.ok) return `<p class="note danger small" role="alert">${esc(pv.error)}</p>`;
    const i = pv.info;
    const when = i.updatedAt ? safe(() => { const k = isoToKey(i.updatedAt); return k ? U.fmtLong(k) : ''; }, '') : '';
    return `<div class="set-preview" role="region" aria-label="Aperçu de la sauvegarde">
      <p><b>${esc(i.from)}</b>${i.firstName ? ` · ${esc(i.firstName)}` : ''}${when ? ` · enregistrée le ${esc(when)}` : ''}</p>
      <ul class="small set-preview-list">
        <li>${esc(U.plural(i.sessions, 'séance', 'séances'))} (dont ${esc(i.done)} terminée${i.done > 1 ? 's' : ''})</li>
        <li>${esc(U.plural(i.goals.length, 'objectif', 'objectifs'))}${i.goals.length ? ` : ${esc(i.goals.slice(0, 4).join(', '))}${i.goals.length > 4 ? '…' : ''}` : ''}</li>
        <li>${esc(U.plural(i.benchmarks, 'mesure de test', 'mesures de test'))}, ${esc(U.plural(i.habits, 'habitude', 'habitudes'))}, ${esc(U.plural(i.body, 'jour de suivi du poids', 'jours de suivi du poids'))}</li>
        ${i.events ? `<li>${esc(U.plural(i.events, 'événement d\'agenda', 'événements d\'agenda'))}</li>` : ''}
      </ul>
      <p class="note warn small">Tes données actuelles seront remplacées. Une copie de secours est gardée sur ce téléphone.</p>
      <div class="row gap wrap"><button type="button" class="btn danger-solid" data-action="reglages.import-appliquer">Remplacer mes données</button>
        <button type="button" class="btn ghost" data-action="reglages.import-annuler">Annuler</button></div>
    </div>`;
  }

  function viewBackup() {
    const s = st().settings || {};
    const today = U.todayKey();
    const lastKey = s.lastExportAt ? isoToKey(s.lastExportAt) : null;
    const env = C.env || {};
    const hasBackup = C.store.hasBackup ? safe(() => C.store.hasBackup(), false) : false;
    const size = C.store.size ? safe(() => C.store.size(), null) : null;
    const late = needsBackupReminder(st(), today);
    const html = `<header class="top"><a class="back" href="#/plus">‹ Plus</a><h1>Sauvegarde</h1></header>
      <section class="card"><h2>Où sont tes données ?</h2>
        <p class="small">Uniquement sur ce téléphone, dans le stockage de ${env.standalone ? "l'app installée" : 'ce navigateur'}. Rien n'est envoyé sur Internet.</p>
        <dl class="set-dl">
          <div><dt>Protection contre l'effacement</dt><dd id="set-persist">vérification…</dd></div>
          <div><dt>Taille</dt><dd>${esc(fmtBytes(size))}<small id="set-quota" class="muted set-quota"></small></dd></div>
          <div><dt>Dernier export</dt><dd class="${late ? 'warn-text' : ''}">${lastKey ? `${esc(U.fmtLong(lastKey))} (${esc(U.relDays(U.daysBetween(today, lastKey)))})` : 'jamais'}</dd></div>
        </dl>
        <button type="button" class="btn ghost small" data-action="reglages.persister" id="set-persist-btn" hidden>Demander la protection</button>
        ${env.embedded ? '<p class="note warn small">Page ouverte dans claude.ai : les données restent dans ce navigateur et peuvent disparaître. Exporte souvent.</p>'
          : env.ios && !env.standalone ? `<p class="note warn small">Installe l'app sur l'écran d'accueil (Partager › « Sur l'écran d'accueil ») : Safari peut effacer les données d'un site
            non installé après quelques jours sans visite. Attention, l'app installée a son propre stockage : exporte ici, puis importe dans l'app installée.</p>` : ''}
      </section>

      <section class="card"><h2>Exporter</h2>
        <p class="small">Un fichier avec tout : séances, tests, objectifs, habitudes, poids, agenda. Sur iPhone, choisis
          « Enregistrer dans Fichiers » (iCloud Drive) ou envoie-le-toi par mail.</p>
        <div class="row gap wrap">
          <button type="button" class="btn" data-action="reglages.exporter">Exporter un fichier</button>
          <button type="button" class="btn ghost" data-action="reglages.copier">Copier le texte</button>
        </div>
      </section>

      <section class="card"><h2>Importer</h2>
        <p class="small">Depuis un fichier exporté (v1 ou v2) ou un texte collé. Tu verras un aperçu avant de remplacer quoi que ce soit.</p>
        <label class="btn ghost set-file-btn">Choisir un fichier
          <input type="file" class="set-file" accept=".json,application/json,text/plain" data-change="reglages.import-fichier"></label>
        <details class="mt" ${pendingImport && pendingImport.pasted ? 'open' : ''}><summary class="set-summary">Ou coller le texte</summary>
          <textarea id="set-import-text" rows="5" aria-label="Texte de la sauvegarde" placeholder="Colle ici le contenu du fichier">${esc(pendingImport && pendingImport.pasted ? pendingImport.text : '')}</textarea>
          <button type="button" class="btn ghost small mt" data-action="reglages.import-verifier">Vérifier</button>
        </details>
        ${pendingImport ? previewHTML(pendingImport.preview) : ''}
      </section>

      ${hasBackup ? `<section class="card"><h2>Copie de secours</h2>
        <p class="small">Faite automatiquement avant chaque import, restauration ou effacement. Elle permet d'annuler la dernière de ces opérations.</p>
        <button type="button" class="btn ghost" data-action="reglages.restaurer">Restaurer la copie de secours</button></section>` : ''}

      <section class="card set-danger"><h2>Tout effacer</h2>
        <p class="small">Efface toutes les données de ce téléphone et relance le questionnaire. Exporte d'abord si tu veux les garder.</p>
        <button type="button" class="btn ghost danger" data-action="reglages.effacer">Tout effacer…</button>
      </section>`;
    return { html, after: fillStorageStatus };
  }

  // Statut asynchrone du stockage (persistance, quota) : rempli après l'affichage.
  function fillStorageStatus($app) {
    const el = $app.querySelector('#set-persist');
    const btn = $app.querySelector('#set-persist-btn');
    const quota = $app.querySelector('#set-quota');
    const sto = typeof navigator !== 'undefined' ? navigator.storage : null;
    if (!el) return;
    if (!sto || !sto.persisted) { el.textContent = 'non disponible sur ce navigateur'; return; }
    sto.persisted().then((ok) => {
      el.textContent = ok ? '✓ accordée' : 'non accordée';
      el.className = ok ? 'ok-text' : 'warn-text';
      if (btn) btn.hidden = !!ok || !sto.persist;
    }).catch(() => { el.textContent = 'inconnue'; });
    if (quota && sto.estimate) {
      sto.estimate().then((e) => { if (e && e.quota) quota.textContent = `place permise : ${fmtBytes(e.quota)}`; }).catch(() => {});
    }
  }

  /* ───────── Vue : Apple Santé & calendrier ───────── */

  function healthPreviewHTML(p) {
    if (!p) return '';
    const last = (list) => list[list.length - 1];
    const rows = [];
    if (p.weights.length) rows.push(`⚖️ ${U.plural(p.weights.length, 'poids', 'poids')} — dernier : ${U.fmtNum(last(p.weights).value, 1)} kg le ${U.fmtShort(last(p.weights).date)}`);
    if (p.sleep.length) rows.push(`😴 ${U.plural(p.sleep.length, 'nuit', 'nuits')} — dernière : ${U.fmtNum(last(p.sleep).hours, 1)} h (${U.fmtShort(last(p.sleep).date)})`);
    if (p.steps.length) rows.push(`👣 ${U.plural(p.steps.length, 'jour de pas', 'jours de pas')} — dernier : ${U.fmtNum(last(p.steps).value, 0)} pas`);
    for (const w of p.workouts) rows.push(`⌚️ ${w.type} le ${U.fmtShort(w.date)} — ${w.durationMin} min${w.distanceKm ? ` · ${U.fmtNum(w.distanceKm, 2)} km` : ''}${w.kcal != null ? ` · ${w.kcal} kcal` : ''}${w.hrAvg ? ` · FC ${w.hrAvg}` : ''}`);
    const errs = p.errors.slice(0, 8);
    return `<div class="set-preview" role="region" aria-label="Aperçu des données">
      ${rows.length ? `<ul class="set-preview-list small">${rows.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="small">Aucune mesure reconnue.</p>'}
      ${errs.length ? `<div class="note warn small"><b>${esc(U.plural(p.errors.length, 'ligne ignorée', 'lignes ignorées'))}</b>
        <ul class="set-errors">${errs.map((e) => `<li>${e.line ? `Ligne ${esc(e.line)} : ` : ''}${esc(e.reason)}${e.text ? ` — <code>${esc(e.text)}</code>` : ''}</li>`).join('')}</ul>
        ${p.errors.length > errs.length ? `<p>… et ${esc(p.errors.length - errs.length)} autres.</p>` : ''}</div>` : ''}
      <div class="row gap wrap mt">
        ${p.count ? '<button type="button" class="btn" data-action="sante.appliquer">Ajouter à Crevare</button>' : ''}
        <button type="button" class="btn ghost" data-action="sante.annuler">Annuler</button>
      </div>
    </div>`;
  }

  function viewHealth() {
    const h = st().health || {};
    const lastKey = h.lastImportAt ? isoToKey(h.lastImportAt) : null;
    const today = U.todayKey();
    const env = C.env || {};
    const hasHealth = !!(C.health && C.health.parse);
    const canRev = !!(C.agenda && typeof C.agenda.icsForRevisions === 'function');
    return `<header class="top"><a class="back" href="#/plus">‹ Plus</a><h1>Apple Santé & calendrier</h1></header>

      <section class="card"><h2>Importer depuis Apple Santé</h2>
        <p class="small">Une page web ne peut pas lire Apple Santé. La voie gratuite : un Raccourci iOS copie ton poids, tes pas et ton sommeil,
          puis tu les colles ici. Les séances de la montre se notent en fin de séance.</p>
        <p class="small muted">Dernier import : ${lastKey ? `${esc(U.fmtLong(lastKey))} (${esc(U.relDays(U.daysBetween(today, lastKey)))})` : 'jamais'}.</p>
        ${hasHealth ? `<button type="button" class="btn block" data-action="sante.coller">📋 Coller depuis le presse-papiers</button>
        <details class="mt" ${healthManual ? 'open' : ''}><summary class="set-summary">Ou coller le texte à la main</summary>
          <textarea id="set-health-text" rows="5" aria-label="Texte du raccourci" placeholder="${esc(C.health.SAMPLE || '')}"></textarea>
          <button type="button" class="btn ghost small mt" data-action="sante.analyser">Analyser</button>
        </details>
        ${healthPending ? healthPreviewHTML(healthPending.parsed) : ''}
        ${healthResult ? `<div class="note ok small mt" role="status"><ul class="set-preview-list">${healthResult.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}`
          : '<p class="note warn small">Module Santé indisponible.</p>'}
      </section>

      ${hasHealth ? `<details class="card set-guide"><summary class="set-summary"><b>Créer le raccourci, pas à pas</b></summary>${C.health.guideHTML()}</details>` : ''}

      <section class="card"><h2>Saisir une séance de la montre</h2>
        <p class="small muted">Pour une séance faite hors de l'app (footing, natation libre…). Elle complète la séance du jour si elle existe, sinon elle s'ajoute comme séance libre.</p>
        <form data-form="sante.seance" class="set-watch">
          <div class="set-grid2">
            <label class="field"><span>Date</span><input type="date" name="date" value="${esc(today)}" max="${esc(today)}" required></label>
            <label class="field"><span>Type</span><select name="type">${WATCH_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
            <label class="field"><span>Durée (min)</span><input type="text" name="duration" inputmode="numeric" autocomplete="off" placeholder="ex. 45" required></label>
            <label class="field"><span>Distance (km)</span><input type="text" name="km" inputmode="decimal" autocomplete="off" placeholder="ex. 7,8"></label>
            <label class="field"><span>Calories (kcal)</span><input type="text" name="kcal" inputmode="numeric" autocomplete="off" placeholder="facultatif"></label>
            <label class="field"><span>FC moyenne</span><input type="text" name="hr" inputmode="numeric" autocomplete="off" placeholder="facultatif"></label>
          </div>
          <button type="submit" class="btn ghost block">Ajouter la séance</button>
        </form>
      </section>

      <section class="card"><h2>Calendrier de l'iPhone</h2>
        <p class="small">Exporte tes séances prévues (8 semaines) et tes échéances d'objectifs dans l'app Calendrier : les rappels sonnent même app fermée.
          Avec ton agenda importé, les séances ont un horaire ; sinon elles sont sur la journée.</p>
        <p class="small muted">Dans la feuille de partage, choisis Calendrier (ou ouvre le fichier), puis « Tout ajouter ». Réexporte quand ton plan change.</p>
        <div class="row gap wrap">
          <button type="button" class="btn" data-action="sante.ics">📅 Exporter mes séances</button>
          ${canRev ? '<button type="button" class="btn ghost" data-action="sante.ics-revisions">Exporter mes révisions</button>' : ''}
        </div>
        ${env.embedded ? '<p class="note warn small mt">Dans claude.ai, le fichier .ics ne peut pas être téléchargé : le texte sera copié.</p>' : ''}
      </section>`;
  }

  /* ───────── Widget « Aujourd'hui » ───────── */

  function reminderCard() {
    const state = st();
    const today = U.todayKey();
    if (!state.profile || !state.profile.onboarded || !needsBackupReminder(state, today)) return '';
    const s = state.settings || {};
    const lastKey = s.lastExportAt ? isoToKey(s.lastExportAt) : null;
    return `<section class="card set-remind" aria-labelledby="set-remind-title">
      <h2 id="set-remind-title">💾 Pense à ta sauvegarde</h2>
      <p class="small">${lastKey ? `Dernier export il y a ${esc(U.plural(U.daysBetween(lastKey, today), 'jour', 'jours'))}.` : 'Tu n\'as encore jamais exporté tes données.'}
        Elles ne sont que sur ce téléphone : un fichier dans Fichiers (iCloud Drive) te protège en cas de perte.</p>
      <div class="row gap wrap"><button type="button" class="btn small" data-action="reglages.exporter">Exporter maintenant</button>
        <a class="btn ghost small" href="#/donnees">Options</a></div>
    </section>`;
  }

  /* ───────── Feuilles (modales) ───────── */

  function openPoolSheet(id, len) {
    const pl = id ? (prof().pools || []).find((x) => x.id === id) : null;
    const length = pl ? pl.length : Number(len) || 25;
    C.ui.openModal({
      title: pl ? 'Modifier la piscine' : `Nouvelle piscine ${length} m`,
      body: `<form data-form="reglages.piscine-enregistrer" data-id="${esc(pl ? pl.id : '')}">
        <label class="field"><span>Nom</span><input type="text" name="name" maxlength="60" autocomplete="off" value="${esc(pl ? pl.name : '')}" placeholder="Ex. Piscine de Fresnes"></label>
        <div class="field"><span>Longueur du bassin</span>${C.ui.segmented('length', POOL_LENGTHS, length)}</div>
        <label class="field"><span>Profondeur de la fosse (m, facultatif)</span><input type="text" name="deepM" inputmode="decimal" autocomplete="off" value="${esc(pl && pl.deepM ? U.fmtNum(pl.deepM, 2) : '')}" placeholder="Ex. 3,5">
          <small class="muted">Le mannequin du SSA est posé entre 1,80 et 2,80 m (à confirmer).</small></label>
        <div class="field"><span>Mannequin disponible</span>${C.ui.segmented('mannequin', YES_NO_UNKNOWN, pl ? (pl.mannequin === true ? 'oui' : pl.mannequin === false ? 'non' : '') : '')}</div>
        <button type="submit" class="btn block mt">Enregistrer</button>
        ${pl ? `<button type="button" class="btn ghost block mt danger" data-action="reglages.piscine-supprimer" data-id="${esc(pl.id)}">Supprimer cette piscine</button>` : ''}
      </form>`,
    });
  }

  function openInjurySheet(id) {
    const inj = id ? (prof().injuries || []).find((x) => x.id === id) : null;
    C.ui.openModal({
      title: inj ? 'Modifier la zone' : 'Zone fragile ou blessure',
      body: `<form data-form="reglages.blessure-enregistrer" data-id="${esc(inj ? inj.id : '')}">
        <label class="field"><span>Zone</span><select name="zone">${ZONES.map((z) => `<option value="${esc(z.value)}" ${inj && inj.zone === z.value ? 'selected' : ''}>${esc(z.label)}</option>`).join('')}</select></label>
        <div class="field"><span>Côté</span>${C.ui.segmented('side', SIDES.concat([{ value: '', label: 'Sans objet' }]), inj ? inj.side : '')}</div>
        <label class="field"><span>Depuis (facultatif)</span><input type="date" name="since" value="${esc(inj && U.isKey(inj.since) ? inj.since : '')}"></label>
        <label class="field"><span>Note (facultatif)</span><input type="text" name="note" maxlength="300" autocomplete="off" value="${esc(inj ? inj.note : '')}" placeholder="Ex. entorse ancienne, gêne en descente"></label>
        <button type="submit" class="btn block mt">Enregistrer</button>
        ${inj ? `<button type="button" class="btn ghost block mt danger" data-action="reglages.blessure-supprimer" data-id="${esc(inj.id)}">Supprimer</button>` : ''}
      </form>`,
    });
  }

  /* ───────── Export / import ───────── */

  function markExported() {
    C.store.update((s) => { s.settings.lastExportAt = new Date().toISOString(); });
  }

  // Doit être appelé directement dans le clic (partage iOS).
  function exportNow() {
    const text = C.store.exportJSON(true);
    const name = exportName(U.todayKey());
    if (!C.health || !C.health.shareFile) { copyJSON(text); return; }
    C.health.shareFile(name, text, 'application/json', { title: 'Sauvegarde Crevare' }).then((res) => {
      if (res === 'cancelled' || res === 'shown') return;
      markExported();
      C.ui.toast(res === 'shared' ? '✓ Sauvegarde exportée' : res === 'downloaded' ? '✓ Fichier téléchargé' : '✓ Texte copié : colle-le dans Notes ou un mail à toi-même', 3500);
    });
  }

  function copyJSON(text) {
    const done = () => { markExported(); C.ui.toast('✓ Copié : colle-le dans Notes ou un mail à toi-même', 3500); };
    const fallback = () => {
      C.ui.openModal({ title: 'Copier la sauvegarde', body: `<textarea id="set-export-text" rows="8" readonly aria-label="Sauvegarde">${esc(text)}</textarea>
        <p class="small muted">Sélectionne tout le texte et copie-le, puis colle-le dans Notes ou un mail.</p>` });
      const ta = document.getElementById('set-export-text');
      if (ta) { ta.focus(); ta.select(); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function readFile(file) {
    if (file.text) return file.text();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
      r.readAsText(file);
    });
  }

  /* ───────── Apple Santé ───────── */

  function analyseHealth(text) {
    healthPending = { parsed: C.health.parse(text) };
    healthResult = null;
    if (!healthPending.parsed.count && !healthPending.parsed.errors.length) {
      healthPending = null;
      C.ui.toast('Rien à lire : lance d\'abord le raccourci « Crevare Santé »');
    }
    C.rerender();
  }

  /* ───────── Enregistrement ───────── */

  // Enveloppe de page : permet des cibles tactiles de 44 px dans tout le module (.set-page).
  const page = (view) => (params) => {
    const out = view(params);
    return typeof out === 'string' ? `<div class="set-page">${out}</div>` : { ...out, html: `<div class="set-page">${out.html}</div>` };
  };

  function register() {
    C.route('#/reglages', page(viewSettings), { tab: '#/plus', title: 'Réglages' });
    C.route('#/donnees', page(viewBackup), { tab: '#/plus', title: 'Sauvegarde' });
    C.route('#/sante', page(viewHealth), { tab: '#/plus', title: 'Apple Santé & calendrier' });
    C.menuItem({ hash: '#/sante', icon: '⌚️', label: 'Apple Santé & calendrier', desc: 'Raccourci iOS, séances dans Calendrier', order: 40 });
    C.menuItem({ hash: '#/donnees', icon: '💾', label: 'Sauvegarde', desc: 'Exporter, importer, restaurer', order: 45 });
    C.menuItem({ hash: '#/reglages', icon: '⚙️', label: 'Réglages', desc: 'Profil, piscines, matériel, dispos, thème', order: 50 });

    // — Profil
    C.onChange('reglages.profil', (el) => {
      const f = el.dataset.f;
      const def = Object.prototype.hasOwnProperty.call(PROFILE_FIELDS, f) ? PROFILE_FIELDS[f] : null;
      if (!def) return;
      let ok = true;
      C.store.update((s) => { ok = applyProfileField(s.profile, f, el.value); }, { silent: true });
      if (!ok) {
        C.ui.toast(f === 'birthYear' ? 'Année de naissance invalide (ex. 2006)' : 'Valeur invalide');
        C.rerender();
        return;
      }
      if (def.silent) C.ui.toast('✓ Enregistré', 1200); else C.rerender();
    });
    C.action('reglages.jour', (el) => {
      C.store.update((s) => { s.profile.availableDays = toggleDay(s.profile.availableDays, el.dataset.d); });
    });
    C.action('reglages.materiel', (el) => {
      C.store.update((s) => {
        if (!U.isObj(s.profile.equipment)) s.profile.equipment = { home: [], gym: { name: '', hyrox: false } };
        s.profile.equipment.home = toggleItem(s.profile.equipment.home, el.dataset.id);
      });
    });
    C.onChange('reglages.debut', (el) => {
      if (!U.isKey(el.value)) { C.ui.toast('Date invalide'); C.rerender(); return; }
      C.store.update((s) => { s.plan.startDate = el.value; });
      C.ui.toast('Début du plan modifié');
    });

    // — Blessures
    C.action('reglages.blessure-ajouter', () => openInjurySheet(null));
    C.action('reglages.blessure-modifier', (el) => openInjurySheet(el.dataset.id));
    C.onSubmit('reglages.blessure-enregistrer', (form, fd) => {
      const id = form.dataset.id;
      const zone = ZONES.some((z) => z.value === fd.get('zone')) ? fd.get('zone') : 'autre';
      const side = String(fd.get('side') || '').slice(0, 20);
      const since = U.isKey(fd.get('since')) ? fd.get('since') : null;
      const note = String(fd.get('note') || '').trim().slice(0, 300);
      C.ui.closeModal();
      C.store.update((s) => {
        const list = Array.isArray(s.profile.injuries) ? s.profile.injuries : (s.profile.injuries = []);
        const cur = id ? list.find((x) => x.id === id) : null;
        if (cur) Object.assign(cur, { zone, side, since, note });
        else list.push({ id: U.uid(), zone, side, note, active: true, since });
      });
    });
    C.action('reglages.blessure-active', (el) => {
      C.store.update((s) => { const i = (s.profile.injuries || []).find((x) => x.id === el.dataset.id); if (i) i.active = !i.active; });
    });
    C.action('reglages.blessure-supprimer', async (el) => {
      C.ui.closeModal();
      if (!(await C.ui.ask('Supprimer cette zone ? Pour garder l\'historique, rends-la plutôt inactive.', 'Supprimer', { danger: true }))) return;
      C.store.update((s) => { s.profile.injuries = (s.profile.injuries || []).filter((x) => x.id !== el.dataset.id); });
    });

    // — Piscines
    C.action('reglages.piscine-ajouter', (el) => openPoolSheet(null, el.dataset.len));
    C.action('reglages.piscine-modifier', (el) => openPoolSheet(el.dataset.id));
    C.onSubmit('reglages.piscine-enregistrer', (form, fd) => {
      const pool = poolFromForm(Object.fromEntries(fd.entries()));
      if (!pool) { C.ui.toast('Profondeur invalide (en mètres, ex. 3,5)'); return; }
      const id = form.dataset.id;
      C.ui.closeModal();
      C.store.update((s) => {
        const list = Array.isArray(s.profile.pools) ? s.profile.pools : (s.profile.pools = []);
        const cur = id ? list.find((x) => x.id === id) : null;
        if (cur) Object.assign(cur, pool); else list.push({ id: U.uid(), ...pool });
      });
    });
    C.action('reglages.piscine-supprimer', async (el) => {
      C.ui.closeModal();
      if (!(await C.ui.ask('Supprimer cette piscine ? Les séances déjà faites gardent leur longueur de bassin.', 'Supprimer', { danger: true }))) return;
      C.store.update((s) => { s.profile.pools = (s.profile.pools || []).filter((x) => x.id !== el.dataset.id); });
    });

    // — Son, voix, thème, rappel
    C.onChange('reglages.reglage', (el) => {
      const f = el.dataset.f;
      C.store.update((s) => {
        if (f === 'sound' || f === 'voice') s.settings[f] = !!el.checked;
        else if (f === 'theme' && THEMES.some((t) => t.value === el.value)) s.settings.theme = el.value;
        else if (f === 'exportReminderDays' && REMINDERS.some((r) => String(r.value) === el.value)) s.settings.exportReminderDays = Number(el.value);
      });
      if (f === 'theme' && C.applyTheme) C.applyTheme();
    });

    C.action('reglages.questionnaire', async () => {
      if (!(await C.ui.ask('Refaire le questionnaire ? Tes réponses actuelles sont préremplies ; tes séances et tests sont gardés.', 'Commencer'))) return;
      if (C.onboardingUI && C.onboardingUI.restart) C.onboardingUI.restart();
      C.go('#/bienvenue');
    });

    // — Sauvegarde
    C.action('reglages.exporter', () => exportNow());
    C.action('reglages.copier', () => copyJSON(C.store.exportJSON(true)));
    C.action('reglages.persister', async () => {
      const ok = await C.store.persist();
      C.ui.toast(ok ? '✓ Protection accordée' : 'Refusée par le navigateur : installe l\'app sur l\'écran d\'accueil et exporte régulièrement.', 3500);
      C.rerender();
    });
    C.onChange('reglages.import-fichier', async (el) => {
      const file = el.files && el.files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { C.ui.toast('Fichier trop gros pour une sauvegarde Crevare'); return; }
      try {
        const text = await readFile(file);
        pendingImport = { text, preview: backupPreview(text), pasted: false };
      } catch (e) {
        pendingImport = { text: '', preview: { ok: false, error: e.message || 'Lecture du fichier impossible.' }, pasted: false };
      }
      C.rerender();
    });
    C.action('reglages.import-verifier', () => {
      const ta = document.getElementById('set-import-text');
      const text = ta ? ta.value : '';
      pendingImport = { text, preview: backupPreview(text), pasted: true };
      C.rerender();
    });
    C.action('reglages.import-annuler', () => { pendingImport = null; C.rerender(); });
    C.action('reglages.import-appliquer', async () => {
      if (!pendingImport || !pendingImport.preview || !pendingImport.preview.ok) return;
      if (!(await C.ui.ask('Remplacer toutes les données de ce téléphone par cette sauvegarde ?', 'Remplacer', { danger: true }))) return;
      try {
        C.store.importJSON(pendingImport.text);
        pendingImport = null;
        if (C.onboardingUI && C.onboardingUI.reset) C.onboardingUI.reset();
        C.ui.toast('✓ Sauvegarde importée');
        C.go('#/');
      } catch (e) {
        pendingImport.preview = { ok: false, error: e && e.message ? e.message : 'Import impossible.' };
        C.rerender();
      }
    });
    C.action('reglages.restaurer', async () => {
      if (!(await C.ui.ask('Remplacer les données actuelles par la copie de secours ? (Les données actuelles deviennent à leur tour la copie de secours.)', 'Restaurer'))) return;
      try {
        C.store.restoreBackup();
        if (C.onboardingUI && C.onboardingUI.reset) C.onboardingUI.reset();
        C.ui.toast('✓ Copie de secours restaurée');
        C.go('#/');
      } catch (e) { C.ui.toast(e.message || 'Restauration impossible'); }
    });
    C.action('reglages.effacer', async () => {
      if (!(await C.ui.ask('Effacer toutes tes données de ce téléphone : séances, tests, objectifs, habitudes, poids, agenda ?', 'Continuer', { danger: true, title: 'Tout effacer' }))) return;
      if (!(await C.ui.ask('Dernière vérification : as-tu exporté une sauvegarde ? Une copie de secours est gardée, mais elle sera remplacée au prochain import.', 'Tout effacer', { danger: true, title: 'Vraiment tout effacer ?' }))) return;
      C.store.reset();
      pendingImport = null;
      if (C.onboardingUI && C.onboardingUI.reset) C.onboardingUI.reset();
      C.go('#/bienvenue');
      C.ui.toast('Données effacées');
    });

    // — Apple Santé
    C.action('sante.coller', () => {
      if (!C.health) return;
      const clip = navigator.clipboard;
      if (clip && clip.readText) {
        // Lecture directement dans le clic : iOS affiche une bulle « Coller » à confirmer.
        clip.readText().then((t) => {
          if (!String(t || '').trim()) { C.ui.toast('Presse-papiers vide : lance d\'abord le raccourci « Crevare Santé »', 3500); return; }
          analyseHealth(t);
        }, () => {
          healthManual = true;
          C.ui.toast('Accès refusé : colle le texte dans la zone prévue', 3000);
          C.rerender();
          const ta = document.getElementById('set-health-text');
          if (ta) ta.focus();
        });
      } else {
        healthManual = true;
        C.rerender();
        const ta = document.getElementById('set-health-text');
        if (ta) ta.focus();
      }
    });
    C.action('sante.analyser', () => {
      const ta = document.getElementById('set-health-text');
      if (!ta || !ta.value.trim()) { C.ui.toast('Colle d\'abord le texte'); return; }
      healthManual = true;
      analyseHealth(ta.value);
    });
    C.action('sante.annuler', () => { healthPending = null; C.rerender(); });
    C.action('sante.appliquer', () => {
      if (!healthPending || !C.health) return;
      const parsed = healthPending.parsed;
      healthPending = null;
      const res = C.health.apply(parsed);
      healthResult = C.health.summaryLines(res);
      C.rerender();
      C.ui.toast('✓ Données ajoutées');
    });
    C.onSubmit('sante.seance', (form, fd) => {
      if (!C.health) return;
      const v = Object.fromEntries(fd.entries());
      const line = ['entrainement', v.date, String(v.type || 'Autre').replace(/;/g, ','), v.duration, v.km, v.kcal, v.hr].map((x) => String(x ?? '').trim()).join(';');
      const parsed = C.health.parse(line);
      if (parsed.errors.length || !parsed.workouts.length) { C.ui.toast(parsed.errors.length ? parsed.errors[0].reason : 'Séance illisible', 3000); return; }
      const res = C.health.apply(parsed);
      healthResult = C.health.summaryLines(res);
      C.rerender();
      C.ui.toast(res.workoutsDup ? 'Déjà enregistrée' : '✓ Séance ajoutée');
    });
    C.action('sante.ics', () => {
      if (!C.health) return;
      const today = U.todayKey();
      const text = C.health.icsForPlan(today, U.addDays(today, 55));
      const n = (text.match(/BEGIN:VEVENT/g) || []).length;
      if (!n) { C.ui.toast('Rien à exporter pour les 8 prochaines semaines'); return; }
      C.health.shareFile('crevare-seances.ics', text, 'text/calendar', { title: 'Séances Crevare' }).then((res) => {
        if (res === 'cancelled' || res === 'shown') return;
        C.ui.toast(res === 'copied' ? 'Texte du calendrier copié' : `✓ ${U.plural(n, 'événement exporté', 'événements exportés')}`);
      });
    });
    C.action('sante.ics-revisions', () => {
      if (!C.health || !C.agenda || !C.agenda.icsForRevisions) return;
      const today = U.todayKey();
      const text = safe(() => C.agenda.icsForRevisions(today, U.addDays(today, 13)), '');
      if (!text || !/BEGIN:VEVENT/.test(text)) { C.ui.toast('Aucune révision prévue à exporter'); return; }
      C.health.shareFile('crevare-revisions.ics', text, 'text/calendar', { title: 'Révisions Crevare' }).then((res) => {
        if (res === 'copied') C.ui.toast('Texte du calendrier copié');
      });
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.backupUI = { reminderCard, exportNow };
  C.settingsUI = {
    viewSettings, viewBackup, viewHealth,
    LABELS: { ZONES, SIDES, EQUIPMENT, SWIM_LEVELS, DURATIONS, PER_WEEK, POOL_LENGTHS, YES_NO, zoneLabel },
    applyProfileField, toggleDay, toggleItem,
    _t: { applyProfileField, toggleDay, toggleItem, poolFromForm, daysSinceExport, needsBackupReminder, backupPreview, exportName, fmtBytes },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
