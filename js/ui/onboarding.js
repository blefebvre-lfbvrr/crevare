/* Crevare — questionnaire de départ (#/bienvenue), affiché tant que profile.onboarded est faux.
 * Une question par écran, barre de progression, bouton Retour. Les réponses restent en mémoire (brouillon)
 * jusqu'à « Créer mon plan », puis : profil, début du plan, objectifs (modèles C.data), premiers tests.
 * Tout reste modifiable ensuite (Réglages, Objectifs). Si les données viennent de la v1, on préremplit. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Accès défensifs ───────── */

  const D = () => C.data || {};
  const st = () => C.state || {};
  function safe(fn, fallback) { try { return fn(); } catch (e) { console.error(e); return fallback; } }
  const metric = (name, ...args) => (C.metrics && typeof C.metrics[name] === 'function' ? safe(() => C.metrics[name](...args), null) : null);

  // Libellés partagés avec les réglages (settings.js est chargé après : lecture à l'exécution).
  const FALLBACK_LABELS = {
    ZONES: [{ value: 'cheville', label: 'Cheville' }, { value: 'genou', label: 'Genou' }, { value: 'epaule', label: 'Épaule' }, { value: 'dos', label: 'Dos' },
      { value: 'hanche', label: 'Hanche' }, { value: 'poignet', label: 'Poignet' }, { value: 'autre', label: 'Autre' }],
    SIDES: [{ value: 'gauche', label: 'Gauche' }, { value: 'droite', label: 'Droite' }, { value: 'les deux', label: 'Les deux' }],
    EQUIPMENT: [{ id: 'barre', label: 'Barre de traction' }, { id: 'elastiques', label: 'Élastiques' }, { id: 'halteres', label: 'Haltères' }],
    SWIM_LEVELS: [{ value: 'inconnu', label: 'Je ne sais pas' }, { value: 'debutant', label: 'Débutant' }, { value: 'a-l-aise', label: "À l'aise" }, { value: 'confirme', label: 'Confirmé' }],
    DURATIONS: [45, 60, 90, 120, 180].map((m) => ({ value: m, label: `${m} min` })),
    PER_WEEK: [2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) })),
  };
  const L = () => Object.assign({}, FALLBACK_LABELS, (C.settingsUI && C.settingsUI.LABELS) || {});
  const zoneLabel = (z) => (L().ZONES.find((x) => x.value === z) || { label: z }).label;

  const STEPS = ['Bienvenue', 'Blessures', 'Objectifs', 'Disponibilités', 'Lieux et matériel', 'Niveau actuel', 'Récapitulatif'];
  const LAST = STEPS.length - 1; // récapitulatif ; l'écran final (STEPS.length) suit la création du plan
  const GOAL_ORDER = ['ssa', 'hyrox', 'pompier', 'protection-civile', 'custom'];
  const RUNS = [0, 1, 2, 3, 4].map((n) => ({ value: n, label: n === 4 ? '4 ou +' : String(n) }));

  /* ───────── Brouillon ───────── */

  let draft = null;

  const nextMonday = (today) => U.addDays(U.mondayOf(today), 7);

  // Objectif existant correspondant à un modèle (pour ne pas créer de doublon en refaisant le questionnaire).
  function matchGoal(goals, tplId) {
    const act = (Array.isArray(goals) ? goals : []).filter((g) => U.isObj(g) && g.status === 'active');
    if (tplId === 'protection-civile') return act.find((g) => g.details && (g.details.template === 'protection-civile' || g.details.kind === 'protection-civile')) || null;
    if (tplId === 'custom') return null;
    return act.find((g) => (g.details && g.details.template === tplId) || (g.type === tplId && !(g.details && g.details.template && g.details.template !== tplId))) || null;
  }
  // Objectif issu de la v1 : sans modèle ni jalons → on le reconstruit depuis le modèle.
  const isLegacyGoal = (g) => !(g.details && g.details.template) && !(Array.isArray(g.milestones) && g.milestones.length);

  function templateDefaultDate(tplId, today) {
    const tpl = (D().goalTemplates || {})[tplId];
    if (!tpl || tpl.defaultDate == null) return '';
    const d = typeof tpl.defaultDate === 'function' ? safe(() => tpl.defaultDate(today), null) : tpl.defaultDate;
    return U.isKey(d) ? d : '';
  }
  function hyroxChoices(today) {
    return D().upcomingHyroxEvents ? safe(() => D().upcomingHyroxEvents(today, { minDays: 56 }), []) : [];
  }

  // Meilleure (ou dernière) valeur connue d'un test, pour préremplir.
  function knownValue(benchId) {
    const e = metric('benchBest', benchId) || metric('benchLast', benchId);
    if (e && U.num(e.value) != null) return U.num(e.value);
    const list = ((st().benchmarks || {})[benchId] || []).filter((x) => x && U.num(x.value) != null);
    return list.length ? U.num(list[list.length - 1].value) : null;
  }

  // Lecture de « 3 sorties par semaine, 7 à 10 km » (texte du profil) pour préremplir.
  function parseRunText(t) {
    const s = String(t || '');
    const m = s.match(/(\d)\s*\+?\s*(?:ou \+\s*)?sorties?/i);
    const km = s.match(/(\d+(?:[.,]\d+)?(?:\s*(?:à|-)\s*\d+(?:[.,]\d+)?)?)\s*km/i);
    return { perWeek: m ? Math.min(4, Number(m[1])) : null, km: km ? km[1] : '' };
  }
  function runText(perWeek, km) {
    const parts = [];
    if (perWeek != null) parts.push(perWeek === 0 ? 'pas de course en ce moment' : `${perWeek >= 4 ? '4 ou plus' : perWeek} sortie${perWeek > 1 ? 's' : ''} par semaine`);
    if (km) parts.push(`${km} km`);
    return parts.join(', ');
  }
  function strengthText(d) {
    const parts = [];
    if (d.pullups != null) parts.push(`${d.pullups} traction${d.pullups > 1 ? 's' : ''} stricte${d.pullups > 1 ? 's' : ''}`);
    if (d.pushups != null) parts.push(`${d.pushups} pompe${d.pushups > 1 ? 's' : ''}`);
    if (d.plankSec != null) parts.push(`gainage ${U.formatDuration(d.plankSec)}`);
    return parts.join(', ');
  }

  /* draftFromState(state, today) → brouillon prérempli depuis l'état (profil, objectifs actifs, tests connus). */
  function draftFromState(state, today) {
    const s = state || {};
    const p = s.profile || {};
    const goals = Array.isArray(s.goals) ? s.goals : [];
    const eq = p.equipment || {};
    const run = parseRunText(p.levels && p.levels.run);
    const evs = hyroxChoices(today);
    const hx = matchGoal(goals, 'hyrox');
    const tplHx = ((D().goalTemplates || {}).hyrox || {}).details || {};
    const hxEvent = hx && hx.details && hx.details.event ? hx.details.event
      : (evs.find((e) => e.id === tplHx.event) || evs[0] || { id: '' }).id;
    const g = {};
    for (const id of GOAL_ORDER) {
      const m = matchGoal(goals, id);
      g[id] = { on: !!m, existingId: m ? m.id : null, date: (m && m.date) || templateDefaultDate(id, today) };
    }
    Object.assign(g.hyrox, {
      event: hxEvent, division: (hx && hx.details && hx.details.division) || tplHx.division || 'doubles',
      category: (hx && hx.details && hx.details.category) || (p.sex === 'F' ? 'women' : 'men'),
      partner: (hx && hx.details && hx.details.partner) || '',
    });
    const pp = matchGoal(goals, 'pompier');
    g.pompier.path = (pp && pp.details && pp.details.path) || 'indecis';
    const pc = matchGoal(goals, 'protection-civile');
    g['protection-civile'].city = (pc && pc.details && pc.details.city) || '';
    Object.assign(g.custom, { name: '', discipline: 'course', benchId: '', date: templateDefaultDate('custom', today) });
    return {
      step: 0,
      redo: !!p.onboarded,
      migrated: s.migratedFrom === 1 && !p.onboarded,
      firstName: p.firstName || '',
      birthYear: p.birthYear || '',
      sex: p.sex || '',
      injuries: (Array.isArray(p.injuries) ? p.injuries : []).map((i) => ({ id: i.id, zone: i.zone, side: i.side || '', active: i.active !== false, note: i.note || '', since: i.since || null })),
      goals: g,
      sessionsPerWeek: p.sessionsPerWeek || 3,
      availableDays: Array.isArray(p.availableDays) && p.availableDays.length ? p.availableDays.slice() : [1, 3, 5],
      maxSessionMin: p.maxSessionMin || 120,
      start: p.onboarded ? 'keep' : 'today',
      pools: (Array.isArray(p.pools) ? p.pools : []).map((x) => ({ ...x })),
      gymName: (eq.gym && eq.gym.name) || '',
      gymHyrox: !!(eq.gym && eq.gym.hyrox),
      home: Array.isArray(eq.home) ? eq.home.slice() : ['barre', 'elastiques'],
      apneaBuddy: p.apneaBuddy || '',
      swim: (p.levels && p.levels.swim) || 'inconnu',
      swim100: knownValue('swim_100'),
      runPerWeek: run.perWeek,
      runKm: run.km,
      run5k: knownValue('run_5k'),
      pullups: knownValue('pullups'),
      pushups: knownValue('pushups'),
      plankSec: knownValue('plank'),
      persisted: null,
    };
  }

  /* goalsFromDraft(draft, goals, today, create) → nouveau tableau d'objectifs.
   * create(tplId, overrides, today) = C.data.createGoalFromTemplate. Objectif coché : mis à jour s'il existe déjà
   * (reconstruit depuis le modèle s'il vient de la v1), sinon créé. Objectif décoché : jamais supprimé. */
  function goalsFromDraft(d, goals, today, create, refresh) {
    const out = (Array.isArray(goals) ? goals : []).map((g) => ({ ...g }));
    for (const id of GOAL_ORDER) {
      const sel = d.goals[id];
      if (!sel || !sel.on) continue;
      const ov = { details: {} };
      if (id === 'ssa' || id === 'pompier') ov.date = U.isKey(sel.date) ? sel.date : undefined;
      if (id === 'pompier') ov.details.path = sel.path || 'indecis';
      if (id === 'protection-civile') { ov.details.city = String(sel.city || '').trim().slice(0, 80); }
      if (id === 'hyrox') {
        const ev = sel.event && D().hyroxEvent ? D().hyroxEvent(sel.event) : null;
        ov.details = { event: ev ? ev.id : '', division: sel.division, category: sel.category, level: 'open', partner: String(sel.partner || '').trim().slice(0, 80) };
        ov.date = ev ? ev.defaultDay : (U.isKey(sel.date) ? sel.date : undefined);
        if (U.isKey(ov.date)) ov.details.raceDate = ov.date;
      }
      if (id === 'custom') {
        const name = String(sel.name || '').trim();
        if (!name) continue;
        if (out.some((g) => g.status === 'active' && U.normalize(g.name) === U.normalize(name))) continue;
        ov.name = name.slice(0, 120);
        ov.date = U.isKey(sel.date) ? sel.date : undefined;
        ov.details = { discipline: sel.discipline || 'autre', benchId: sel.benchId || null };
      }
      const idx = id === 'custom' ? -1 : out.findIndex((g) => g === matchGoal(out, id));
      if (idx < 0) { out.push(create(id, ov, today)); continue; }
      const cur = out[idx];
      if (isLegacyGoal(cur)) {
        const fresh = create(id, ov.date ? ov : { ...ov, date: cur.date || undefined }, today);
        out[idx] = { ...fresh, id: cur.id, createdAt: cur.createdAt || fresh.createdAt, note: cur.note || fresh.note };
        continue;
      }
      // Mise à jour d'un objectif v2 existant : détails fusionnés, date, jalons recalculés si la date change.
      const next = { ...cur, details: { ...(cur.details || {}), ...ov.details } };
      if (U.isKey(ov.date) && ov.date !== cur.date) {
        next.date = ov.date;
        if (id === 'pompier') next.details.applyDate = ov.date;
        if (typeof refresh === 'function') next.milestones = refresh(next, today, 'date');
      }
      out[idx] = next;
    }
    return out;
  }

  // Tests déclarés au questionnaire → [{ benchId, value, note }].
  function benchesFromDraft(d) {
    const out = [];
    const add = (benchId, value, note) => { if (U.num(value) != null && U.num(value) >= 0) out.push({ benchId, value: U.num(value), note }); };
    add('pullups', d.pullups, 'Déclaré au questionnaire (tractions strictes)');
    add('pushups', d.pushups, 'Déclaré au questionnaire : pompes max, sans cadence imposée');
    add('plank', d.plankSec, 'Déclaré au questionnaire');
    add('swim_100', d.swim100, 'Déclaré au questionnaire');
    add('run_5k', d.run5k, 'Déclaré au questionnaire');
    return out;
  }

  // Validation d'une étape → message d'erreur ou ''.
  function stepError(d, step) {
    if (step === 0) {
      const y = String(d.birthYear || '').trim();
      if (y && !(Number.isInteger(Number(y)) && Number(y) >= 1930 && Number(y) <= Number(U.todayKey().slice(0, 4)) - 10)) return 'Année de naissance invalide (ex. 2006).';
    }
    if (step === 2) {
      const g = d.goals;
      if (g.hyrox.on && !g.hyrox.event && !U.isKey(g.hyrox.date)) return 'HYROX : choisis une course ou une date.';
      if (g.custom.on && !String(g.custom.name || '').trim()) return 'Objectif perso : donne-lui un nom.';
      for (const id of ['ssa', 'pompier', 'custom']) if (g[id].on && U.isKey(g[id].date) && g[id].date <= U.todayKey()) return 'Une date d\'objectif est déjà passée.';
    }
    if (step === 3 && !d.availableDays.length) return 'Choisis au moins un jour.';
    return '';
  }

  /* ───────── Rendu des étapes ───────── */

  const seg = (f, options, current, extra = '') => C.ui.segmented(`onb-${f}`, options, current, `data-change="onb.champ" data-f="${esc(f)}" ${extra}`);
  const textInput = (f, value, attrs = '') => `<input type="text" class="onb-in" id="onb-${esc(f.replace(/\./g, '-'))}" data-input="onb.champ" data-f="${esc(f)}" value="${esc(value ?? '')}" autocomplete="off" ${attrs}>`;
  const dateInput = (f, value, attrs = '') => `<input type="date" class="onb-in" id="onb-${esc(f.replace(/\./g, '-'))}" data-change="onb.champ" data-f="${esc(f)}" value="${esc(U.isKey(value) ? value : '')}" ${attrs}>`;
  const numInput = (f, value, label, attrs = '') => `<input type="text" inputmode="numeric" class="onb-num" id="onb-${esc(f)}" data-input="onb.champ" data-f="${esc(f)}" value="${esc(value ?? '')}" autocomplete="off" aria-label="${esc(label)}" ${attrs}>`;
  const timeIn = (f, value, label) => C.ui.timeInput({ value, label, id: `onb-${f}`, data: { input: 'onb.champ', f } });
  const pressed = (b) => (b ? 'true' : 'false');

  function stepWelcome(d) {
    return `<h1 class="onb-title">Bienvenue sur Crevare</h1>
      <p>Ton plan d'entraînement pour tes objectifs (SSA, HYROX, pompier…), avec ton agenda. Deux minutes de questions ; tout reste modifiable.</p>
      ${d.migrated ? '<p class="note ok small">On a repris tes données de l\'ancienne version : séances, tests, habitudes et dates d\'objectifs. Vérifie et complète.</p>' : ''}
      ${d.redo ? '<p class="note small">Tes réponses actuelles sont préremplies. Tes séances et tes tests sont gardés.</p>' : ''}
      <label class="field"><span>Ton prénom (facultatif)</span>${textInput('firstName', d.firstName, 'maxlength="40" autocapitalize="words" autocomplete="given-name"')}</label>
      <label class="field"><span>Année de naissance</span>${numInput('birthYear', d.birthYear, 'Année de naissance', 'maxlength="4" placeholder="AAAA"')}</label>
      <div class="field"><span>Catégorie pour les barèmes officiels</span>${seg('sex', [{ value: 'H', label: 'Hommes' }, { value: 'F', label: 'Femmes' }], d.sex)}
        <small class="muted">Âge et catégorie servent seulement à choisir les bons barèmes (pompiers, HYROX).</small></div>
      <p class="small muted">🔒 Tes réponses restent sur ce téléphone.</p>`;
  }

  function stepInjuries(d) {
    const { SIDES, ZONES } = L();
    return `<h1 class="onb-title">Une blessure ou une zone fragile ?</h1>
      <p class="muted">On adapte les exercices (moins de sauts, alternatives sans impact). Ce n'est pas un diagnostic.</p>
      ${d.injuries.length ? `<ul class="onb-list">${d.injuries.map((inj, i) => `<li class="onb-inj">
        <div class="row between gap"><b>${esc(zoneLabel(inj.zone))}</b>
          <button type="button" class="icon-btn small" data-action="onb.blessure-retirer" data-i="${i}" aria-label="${esc(`Retirer : ${zoneLabel(inj.zone)}`)}">✕</button></div>
        ${C.ui.segmented(`onb-side-${i}`, SIDES, inj.side, `data-change="onb.blessure-cote" data-i="${i}"`)}
      </li>`).join('')}</ul>` : '<p class="small">Aucune pour l\'instant.</p>'}
      <p class="small"><b>Ajouter une zone :</b></p>
      <div class="onb-chips">${ZONES.filter((z) => !['coude', 'nuque'].includes(z.value)).map((z) => `<button type="button" class="set-chip" data-action="onb.blessure" data-zone="${esc(z.value)}">＋ ${esc(z.label)}</button>`).join('')}</div>`;
  }

  function goalBlock(id, d, today) {
    const tpl = (D().goalTemplates || {})[id];
    if (!tpl) return '';
    const g = d.goals[id];
    let inner = '';
    if (id === 'ssa') {
      inner = `<label class="field"><span>Date visée pour la certification</span>${dateInput('goals.ssa.date', g.date, `min="${esc(today)}"`)}</label>
        <p class="small muted">Test d'entrée, formation et TSA : tu ajouteras leurs dates dans l'objectif quand tu les connaîtras. Les cibles visent large
          (plus strictes que les minimums) pour passer même un mauvais jour.</p>`;
    } else if (id === 'hyrox') {
      const evs = hyroxChoices(today);
      inner = `<label class="field"><span>Course</span><select class="onb-in" data-change="onb.champ" data-f="goals.hyrox.event">
          ${evs.map((e) => `<option value="${esc(e.id)}" ${e.id === g.event ? 'selected' : ''}>${esc(`${e.name} · ${U.fmtMonthYear(e.start)}`)}</option>`).join('')}
          <option value="" ${!g.event ? 'selected' : ''}>Autre course (date à saisir)</option></select>
          <small class="muted">Dates et billetterie à revérifier sur le site de la course.</small></label>
        ${!g.event ? `<label class="field"><span>Date de la course</span>${dateInput('goals.hyrox.date', g.date, `min="${esc(today)}"`)}</label>` : ''}
        <div class="field"><span>Division</span>${seg('goals.hyrox.division', [{ value: 'doubles', label: 'Doubles' }, { value: 'solo', label: 'Solo' }, { value: 'relay', label: 'Relay' }], g.division)}</div>
        <div class="field"><span>Catégorie</span>${seg('goals.hyrox.category', [{ value: 'men', label: 'Hommes' }, { value: 'women', label: 'Femmes' }, { value: 'mixed', label: 'Mixte' }], g.category)}</div>
        ${g.division !== 'solo' ? `<label class="field"><span>Partenaire (facultatif)</span>${textInput('goals.hyrox.partner', g.partner, 'maxlength="80" placeholder="Prénom"')}</label>` : ''}
        <p class="small muted">Niveau Open (charges standard). Objectif : finir, en commençant doucement.</p>`;
    } else if (id === 'pompier') {
      const paths = Object.entries(D().pompierPaths || {});
      inner = `<label class="field"><span>Date de candidature</span>${dateInput('goals.pompier.date', g.date, `min="${esc(today)}"`)}</label>
        ${paths.length ? `<label class="field"><span>Voie</span><select class="onb-in" data-change="onb.champ" data-f="goals.pompier.path">${paths.map(([v, p]) => `<option value="${esc(v)}" ${v === g.path ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
          <small class="muted">Rien ne presse : « À décider » convient très bien.</small></label>` : ''}`;
    } else if (id === 'protection-civile') {
      inner = `<label class="field"><span>Ville visée (facultatif)</span>${textInput('goals.protection-civile.city', g.city, 'maxlength="80" placeholder="Ex. Montpellier"')}</label>`;
    } else if (id === 'custom') {
      const benches = (D().benchmarks || []).filter((b) => b.id !== 'ssa_test_v1');
      inner = `<label class="field"><span>Nom</span>${textInput('goals.custom.name', g.name, 'maxlength="120" placeholder="Ex. 10 km en moins de 50 min"')}</label>
        <label class="field"><span>Date</span>${dateInput('goals.custom.date', g.date, `min="${esc(today)}"`)}</label>
        <div class="field"><span>Discipline</span>${seg('goals.custom.discipline', [{ value: 'course', label: 'Course' }, { value: 'natation', label: 'Natation' }, { value: 'force', label: 'Force' }, { value: 'autre', label: 'Autre' }], g.discipline)}</div>
        ${benches.length ? `<label class="field"><span>Test lié (facultatif)</span><select class="onb-in" data-change="onb.champ" data-f="goals.custom.benchId">
          <option value="">Aucun</option>${benches.map((b) => `<option value="${esc(b.id)}" ${b.id === g.benchId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}`;
    }
    const short = { ssa: 'SSA — Surveillant sauveteur aquatique', hyrox: 'HYROX', pompier: 'Sapeur-pompier (volontaire, réserve…)', 'protection-civile': 'Protection civile — secours aquatiques', custom: 'Objectif perso' }[id] || tpl.name;
    return `<div class="onb-goal ${g.on ? 'is-on' : ''}">
      <label class="check-row onb-goal-head"><input type="checkbox" data-change="onb.objectif" data-tpl="${esc(id)}" ${g.on ? 'checked' : ''}>
        <span><span aria-hidden="true">${esc(tpl.icon || '🎯')}</span> <b>${esc(short)}</b>${g.existingId ? ' <span class="pill">déjà suivi</span>' : ''}</span></label>
      ${g.on ? `<div class="onb-goal-body">${inner}</div>` : ''}
    </div>`;
  }

  function stepGoals(d) {
    const today = U.todayKey();
    return `<h1 class="onb-title">Tes objectifs</h1>
      <p class="muted">Coche tout ce que tu vises. Le plan s'organise autour, du plus proche au plus lointain. Dates modifiables.</p>
      ${GOAL_ORDER.map((id) => goalBlock(id, d, today)).join('')}
      <p class="small muted">Aucun objectif ? Pas grave : le plan reste général et tu pourras en ajouter.</p>`;
  }

  function stepAvailability(d) {
    const { PER_WEEK, DURATIONS } = L();
    const today = U.todayKey();
    const mon = nextMonday(today);
    const plan = st().plan || {};
    const starts = [{ value: 'today', label: `Aujourd'hui (${U.fmtShort(today)})` }, { value: 'monday', label: `Lundi prochain (${U.fmtShort(mon)})` }];
    if (d.redo && U.isKey(plan.startDate)) starts.unshift({ value: 'keep', label: `Garder (${U.fmtShort(plan.startDate)})` });
    const few = d.availableDays.length < d.sessionsPerWeek;
    return `<h1 class="onb-title">Tes disponibilités</h1>
      <div class="field"><span>Séances de sport par semaine</span>${seg('sessionsPerWeek', PER_WEEK, d.sessionsPerWeek)}</div>
      <div class="field"><span>Jours possibles</span>
        <div class="set-days" role="group" aria-label="Jours possibles">${U.DAYS_SHORT.map((x, i) => `<button type="button" class="set-day" aria-pressed="${pressed(d.availableDays.includes(i))}"
          aria-label="${esc(U.DAYS[i])}" data-action="onb.jour" data-d="${i}">${esc(x)}</button>`).join('')}</div>
        <small class="muted">Jamais plus d'une séance par jour. Avec ton agenda importé, l'app évite les grosses journées de cours et les gardes.</small></div>
      ${few ? '<p class="note warn small">Moins de jours que de séances : le plan en prévoira moins.</p>' : ''}
      <div class="field"><span>Durée maximale d'une séance</span>${seg('maxSessionMin', DURATIONS, d.maxSessionMin)}</div>
      <div class="field"><span>Je commence</span>${seg('start', starts, d.start)}
        <small class="muted">Les premières semaines sont volontairement douces, puis ça monte progressivement.</small></div>`;
  }

  function stepPlaces(d) {
    const { EQUIPMENT } = L();
    return `<h1 class="onb-title">Lieux et matériel</h1>
      <h2 class="onb-sub">Piscines</h2>
      ${d.pools.length ? `<ul class="onb-list">${d.pools.map((pl, i) => `<li class="onb-pool">
        <label class="field grow"><span>Nom de la piscine ${esc(pl.length)} m</span>${textInput(`pool.${i}`, pl.name, `maxlength="60" placeholder="Ex. piscine municipale"`)}</label>
        <button type="button" class="icon-btn small" data-action="onb.piscine-retirer" data-i="${i}" aria-label="Retirer cette piscine">✕</button></li>`).join('')}</ul>` : ''}
      <div class="row gap wrap"><button type="button" class="btn ghost small" data-action="onb.piscine" data-len="25">＋ Piscine 25 m</button>
        <button type="button" class="btn ghost small" data-action="onb.piscine" data-len="50">＋ Piscine 50 m</button></div>
      <p class="small muted">Avant d'enregistrer une séance de natation, l'app te demandera laquelle. Profondeur et mannequin : dans Réglages.</p>

      <h2 class="onb-sub">Salle</h2>
      <label class="field"><span>Nom du club (facultatif)</span>${textInput('gymName', d.gymName, 'maxlength="80" placeholder="Ex. Fitness Park …"')}</label>
      <div class="field"><span>Équipée pour HYROX (SkiErg, sled, wall balls…)</span>${seg('gymHyrox', [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non / je ne sais pas' }], d.gymHyrox ? 'oui' : 'non')}</div>

      <h2 class="onb-sub">Matériel à la maison</h2>
      <div class="onb-chips">${EQUIPMENT.map((x) => `<button type="button" class="set-chip" aria-pressed="${pressed(d.home.includes(x.id))}" data-action="onb.materiel" data-id="${esc(x.id)}">${esc(x.label)}</button>`).join('')}</div>

      <h2 class="onb-sub">Apnée</h2>
      <label class="field"><span>Qui peut t'accompagner (club, binôme, MNS) ?</span>${textInput('apneaBuddy', d.apneaBuddy, 'maxlength="120" placeholder="Laisse vide si personne"')}</label>
      <p class="small muted">Jamais d'apnée seul : sans accompagnement confirmé, ces exercices sont remplacés par de la nage en surface.</p>`;
  }

  function stepLevel(d) {
    const { SWIM_LEVELS } = L();
    return `<h1 class="onb-title">Ton niveau actuel</h1>
      <p class="muted">Une estimation suffit : les vrais tests viendront dans les premières semaines.</p>
      <h2 class="onb-sub">Natation</h2>
      <div class="field">${seg('swim', SWIM_LEVELS, d.swim)}</div>
      ${d.swim === 'inconnu' ? '<p class="note small">Pas de souci : une séance de tests de natation sera prévue au début du plan.</p>' : ''}
      <label class="field"><span>Temps sur 100 m crawl, si tu le connais</span>${timeIn('swim100', d.swim100, 'Temps sur 100 m crawl')}</label>

      <h2 class="onb-sub">Course</h2>
      <div class="field"><span>Sorties par semaine en ce moment</span>${seg('runPerWeek', RUNS, d.runPerWeek == null ? '' : d.runPerWeek)}</div>
      <label class="field"><span>Distance habituelle (km)</span>${textInput('runKm', d.runKm, 'inputmode="text" maxlength="20" placeholder="Ex. 7 à 10"')}</label>
      <label class="field"><span>Temps sur 5 km, si tu le connais</span>${timeIn('run5k', d.run5k, 'Temps sur 5 km')}</label>

      <h2 class="onb-sub">Force</h2>
      <div class="onb-grid3">
        <label class="field"><span>Tractions strictes</span>${numInput('pullups', d.pullups, 'Tractions strictes', 'maxlength="3" placeholder="0"')}</label>
        <label class="field"><span>Pompes d'affilée</span>${numInput('pushups', d.pushups, 'Pompes', 'maxlength="3" placeholder="0"')}</label>
        <label class="field"><span>Gainage (m:ss)</span>${timeIn('plankSec', d.plankSec, 'Gainage, durée')}</label>
      </div>
      <p class="small muted">Enregistrés comme premiers repères (« déclaré au questionnaire ») dans Progrès. Tape 100 pour 1:00.</p>`;
  }

  function recapRow(label, value, step) {
    return `<li class="onb-recap-row"><span class="grow"><small class="muted">${esc(label)}</small><b>${value}</b></span>
      <button type="button" class="btn ghost small" data-action="onb.aller" data-step="${step}">Modifier</button></li>`;
  }

  function stepRecap(d) {
    const { EQUIPMENT, SWIM_LEVELS } = L();
    const today = U.todayKey();
    const g = d.goals;
    const goalTxt = GOAL_ORDER.filter((id) => g[id].on).map((id) => {
      if (id === 'hyrox') {
        const ev = g.hyrox.event && D().hyroxEvent ? D().hyroxEvent(g.hyrox.event) : null;
        return `HYROX ${ev ? `${ev.city} (${U.fmtLong(ev.defaultDay)})` : g.hyrox.date ? U.fmtLong(g.hyrox.date) : ''} · ${g.hyrox.division === 'doubles' ? 'Doubles' : g.hyrox.division === 'relay' ? 'Relay' : 'Solo'}`;
      }
      if (id === 'ssa') return `SSA${U.isKey(g.ssa.date) ? ` · ${U.fmtLong(g.ssa.date)}` : ''}`;
      if (id === 'pompier') return `Pompier${U.isKey(g.pompier.date) ? ` · candidature ${U.fmtLong(g.pompier.date)}` : ''}`;
      if (id === 'protection-civile') return `Protection civile${g['protection-civile'].city ? ` · ${g['protection-civile'].city}` : ''}`;
      return g.custom.name || 'Objectif perso';
    });
    const startTxt = d.start === 'keep' ? 'date actuelle gardée' : d.start === 'monday' ? U.fmtDate(nextMonday(today)) : `aujourd'hui (${U.fmtDate(today)})`;
    const pools = d.pools.map((p) => (p.name && p.name.includes(`${p.length} m`) ? p.name : `${p.name || 'Piscine'} (${p.length} m)`)).join(', ') || 'aucune';
    const home = d.home.map((id) => (EQUIPMENT.find((x) => x.id === id) || { label: id }).label).join(', ') || 'rien';
    const inj = d.injuries.map((i) => `${zoneLabel(i.zone)}${i.side ? ` ${i.side}` : ''}`).join(', ') || 'aucune';
    const swim = (SWIM_LEVELS.find((x) => x.value === d.swim) || { label: d.swim }).label;
    return `<h1 class="onb-title">Récapitulatif</h1>
      <p class="muted">Vérifie, puis crée ton plan. Tout se modifie ensuite dans Réglages et Objectifs.</p>
      <ul class="onb-recap">
        ${recapRow('Toi', esc([d.firstName, d.birthYear ? `né(e) en ${d.birthYear}` : '', d.sex === 'H' ? 'barèmes hommes' : d.sex === 'F' ? 'barèmes femmes' : ''].filter(Boolean).join(' · ') || '—'), 0)}
        ${recapRow('Blessures', esc(inj), 1)}
        ${recapRow('Objectifs', goalTxt.length ? goalTxt.map(esc).join('<br>') : 'aucun pour l\'instant', 2)}
        ${recapRow('Disponibilités', esc(`${d.sessionsPerWeek} séances/semaine · ${d.availableDays.map((i) => U.DAYS_ABBR[i]).join(' ')} · ${d.maxSessionMin} min max · début ${startTxt}`), 3)}
        ${recapRow('Lieux', esc(`Piscines : ${pools} · Salle : ${d.gymName || '—'}${d.gymHyrox ? ' (HYROX)' : ''} · Maison : ${home}${d.apneaBuddy ? ` · Apnée avec : ${d.apneaBuddy}` : ''}`), 4)}
        ${recapRow('Niveau', esc([`Natation : ${swim}`, runText(d.runPerWeek, d.runKm) ? `Course : ${runText(d.runPerWeek, d.runKm)}` : '', strengthText(d) ? `Force : ${strengthText(d)}` : ''].filter(Boolean).join(' · ')), 5)}
      </ul>`;
  }

  function stepDone(d) {
    const env = C.env || {};
    const hasAgenda = !!(C.agenda || C.agendaUI);
    const install = env.embedded ? '<p class="note warn small">Page ouverte dans claude.ai : pas d\'installation possible ici. Exporte souvent tes données.</p>'
      : !env.standalone ? `<div class="note small"><b>Installe l'app sur ton iPhone</b>
          <ol class="onb-steps"><li>Dans Safari, touche <b>Partager</b> (le carré avec une flèche).</li>
          <li>Choisis <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li>
          <li>Ouvre Crevare depuis l'icône : plein écran, et tes données sont mieux protégées.</li></ol>
          <p class="small muted">L'app installée a son propre stockage, séparé de Safari : si tu as déjà saisi des choses ici, exporte-les (Sauvegarde) puis importe-les dans l'app installée.</p></div>` : '';
    return `<h1 class="onb-title">C'est prêt${d.firstName ? `, ${esc(d.firstName)}` : ''} !</h1>
      <p>Ton plan est créé. Il commence doucement et s'adapte à tes objectifs, à tes blessures et à ton agenda.</p>
      ${install}
      <div class="note ${d.persisted ? 'ok' : 'warn'} small"><b>Tes données restent sur ce téléphone.</b>
        ${d.persisted ? 'Le navigateur a accepté de les protéger.' : 'Le navigateur peut les effacer s\'il manque de place.'}
        Pense à exporter une sauvegarde de temps en temps (Plus › Sauvegarde).</div>
      <ul class="menu mt">
        ${hasAgenda ? `<li><a class="menu-item" href="#/agenda-reglages"><span class="menu-icon" aria-hidden="true">🗓</span><span class="menu-text"><b>Ajouter tes calendriers</b>
          <small class="muted">Cours et Protection civile : les révisions se placent entre les deux, jamais après 22 h.</small></span><span aria-hidden="true">›</span></a></li>` : ''}
        <li><a class="menu-item" href="#/sante"><span class="menu-icon" aria-hidden="true">⌚️</span><span class="menu-text"><b>Relier Apple Santé</b>
          <small class="muted">Poids, pas, sommeil via un Raccourci iOS.</small></span><span aria-hidden="true">›</span></a></li>
        <li><a class="menu-item" href="#/donnees"><span class="menu-icon" aria-hidden="true">💾</span><span class="menu-text"><b>Faire une première sauvegarde</b>
          <small class="muted">Un fichier dans Fichiers (iCloud Drive).</small></span><span aria-hidden="true">›</span></a></li>
      </ul>
      <button type="button" class="btn block mt" data-action="onb.fin">Voir ma journée</button>`;
  }

  function view() {
    if (!draft) draft = draftFromState(st(), U.todayKey());
    const d = draft;
    if (d.step > LAST) return `<div class="onb">${stepDone(d)}</div>`;
    const body = [stepWelcome, stepInjuries, stepGoals, stepAvailability, stepPlaces, stepLevel, stepRecap][d.step](d);
    const pct = Math.round(((d.step + 1) / STEPS.length) * 100);
    return `<div class="onb">
      <div class="onb-top">
        ${d.step > 0 ? '<button type="button" class="onb-back" data-action="onb.retour">‹ Retour</button>' : '<span></span>'}
        <span class="small muted">Étape ${d.step + 1} sur ${STEPS.length}</span>
        ${d.redo ? '<button type="button" class="onb-back" data-action="onb.quitter">Quitter</button>' : '<span></span>'}
      </div>
      <div class="onb-progress" role="progressbar" aria-label="${esc(`Questionnaire : ${STEPS[d.step]}`)}" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${d.step + 1}">
        <span style="width:${pct}%"></span></div>
      <section class="onb-step">${body}</section>
      <div class="onb-nav">
        ${d.step < LAST ? `<button type="button" class="btn block" data-action="onb.suivant">${d.step === 0 ? 'Commencer' : 'Suivant'}</button>`
          : `<button type="button" class="btn block" data-action="onb.creer">${d.redo ? 'Mettre à jour mon plan' : 'Créer mon plan'}</button>`}
      </div>
    </div>`;
  }

  /* ───────── Saisie ───────── */

  // Écrit une valeur dans le brouillon. Renvoie true si l'écran doit être redessiné.
  function setDraftField(d, f, el) {
    const v = el.value;
    if (f.startsWith('pool.')) { const i = Number(f.slice(5)); if (d.pools[i]) d.pools[i].name = String(v).slice(0, 60); return false; }
    if (f.startsWith('goals.')) {
      const [, id, key] = f.split('.');
      const g = d.goals[id];
      if (!g) return false;
      if (key === 'date') { g.date = U.isKey(v) ? v : ''; return false; }
      g[key] = String(v).slice(0, 120);
      return ['event', 'division', 'category', 'discipline'].includes(key);
    }
    switch (f) {
      case 'firstName': d.firstName = String(v).slice(0, 40); return false;
      case 'birthYear': d.birthYear = String(v).replace(/\D/g, '').slice(0, 4); return false;
      case 'sex': d.sex = v === 'H' || v === 'F' ? v : ''; return false;
      case 'sessionsPerWeek': d.sessionsPerWeek = U.clamp(Math.round(Number(v)) || 3, 1, 7); return true;
      case 'maxSessionMin': d.maxSessionMin = U.clamp(Math.round(Number(v)) || 120, 20, 300); return false;
      case 'start': d.start = ['today', 'monday', 'keep'].includes(v) ? v : 'today'; return false;
      case 'gymName': d.gymName = String(v).slice(0, 80); return false;
      case 'gymHyrox': d.gymHyrox = v === 'oui'; return false;
      case 'apneaBuddy': d.apneaBuddy = String(v).slice(0, 120); return false;
      case 'swim': d.swim = v; return true;
      case 'runPerWeek': d.runPerWeek = v === '' ? null : U.clamp(Math.round(Number(v)), 0, 4); return false;
      case 'runKm': d.runKm = String(v).slice(0, 20); return false;
      case 'pullups': case 'pushups': { const n = String(v).trim() === '' ? null : Math.round(U.num(v)); d[f] = n != null && n >= 0 && n <= 500 ? n : null; return false; }
      case 'swim100': case 'run5k': case 'plankSec': d[f] = String(v).trim() ? U.parseDuration(v) : null; return false;
      default: return false;
    }
  }

  async function createPlan() {
    const d = draft;
    const today = U.todayKey();
    const err = [0, 2, 3].map((s) => stepError(d, s)).find(Boolean);
    if (err) { C.ui.toast(err, 3000); return; }
    // Demande de stockage persistant dans le geste (sans effet visible sur iOS ; accordé selon l'usage).
    const persistP = Promise.race([
      C.store.persist ? C.store.persist().catch(() => false) : Promise.resolve(false),
      new Promise((resolve) => setTimeout(() => resolve(false), 2000)), // pas d'attente infinie si le navigateur demande l'autorisation
    ]);
    const create = (id, ov, t) => D().createGoalFromTemplate(id, ov, t);
    const refresh = C.goalsUI && C.goalsUI._t ? C.goalsUI._t.refreshDues : null;
    let goals;
    try {
      goals = typeof D().createGoalFromTemplate === 'function' ? goalsFromDraft(d, st().goals, today, create, refresh) : st().goals;
    } catch (e) {
      console.error(e);
      C.ui.toast('Objectifs impossibles à créer : tu pourras les ajouter ensuite.', 3500);
      goals = st().goals;
    }
    C.store.update((s) => {
      const p = s.profile;
      p.firstName = String(d.firstName || '').trim().slice(0, 40);
      const y = Number(d.birthYear);
      p.birthYear = Number.isInteger(y) && y >= 1930 ? y : null;
      p.sex = d.sex === 'H' || d.sex === 'F' ? d.sex : null;
      p.injuries = d.injuries.map((i) => ({ id: i.id || U.uid(), zone: i.zone, side: i.side || '', note: i.note || '', active: i.active !== false, since: i.since || null }));
      p.sessionsPerWeek = d.sessionsPerWeek;
      p.availableDays = d.availableDays.slice().sort((a, b) => a - b);
      p.maxSessionMin = d.maxSessionMin;
      p.pools = d.pools.map((x) => ({ id: x.id || U.uid(), name: String(x.name || '').trim() || `Piscine ${x.length} m`, length: x.length, deepM: x.deepM ?? null, mannequin: x.mannequin ?? null }));
      p.equipment = { home: d.home.slice(), gym: { name: String(d.gymName || '').trim(), hyrox: !!d.gymHyrox } };
      p.apneaBuddy = String(d.apneaBuddy || '').trim();
      p.levels = { swim: d.swim || 'inconnu', run: runText(d.runPerWeek, String(d.runKm || '').trim()), strength: strengthText(d) };
      p.onboarded = true;
      if (!U.isObj(s.plan)) s.plan = { startDate: today, overrides: {} };
      if (d.start === 'monday') s.plan.startDate = nextMonday(today);
      else if (d.start === 'today' || !U.isKey(s.plan.startDate)) s.plan.startDate = today;
      s.goals = goals;
    }, { silent: true });
    if (C.metrics && typeof C.metrics.addBench === 'function') {
      for (const b of benchesFromDraft(d)) safe(() => C.metrics.addBench(b.benchId, { date: today, value: b.value, context: 'test', source: 'questionnaire', note: b.note }, { silent: true }));
    }
    d.step = STEPS.length; // écran final
    d.persisted = await persistP;
    C.rerender();
    window.scrollTo(0, 0);
  }

  function register() {
    C.route('#/bienvenue', view, { tab: '#/', title: 'Bienvenue' });

    C.onInput('onb.champ', (el) => { if (draft) setDraftField(draft, el.dataset.f, el); });
    C.onChange('onb.champ', (el) => { if (draft && setDraftField(draft, el.dataset.f, el)) C.rerender(); });
    C.action('onb.suivant', () => {
      if (!draft) return;
      const err = stepError(draft, draft.step);
      if (err) { C.ui.toast(err, 3000); return; }
      draft.step = Math.min(LAST, draft.step + 1);
      C.rerender(); window.scrollTo(0, 0);
    });
    C.action('onb.retour', () => { if (!draft) return; draft.step = Math.max(0, draft.step - 1); C.rerender(); window.scrollTo(0, 0); });
    C.action('onb.aller', (el) => { if (!draft) return; draft.step = U.clamp(Number(el.dataset.step) || 0, 0, LAST); C.rerender(); window.scrollTo(0, 0); });
    C.action('onb.quitter', () => { draft = null; C.go('#/reglages'); });
    C.action('onb.creer', () => createPlan());
    C.action('onb.fin', () => { draft = null; C.go('#/'); });

    // Blessures
    C.action('onb.blessure', (el) => {
      if (!draft) return;
      draft.injuries.push({ id: U.uid(), zone: el.dataset.zone, side: '', active: true, note: '' });
      C.rerender();
    });
    C.onChange('onb.blessure-cote', (el) => { const i = draft && draft.injuries[Number(el.dataset.i)]; if (i) i.side = String(el.value).slice(0, 20); });
    C.action('onb.blessure-retirer', (el) => { if (!draft) return; draft.injuries.splice(Number(el.dataset.i), 1); C.rerender(); });

    // Objectifs
    C.onChange('onb.objectif', (el) => {
      const g = draft && draft.goals[el.dataset.tpl];
      if (!g) return;
      g.on = !!el.checked;
      C.rerender();
    });

    // Disponibilités, lieux, matériel
    C.action('onb.jour', (el) => {
      if (!draft) return;
      const toggle = C.settingsUI && C.settingsUI.toggleDay;
      const n = Number(el.dataset.d);
      draft.availableDays = toggle ? toggle(draft.availableDays, n)
        : (draft.availableDays.includes(n) ? draft.availableDays.filter((x) => x !== n) : draft.availableDays.concat([n]).sort());
      C.rerender();
    });
    C.action('onb.piscine', (el) => {
      if (!draft) return;
      const len = Number(el.dataset.len) === 50 ? 50 : 25;
      draft.pools.push({ id: U.uid(), name: `Piscine ${len} m`, length: len, deepM: null, mannequin: null });
      C.rerender();
      const input = document.getElementById(`onb-pool-${draft.pools.length - 1}`);
      if (input) { input.focus(); input.select(); }
    });
    C.action('onb.piscine-retirer', (el) => { if (!draft) return; draft.pools.splice(Number(el.dataset.i), 1); C.rerender(); });
    C.action('onb.materiel', (el) => {
      if (!draft) return;
      const id = el.dataset.id;
      draft.home = draft.home.includes(id) ? draft.home.filter((x) => x !== id) : draft.home.concat([id]);
      el.setAttribute('aria-pressed', draft.home.includes(id) ? 'true' : 'false');
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.onboardingUI = {
    view,
    // Repartir d'un brouillon prérempli depuis l'état actuel (« Refaire le questionnaire »).
    restart() { draft = draftFromState(st(), U.todayKey()); },
    reset() { draft = null; },
    _t: { draftFromState, goalsFromDraft, benchesFromDraft, stepError, setDraftField, parseRunText, runText, strengthText, matchGoal, isLegacyGoal, nextMonday },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
