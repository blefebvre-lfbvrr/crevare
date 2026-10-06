/* Crevare — plan sportif : semaine (#/plan, #/plan/:monday), aperçu d'un jour (#/jour/:date),
 * vue d'ensemble des blocs jusqu'aux objectifs (#/plan-apercu).
 *
 * Expose aussi C.planUI : fonctions pures (état d'un jour, séance principale, cibles de déplacement,
 * frise) et feuilles partagées avec l'écran « Aujourd'hui » (imprévu, changer, déplacer, check-list).
 * Tous les appels aux autres modules sont défensifs : un module absent ne casse pas l'écran. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Accès défensifs ───────── */

  const has = (mod, name) => !!(mod && typeof mod[name] === 'function');
  function safe(fn, fallback) {
    try { const r = fn(); return r === undefined ? fallback : r; } catch (e) { if (typeof console !== 'undefined') console.error(e); return fallback; }
  }
  const st = () => C.state || {};
  const plannerOk = () => has(C.planner, 'day') && has(C.planner, 'week');
  const dayPlan = (date) => (plannerOk() ? safe(() => C.planner.day(date), null) : null);
  const weekPlan = (monday) => (plannerOk() ? safe(() => C.planner.week(monday), []) || [] : []);
  const phaseOf = (date) => (has(C.planner, 'phase') ? safe(() => C.planner.phase(date), null) : null);
  const sessionsOn = (date) => (has(C.sessions, 'forDate') ? safe(() => C.sessions.forDate(date), []) || [] : []);
  const templates = () => (C.data && C.data.sessionTemplates) || {};
  const tplTitle = (tid) => (templates()[tid] && templates()[tid].title) || tid;
  const LOC = (loc) => (C.ui && C.ui.LOCATIONS && (C.ui.LOCATIONS[loc] || C.ui.LOCATIONS.autre)) || { label: loc || '', icon: '•', color: 'var(--muted)' };
  const locBadge = (loc) => (C.ui && C.ui.locBadge ? C.ui.locBadge(loc) : `<span class="badge">${esc(LOC(loc).label)}</span>`);
  const goalTags = (goals) => (C.ui && C.ui.goalTags ? C.ui.goalTags(goals) : '');
  const toast = (msg) => { if (C.ui && C.ui.toast) C.ui.toast(msg); };

  /* ───────── Référentiels ───────── */

  const VARIANTS = {
    normal: { label: 'Normale', icon: '▶', desc: 'La séance prévue.' },
    allege: { label: 'Allégée', icon: '🪶', desc: 'Un tiers de volume en moins.' },
    express: { label: 'Express', icon: '⚡', desc: '30 min maximum : l\'essentiel.' },
    doux: { label: 'Douce', icon: '🦶', desc: 'Sans sauts ni impacts : ménage genou et cheville.' },
  };
  const VARIANT_LONG = { normal: 'version normale', allege: 'version allégée', express: 'version express', doux: 'version douce' };

  // État d'un jour dans la semaine.
  const STATES = {
    fait: { label: 'Fait', icon: '✓', cls: 'ok' },
    'en-cours': { label: 'En cours', icon: '◐', cls: 'warn' },
    'a-terminer': { label: 'Non terminée', icon: '◐', cls: 'warn' },
    manque: { label: 'Manqué', icon: '✕', cls: 'danger' },
    aujourdhui: { label: 'Aujourd\'hui', icon: '▶', cls: 'warn' },
    prevu: { label: 'Prévu', icon: '', cls: '' },
    repos: { label: 'Repos', icon: '·', cls: '' },
    evenement: { label: 'Jour J', icon: '🏁', cls: 'warn' },
  };

  const PHASE_COLORS = {
    reprise: 'var(--info)', base: 'var(--ok)', developpement: 'var(--accent-2)', specifique: 'var(--accent)',
    affutage: 'var(--warn)', 'jour-j': 'var(--danger)', recuperation: 'var(--loc-repos)', entretien: 'var(--muted)',
  };

  const AGENDA_KINDS = {
    cours: { label: 'Cours', color: 'var(--info)' },
    'protection-civile': { label: 'Protection civile', color: 'var(--accent)' },
    perso: { label: 'Perso', color: 'var(--loc-repos)' },
    sport: { label: 'Sport', color: 'var(--ok)' },
  };

  /* ───────── Fonctions pures ───────── */

  // Une séance ouverte mais jamais commencée (rien de noté) : on peut la jeter sans perte.
  function isEmptySession(s) {
    if (!s || s.status === 'done' || s.startedAt) return false;
    return !Object.values(s.log || {}).some((sets) => Array.isArray(sets) && sets.some((x) => x && x.done));
  }

  // Séance « principale » d'un jour parmi les séances enregistrées : celle qui correspond au plan,
  // sinon une séance qui n'est pas un bonus (une séance terminée l'emporte).
  function pickMain(list, dp) {
    const arr = (list || []).filter((s) => s && s.status !== 'skipped');
    if (!arr.length) return null;
    if (dp) {
      const match = arr.find((s) => (dp.customSessionId && s.customSessionId === dp.customSessionId) || (dp.templateId && s.templateId === dp.templateId));
      if (match) return match;
    }
    const bonus = new Set((dp && dp.bonus) || []);
    const others = arr.filter((s) => !(s.templateId && bonus.has(s.templateId)));
    return others.find((s) => s.status === 'done') || others[0] || null;
  }

  // Séances bonus d'un jour (mini-séances facultatives proposées par le plan).
  function bonusSessions(list, dp) {
    const bonus = new Set((dp && dp.bonus) || []);
    return (list || []).filter((s) => s && s.templateId && bonus.has(s.templateId) && s.status !== 'skipped');
  }

  // Options de création d'une séance pour le jour prévu (null = jour de repos).
  function openOpts(dp, variant) {
    if (!dp) return null;
    const v = VARIANTS[variant] ? variant : 'normal';
    if (dp.customSessionId) return { customSessionId: dp.customSessionId, variant: v };
    if (dp.templateId) return { templateId: dp.templateId, variant: v };
    if (dp.kind === 'session') return { free: true, title: dp.title || 'Séance libre', loc: dp.loc || 'autre' };
    return null;
  }

  // État affichable d'un jour : fait, en cours, manqué, aujourd'hui, prévu, repos, événement.
  function dayState(dp, list, todayK) {
    const date = dp && dp.date;
    const arr = (list || []).filter((s) => s && s.status !== 'skipped');
    const bonus = new Set((dp && dp.bonus) || []);
    const isBonus = (s) => !!(s.templateId && bonus.has(s.templateId));
    const doneMain = arr.filter((s) => s.status === 'done' && !isBonus(s));
    const bonusDone = arr.filter((s) => s.status === 'done' && isBonus(s)).length;
    const started = arr.filter((s) => s.status === 'in_progress' && !isEmptySession(s) && !isBonus(s));
    let key;
    if (!dp) key = doneMain.length ? 'fait' : 'repos';
    else if (doneMain.length) key = 'fait';
    else if (started.length && date <= todayK) key = date < todayK ? 'a-terminer' : 'en-cours';
    else if (dp.kind === 'event') key = 'evenement';
    else if (dp.kind === 'session') key = date < todayK ? 'manque' : date === todayK ? 'aujourdhui' : 'prevu';
    else key = 'repos';
    return { key, ...STATES[key], bonusDone, extra: !!dp && dp.kind === 'rest' && doneMain.length > 0 };
  }

  // Jours vers lesquels déplacer la séance d'un jour : jours restants de la même semaine (à partir
  // d'aujourd'hui) ; en fin de semaine, on ajoute les jours suivants (6 jours au plus).
  function moveTargets(date, todayK) {
    if (!U.isKey(date)) return [];
    let out = U.weekDays(U.mondayOf(date)).filter((d) => d !== date && d >= todayK);
    if (out.length < 3) {
      for (let i = 1; i <= 6; i++) {
        const d = U.addDays(date, i);
        if (d >= todayK && !out.includes(d)) out.push(d);
      }
      out = out.filter((d) => Math.abs(U.daysBetween(date, d)) <= 6);
    }
    return out.sort();
  }

  // « 5 – 11 oct. » ou « 28 sept. – 4 oct. »
  function weekLabel(monday) {
    const sun = U.addDays(monday, 6);
    const a = U.parseKey(monday), b = U.parseKey(sun);
    if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${U.MONTHS[b.getMonth()]}`;
    return `${U.fmtShort(monday)} – ${U.fmtShort(sun)}`;
  }

  const isPlannedDay = (dp) => !!dp && (dp.kind === 'session' || dp.kind === 'event') && !dp.optional;

  // Résumé de la semaine sans C.metrics (repli) : séances faites hors bonus / prévues, minutes.
  function summarize(days, sessionsByDate) {
    let done = 0, minutes = 0, bonus = 0, plannedMin = 0;
    for (const dp of days) {
      if (isPlannedDay(dp) && dp.kind === 'session') plannedMin += +dp.durationMin || 0;
      const b = new Set(dp.bonus || []);
      for (const s of sessionsByDate[dp.date] || []) {
        if (s.status !== 'done') continue;
        if (s.templateId && b.has(s.templateId)) bonus++; else done++;
        minutes += +s.durationMin || (s.startedAt && s.finishedAt ? Math.max(1, Math.round((s.finishedAt - s.startedAt) / 60000)) : +s.plannedMin || 0);
      }
    }
    return { done, planned: days.filter(isPlannedDay).length, minutes: Math.round(minutes), bonus, plannedMin };
  }

  // « 18:30–20:00 · après tes cours »
  const hm = (v) => { const m = String(v || '').match(/(\d{2}:\d{2})$/) || String(v || '').match(/T(\d{2}:\d{2})/); return m ? m[1] : ''; };
  function slotText(slot, info, kinds) {
    if (!slot || !slot.start || !slot.end) return '';
    const start = hm(slot.start), end = hm(slot.end);
    if (!start || !end) return '';
    let ctx = '';
    const k = kinds || [];
    const what = k.includes('cours') ? 'tes cours' : k.includes('protection-civile') ? 'ta Protection civile' : 'ton dernier rendez-vous';
    const first = info && hm(info.firstStart), last = info && hm(info.lastEnd);
    if (info && Array.isArray(info.events) && !info.events.length) ctx = 'journée libre';
    else if (last && start >= last) ctx = `après ${what}`;
    else if (first && end <= first) ctx = `avant ${k.includes('cours') ? 'tes cours' : 'ton premier rendez-vous'}`;
    else if (first || last) ctx = 'entre deux créneaux';
    return `${start}–${end}${ctx ? ` · ${ctx}` : ''}`;
  }

  // Horaire d'un événement d'agenda pour un jour donné.
  function eventTime(ev, date) {
    if (!ev || ev.allDay) return 'Journée';
    const s = String(ev.start || ''), e = String(ev.end || '');
    const a = s.slice(0, 10) === date ? hm(s) : '…';
    const b = e.slice(0, 10) === date ? hm(e) : '…';
    return b && b !== a ? `${a}–${b}` : a;
  }

  // But et contenu type d'un bloc (vue d'ensemble).
  function blockInfo(key, scope) {
    const hx = scope === 'hyrox', pp = scope === 'pompier';
    switch (key) {
      case 'reprise': return { goal: 'Reprendre sans te blesser et mesurer ton point de départ.', content: 'Volumes réduits, technique, premiers tests (natation, course, force).' };
      case 'base': return hx
        ? { goal: 'Construire l\'endurance et la force de fond.', content: 'Footing facile, technique des 8 stations, force en salle, piscine technique.' }
        : { goal: 'Être à l\'aise dans l\'eau et nager longtemps sans t\'arrêter.', content: 'Technique de crawl, endurance, apnée accompagnée progressive ; course et force pour le reste.' };
      case 'developpement': return hx
        ? { goal: 'Apprendre à courir fatigué.', content: '1 km + station enchaînés, allure seuil, force entretenue, natation pour le SSA.' }
        : { goal: 'Passer au spécifique sauvetage.', content: 'Plongeons, immersion, palmes, remorquage, séries chronométrées.' };
      case 'specifique':
        if (hx) return { goal: 'Te préparer au format exact de la course.', content: 'Simulations ½, ¾ puis complète (au plus tard à J-21), allure de course.' };
        if (pp) return { goal: 'Préparer les tests physiques pompier.', content: 'Luc Léger, tractions, pompes en cadence, gainage, chaise, souplesse.' };
        return { goal: 'Réussir les épreuves dans les temps, avec de la marge.', content: 'Au moins 2 séances piscine par semaine, simulation du test toutes les 3 semaines.' };
      case 'affutage': return { goal: 'Arriver frais le jour J.', content: 'Volume réduit de 40 à 60 %, un peu d\'intensité gardée, sommeil.' };
      case 'jour-j': return { goal: 'L\'épreuve !', content: 'Pas d\'entraînement : check-list, échauffement, résultat à noter.' };
      case 'recuperation': return { goal: 'Récupérer de l\'épreuve.', content: 'Nage facile, mobilité, marche. Pas de séance dure.' };
      default: return pp
        ? { goal: 'Garder la forme en visant les tests pompier.', content: 'Un peu de tout, orienté tests physiques (ICP) ; tests de temps en temps.' }
        : { goal: 'Garder la forme sans objectif proche.', content: 'Un peu de tout : piscine, course, force ; tests de temps en temps.' };
    }
  }

  // Dernière date utile parmi les objectifs actifs (date, fin, dates d'épreuves).
  function lastGoalDate(goals) {
    let end = null;
    for (const g of goals || []) {
      if (!g || g.status !== 'active') continue;
      const d = U.isObj(g.details) ? g.details : {};
      for (const k of [g.date, g.dateEnd, d.raceDate, d.entryTestDate, d.tsaDate, d.applyDate]) if (U.isKey(k) && (!end || k > end)) end = k;
    }
    return end;
  }

  // Repères de la frise : objectifs, épreuves connues et jalons (démarches).
  function markersOf(goals) {
    const out = [];
    for (const g of goals || []) {
      if (!g || g.status !== 'active') continue;
      const d = U.isObj(g.details) ? g.details : {};
      const seen = new Set();
      const add = (date, title, kind, extra = {}) => {
        if (!U.isKey(date) || seen.has(date + title)) return;
        seen.add(date + title);
        out.push({ date, title, kind, type: g.type, goalId: g.id, ...extra });
      };
      if (g.type === 'ssa') {
        add(d.entryTestDate, 'Test d\'entrée SSA', 'goal');
        add(d.tsaDate, 'TSA (certification SSA)', 'goal');
      }
      if (g.type === 'hyrox' && d.raceDate && d.raceDate !== g.date) add(d.raceDate, g.name || 'HYROX', 'goal');
      add(g.date, g.name || 'Objectif', 'goal');
      for (const m of Array.isArray(g.milestones) ? g.milestones : []) {
        if (m && U.isKey(m.due) && m.title) add(m.due, m.title, 'milestone', { done: !!m.done });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'goal' ? 1 : -1));
  }

  // Frise : blocs (C.planner.macro) + repères rangés dans le bloc où ils tombent + position actuelle.
  function timeline(blocks, goals, todayK) {
    const rows = (blocks || []).map((b) => {
      const goal = (goals || []).find((g) => g && g.id === b.goalId) || null;
      const days = U.daysBetween(b.start, b.end) + 1;
      const current = todayK >= b.start && todayK <= b.end;
      return {
        ...b, scope: goal ? goal.type : null, days, weeks: Math.max(1, Math.round(days / 7)), current,
        weekNow: current ? Math.floor(U.daysBetween(b.start, todayK) / 7) + 1 : null,
        progress: current ? U.clamp((U.daysBetween(b.start, todayK) + 1) / days, 0, 1) : b.end < todayK ? 1 : 0,
        markers: [],
      };
    });
    if (!rows.length) return rows;
    for (const m of markersOf(goals)) {
      // Jalon passé et fait : inutile ; jalon en retard : rangé dans le 1er bloc.
      if (m.date < rows[0].start) { if (m.kind === 'milestone' && !m.done) rows[0].markers.push({ ...m, late: true }); continue; }
      const row = rows.find((r) => m.date >= r.start && m.date <= r.end) || (m.date > rows[rows.length - 1].end ? rows[rows.length - 1] : null);
      if (row) row.markers.push({ ...m, late: m.kind === 'milestone' && !m.done && m.date < todayK });
    }
    return rows;
  }

  // Séries notées / prévues d'une séance (repli simple si session.js n'expose rien).
  function progressOf(s) {
    const t = C.sessionUI && C.sessionUI._t;
    if (t && typeof t.progressCount === 'function') { const r = safe(() => t.progressCount(s), null); if (r) return r; }
    let done = 0, total = 0;
    for (const it of (s && s.exercises) || []) {
      total += Math.max(1, +it.sets || 1);
      done += ((s.log || {})[it.key] || []).filter((x) => x && x.done).length;
    }
    return { done, total };
  }

  // Prescription courte d'un exercice : « 3 × 8–10 · 20 kg · repos 1:30 »
  function prescription(it) {
    const parts = [];
    const reps = String(it.reps || '').trim();
    const sets = +it.sets || 1;
    if (sets > 1) parts.push(reps ? `${sets} × ${reps}` : `${sets} séries`);
    else if (reps) parts.push(reps);
    const t = it.target || {};
    if (t.kg) parts.push(`${U.fmtNum(t.kg, 1)} kg`);
    if (t.sec && it.track === 'time' && !/\d\s*(s|min|:)/.test(reps)) parts.push(U.formatDuration(t.sec));
    if (t.m && !/\d\s*m\b/.test(reps)) parts.push(`${t.m} m`);
    if (+it.rest > 0) parts.push(`repos ${it.rest < 60 ? `${it.rest} s` : U.formatDuration(it.rest)}`);
    return parts.join(' · ');
  }

  /* ───────── Check-lists (jour J et veille) ─────────
   * Cases cochées gardées sur cet appareil (clé à part), par date d'épreuve : ce qui est coché la veille
   * reste coché le jour J. Rien n'est envoyé ailleurs. */

  const CHECK_KEY = 'crevare.checklists';
  let checkMem = null;
  function checks() {
    if (checkMem) return checkMem;
    checkMem = {};
    try { const raw = localStorage.getItem(CHECK_KEY); if (raw) checkMem = JSON.parse(raw) || {}; } catch (e) { checkMem = {}; }
    if (!U.isObj(checkMem)) checkMem = {};
    return checkMem;
  }
  function saveChecks() {
    const all = checks();
    // On ne garde que les 90 derniers jours.
    const limit = U.addDays(U.todayKey(), -90);
    for (const k of Object.keys(all)) if (k.slice(0, 10) < limit) delete all[k];
    try { localStorage.setItem(CHECK_KEY, JSON.stringify(all)); } catch (e) { /* mémoire seule */ }
  }
  const isChecked = (evDate, listId, itemId) => !!(checks()[`${evDate}|${listId}`] || {})[itemId];
  function toggleCheck(evDate, listId, itemId) {
    const all = checks();
    const k = `${evDate}|${listId}`;
    const box = (all[k] ||= {});
    if (box[itemId]) delete box[itemId]; else box[itemId] = 1;
    saveChecks();
    return !!box[itemId];
  }

  // Check-list d'un événement (C.data.checklists[listId]) groupée, cochable.
  function checklistHTML(evDate, listId, opts = {}) {
    const items = (C.data && C.data.checklists && Array.isArray(C.data.checklists[listId])) ? C.data.checklists[listId] : [];
    if (!items.length) return '';
    const meta = (C.data.checklistMeta && C.data.checklistMeta[listId]) || { title: 'Check-list', icon: '✅' };
    const GROUPS = C.data.CHECKLIST_GROUPS || {};
    const order = [...Object.keys(GROUPS)];
    for (const it of items) if (!order.includes(it.group)) order.push(it.group);
    const doneN = items.filter((it) => isChecked(evDate, listId, it.id)).length;
    const groups = order.map((g) => {
      const list = items.filter((it) => it.group === g);
      if (!list.length) return '';
      return `<h4>${esc(GROUPS[g] || g || 'Divers')}</h4><ul class="pln-cl-list">${list.map((it) => {
        const on = isChecked(evDate, listId, it.id);
        return `<li><button type="button" class="pln-cl-item" role="checkbox" aria-checked="${on}" data-action="plan.coche"
          data-ev="${esc(evDate)}" data-list="${esc(listId)}" data-item="${esc(it.id)}"><span class="pln-cl-box" aria-hidden="true">${on ? '✓' : ''}</span><span>${esc(it.text)}</span></button></li>`;
      }).join('')}</ul>`;
    }).join('');
    return `<section class="card pln-cl" aria-labelledby="pln-cl-${esc(listId)}">
      <div class="card-head"><h2 id="pln-cl-${esc(listId)}"><span aria-hidden="true">${esc(meta.icon || '✅')}</span> ${esc(opts.title || meta.title)}</h2><span class="tiny muted num">${esc(doneN)}/${esc(items.length)}</span></div>
      ${opts.intro ? `<p class="small muted">${esc(opts.intro)}</p>` : ''}
      ${groups}
    </section>`;
  }

  /* ───────── Agenda (si le module existe) ───────── */

  const agendaSources = () => (st().agenda && Array.isArray(st().agenda.sources) ? st().agenda.sources : []);
  function kindOfEvent(ev) {
    const src = agendaSources().find((s) => s.id === ev.sourceId);
    return (src && src.kind) || ev.kind || 'perso';
  }
  function dayInfo(date) { return has(C.agenda, 'dayInfo') ? safe(() => C.agenda.dayInfo(date), null) : null; }
  function slotFor(date, durationMin) {
    if (!has(C.agenda, 'trainingSlot')) return '';
    const slot = safe(() => C.agenda.trainingSlot(date, durationMin || 60), null);
    if (!slot) return '';
    const info = dayInfo(date);
    const evs = info && Array.isArray(info.events) ? info.events : has(C.agenda, 'eventsOn') ? safe(() => C.agenda.eventsOn(date), []) : [];
    return slotText(slot, info, [...new Set((evs || []).map(kindOfEvent))]);
  }

  function agendaCard(date, dp) {
    if (!C.agenda) return '';
    const events = has(C.agenda, 'eventsOn') ? safe(() => C.agenda.eventsOn(date), []) || [] : [];
    const blocks = has(C.agenda, 'schedule') ? (safe(() => C.agenda.schedule(date, date), []) || []).filter((b) => b && b.date === date) : [];
    const slot = dp && dp.kind === 'session' ? slotFor(date, dp.durationMin) : '';
    const subjects = st().agenda && Array.isArray(st().agenda.subjects) ? st().agenda.subjects : [];
    const subjName = (id) => { const s = subjects.find((x) => x.id === id); return s ? s.name : ''; };
    const rows = events.map((ev) => {
      const k = AGENDA_KINDS[kindOfEvent(ev)] || AGENDA_KINDS.perso;
      return `<li class="pln-ev" style="--c:${k.color}"><span class="pln-ev-t num">${esc(eventTime(ev, date))}</span>
        <span class="grow"><b>${esc(ev.title || 'Événement')}</b><small class="muted">${esc(k.label)}${ev.location ? ` · ${esc(ev.location)}` : ''}</small></span></li>`;
    }).concat(blocks.map((b) => `<li class="pln-ev pln-ev-rev ${b.done ? 'is-done' : ''}" style="--c:var(--loc-repos)"><span class="pln-ev-t num">${esc(hm(b.start))}–${esc(hm(b.end))}</span>
        <span class="grow"><b>${b.done ? '✓ ' : ''}Révision${subjName(b.subjectId) ? ` · ${esc(subjName(b.subjectId))}` : ''}</b><small class="muted">${esc(b.title || '')}</small></span></li>`));
    if (!rows.length && !slot) {
      return `<section class="card"><div class="card-head"><h3>Agenda</h3><a class="link small pln-more" href="#/agenda/${esc(date)}">Ouvrir</a></div>
        <p class="small muted">Rien de prévu ce jour-là dans tes calendriers.</p></section>`;
    }
    return `<section class="card" aria-labelledby="pln-ag-t"><div class="card-head"><h3 id="pln-ag-t">Agenda</h3><a class="link small pln-more" href="#/agenda/${esc(date)}">Ouvrir</a></div>
      ${slot ? `<p class="pln-slot"><span aria-hidden="true">🕒</span> Créneau conseillé pour le sport : <b class="num">${esc(slot)}</b></p>` : ''}
      ${rows.length ? `<ul class="pln-evs">${rows.join('')}</ul>` : ''}</section>`;
  }

  /* ───────── Actions sur les séances (partagées avec « Aujourd'hui ») ───────── */

  function go(id) { if (id && C.go) C.go('#/seance/' + encodeURIComponent(id)); }

  // Reconstruit une séance encore vide dans une autre version (allégée, express, douce…).
  function rebuild(s, opts) {
    const fresh = C.sessions.build(s.date, opts);
    C.sessions.patch(s.id, {
      variant: fresh.variant, title: fresh.title, loc: fresh.loc, kind: fresh.kind, templateId: fresh.templateId, customSessionId: fresh.customSessionId,
      source: fresh.source, exercises: fresh.exercises, intro: fresh.intro, safety: fresh.safety, plannedMin: fresh.plannedMin, goals: fresh.goals, log: {},
    }, { silent: true });
  }

  // Ouvre (ou crée) la séance prévue d'un jour, dans la version demandée, puis va sur l'écran de séance.
  async function start(date, variant) {
    if (!has(C.sessions, 'open')) { toast('Séances indisponibles pour le moment.'); return null; }
    const dp = dayPlan(date);
    const list = sessionsOn(date);
    const main = pickMain(list, dp);
    const wanted = VARIANTS[variant] ? variant : null;
    if (main) {
      const opts = openOpts(dp, wanted || main.variant || 'normal');
      if (wanted && opts && !opts.free && main.status === 'in_progress' && (main.variant || 'normal') !== wanted) {
        if (!isEmptySession(main)) {
          const ok = C.ui && C.ui.ask ? await C.ui.ask(`Passer en ${VARIANT_LONG[wanted]} ? Les séries déjà notées de cette séance seront effacées.`, 'Changer de version', { title: 'Séance commencée' }) : false;
          if (!ok) { go(main.id); return main.id; }
        }
        safe(() => rebuild(main, opts), null);
      }
      go(main.id);
      return main.id;
    }
    const opts = openOpts(dp, wanted || 'normal');
    if (!opts) { toast('Repos prévu ce jour-là : choisis une séance avec « Changer ».'); return null; }
    const id = C.sessions.open(date, { ...opts, forceNew: list.length > 0, silent: true });
    go(id);
    return id;
  }

  // Mini-séance bonus (abdos, cheville/genou…) : séance séparée de la séance principale.
  function startBonus(date, tid) {
    if (!has(C.sessions, 'create')) return null;
    const existing = sessionsOn(date).find((s) => s.templateId === tid);
    const id = existing ? existing.id : C.sessions.create(date, { templateId: tid, silent: true });
    go(id);
    return id;
  }

  // Jette la séance vide d'un jour (ouverte puis abandonnée) avant de changer le plan.
  function dropEmpty(date) {
    for (const s of sessionsOn(date)) if (isEmptySession(s)) safe(() => C.sessions.remove(s.id), null);
  }

  function setOverride(date, ov) {
    if (!has(C.planner, 'setOverride')) { toast('Plan indisponible pour le moment.'); return false; }
    return safe(() => C.planner.setOverride(date, ov), false) !== false;
  }

  /* ───────── Feuilles (modales) ───────── */

  const sheetOpt = (attrs, icon, title, desc, extra = '') => `<button type="button" class="pln-opt" ${attrs}>
    <span class="pln-opt-i" aria-hidden="true">${icon}</span><span class="grow"><b>${esc(title)}</b>${desc ? `<small class="muted">${esc(desc)}</small>` : ''}</span>${extra}</button>`;

  // « Pas en forme / imprévu ? » : versions allégée, express, douce ; repos ; déplacer.
  function openAdjustSheet(date, opts = {}) {
    if (!C.ui || !C.ui.openModal) return;
    const dp = dayPlan(date);
    const rec = opts.recommend || null;
    const dur = (v) => (has(C.planner, 'instantiate') ? safe(() => C.planner.instantiate(date, { ...(openOpts(dp, v) || {}), variant: v }).durationMin, null) : null);
    const badge = (v) => (rec === v ? '<span class="pill ok">Conseillé</span>' : '');
    const canVariant = !!dp && dp.kind === 'session' && !!(dp.templateId || dp.customSessionId);
    const slot = slotFor(date, dp && dp.durationMin);
    const body = `
      ${opts.reason ? `<p class="note small">${esc(opts.reason)}</p>` : ''}
      ${canVariant ? `<h4>Garder la séance, en plus léger</h4>
      ${['allege', 'express', 'doux'].map((v) => { const d = dur(v); return sheetOpt(`data-action="plan.version" data-date="${esc(date)}" data-variant="${v}"`, VARIANTS[v].icon,
        `Version ${VARIANTS[v].label.toLowerCase()}${d ? ` · ≈ ${d} min` : ''}`, VARIANTS[v].desc, badge(v)); }).join('')}` : ''}
      <h4>Changer le programme</h4>
      ${sheetOpt(`data-action="plan.repos" data-date="${esc(date)}"`, '🛋️', 'Repos aujourd\'hui', 'La séance saute ; le reste de la semaine ne bouge pas.', badge('repos'))}
      ${sheetOpt(`data-action="plan.deplacer" data-date="${esc(date)}"`, '📅', 'Déplacer à un autre jour', 'Échange avec un autre jour de la semaine.')}
      ${sheetOpt(`data-action="plan.changer" data-date="${esc(date)}"`, '🔁', 'Faire une autre séance', 'Piscine, salle, maison, séance perso ou libre.')}
      ${slot ? `<p class="pln-slot mt"><span aria-hidden="true">🕒</span> Créneau libre suggéré : <b class="num">${esc(slot)}</b></p>` : ''}`;
    C.ui.openModal({ title: 'Pas en forme ou imprévu ?', body });
  }

  // Déplacer : échange avec un autre jour (C.planner.swapDays).
  function openMoveSheet(date) {
    if (!C.ui || !C.ui.openModal) return;
    const todayK = U.todayKey();
    const targets = moveTargets(date, todayK);
    const src = dayPlan(date);
    const rows = targets.map((d) => {
      const dp = dayPlan(d);
      const blocked = dp && dp.kind === 'event' && !dp.overridden;
      const what = !dp ? '' : dp.kind === 'rest' ? 'Repos' : dp.title;
      const label = `${U.fmtDate(d)}${d === todayK ? ' (aujourd\'hui)' : ''}`;
      const desc = blocked ? 'Jour d\'épreuve : impossible.' : dp && dp.kind === 'rest' ? 'Repos ce jour-là : la séance y passe.' : `Échange avec : ${what}`;
      return sheetOpt(`data-action="plan.deplacer-vers" data-date="${esc(date)}" data-to="${esc(d)}" ${blocked ? 'disabled' : ''}`, dp ? LOC(dp.loc).icon : '•', label, desc);
    }).join('');
    const body = `<p class="small muted">${esc(src && src.kind !== 'rest' ? `« ${src.title} » passe au jour choisi, et ce jour-là prend sa place.` : 'Les deux jours échangent leur programme.')}</p>
      ${rows || '<p class="muted">Aucun autre jour disponible cette semaine.</p>'}`;
    C.ui.openModal({ title: 'Déplacer la séance', body });
  }

  // Changer : séances du catalogue groupées par lieu, séances perso, séance libre, repos.
  function openChangeSheet(date) {
    if (!C.ui || !C.ui.openModal) return;
    const dp = dayPlan(date);
    const list = has(C.planner, 'choices') ? safe(() => C.planner.choices(date), []) || [] : [];
    const tpl = list.filter((c) => c.templateId);
    const perso = list.filter((c) => c.customSessionId);
    const order = ['piscine', 'salle', 'dehors', 'maison', 'autre', 'repos'];
    const rank = (l) => { const i = order.indexOf(l); return i < 0 ? 99 : i; };
    const locs = [...new Set(tpl.map((c) => c.loc))].sort((a, b) => rank(a) - rank(b));
    const meta = (c) => [c.durationMin ? `≈ ${c.durationMin} min` : '', (c.goals || []).filter((g) => g !== 'general').map((g) => (C.ui.GOALS[g] || {}).label || g).join(', ')].filter(Boolean).join(' · ');
    const opt = (c, attrs) => sheetOpt(attrs, LOC(c.loc).icon, c.title, meta(c), c.planned ? '<span class="pill">Prévu</span>' : '');
    const groups = locs.map((loc) => `<h4>${esc(LOC(loc).label)}</h4>${tpl.filter((c) => c.loc === loc)
      .map((c) => opt(c, `data-action="plan.choisir" data-date="${esc(date)}" data-tid="${esc(c.templateId)}"`)).join('')}`).join('');
    const persoHTML = perso.length ? `<h4>Mes séances</h4>${perso.map((c) => opt(c, `data-action="plan.choisir" data-date="${esc(date)}" data-cid="${esc(c.customSessionId)}"`)).join('')}`
      : '<h4>Mes séances</h4><p class="small muted">Aucune séance perso. <a class="link" href="#/mes-seances">En créer une</a></p>';
    const body = `${groups}${persoHTML}
      <h4>Autre</h4>
      ${sheetOpt(`data-action="plan.choisir" data-date="${esc(date)}" data-mode="free"`, '✍️', 'Séance libre', 'Tu ajoutes tes exercices au fur et à mesure.')}
      ${sheetOpt(`data-action="plan.choisir" data-date="${esc(date)}" data-mode="rest"`, '🛋️', 'Repos', 'Pas de séance ce jour-là.')}
      ${dp && dp.overridden ? sheetOpt(`data-action="plan.retablir" data-date="${esc(date)}"`, '↩️', 'Revenir au plan', 'Annule ton changement pour ce jour.') : ''}`;
    C.ui.openModal({ title: 'Changer la séance', body });
  }

  /* ───────── Vues ───────── */

  const variantSel = {}; // version choisie sur #/jour/:date (mémoire de l'écran)

  function unavailable(title) {
    return `<header class="top"><h1>${esc(title)}</h1></header>
      ${C.ui.empty('Plan indisponible', 'Le planificateur n\'est pas chargé. Tes séances perso restent accessibles.', '<a class="btn ghost" href="#/mes-seances">Mes séances</a>')}`;
  }

  function phaseBanner(ph, opts = {}) {
    if (!ph) return '';
    const pills = [
      ph.deload ? '<span class="pill ok">Semaine allégée</span>' : '',
      ph.taper ? '<span class="pill warn">Affûtage</span>' : '',
    ].join('');
    const color = PHASE_COLORS[ph.key] || 'var(--muted)';
    return `<section class="card pln-phase" style="--k:${color}" aria-label="Période en cours">
      <div class="row between gap wrap"><b class="pln-phase-l">${esc(ph.label || '')}</b><span class="row gap">${pills}</span></div>
      <p class="small muted">${ph.weekInPhase ? `Semaine ${esc(ph.weekInPhase)} de ce bloc` : ''}${ph.goal && ph.goal.name ? ` · objectif : ${esc(ph.goal.name)}` : ''}</p>
      ${opts.notes !== false && Array.isArray(ph.notes) && ph.notes.length ? `<ul class="pln-notes">${ph.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${opts.link !== false ? '<a class="link small" href="#/plan-apercu">Vue d\'ensemble jusqu\'à tes objectifs ›</a>' : ''}
    </section>`;
  }

  function weekSummaryOf(monday, days) {
    const byDate = {};
    for (const d of U.weekDays(monday)) byDate[d] = sessionsOn(d);
    const own = summarize(days, byDate);
    if (has(C.metrics, 'weekSummary')) {
      const m = safe(() => C.metrics.weekSummary(monday), null);
      if (m) return { ...own, done: m.done, planned: m.planned == null ? own.planned : m.planned, minutes: m.minutes, bonus: m.bonus || 0 };
    }
    return own;
  }

  // #/plan et #/plan/:monday
  function viewWeek(params = {}) {
    if (!plannerOk()) return unavailable('Sport');
    const todayK = U.todayKey();
    const cur = U.mondayOf(todayK);
    const monday = U.isKey(params.monday) ? U.mondayOf(params.monday) : cur;
    const days = weekPlan(monday);
    const sun = U.addDays(monday, 6);
    const start = (st().plan && st().plan.startDate) || monday;
    const phDate = todayK >= monday && todayK <= sun ? todayK : U.maxKey(monday, start) <= sun ? U.maxKey(monday, start) : monday;
    const ph = phaseOf(phDate);
    const sum = weekSummaryOf(monday, days);
    const rel = U.weeksBetween(cur, monday);
    const relTxt = rel === 0 ? 'Cette semaine' : rel === 1 ? 'Semaine prochaine' : rel === -1 ? 'Semaine dernière' : rel > 0 ? `Dans ${rel} semaines` : `Il y a ${-rel} semaines`;

    const rows = days.map((dp) => {
      const s = dayState(dp, sessionsOn(dp.date), todayK);
      const L = dp.kind === 'event' ? { icon: '🏁', color: 'var(--danger)', label: '' } : LOC(dp.loc);
      const isToday = dp.date === todayK;
      const meta = dp.kind === 'rest'
        ? (s.extra ? 'Séance en plus faite' : dp.blocked === 'avant-plan' ? 'Avant le début du plan' : '')
        : [L.label, dp.durationMin ? `${dp.durationMin} min` : ''].filter(Boolean).join(' · ');
      const bonus = (dp.bonus || []).length ? `<small class="pln-bonus">+ en option : ${esc(dp.bonus.map(tplTitle).join(', '))}${s.bonusDone ? ' ✓' : ''}</small>` : '';
      const d = U.parseKey(dp.date);
      return `<li><a class="pln-day st-${esc(s.key)} ${isToday ? 'is-today' : ''} ${dp.kind === 'rest' ? 'is-rest' : ''}" href="#/jour/${esc(dp.date)}" style="--c:${L.color}" ${isToday ? 'aria-current="date"' : ''}
        aria-label="${esc(`${U.fmtDate(dp.date)} : ${dp.kind === 'rest' ? 'repos' : dp.title}, ${s.label}`)}">
        <span class="pln-day-d"><small>${esc(U.DAYS_ABBR[U.dow(dp.date)])}</small><b class="num">${esc(d.getDate())}</b></span>
        <span class="pln-day-m"><b>${dp.kind === 'rest' ? 'Repos' : esc(dp.title)}</b>${meta ? `<small class="muted">${dp.kind === 'rest' ? '' : `<span aria-hidden="true">${L.icon}</span> `}${esc(meta)}</small>` : ''}${bonus}</span>
        <span class="pln-day-s">${s.key !== 'repos' ? `<span class="pill ${esc(s.cls)}">${s.icon ? `<span aria-hidden="true">${esc(s.icon)}</span> ` : ''}${esc(s.label)}</span>` : ''}
          ${dp.overridden ? '<span class="tag pln-mod">modifié</span>' : ''}</span>
      </a></li>`;
    }).join('');

    const html = `
      <header class="top"><h1>Sport</h1><p class="muted small">${esc(relTxt)} · ${esc(weekLabel(monday))}</p></header>
      <nav class="pln-nav" aria-label="Changer de semaine">
        <a class="icon-btn" href="#/plan/${esc(U.addDays(monday, -7))}" aria-label="Semaine précédente">‹</a>
        <a class="btn ghost small grow" href="#/plan" ${rel === 0 ? 'aria-current="page"' : ''}>Aujourd'hui</a>
        <a class="icon-btn" href="#/plan/${esc(U.addDays(monday, 7))}" aria-label="Semaine suivante">›</a>
      </nav>
      ${phaseBanner(ph)}
      <section class="pln-sum" aria-label="Résumé de la semaine">
        <div><b class="num">${esc(sum.done)}<small>/${esc(sum.planned)}</small></b><span>séances faites</span></div>
        <div><b class="num">${esc(sum.minutes)}</b><span>min faites</span></div>
        <div><b class="num">${esc(sum.plannedMin)}</b><span>min prévues</span></div>
      </section>
      <ol class="pln-days" aria-label="Jours de la semaine">${rows}</ol>
      <nav class="pln-links" aria-label="Aller plus loin">
        <a class="pln-link" href="#/bibliotheque"><span aria-hidden="true">📚</span>Bibliothèque</a>
        <a class="pln-link" href="#/mes-seances"><span aria-hidden="true">📋</span>Mes séances</a>
        <a class="pln-link" href="#/plan-apercu"><span aria-hidden="true">🗺️</span>Vue d'ensemble</a>
      </nav>`;
    return html;
  }

  function exerciseList(items) {
    if (!items.length) return '<p class="small muted">Pas d\'exercice prévu : tu ajoutes les tiens pendant la séance.</p>';
    return `<ol class="pln-ex">${items.map((it, i) => {
      const flags = [
        it.apnea ? '<span class="pill danger">🤿 Apnée : accompagné</span>' : '',
        /^Adapté/.test(it.note || '') ? '<span class="pill ok">Adapté</span>' : '',
        it.test ? '<span class="pill warn">Test</span>' : '',
      ].join('');
      const presc = prescription(it);
      const href = it.exId && !/^v1:/.test(it.exId) ? `#/exercice/${esc(encodeURIComponent(it.exId))}` : '';
      const inner = `<span class="pln-ex-n num" aria-hidden="true">${i + 1}</span>
        <span class="grow"><b>${esc(it.name || it.exId)}</b>${presc ? `<small class="muted">${esc(presc)}</small>` : ''}
        ${it.note ? `<small class="pln-ex-note">${esc(it.note)}</small>` : ''}${flags ? `<span class="row gap wrap">${flags}</span>` : ''}</span>`;
      return `<li>${href ? `<a class="pln-ex-row" href="${href}">${inner}<span class="muted" aria-hidden="true">›</span></a>` : `<div class="pln-ex-row">${inner}</div>`}</li>`;
    }).join('')}</ol>`;
  }

  // #/jour/:date
  function viewDay(params = {}) {
    const date = params.date;
    if (!U.isKey(date)) return `<header class="top"><a class="back" href="#/plan">‹ Sport</a><h1>Jour introuvable</h1></header>${C.ui.empty('Date invalide', '', '<a class="btn ghost" href="#/plan">Revenir au plan</a>')}`;
    if (!plannerOk()) return unavailable(U.fmtDate(date));
    const todayK = U.todayKey();
    const dp = dayPlan(date);
    if (!dp) return unavailable(U.fmtDate(date));
    const list = sessionsOn(date);
    const main = pickMain(list, dp);
    const state = dayState(dp, list, todayK);
    const ph = phaseOf(date);
    const variant = variantSel[date] && VARIANTS[variantSel[date]] ? variantSel[date] : 'normal';
    const startable = !!dp && (dp.kind === 'session' || dp.kind === 'event');
    const inst = startable && has(C.planner, 'instantiate')
      ? safe(() => C.planner.instantiate(date, { ...(openOpts(dp, variant) || {}), variant }), null) : null;
    const L = dp.kind === 'event' ? { color: 'var(--danger)' } : LOC(dp.loc);
    const past = date < todayK, isToday = date === todayK;
    const canVariant = dp.kind === 'session' && !!(dp.templateId || dp.customSessionId) && (!main || isEmptySession(main));

    // Séance déjà enregistrée
    let sessionBox = '';
    if (main) {
      const p = progressOf(main);
      sessionBox = main.status === 'done'
        ? `<p class="note ok small">✓ Séance faite${main.durationMin ? ` · ${esc(main.durationMin)} min` : ''}${main.rpe ? ` · effort ${esc(main.rpe)}/10` : ''}${main.title !== dp.title ? ` · ${esc(main.title)}` : ''}</p>
           <a class="btn ghost block" href="#/seance/${esc(encodeURIComponent(main.id))}">Voir la séance</a>`
        : `<p class="note warn small">${isEmptySession(main) ? 'Séance ouverte, rien de noté pour l\'instant.' : `Séance en cours : ${esc(p.done)}/${esc(p.total)} séries notées.`}${main.variant && main.variant !== 'normal' ? ` (${esc(VARIANT_LONG[main.variant] || main.variant)})` : ''}</p>
           <a class="btn block" href="#/seance/${esc(encodeURIComponent(main.id))}">Reprendre</a>`;
    }

    // Boutons principaux
    let primary = '';
    if (!main && startable) {
      if (date <= todayK) {
        const label = dp.kind === 'event' ? 'Noter mon résultat' : past ? 'Noter cette séance après coup' : `Commencer${variant !== 'normal' ? ` (${VARIANT_LONG[variant]})` : ''}`;
        primary = `<button type="button" class="btn block" data-action="plan.commencer" data-date="${esc(date)}" data-variant="${esc(variant)}">${esc(label)}</button>`;
      } else {
        const td = dayPlan(todayK);
        const todayFree = td && td.kind === 'rest' && !['event', 'veille', 'apres-course'].includes(td.blocked) && !pickMain(sessionsOn(todayK), td);
        if (todayFree && dp.kind === 'session') primary = `<button type="button" class="btn block" data-action="plan.deplacer-vers" data-date="${esc(date)}" data-to="${esc(todayK)}" data-retour="today">La faire aujourd'hui (repos prévu)</button>`;
      }
    }

    const variants = canVariant ? `<div class="pln-var" role="group" aria-label="Version de la séance">${Object.entries(VARIANTS).map(([k, v]) =>
      `<button type="button" class="pln-var-b" data-action="plan.variante" data-date="${esc(date)}" data-variant="${esc(k)}" aria-pressed="${k === variant}">${esc(v.label)}</button>`).join('')}</div>
      <p class="tiny muted">${esc(VARIANTS[variant].desc)}</p>` : '';

    const restBonus = dp.kind === 'rest' && (dp.bonus || []).length ? `<h4>En option</h4>${dp.bonus.map((tid) => {
      const done = list.find((s) => s.templateId === tid);
      const d = has(C.planner, 'instantiate') ? safe(() => C.planner.instantiate(date, { templateId: tid }).durationMin, null) : null;
      return `<div class="pln-bonus-row"><span class="grow"><b>${esc(tplTitle(tid))}</b><small class="muted">${d ? `≈ ${esc(d)} min · ` : ''}facultatif</small></span>
        ${done ? `<a class="btn ghost small" href="#/seance/${esc(encodeURIComponent(done.id))}">${done.status === 'done' ? '✓ Faite' : 'Reprendre'}</a>`
        : date <= todayK ? `<button type="button" class="btn ghost small" data-action="plan.bonus" data-date="${esc(date)}" data-tid="${esc(tid)}">Commencer</button>` : ''}</div>`;
    }).join('')}` : '';

    // Check-list : jour J, ou veille d'une épreuve
    let checklist = '';
    if (dp.kind === 'event' && dp.event && dp.event.checklist) checklist = checklistHTML(date, dp.event.checklist);
    else {
      const tomorrow = dayPlan(U.addDays(date, 1));
      if (tomorrow && tomorrow.kind === 'event' && tomorrow.event && tomorrow.event.checklist) {
        checklist = checklistHTML(tomorrow.date, tomorrow.event.checklist, { intro: `Demain : ${tomorrow.event.title || tomorrow.title}. Prépare tes affaires ce soir.` });
      }
    }

    const content = inst && dp.kind !== 'rest' ? `<section class="card" aria-labelledby="pln-ct">
        <h3 id="pln-ct">Au programme${inst.durationMin ? ` · ≈ ${esc(inst.durationMin)} min` : ''}</h3>
        ${inst.intro ? `<p class="small">${esc(inst.intro)}</p>` : ''}
        ${exerciseList(inst.exercises || [])}
        ${(inst.safety || []).length ? `<h4>Sécurité</h4>${inst.safety.map((t) => `<p class="note warn small">${esc(t)}</p>`).join('')}` : ''}
        ${main ? '<p class="tiny muted mt">La séance enregistrée garde le contenu du moment où tu l\'as ouverte.</p>' : ''}
      </section>` : '';

    const actions = `<section class="card pln-acts" aria-label="Modifier ce jour">
        ${date >= todayK ? `<button type="button" class="btn ghost" data-action="plan.changer" data-date="${esc(date)}">🔁 Changer</button>
        ${dp.kind !== 'event' || dp.overridden ? `<button type="button" class="btn ghost" data-action="plan.deplacer" data-date="${esc(date)}">📅 Déplacer</button>` : ''}` : ''}
        ${dp.overridden ? `<button type="button" class="btn ghost" data-action="plan.retablir" data-date="${esc(date)}">↩️ Revenir au plan</button>` : ''}
        ${dp.kind === 'session' && isToday && (!main || isEmptySession(main)) ? `<button type="button" class="btn ghost" data-action="plan.imprevu" data-date="${esc(date)}">Pas en forme ?</button>` : ''}
      </section>`;

    const html = `
      <header class="top">
        <a class="back" href="#/plan/${esc(U.mondayOf(date))}">‹ Semaine</a>
        <h1>${esc(U.fmtDate(date))}</h1>
        <p class="muted small">${esc(U.relDays(U.daysBetween(todayK, date)))}${ph && ph.label ? ` · ${esc(ph.label)}` : ''}</p>
      </header>
      <section class="card pln-sess" style="--c:${L.color}" aria-labelledby="pln-sess-t">
        <div class="row between gap wrap">
          ${dp.kind === 'event' ? '<span class="badge" style="--c:var(--danger)">🏁 Jour J</span>' : locBadge(dp.loc)}
          <span class="row gap">${state.key !== 'repos' && state.key !== 'evenement' ? `<span class="pill ${esc(state.cls)}">${esc(state.label)}</span>` : ''}${dp.overridden ? '<span class="tag pln-mod">modifié</span>' : ''}</span>
        </div>
        <h2 id="pln-sess-t">${dp.kind === 'rest' ? 'Repos' : esc(dp.title)}</h2>
        <p class="small muted">${[dp.durationMin ? `≈ ${esc(dp.durationMin)} min` : '', inst ? goalTags((inst.goals || []).filter((g) => g !== 'general')) : ''].filter(Boolean).join(' · ')}</p>
        ${dp.reason ? `<p class="small">${esc(dp.reason)}</p>` : ''}
        ${sessionBox}
        ${variants}
        ${primary}
        ${restBonus}
      </section>
      ${checklist}
      ${content}
      ${agendaCard(date, dp)}
      ${actions}`;
    return html;
  }

  // #/plan-apercu
  function viewOverview() {
    if (!has(C.planner, 'macro')) return unavailable('Vue d\'ensemble');
    const todayK = U.todayKey();
    const goals = Array.isArray(st().goals) ? st().goals : [];
    const last = lastGoalDate(goals);
    const ph = phaseOf(todayK);
    const from = ph && U.isKey(ph.start) && ph.start <= todayK ? ph.start : todayK;
    const to = last && last > todayK ? last : U.addDays(todayK, 84);
    const blocks = safe(() => C.planner.macro(from, to), []) || [];
    const rows = timeline(blocks, goals, todayK);
    const head = `<header class="top"><a class="back" href="#/plan">‹ Sport</a><h1>Vue d'ensemble</h1>
      <p class="muted small">${last && last > todayK ? `D'aujourd'hui à ton dernier objectif (${esc(U.fmtLong(last))}).` : 'Les 12 prochaines semaines.'}</p></header>`;
    if (!rows.length) return head + C.ui.empty('Rien à afficher', 'Ajoute un objectif daté pour voir les blocs d\'entraînement.', '<a class="btn ghost" href="#/objectifs">Mes objectifs</a>');
    const noGoal = !last ? `<p class="note small">Aucun objectif daté : <a class="link" href="#/objectifs">ajoute tes objectifs</a> pour que le plan s'organise autour.</p>` : '';
    let year = todayK.slice(0, 4);
    const items = rows.map((r) => {
      // Séparateur d'année quand la frise change d'année.
      const y = r.start.slice(0, 4);
      const sep = y !== year ? `<li class="pln-year" aria-hidden="true">${esc(y)}</li>` : '';
      year = y;
      return sep + blockHTML(r);
    }).join('');
    function blockHTML(r) {
      const info = blockInfo(r.key, r.scope);
      const color = PHASE_COLORS[r.key] || 'var(--muted)';
      // Jour d'épreuve : le repère de l'objectif ce jour-là ferait doublon avec le titre du bloc.
      const jday = r.key === 'jour-j' && r.days <= 2;
      const marks = r.markers.filter((m) => !(jday && m.kind === 'goal' && m.date === r.start)).map((m) => {
        const gc = (C.ui.GOALS[m.type] || C.ui.GOALS.custom || {}).color || 'var(--muted)';
        const icon = m.kind === 'goal' ? '🏁' : m.done ? '✓' : '◇';
        return `<li class="pln-mark ${m.kind === 'goal' ? 'is-goal' : ''} ${m.done ? 'is-done' : ''} ${m.late ? 'is-late' : ''}" style="--g:${gc}">
          <span class="pln-mark-d num">${esc(U.fmtShort(m.date))}</span><span aria-hidden="true">${icon}</span>
          <span class="grow">${esc(m.title)}${m.late ? ' <span class="pill danger">en retard</span>' : ''}</span></li>`;
      }).join('');
      if (jday) {
        // Repère compact (le détail est dans la check-list du jour).
        return `<li class="pln-blk pln-blk-j ${r.end < todayK ? 'is-past' : ''}" style="--k:${color}">
          <div class="pln-blk-h"><b>🏁 ${esc(r.label)}</b><span class="tiny muted num">${esc(U.fmtLong(r.start))}</span></div>
          ${marks ? `<ul class="pln-marks">${marks}</ul>` : ''}</li>`;
      }
      return `<li class="pln-blk ${r.current ? 'is-current' : ''} ${r.end < todayK ? 'is-past' : ''}" style="--k:${color}">
        <div class="pln-blk-h"><b>${esc(r.label)}</b><span class="tiny muted num">${esc(U.fmtShort(r.start))} → ${esc(r.end.slice(0, 4) !== r.start.slice(0, 4) ? U.fmtLong(r.end) : U.fmtShort(r.end))} · ${esc(U.plural(r.weeks, 'semaine', 'semaines'))}</span></div>
        ${r.current ? `<div class="pln-here"><span aria-hidden="true">📍</span> Tu es ici · semaine ${esc(r.weekNow)} sur ${esc(r.weeks)}
          <div class="pln-bar" role="progressbar" aria-label="Avancement du bloc" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r.progress * 100)}"><i style="width:${Math.round(r.progress * 100)}%"></i></div></div>` : ''}
        <p class="small"><b>But :</b> ${esc(info.goal)}</p>
        <p class="small muted">${esc(info.content)}</p>
        ${marks ? `<ul class="pln-marks">${marks}</ul>` : ''}
      </li>`;
    }
    return `${head}${noGoal}<ol class="pln-tl" aria-label="Blocs d'entraînement">${items}</ol>
      <p class="tiny muted center mt">Le plan se recalcule tout seul quand tes objectifs ou leurs dates changent.</p>`;
  }

  /* ───────── Enregistrement ───────── */

  function register() {
    C.route('#/plan', viewWeek, { tab: '#/plan', title: 'Sport' });
    C.route('#/plan/:monday', viewWeek, { tab: '#/plan', title: 'Sport' });
    C.route('#/plan-apercu', viewOverview, { tab: '#/plan', title: 'Vue d\'ensemble' });
    C.route('#/jour/:date', viewDay, { tab: '#/plan', title: 'Jour' });

    C.action('plan.commencer', (el) => start(el.dataset.date, el.dataset.variant));
    C.action('plan.bonus', (el) => startBonus(el.dataset.date, el.dataset.tid));
    C.action('plan.variante', (el) => { variantSel[el.dataset.date] = el.dataset.variant; C.rerender(); });
    C.action('plan.imprevu', (el) => openAdjustSheet(el.dataset.date, { recommend: el.dataset.recommend || null, reason: el.dataset.reason || '' }));

    C.action('plan.version', (el) => {
      C.ui.closeModal();
      start(el.dataset.date, el.dataset.variant);
    });

    C.action('plan.repos', async (el) => {
      const date = el.dataset.date;
      C.ui.closeModal();
      const main = pickMain(sessionsOn(date), dayPlan(date));
      if (main && !isEmptySession(main)) {
        const ok = await C.ui.ask('Une séance est déjà commencée ce jour-là. Elle reste enregistrée ; le plan passe en repos.', 'Passer en repos');
        if (!ok) return;
      }
      dropEmpty(date);
      if (setOverride(date, { rest: true })) toast('Repos noté. Récupère bien 🛋️');
    });

    C.action('plan.deplacer', (el) => openMoveSheet(el.dataset.date));
    C.action('plan.deplacer-vers', (el) => {
      const from = el.dataset.date, to = el.dataset.to;
      if (!has(C.planner, 'swapDays')) { toast('Plan indisponible pour le moment.'); return; }
      C.ui.closeModal();
      const src = dayPlan(from);
      const started = [from, to].some((d) => { const m = pickMain(sessionsOn(d), dayPlan(d)); return m && !isEmptySession(m); });
      dropEmpty(from); dropEmpty(to);
      const ok = safe(() => C.planner.swapDays(from, to), false);
      if (!ok) { toast('Impossible : un des deux jours est un jour d\'épreuve.'); return; }
      const day = U.DAYS[U.dow(to)].toLowerCase();
      toast(`${src && src.kind !== 'rest' ? `« ${src.title} » passe à ${day}` : `Échange fait avec ${day}`}${started ? ' (la séance déjà commencée reste à sa date)' : ''}`);
      if (el.dataset.retour === 'today' && C.go) C.go('#/');
    });

    C.action('plan.changer', (el) => openChangeSheet(el.dataset.date));
    C.action('plan.choisir', (el) => {
      const date = el.dataset.date;
      const ov = el.dataset.tid ? { templateId: el.dataset.tid } : el.dataset.cid ? { customSessionId: el.dataset.cid }
        : el.dataset.mode === 'rest' ? { rest: true } : el.dataset.mode === 'free' ? { free: true } : null;
      if (!ov) return;
      C.ui.closeModal();
      dropEmpty(date);
      delete variantSel[date];
      if (setOverride(date, ov)) toast('Séance changée pour ce jour');
    });
    C.action('plan.retablir', (el) => {
      const date = el.dataset.date;
      C.ui.closeModal();
      dropEmpty(date);
      if (setOverride(date, null)) toast('Retour au plan prévu');
    });

    C.action('plan.coche', (el) => {
      const on = toggleCheck(el.dataset.ev, el.dataset.list, el.dataset.item);
      el.setAttribute('aria-checked', String(on));
      C.rerender();
    });

    C.action('plan.minuteur', (el) => {
      const preset = C.timer && typeof C.timer.getPreset === 'function' ? C.timer.getPreset(el.dataset.preset) : null;
      if (!preset || typeof C.timer.open !== 'function') { if (C.go) C.go('#/chrono'); return; }
      C.timer.open(preset);
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.planUI = {
    viewWeek, viewDay, viewOverview,
    start, startBonus, openAdjustSheet, openMoveSheet, openChangeSheet,
    checklistHTML, slotFor, progressOf, weekSummaryOf, phaseBanner,
    VARIANTS, VARIANT_LONG, STATES, PHASE_COLORS,
    // Fonctions pures (tests et écran « Aujourd'hui »)
    _t: {
      isEmptySession, pickMain, bonusSessions, openOpts, dayState, moveTargets, weekLabel, summarize, isPlannedDay, slotText, eventTime, hm,
      blockInfo, lastGoalDate, markersOf, timeline, prescription, isChecked, toggleCheck,
    },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
