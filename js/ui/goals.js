/* Crevare — objectifs (#/objectifs, #/objectifs/:id) et widget « Échéances » pour Aujourd'hui.
 * Liste : compte à rebours, phase du plan, jalons faits / total, prochain jalon. Détail : réglages selon le type
 * (SSA, HYROX, pompier, perso), jalons et démarches, check-lists du jour J, résultat officiel, archivage.
 * Les modèles, courses et standards viennent de C.data (js/data/goals.js) ; les tests de C.metrics. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Accès défensifs ───────── */

  const D = () => C.data || {};
  const st = () => C.state || {};
  function safe(fn, fallback) { try { return fn(); } catch (e) { console.error(e); return fallback; } }
  const goalsAll = () => (Array.isArray(st().goals) ? st().goals : []).filter((g) => U.isObj(g) && g.id);
  const goalById = (id) => goalsAll().find((g) => g.id === id) || null;
  const metric = (name, ...args) => (C.metrics && typeof C.metrics[name] === 'function' ? safe(() => C.metrics[name](...args), null) : null);
  const bench = (id) => (D().getBenchmark ? safe(() => D().getBenchmark(id), null) : null);
  function fmtBench(id, v) {
    if (v == null) return '—';
    if (D().formatBench) return safe(() => D().formatBench(id, v), String(v));
    const b = bench(id);
    return C.ui.fmtValue(b ? b.unit : '', v);
  }

  /* ───────── Constantes d'affichage ───────── */

  const TYPE_INFO = {
    ssa: { icon: '🛟', label: 'SSA', color: 'var(--goal-ssa)' },
    hyrox: { icon: '🏋️', label: 'HYROX', color: 'var(--goal-hyrox)' },
    pompier: { icon: '🚒', label: 'Pompier', color: 'var(--goal-pompier)' },
    custom: { icon: '🎯', label: 'Perso', color: 'var(--goal-custom)' },
  };
  const PRIORITIES = [{ value: 1, label: 'Principal' }, { value: 2, label: 'Important' }, { value: 3, label: 'Secondaire' }];
  const DISCIPLINES = [{ value: 'course', label: 'Course' }, { value: 'natation', label: 'Natation' }, { value: 'force', label: 'Force' }, { value: 'autre', label: 'Autre' }];
  const DIVISIONS = [{ value: 'doubles', label: 'Doubles' }, { value: 'solo', label: 'Solo' }, { value: 'relay', label: 'Relay (4)' }];
  const CATEGORIES = [{ value: 'men', label: 'Hommes' }, { value: 'women', label: 'Femmes' }, { value: 'mixed', label: 'Mixte' }];
  const LEVELS = [{ value: 'open', label: 'Open' }, { value: 'pro', label: 'Pro' }];
  const STATUS_LABEL = { active: 'En cours', done: 'Atteint', archived: 'Archivé' };
  const CHECKLISTS_BY_TYPE = { ssa: ['ssa-test', 'ssa-tsa'], hyrox: ['hyrox-jour-j'], pompier: ['pompier-tests'] };
  const COUNTDOWN_DAYS = 30;

  const tplOf = (g) => {
    const T = D().goalTemplates || {};
    return T[(g.details && g.details.template) || ''] || T[g.type] || null;
  };
  const isProtectionCivile = (g) => !!(g.details && (g.details.template === 'protection-civile' || g.details.kind === 'protection-civile'));
  const iconOf = (g) => (tplOf(g) && tplOf(g).icon) || (TYPE_INFO[g.type] || TYPE_INFO.custom).icon;
  const colorOf = (g) => (TYPE_INFO[g.type] || TYPE_INFO.custom).color;
  const typeLabel = (g) => (isProtectionCivile(g) ? 'Protection civile' : (TYPE_INFO[g.type] || TYPE_INFO.custom).label);

  /* ───────── Fonctions pures ───────── */

  // Tri des jalons : par échéance (sans date à la fin), ordre d'origine sinon.
  function sortMilestones(list) {
    return (Array.isArray(list) ? list : []).map((m, i) => ({ m, i }))
      .sort((a, b) => (a.m.due || '9999-99-99').localeCompare(b.m.due || '9999-99-99') || a.i - b.i)
      .map((x) => x.m);
  }

  // Avancement : { done, total, next (premier jalon non fait), late (nombre en retard) }.
  function progressOf(goal, today) {
    const ms = (Array.isArray(goal.milestones) ? goal.milestones : []).filter(U.isObj);
    const todo = sortMilestones(ms.filter((m) => !m.done));
    return {
      done: ms.filter((m) => m.done).length, total: ms.length, next: todo[0] || null,
      late: todo.filter((m) => U.isKey(m.due) && m.due < today).length,
    };
  }

  // « J-12 », « aujourd'hui », « 3 j de retard »
  function daysBadge(days) {
    if (days == null) return '';
    if (days === 0) return "Aujourd'hui";
    if (days < 0) return `${-days} j de retard`;
    return `J-${days}`;
  }

  /* countdownItems(goals, today) → 2 à 4 échéances : jalons non faits et objectifs à ≤ 30 jours (retards d'abord),
   * complétées par les objectifs les plus proches s'il y en a moins de 2.
   * Élément : { kind:'goal'|'milestone', goalId, type, title, goalName, due, days, late }. */
  function countdownItems(goals, today, opts = {}) {
    const max = opts.max || 4, min = opts.min || 2, horizon = opts.horizon || COUNTDOWN_DAYS;
    const active = (Array.isArray(goals) ? goals : []).filter((g) => U.isObj(g) && g.status === 'active');
    const near = [];
    for (const g of active) {
      if (U.isKey(g.date) && g.date >= today && U.daysBetween(today, g.date) <= horizon) {
        near.push({ kind: 'goal', goalId: g.id, type: g.type, title: g.name, goalName: '', due: g.date, days: U.daysBetween(today, g.date), late: false });
      }
      for (const m of Array.isArray(g.milestones) ? g.milestones : []) {
        if (!U.isObj(m) || m.done || !U.isKey(m.due)) continue;
        const days = U.daysBetween(today, m.due);
        if (days > horizon) continue;
        near.push({ kind: 'milestone', goalId: g.id, type: g.type, title: m.title, goalName: g.name, due: m.due, days, late: days < 0 });
      }
    }
    // Retards d'abord (le plus ancien en premier), puis par échéance ; à date égale, l'objectif avant ses jalons.
    near.sort((a, b) => (b.late - a.late) || a.due.localeCompare(b.due) || (a.kind === 'goal' ? -1 : 0) - (b.kind === 'goal' ? -1 : 0));
    const out = near.slice(0, max);
    if (out.length < min) {
      const far = active.filter((g) => U.isKey(g.date) && g.date >= today && !out.some((x) => x.kind === 'goal' && x.goalId === g.id))
        .sort((a, b) => a.date.localeCompare(b.date));
      for (const g of far) {
        if (out.length >= min) break;
        out.push({ kind: 'goal', goalId: g.id, type: g.type, title: g.name, goalName: '', due: g.date, days: U.daysBetween(today, g.date), late: false });
      }
    }
    return out;
  }

  /* refreshDues(goal, today, reason) → jalons avec échéances recalculées après un changement :
   * reason 'date' (date de l'objectif) : jalons « N jours avant/après l'objectif » et jalons calculés ;
   * reason 'details' (dates du stage, du TSA…) : jalons calculés seulement.
   * Jamais : jalons faits, jalons sans clé (ajoutés ou modifiés à la main), démarches « dans N jours ». */
  function refreshDues(goal, today, reason) {
    const ms = Array.isArray(goal.milestones) ? goal.milestones : [];
    const tpl = tplOf(goal);
    if (!tpl || typeof D().createGoalFromTemplate !== 'function') return ms;
    const fresh = safe(() => D().createGoalFromTemplate(tpl.id, { date: goal.date, details: goal.details }, today), null);
    if (!fresh) return ms;
    const freshByKey = new Map(fresh.milestones.filter((m) => m.key).map((m) => [m.key, m]));
    const defs = new Map((tpl.milestones || []).map((m) => [m.key, m]));
    return sortMilestones(ms.map((m) => {
      if (!U.isObj(m) || m.done || !m.key) return m;
      const def = defs.get(m.key);
      if (!def || def.repeatDays) return m;
      const depends = typeof def.due === 'function' || (reason === 'date' && typeof def.offsetDays === 'number');
      if (!depends || !freshByKey.has(m.key)) return m;
      return { ...m, due: freshByKey.get(m.key).due };
    }));
  }

  // Valeurs d'un formulaire « nouvel objectif » → overrides pour createGoalFromTemplate.
  function overridesFromForm(tplId, v) {
    const o = { details: {} };
    const name = String(v.name || '').trim();
    if (name) o.name = name.slice(0, 120);
    if (U.isKey(v.date)) o.date = v.date;
    if (tplId === 'hyrox') {
      if (v.event) {
        const ev = D().hyroxEvent ? D().hyroxEvent(v.event) : null;
        o.details.event = ev ? ev.id : '';
        if (ev && !U.isKey(v.date)) o.date = ev.defaultDay;
      } else o.details.event = '';
      if (['solo', 'doubles', 'relay'].includes(v.division)) o.details.division = v.division;
      if (['men', 'women', 'mixed'].includes(v.category)) o.details.category = v.category;
      if (v.partner) o.details.partner = String(v.partner).trim().slice(0, 80);
      if (U.isKey(o.date)) o.details.raceDate = o.date;
    }
    if (tplId === 'pompier' && v.path) o.details.path = v.path;
    if (tplId === 'protection-civile' && v.city) o.details.city = String(v.city).trim().slice(0, 80);
    if (tplId === 'custom') {
      if (DISCIPLINES.some((d) => d.value === v.discipline)) o.details.discipline = v.discipline;
      o.details.benchId = v.benchId || null;
      if (v.targetValue != null) o.details.targetValue = v.targetValue;
    }
    return o;
  }

  /* ───────── Mise à jour d'un objectif ───────── */

  function updateGoal(id, fn, opts) {
    return C.store.update((s) => {
      const g = (Array.isArray(s.goals) ? s.goals : []).find((x) => x && x.id === id);
      if (!g) return null;
      if (!U.isObj(g.details)) g.details = {};
      if (!Array.isArray(g.milestones)) g.milestones = [];
      return fn(g, s);
    }, opts);
  }

  // Champs modifiables : chemin, lecture/validation, re-rendu, conséquence (recalcul des jalons…).
  const text = (max) => (v) => String(v || '').trim().slice(0, max);
  const dateOrNull = (v) => (U.isKey(v) ? v : null);
  const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
  const hasKey = (obj, k) => !!obj && Object.prototype.hasOwnProperty.call(obj, k);
  const FIELDS = {
    name: { set: (g, v) => { const t = text(120)(v); if (t) g.name = t; }, silent: true },
    note: { set: (g, v) => { g.note = text(1000)(v); }, silent: true },
    priority: { set: (g, v) => { if ([1, 2, 3].includes(+v)) g.priority = +v; } },
    date: { set: (g, v, today) => {
      g.date = dateOrNull(v);
      if (g.type === 'hyrox') g.details.raceDate = g.date;
      if (g.type === 'pompier') g.details.applyDate = g.date;
      g.milestones = refreshDues(g, today, 'date');
    } },
    'd.raceDate': { set: (g, v, today) => { g.date = dateOrNull(v); g.details.raceDate = g.date; g.milestones = refreshDues(g, today, 'date'); } },
    'd.event': { set: (g, v, today) => {
      const ev = v && D().hyroxEvent ? D().hyroxEvent(v) : null;
      g.details.event = ev ? ev.id : '';
      if (ev) {
        g.details.venue = ev.venue ? `${ev.city} — ${ev.venue}` : ev.city;
        g.date = ev.defaultDay; g.details.raceDate = ev.defaultDay;
        g.milestones = refreshDues(g, today, 'date');
      }
    } },
    'd.division': { set: (g, v) => { const x = oneOf(['solo', 'doubles', 'relay'])(v); if (x) g.details.division = x; } },
    'd.category': { set: (g, v) => { const x = oneOf(['men', 'women', 'mixed'])(v); if (x) g.details.category = x; } },
    'd.level': { set: (g, v) => { const x = oneOf(['open', 'pro'])(v); if (x) g.details.level = x; } },
    'd.partner': { set: (g, v) => { g.details.partner = text(80)(v); }, silent: true },
    'd.venue': { set: (g, v) => { g.details.venue = text(120)(v); }, silent: true },
    'd.organisme': { set: (g, v) => { g.details.organisme = text(120)(v); }, silent: true },
    'd.ville': { set: (g, v) => { g.details.ville = text(80)(v); }, silent: true },
    'd.city': { set: (g, v) => { g.details.city = text(80)(v); }, silent: true },
    'd.department': { set: (g, v) => { g.details.department = text(40)(v); }, silent: true },
    'd.mention': { set: (g, v) => { if (hasKey(D().ssaMentions, v)) g.details.mention = v; } },
    'd.entryTestDate': { set: (g, v, today) => { g.details.entryTestDate = dateOrNull(v); g.milestones = refreshDues(g, today, 'details'); } },
    'd.trainingStart': { set: (g, v, today) => { g.details.trainingStart = dateOrNull(v); g.milestones = refreshDues(g, today, 'details'); } },
    'd.trainingEnd': { set: (g, v, today) => { g.details.trainingEnd = dateOrNull(v); g.milestones = refreshDues(g, today, 'details'); } },
    'd.tsaDate': { set: (g, v, today) => { g.details.tsaDate = dateOrNull(v); g.milestones = refreshDues(g, today, 'details'); } },
    'd.path': { set: (g, v) => { if (hasKey(D().pompierPaths, v)) g.details.path = v; } },
    'd.bareme': { set: (g, v) => { if ((D().baremes || []).some((b) => b.id === v)) g.details.bareme = v; } },
    'd.discipline': { set: (g, v) => { if (DISCIPLINES.some((d) => d.value === v)) g.details.discipline = v; } },
    'd.benchId': { set: (g, v) => { g.details.benchId = v && bench(v) ? v : null; g.details.targetValue = null; } },
  };
  // Cibles en temps (secondes), saisie rapide 345 → 3:45.
  for (const k of ['entry', 'tsa', 'fins']) {
    FIELDS[`t.${k}`] = { time: true, set: (g, v) => {
      if (!U.isObj(g.details.targets)) g.details.targets = {};
      if (v == null) delete g.details.targets[k]; else g.details.targets[k] = v;
    } };
  }
  FIELDS['d.targetValue'] = { benchValue: true, set: (g, v) => { g.details.targetValue = v; } };

  // Lit la valeur d'un champ selon son type (case à cocher, durée, nombre).
  function readField(el, def, goal) {
    if (def.time) return U.parseDuration(el.value);
    if (def.benchValue) {
      const b = bench(goal.details.benchId);
      if (b && b.unit === 'time') return U.parseDuration(el.value);
      return U.num(el.value);
    }
    return el.value;
  }

  /* ───────── Vues : liste ───────── */

  function phaseNow(today) {
    if (!C.planner || typeof C.planner.phase !== 'function') return null;
    return safe(() => C.planner.phase(today), null);
  }

  function goalCard(g, today, phase) {
    const pr = progressOf(g, today);
    const days = U.isKey(g.date) ? U.daysBetween(today, g.date) : null;
    const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
    const isPhaseGoal = phase && phase.goal && phase.goal.id === g.id;
    const next = pr.next;
    const nextTxt = next ? `${next.title}${U.isKey(next.due) ? ` · ${next.due < today ? `en retard (${U.fmtShort(next.due)})` : U.relDays(U.daysBetween(today, next.due))}` : ''}` : '';
    return `<li><a class="card gol-card" href="#/objectifs/${esc(encodeURIComponent(g.id))}" style="--c:${colorOf(g)}">
      <div class="gol-card-top">
        <span class="gol-icon" aria-hidden="true">${esc(iconOf(g))}</span>
        <span class="gol-card-name"><b>${esc(g.name)}</b>
          <small class="muted">${U.isKey(g.date) ? `${esc(U.fmtLong(g.date))} · ${esc(U.relDays(days))}` : 'Date à définir'}</small></span>
        ${days != null && days >= 0 ? `<span class="gol-days num" aria-label="${esc(`${days} jours restants`)}"><b>${esc(days)}</b><small>jours</small></span>` : ''}
      </div>
      <div class="row gap wrap">
        <span class="tag" style="--c:${colorOf(g)}">${esc(typeLabel(g))}</span>
        ${isPhaseGoal ? `<span class="pill ok">Phase : ${esc(phase.label)}</span>` : ''}
        ${g.priority === 1 ? '<span class="pill">Principal</span>' : ''}
        ${pr.late ? `<span class="pill warn">${esc(U.plural(pr.late, 'démarche en retard', 'démarches en retard'))}</span>` : ''}
      </div>
      ${pr.total ? `<div class="gol-bar" role="progressbar" aria-label="Jalons faits" aria-valuemin="0" aria-valuemax="${esc(pr.total)}" aria-valuenow="${esc(pr.done)}">
        <span style="width:${pct}%"></span></div>
        <p class="small gol-card-next"><span class="muted">${esc(pr.done)}/${esc(pr.total)} jalons</span>${nextTxt ? ` · Prochain : ${esc(nextTxt)}` : ' · Tout est fait 🎉'}</p>` : ''}
    </a></li>`;
  }

  function viewList() {
    const today = U.todayKey();
    const all = goalsAll();
    const active = all.filter((g) => g.status === 'active').sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.priority - b.priority);
    const others = all.filter((g) => g.status !== 'active').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const phase = phaseNow(today);
    const phaseCard = phase && phase.label ? `<div class="note gol-phase"><b>Phase actuelle : ${esc(phase.label)}</b>${phase.goal ? ` <span class="muted">· objectif prioritaire : ${esc(phase.goal.name)}</span>` : ''}
      ${phase.deload ? '<br><span class="small">Semaine allégée.</span>' : ''}</div>` : '';
    return `<header class="top"><a class="back" href="#/plus">‹ Plus</a><h1>Objectifs</h1></header>
      ${phaseCard}
      ${active.length ? `<ul class="list gol-list">${active.map((g) => goalCard(g, today, phase)).join('')}</ul>`
        : C.ui.empty('Aucun objectif en cours', 'Ajoute un objectif : le plan et les rappels s\'organisent autour.')}
      <button type="button" class="btn block mt" data-action="objectif.ajouter">＋ Ajouter un objectif</button>
      ${others.length ? `<details class="card gol-others"><summary><b>Atteints et archivés</b> <span class="muted small">(${esc(others.length)})</span></summary>
        <ul class="list mt">${others.map((g) => `<li><a class="gol-mini" href="#/objectifs/${esc(encodeURIComponent(g.id))}">
          <span aria-hidden="true">${esc(iconOf(g))}</span><span class="grow"><b>${esc(g.name)}</b>
          <small class="muted">${esc(STATUS_LABEL[g.status] || '')}${U.isKey(g.date) ? ` · ${esc(U.fmtLong(g.date))}` : ''}</small></span><span aria-hidden="true">›</span></a></li>`).join('')}</ul>
      </details>` : ''}
      <p class="muted small center mt">Dates de course, épreuves et billetterie : à revérifier auprès des organisateurs.</p>`;
  }

  /* ───────── Vues : détail ───────── */

  const field = (label, inner, hint) => `<label class="field"><span>${esc(label)}</span>${inner}${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
  const attrs = (g, f) => `data-change="objectif.champ" data-id="${esc(g.id)}" data-f="${esc(f)}" id="gol-${esc(f.replace(/\./g, '-'))}"`;
  const inputText = (g, f, value, extra = '') => `<input type="text" class="gol-in" ${attrs(g, f)} value="${esc(value || '')}" autocomplete="off" ${extra}>`;
  const inputDate = (g, f, value) => `<input type="date" class="gol-in" ${attrs(g, f)} value="${esc(U.isKey(value) ? value : '')}">`;
  const select = (g, f, options, current) => `<select class="gol-in" ${attrs(g, f)}>${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(current ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  const seg = (g, f, options, current) => `<div class="gol-seg">${C.ui.segmented(`gol-${g.id}-${f}`, options, current, `data-change="objectif.champ" data-id="${esc(g.id)}" data-f="${esc(f)}"`)}</div>`;
  const timeField = (g, f, value, label) => C.ui.timeInput({ value, label, data: { change: 'objectif.champ', id: g.id, f }, id: `gol-${f.replace(/\./g, '-')}` });

  function generalCard(g) {
    const dateLabel = g.type === 'ssa' ? 'Date visée pour la certification' : g.type === 'pompier' ? 'Date de candidature' : 'Date';
    return `<section class="card">
      <h2>Général</h2>
      ${field('Nom', inputText(g, 'name', g.name, 'maxlength="120"'))}
      ${g.type === 'hyrox' ? '' : field(dateLabel, inputDate(g, 'date', g.date), g.type === 'pompier' ? 'Fin 2029 par exemple : modifiable à tout moment.' : '')}
      <div class="field"><span>Priorité</span>${seg(g, 'priority', PRIORITIES, g.priority)}</div>
      ${field('Notes', `<textarea class="gol-in" ${attrs(g, 'note')} rows="3" maxlength="1000" placeholder="Infos utiles, contacts, idées…">${esc(g.note || '')}</textarea>`)}
    </section>`;
  }

  function benchLine(id, targetValue, label) {
    const b = bench(id);
    const best = metric('benchBest', id), last = metric('benchLast', id), trend = metric('benchTrend', id);
    const trendTxt = trend ? `${trend.direction === 'mieux' ? '↗︎ en progrès' : trend.direction === 'moins-bien' ? '↘︎ en baisse' : '→ stable'}${C.metrics.fmtTrend ? ` (${safe(() => C.metrics.fmtTrend(id, trend), '')})` : ''}` : '';
    const ok = best && targetValue != null && (b && b.lower ? best.value <= targetValue : best.value >= targetValue);
    return `<a class="gol-bench" href="#/progres/${esc(encodeURIComponent(id))}">
      <span class="grow"><b>${esc(label || (b ? b.name : id))}</b>
        <small class="muted">Meilleur : ${esc(best ? fmtBench(id, best.value) : '—')} · Dernier : ${esc(last ? fmtBench(id, last.value) : '—')}${trendTxt ? ` · ${esc(trendTxt)}` : ''}</small></span>
      ${targetValue != null ? `<span class="pill ${ok ? 'ok' : ''}">${ok ? '✓ ' : ''}cible ${esc(fmtBench(id, targetValue))}</span>` : ''}
    </a>`;
  }

  function ssaCard(g) {
    const d = g.details, t = U.isObj(d.targets) ? d.targets : {};
    const mentions = Object.entries(D().ssaMentions || {}).map(([value, label]) => ({ value, label }));
    const off = (id) => { const b = bench(id); return b && b.official ? b.official : null; };
    const tgt = (k, id, label) => {
      const o = off(id);
      return `<div class="gol-target">${field(label, timeField(g, `t.${k}`, t[k], `${label} (minutes:secondes)`),
        o ? `Minimum officiel : ${esc(U.formatDuration(o.value))} (à confirmer avec ton organisme). Ta cible garde une marge.` : '')}</div>`;
    };
    return `<section class="card">
      <h2>Formation SSA</h2>
      ${field('Organisme', inputText(g, 'd.organisme', d.organisme, 'maxlength="120" placeholder="FFSS, Protection civile, Croix-Rouge, club…"'))}
      ${field('Ville', inputText(g, 'd.ville', d.ville, 'maxlength="80"'))}
      ${mentions.length ? field('Mention', select(g, 'd.mention', mentions, d.mention)) : ''}
      <div class="gol-grid2">
        ${field("Test d'entrée", inputDate(g, 'd.entryTestDate', d.entryTestDate))}
        ${field('TSA (certification)', inputDate(g, 'd.tsaDate', d.tsaDate))}
        ${field('Début de la formation', inputDate(g, 'd.trainingStart', d.trainingStart))}
        ${field('Fin de la formation', inputDate(g, 'd.trainingEnd', d.trainingEnd))}
      </div>
      <p class="small muted">Les dates saisies mettent à jour les jalons (certificat médical, PSE2, test d'entrée, TSA).</p>
      <h3 class="mt">Tes cibles</h3>
      <div class="gol-grid3">
        ${tgt('entry', 'ssa_entry_test', "Test d'entrée (100 m)")}
        ${tgt('tsa', 'ssa_tsa_course', 'Parcours TSA (100 m)')}
        ${tgt('fins', 'ssa_tsa_fins', '300 m palmes')}
      </div>
      <div class="list mt">
        ${benchLine('ssa_entry_test', t.entry, "Test d'entrée")}
        ${benchLine('ssa_tsa_course', t.tsa, 'Parcours TSA')}
        ${benchLine('ssa_tsa_fins', t.fins, '300 m palmes')}
      </div>
    </section>`;
  }

  function hyroxStandardsHTML(d) {
    const std = D().hyroxLoads ? safe(() => D().hyroxLoads(d.division, d.category, d.level), null) : null;
    if (!std) return '<p class="note warn small">Cette combinaison (division, catégorie, niveau) n\'existe pas ou n\'a pas été trouvée : vérifie dans le règlement.</p>';
    let L = std;
    let who = '';
    if (std.perSex) {
      const sex = (st().profile || {}).sex === 'F' ? 'F' : 'H';
      L = std.perSex[sex];
      who = sex === 'F' ? ' (tes charges : femmes)' : ' (tes charges : hommes)';
    }
    const notes = (std.notes || []).filter(Boolean);
    return `<div class="gol-std">
      <p class="small"><b>${esc(std.label)}</b>${esc(who)} — ${esc(std.rule || '')}</p>
      <ol class="gol-stations">${(L.stations || []).map((s) => {
        const m = String(s.load || '').match(/^([^(]+?)\s*(\(.*\))?$/) || [];
        return `<li><div class="gol-st"><span class="grow"><b>${esc(s.name)}</b> <span class="muted small">${esc(s.amount)}</span>
          ${m[2] ? `<small class="muted gol-st-note">${esc(m[2].slice(1, -1))}</small>` : ''}</span>
          ${m[1] ? `<span class="pill gol-st-load">${esc(m[1])}</span>` : ''}</div></li>`;
      }).join('')}</ol>
      <p class="tiny muted">Entre chaque station : 1 km de course (8 au total). Charges 26/27 recoupées sur plusieurs sources : à vérifier dans le règlement officiel.</p>
      ${notes.length ? `<ul class="small gol-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function hyroxCard(g) {
    const d = g.details;
    const today = U.todayKey();
    const events = (D().hyroxEvents || []).filter((e) => !e.qualifOnly && (e.end >= today || e.id === d.event));
    const ev = d.event && D().hyroxEvent ? D().hyroxEvent(d.event) : null;
    const options = [{ value: '', label: 'Autre course / à choisir' }].concat(events.map((e) => ({ value: e.id, label: `${e.name} · ${U.fmtMonthYear(e.start)}` })));
    const raceDate = d.raceDate || g.date;
    const outside = ev && U.isKey(raceDate) && (raceDate < ev.start || raceDate > ev.end);
    return `<section class="card">
      <h2>Course HYROX</h2>
      ${field('Course', select(g, 'd.event', options, ev ? ev.id : ''))}
      ${ev ? `<p class="small">${esc(ev.city)}${ev.venue ? ` · ${esc(ev.venue)}` : ''} · du ${esc(U.fmtShort(ev.start))} au ${esc(U.fmtLong(ev.end))}<br>
        <span class="muted">Billetterie : ${esc(ev.ticketStatus || 'à vérifier')} (vérifié le ${esc(U.fmtLong(ev.checkedAt))}, à revérifier).</span>
        ${ev.note ? `<br><span class="muted">${esc(ev.note)}</span>` : ''}
        ${ev.source ? `<br><a class="link" href="${esc(ev.source)}" target="_blank" rel="noopener">Page de la course</a>` : ''}</p>` : field('Lieu', inputText(g, 'd.venue', d.venue, 'maxlength="120"'))}
      ${field('Date exacte de ta vague', inputDate(g, 'd.raceDate', raceDate), ev ? 'Le jour exact dépend de ton billet (division, vague).' : '')}
      ${outside ? '<p class="note warn small">Cette date est en dehors des jours de la course.</p>' : ''}
      <div class="field"><span>Division</span>${seg(g, 'd.division', DIVISIONS, d.division)}</div>
      <div class="field"><span>Catégorie</span>${seg(g, 'd.category', CATEGORIES, d.category)}</div>
      <div class="field"><span>Niveau</span>${seg(g, 'd.level', LEVELS, d.level)}</div>
      ${d.division !== 'solo' ? field(d.division === 'relay' ? 'Équipe' : 'Partenaire', inputText(g, 'd.partner', d.partner, 'maxlength="80" placeholder="Prénom"')) : ''}
      <h3 class="mt">Stations et charges</h3>
      ${hyroxStandardsHTML(d)}
      <div class="list mt">${benchLine('hyrox_sim', null, 'Simulation complète')}${benchLine('run_5k', null)}</div>
    </section>`;
  }

  function pompierCard(g) {
    const d = g.details;
    const paths = Object.entries(D().pompierPaths || {}).map(([value, p]) => ({ value, label: p.label }));
    const path = (D().pompierPaths || {})[d.path];
    const baremes = (D().baremes || []).map((b) => ({ value: b.id, label: `${b.label}${b.confidence === 'faible' ? ' (fiabilité faible)' : ''}` }));
    return `<section class="card">
      <h2>Sapeur-pompier</h2>
      ${paths.length ? field('Voie', select(g, 'd.path', paths, d.path || 'indecis'), path && path.note ? esc(path.note) : 'Volontaire, engagement différencié, réserve… à décider tranquillement.') : ''}
      ${field('Département visé', inputText(g, 'd.department', d.department, 'maxlength="40" inputmode="text" placeholder="Ex. 94, 34, 75…"'), 'Les épreuves changent d\'un SDIS à l\'autre.')}
      ${baremes.length ? field('Barème de référence pour tes cibles', select(g, 'd.bareme', baremes, d.bareme || D().DEFAULT_BAREME), 'Cible = seuil du barème + 20 %. À vérifier pour ton département.') : ''}
      <div class="list mt">${['luc_leger', 'chinups', 'pushups', 'plank', 'wall_sit', 'swim_50'].filter((id) => bench(id)).map((id) => benchLine(id, null)).join('')}</div>
    </section>`;
  }

  function customCard(g) {
    const d = g.details;
    const pc = isProtectionCivile(g);
    const benches = (D().benchmarks || []).filter((b) => b.id !== 'ssa_test_v1').map((b) => ({ value: b.id, label: b.name }));
    const b = bench(d.benchId);
    const targetInput = !b ? '' : b.unit === 'time'
      ? timeField(g, 'd.targetValue', d.targetValue, 'Valeur cible (minutes:secondes)')
      : `<input type="text" inputmode="decimal" autocomplete="off" ${attrs(g, 'd.targetValue')} value="${esc(d.targetValue != null ? U.fmtNum(d.targetValue, 2) : '')}" placeholder="Ex. 12">`;
    return `<section class="card">
      <h2>${pc ? 'Protection civile' : 'Objectif perso'}</h2>
      ${pc ? field('Ville visée', inputText(g, 'd.city', d.city, 'maxlength="80" placeholder="Ex. Montpellier"'), 'Sert à nommer la démarche « contacter l\'antenne ».') : ''}
      <div class="field"><span>Discipline</span>${seg(g, 'd.discipline', DISCIPLINES, d.discipline || 'autre')}</div>
      ${benches.length ? field('Test lié (pour suivre ta progression)', select(g, 'd.benchId', [{ value: '', label: 'Aucun' }].concat(benches), d.benchId || '')) : ''}
      ${b ? field('Valeur cible', targetInput, b.lower ? 'Plus bas = mieux.' : '') : ''}
      ${b ? `<div class="list mt">${benchLine(b.id, d.targetValue)}</div>` : ''}
    </section>`;
  }

  // openNote : note affichée en entier (prochains jalons) ; sinon repliée derrière « Détail ».
  function milestoneRow(g, m, today, openNote) {
    const late = !m.done && U.isKey(m.due) && m.due < today;
    const when = m.done ? `Fait${U.isKey(m.doneAt) ? ` le ${U.fmtShort(m.doneAt)}` : ''}`
      : U.isKey(m.due) ? (late ? `En retard · prévu le ${U.fmtShort(m.due)}` : `${U.fmtDate(m.due)} · ${U.relDays(U.daysBetween(today, m.due))}`) : 'Date à définir';
    return `<li class="gol-ms ${m.done ? 'is-done' : ''} ${late ? 'is-late' : ''}">
      <label class="gol-ms-check"><input type="checkbox" data-change="objectif.jalon-fait" data-id="${esc(g.id)}" data-mid="${esc(m.id)}" ${m.done ? 'checked' : ''}
        aria-label="${esc(`Fait : ${m.title}`)}"></label>
      <div class="gol-ms-body"><b>${esc(m.title)}</b><small class="${late ? 'warn-text' : 'muted'}">${esc(when)}</small>
        ${!m.note ? '' : openNote ? `<p class="small muted gol-ms-note">${esc(m.note)}</p>`
          : `<details class="gol-ms-more"><summary>Détail</summary><p class="small muted gol-ms-note">${esc(m.note)}</p></details>`}</div>
      <button type="button" class="icon-btn small" data-action="objectif.jalon-modifier" data-id="${esc(g.id)}" data-mid="${esc(m.id)}" aria-label="${esc(`Modifier : ${m.title}`)}">✎</button>
    </li>`;
  }

  function milestonesCard(g, today) {
    const ms = (g.milestones || []).filter(U.isObj);
    const todo = sortMilestones(ms.filter((m) => !m.done));
    const done = sortMilestones(ms.filter((m) => m.done));
    return `<section class="card">
      <div class="card-head"><h2>Jalons et démarches</h2><span class="muted small">${esc(done.length)}/${esc(ms.length)}</span></div>
      ${todo.length ? `<ul class="gol-ms-list">${todo.map((m, i) => milestoneRow(g, m, today, i < 2 || (U.isKey(m.due) && m.due < today))).join('')}</ul>` : '<p class="muted small">Rien à faire pour l\'instant.</p>'}
      ${done.length ? `<details class="gol-done"><summary>Faits (${esc(done.length)})</summary><ul class="gol-ms-list">${done.map((m) => milestoneRow(g, m, today, false)).join('')}</ul></details>` : ''}
      <button type="button" class="btn ghost small mt" data-action="objectif.jalon-ajouter" data-id="${esc(g.id)}">＋ Ajouter un jalon</button>
    </section>`;
  }

  function checklistsCard(g) {
    const ids = (CHECKLISTS_BY_TYPE[g.type] || []).filter((id) => (D().checklists || {})[id]);
    if (!ids.length) return '';
    const state = U.isObj(g.details.checklist) ? g.details.checklist : {};
    const groups = D().CHECKLIST_GROUPS || {};
    return ids.map((id) => {
      const items = D().checklists[id];
      const meta = (D().checklistMeta || {})[id] || { title: 'Check-list', icon: '✓' };
      const checked = new Set(Array.isArray(state[id]) ? state[id] : []);
      const n = items.filter((it) => checked.has(it.id)).length;
      const byGroup = [];
      for (const it of items) {
        let grp = byGroup.find((x) => x.g === it.group);
        if (!grp) { grp = { g: it.group, items: [] }; byGroup.push(grp); }
        grp.items.push(it);
      }
      return `<details class="card gol-cl"><summary><span aria-hidden="true">${esc(meta.icon)}</span> <b>${esc(meta.title)}</b>
        <span class="muted small">${esc(n)}/${esc(items.length)}</span></summary>
        ${byGroup.map((grp) => `<h4>${esc(groups[grp.g] || grp.g)}</h4><ul class="gol-cl-list">${grp.items.map((it) => `<li><label class="check-row">
          <input type="checkbox" data-change="objectif.check" data-id="${esc(g.id)}" data-list="${esc(id)}" data-item="${esc(it.id)}" ${checked.has(it.id) ? 'checked' : ''}>
          <span>${esc(it.text)}</span></label></li>`).join('')}</ul>`).join('')}
        ${n ? `<button type="button" class="btn ghost small mt" data-action="objectif.check-reset" data-id="${esc(g.id)}" data-list="${esc(id)}">Tout décocher</button>` : ''}
      </details>`;
    }).join('');
  }

  function resultCard(g, today) {
    if (!(U.isKey(g.date) && g.date <= today) && !g.result && g.status !== 'done') return '';
    const r = U.isObj(g.result) ? g.result : {};
    let inner = '';
    if (g.type === 'hyrox') {
      inner = `${field('Temps officiel', C.ui.timeInput({ name: 'time', value: r.time, label: 'Temps officiel (heures:minutes:secondes)', placeholderText: 'h:mm:ss' }), 'Tape les chiffres : 13542 → 1:35:42.')}`;
    } else if (g.type === 'ssa') {
      inner = `<div class="field"><span>Certification obtenue ?</span>${C.ui.segmented('success', [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Pas cette fois' }], r.success == null ? '' : r.success ? 'oui' : 'non')}</div>
        <div class="gol-grid2">${field('Parcours TSA (facultatif)', C.ui.timeInput({ name: 'tsa', value: r.tsa, label: 'Temps du parcours TSA' }))}
        ${field('300 m palmes (facultatif)', C.ui.timeInput({ name: 'fins', value: r.fins, label: 'Temps du 300 m palmes' }))}</div>`;
    } else if (g.type === 'pompier') {
      inner = `<div class="field"><span>Candidature retenue ?</span>${C.ui.segmented('success', [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Pas cette fois' }, { value: 'attente', label: 'En attente' }], r.success == null ? (r.pending ? 'attente' : '') : r.success ? 'oui' : 'non')}</div>`;
    } else {
      const b = bench(g.details.benchId);
      inner = b ? field(`Résultat — ${b.name}`, b.unit === 'time' ? C.ui.timeInput({ name: 'value', value: r.value, label: 'Résultat' })
        : `<input type="text" name="value" inputmode="decimal" autocomplete="off" value="${esc(r.value != null ? U.fmtNum(r.value, 2) : '')}" aria-label="Résultat">`)
        : `<div class="field"><span>Objectif atteint ?</span>${C.ui.segmented('success', [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Pas encore' }], r.success == null ? '' : r.success ? 'oui' : 'non')}</div>`;
    }
    return `<section class="card gol-result">
      <h2>Résultat</h2>
      <form data-form="objectif.resultat" data-id="${esc(g.id)}">
        ${inner}
        ${field('Commentaire', `<input type="text" name="note" maxlength="300" autocomplete="off" value="${esc(r.note || '')}">`)}
        <button type="submit" class="btn block">Enregistrer le résultat</button>
      </form>
    </section>`;
  }

  function viewDetail(params) {
    const g = goalById(params.id);
    if (!g) {
      return `<header class="top"><a class="back" href="#/objectifs">‹ Objectifs</a><h1>Objectif introuvable</h1></header>
        ${C.ui.empty('Cet objectif n\'existe plus', 'Il a peut-être été supprimé.', '<a class="btn" href="#/objectifs">Mes objectifs</a>')}`;
    }
    if (!U.isObj(g.details)) return C.ui.empty('Objectif illisible', 'Ses réglages sont abîmés : supprime-le et recrée-le.');
    const today = U.todayKey();
    const days = U.isKey(g.date) ? U.daysBetween(today, g.date) : null;
    const tpl = tplOf(g);
    const typeCard = g.type === 'ssa' ? ssaCard(g) : g.type === 'hyrox' ? hyroxCard(g) : g.type === 'pompier' ? pompierCard(g) : customCard(g);
    return `<header class="top"><a class="back" href="#/objectifs">‹ Objectifs</a>
        <h1><span aria-hidden="true">${esc(iconOf(g))}</span> ${esc(g.name)}</h1>
        <div class="row gap wrap"><span class="tag" style="--c:${colorOf(g)}">${esc(typeLabel(g))}</span>
          <span class="pill ${g.status === 'done' ? 'ok' : ''}">${esc(STATUS_LABEL[g.status] || '')}</span>
          ${days != null ? `<span class="pill ${days < 0 ? '' : 'warn'}">${esc(days >= 0 ? `${daysBadge(days)} · ${U.relDays(days)}` : `passé (${U.fmtLong(g.date)})`)}</span>` : ''}</div>
      </header>
      ${tpl && tpl.description ? `<p class="small muted gol-desc">${esc(tpl.description)}</p>` : ''}
      ${resultCard(g, today)}
      ${milestonesCard(g, today)}
      ${typeCard}
      ${checklistsCard(g)}
      ${generalCard(g)}
      <section class="card">
        <h2>Gérer</h2>
        <div class="row gap wrap">
          ${g.status !== 'done' ? `<button type="button" class="btn ghost small" data-action="objectif.statut" data-id="${esc(g.id)}" data-v="done">✓ Marquer comme atteint</button>` : ''}
          ${g.status !== 'archived' ? `<button type="button" class="btn ghost small" data-action="objectif.statut" data-id="${esc(g.id)}" data-v="archived">Archiver</button>` : ''}
          ${g.status !== 'active' ? `<button type="button" class="btn ghost small" data-action="objectif.statut" data-id="${esc(g.id)}" data-v="active">Remettre en cours</button>` : ''}
          <button type="button" class="btn ghost small danger" data-action="objectif.supprimer" data-id="${esc(g.id)}">Supprimer</button>
        </div>
        <p class="tiny muted">Archivé : l'objectif ne compte plus dans le plan, mais ses jalons et résultats restent.</p>
      </section>`;
  }

  /* ───────── Widget « Aujourd'hui » ───────── */

  function countdownCard() {
    const today = U.todayKey();
    const items = countdownItems(goalsAll(), today);
    if (!items.length) return '';
    return `<section class="card gol-cd" aria-labelledby="gol-cd-title">
      <div class="card-head"><h2 id="gol-cd-title">Échéances</h2><a class="small link" href="#/objectifs">Objectifs ›</a></div>
      <ul class="gol-cd-list">${items.map((it) => `<li><a class="gol-cd-row" href="#/objectifs/${esc(encodeURIComponent(it.goalId))}" style="--c:${(TYPE_INFO[it.type] || TYPE_INFO.custom).color}">
        <span class="gol-cd-days num ${it.late ? 'is-late' : it.days <= 7 ? 'is-soon' : ''}">${esc(daysBadge(it.days))}</span>
        <span class="gol-cd-text"><b>${it.kind === 'goal' ? '🎯 ' : ''}${esc(it.title)}</b>
          <small class="muted">${it.goalName ? `${esc(it.goalName)} · ` : ''}${esc(U.fmtDate(it.due))}</small></span>
        <span aria-hidden="true" class="muted">›</span></a></li>`).join('')}</ul>
    </section>`;
  }

  /* ───────── Feuilles (modales) ───────── */

  function openAddSheet() {
    const tpls = D().listGoalTemplates ? D().listGoalTemplates() : Object.values(D().goalTemplates || {});
    if (!tpls.length) { C.ui.toast('Modèles d\'objectifs indisponibles'); return; }
    C.ui.openModal({
      title: 'Ajouter un objectif',
      body: `<ul class="list">${tpls.map((t) => `<li><button type="button" class="gol-tpl" data-action="objectif.modele" data-tpl="${esc(t.id)}">
        <span class="gol-icon" aria-hidden="true">${esc(t.icon || '🎯')}</span>
        <span class="grow"><b>${esc(t.name)}</b><small class="muted">${esc(String(t.description || '').slice(0, 140))}${String(t.description || '').length > 140 ? '…' : ''}</small></span>
      </button></li>`).join('')}</ul>`,
    });
  }

  function defaultDateFor(tpl, today) {
    if (!tpl || tpl.defaultDate == null) return '';
    const d = typeof tpl.defaultDate === 'function' ? safe(() => tpl.defaultDate(today), null) : tpl.defaultDate;
    return U.isKey(d) ? d : '';
  }

  function openTemplateForm(tplId) {
    const T = D().goalTemplates || {};
    const tpl = T[tplId];
    if (!tpl) return;
    const today = U.todayKey();
    let extra = '';
    if (tplId === 'hyrox') {
      const evs = D().upcomingHyroxEvents ? D().upcomingHyroxEvents(today, { minDays: 56 }) : [];
      const def = evs.find((e) => e.id === (tpl.details && tpl.details.event)) || evs[0];
      extra = `<label class="field"><span>Course</span><select name="event">${evs.map((e) => `<option value="${esc(e.id)}" ${def && e.id === def.id ? 'selected' : ''}>${esc(`${e.name} · ${U.fmtMonthYear(e.start)}`)}</option>`).join('')}
          <option value="">Autre course (date à saisir)</option></select>
        <small class="muted">Au moins 8 semaines de préparation. Billetterie à vérifier.</small></label>
        <div class="field"><span>Division</span>${C.ui.segmented('division', DIVISIONS, 'doubles')}</div>
        <div class="field"><span>Catégorie</span>${C.ui.segmented('category', CATEGORIES, (st().profile || {}).sex === 'F' ? 'women' : 'men')}</div>
        <label class="field"><span>Partenaire (facultatif)</span><input type="text" name="partner" maxlength="80" autocomplete="off"></label>`;
    } else if (tplId === 'pompier') {
      extra = `<label class="field"><span>Voie</span><select name="path">${Object.entries(D().pompierPaths || {}).map(([v, p]) => `<option value="${esc(v)}" ${v === 'indecis' ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>`;
    } else if (tplId === 'protection-civile') {
      extra = '<label class="field"><span>Ville visée (facultatif)</span><input type="text" name="city" maxlength="80" autocomplete="off" placeholder="Ex. Montpellier"></label>';
    } else if (tplId === 'custom') {
      extra = `<div class="field"><span>Discipline</span>${C.ui.segmented('discipline', DISCIPLINES, 'course')}</div>
        <label class="field"><span>Test lié (facultatif)</span><select name="benchId"><option value="">Aucun</option>${(D().benchmarks || []).filter((b) => b.id !== 'ssa_test_v1')
          .map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Valeur cible (facultatif)</span><input type="text" name="target" autocomplete="off" inputmode="text" placeholder="Ex. 45:00 ou 12"></label>`;
    }
    const dateLabel = tplId === 'ssa' ? 'Date visée pour la certification' : tplId === 'pompier' ? 'Date de candidature' : tplId === 'hyrox' ? 'Date (si autre course)' : 'Date';
    C.ui.openModal({
      title: tpl.name,
      body: `<form data-form="objectif.creer" data-tpl="${esc(tplId)}">
        <p class="small muted">${esc(tpl.description || '')}</p>
        <label class="field"><span>Nom</span><input type="text" name="name" maxlength="120" autocomplete="off" value="${esc(tplId === 'hyrox' ? '' : tpl.name)}" placeholder="${esc(tplId === 'hyrox' ? 'Automatique (ex. HYROX Lyon — Doubles)' : '')}"></label>
        ${tplId === 'hyrox' ? '' : `<label class="field"><span>${esc(dateLabel)}</span><input type="date" name="date" value="${esc(defaultDateFor(tpl, today))}"></label>`}
        ${extra}
        ${tplId === 'hyrox' ? `<label class="field"><span>${esc(dateLabel)}</span><input type="date" name="date" value=""></label>` : ''}
        <button type="submit" class="btn block mt">Créer l'objectif</button>
      </form>`,
    });
  }

  function openMilestoneSheet(goalId, mid) {
    const g = goalById(goalId);
    if (!g) return;
    const m = mid ? (g.milestones || []).find((x) => x.id === mid) : null;
    C.ui.openModal({
      title: m ? 'Modifier le jalon' : 'Nouveau jalon',
      body: `<form data-form="objectif.jalon-enregistrer" data-id="${esc(g.id)}" data-mid="${esc(m ? m.id : '')}">
        <label class="field"><span>Intitulé</span><input type="text" name="title" maxlength="200" required autocomplete="off" value="${esc(m ? m.title : '')}"></label>
        <label class="field"><span>Échéance (facultatif)</span><input type="date" name="due" value="${esc(m && U.isKey(m.due) ? m.due : '')}"></label>
        <label class="field"><span>Note</span><textarea name="note" rows="3" maxlength="500">${esc(m ? m.note || '' : '')}</textarea></label>
        ${m && m.done ? `<label class="field"><span>Fait le</span><input type="date" name="doneAt" value="${esc(U.isKey(m.doneAt) ? m.doneAt : '')}"></label>` : ''}
        <button type="submit" class="btn block mt">Enregistrer</button>
        ${m ? `<button type="button" class="btn ghost block mt danger" data-action="objectif.jalon-supprimer" data-id="${esc(g.id)}" data-mid="${esc(m.id)}">Supprimer ce jalon</button>` : ''}
      </form>`,
    });
  }

  /* ───────── Enregistrement ───────── */

  // Enveloppe de page : permet des cibles tactiles de 44 px dans tout le module (.gol-page).
  const page = (view) => (params) => `<div class="gol-page">${view(params)}</div>`;

  function register() {
    C.route('#/objectifs', page(viewList), { tab: '#/plus', title: 'Objectifs' });
    C.route('#/objectifs/:id', page(viewDetail), { tab: '#/plus', title: 'Objectif' });
    C.menuItem({ hash: '#/objectifs', icon: '🎯', label: 'Objectifs', desc: 'Comptes à rebours, jalons, démarches', order: 5 });

    C.action('objectif.ajouter', () => openAddSheet());
    C.action('objectif.modele', (el) => {
      const id = el.dataset.tpl;
      C.ui.closeModal();
      openTemplateForm(id);
    });
    C.onSubmit('objectif.creer', async (form, fd) => {
      const tplId = form.dataset.tpl;
      if (typeof D().createGoalFromTemplate !== 'function') { C.ui.toast('Création impossible : données manquantes'); return; }
      const today = U.todayKey();
      const v = Object.fromEntries(fd.entries());
      if (tplId === 'custom') {
        const b = bench(v.benchId);
        v.targetValue = !b || !String(v.target || '').trim() ? null : b.unit === 'time' ? U.parseDuration(v.target) : U.num(v.target);
        if (!String(v.name || '').trim()) { C.ui.toast('Donne un nom à ton objectif'); return; }
      }
      const same = goalsAll().find((g) => g.status === 'active' && tplOf(g) && tplOf(g).id === tplId && tplId !== 'custom');
      C.ui.closeModal();
      if (same && !(await C.ui.ask(`Tu as déjà un objectif « ${same.name} » en cours. En ajouter un autre ?`, 'Ajouter'))) return;
      const goal = safe(() => D().createGoalFromTemplate(tplId, overridesFromForm(tplId, v), today), null);
      if (!goal) { C.ui.toast('Création impossible'); return; }
      C.store.update((s) => { s.goals = (Array.isArray(s.goals) ? s.goals : []).concat([goal]); }, { silent: true });
      C.go(`#/objectifs/${encodeURIComponent(goal.id)}`);
      C.ui.toast('Objectif ajouté');
    });

    C.onChange('objectif.champ', (el) => {
      const id = el.dataset.id, f = el.dataset.f;
      const def = Object.prototype.hasOwnProperty.call(FIELDS, f) ? FIELDS[f] : null;
      const g = goalById(id);
      if (!def || !g) return;
      const value = readField(el, def, g);
      if ((def.time || def.benchValue) && String(el.value || '').trim() && value == null) { C.ui.toast('Valeur illisible'); return; }
      if (f === 'name' && !String(value || '').trim()) { C.ui.toast('Le nom ne peut pas être vide'); el.value = g.name; return; }
      const today = U.todayKey();
      const before = JSON.stringify(g.milestones.map((m) => m.due));
      updateGoal(id, (goal) => def.set(goal, value, today), { silent: !!def.silent });
      const after = goalById(id);
      if (after && JSON.stringify(after.milestones.map((m) => m.due)) !== before) C.ui.toast('Jalons mis à jour');
      else if (def.silent) C.ui.toast('✓ Enregistré', 1200);
    });

    C.onChange('objectif.jalon-fait', (el) => {
      const { id, mid } = el.dataset;
      const checked = el.checked;
      updateGoal(id, (g) => {
        const m = g.milestones.find((x) => x.id === mid);
        if (!m) return;
        m.done = checked;
        m.doneAt = checked ? U.todayKey() : null;
      });
    });
    C.action('objectif.jalon-ajouter', (el) => openMilestoneSheet(el.dataset.id, null));
    C.action('objectif.jalon-modifier', (el) => openMilestoneSheet(el.dataset.id, el.dataset.mid));
    C.onSubmit('objectif.jalon-enregistrer', (form, fd) => {
      const id = form.dataset.id, mid = form.dataset.mid;
      const title = String(fd.get('title') || '').trim().slice(0, 200);
      if (!title) { C.ui.toast('Donne un intitulé au jalon'); return; }
      const due = U.isKey(fd.get('due')) ? fd.get('due') : null;
      const note = String(fd.get('note') || '').trim().slice(0, 500);
      C.ui.closeModal();
      updateGoal(id, (g) => {
        if (mid) {
          const m = g.milestones.find((x) => x.id === mid);
          if (!m) return;
          // Échéance changée à la main : le jalon ne sera plus recalculé automatiquement.
          if (due !== m.due) delete m.key;
          Object.assign(m, { title, due, note });
          if (m.done && U.isKey(fd.get('doneAt'))) m.doneAt = fd.get('doneAt');
        } else {
          g.milestones.push({ id: U.uid(), title, due, note, done: false, doneAt: null });
        }
        g.milestones = sortMilestones(g.milestones);
      });
    });
    C.action('objectif.jalon-supprimer', async (el) => {
      const { id, mid } = el.dataset;
      C.ui.closeModal();
      if (!(await C.ui.ask('Supprimer ce jalon ?', 'Supprimer', { danger: true }))) return;
      updateGoal(id, (g) => { g.milestones = g.milestones.filter((m) => m.id !== mid); });
    });

    C.onChange('objectif.check', (el) => {
      const { id, list, item } = el.dataset;
      const checked = el.checked;
      updateGoal(id, (g) => {
        if (!U.isObj(g.details.checklist)) g.details.checklist = {};
        const set = new Set(Array.isArray(g.details.checklist[list]) ? g.details.checklist[list] : []);
        if (checked) set.add(item); else set.delete(item);
        g.details.checklist[list] = [...set];
      }, { silent: true });
      const sum = el.closest('details') && el.closest('details').querySelector('summary .muted');
      if (sum) {
        const all = el.closest('details').querySelectorAll('input[type=checkbox]');
        sum.textContent = `${[...all].filter((x) => x.checked).length}/${all.length}`;
      }
    });
    C.action('objectif.check-reset', (el) => {
      const { id, list } = el.dataset;
      updateGoal(id, (g) => { if (U.isObj(g.details.checklist)) g.details.checklist[list] = []; });
    });

    C.onSubmit('objectif.resultat', async (form, fd) => {
      const g = goalById(form.dataset.id);
      if (!g) return;
      const note = String(fd.get('note') || '').trim().slice(0, 300);
      const date = U.isKey(g.date) && g.date <= U.todayKey() ? g.date : U.todayKey();
      const src = `objectif:${g.id}`;
      const add = (benchId, value, context) => {
        if (value == null || !C.metrics || typeof C.metrics.addBench !== 'function') return;
        safe(() => C.metrics.addBench(benchId, { date, value, context, source: src, note: g.name }, { silent: true }));
      };
      const readT = (name) => { const raw = String(fd.get(name) || '').trim(); return raw ? U.parseDuration(raw) : null; };
      const result = { date, note };
      let success = null;
      if (g.type === 'hyrox') {
        result.time = readT('time');
        if (String(fd.get('time') || '').trim() && result.time == null) { C.ui.toast('Temps illisible : tape par exemple 13542 pour 1:35:42'); return; }
        add('hyrox_race', result.time, 'officiel');
        success = result.time != null ? true : null;
      } else if (g.type === 'ssa') {
        success = fd.get('success') === 'oui' ? true : fd.get('success') === 'non' ? false : null;
        result.tsa = readT('tsa'); result.fins = readT('fins');
        add('ssa_tsa_course', result.tsa, 'officiel');
        add('ssa_tsa_fins', result.fins, 'officiel');
      } else if (g.type === 'pompier') {
        success = fd.get('success') === 'oui' ? true : fd.get('success') === 'non' ? false : null;
        result.pending = fd.get('success') === 'attente';
      } else {
        const b = bench(g.details.benchId);
        if (b) {
          const raw = String(fd.get('value') || '').trim();
          result.value = raw ? (b.unit === 'time' ? U.parseDuration(raw) : U.num(raw)) : null;
          if (raw && result.value == null) { C.ui.toast('Valeur illisible'); return; }
          add(b.id, result.value, 'test');
          const t = U.num(g.details.targetValue);
          success = result.value == null || t == null ? null : b.lower ? result.value <= t : result.value >= t;
        } else success = fd.get('success') === 'oui' ? true : fd.get('success') === 'non' ? false : null;
      }
      result.success = success;
      updateGoal(g.id, (goal) => { goal.result = result; });
      if (success === true && g.status === 'active') {
        if (await C.ui.ask('Bravo ! Marquer cet objectif comme atteint ?', 'Oui, atteint', { title: 'Objectif atteint' })) {
          updateGoal(g.id, (goal) => { goal.status = 'done'; });
        }
      } else C.ui.toast('Résultat enregistré');
    });

    C.action('objectif.statut', async (el) => {
      const { id, v } = el.dataset;
      if (!['active', 'done', 'archived'].includes(v)) return;
      if (v === 'archived' && !(await C.ui.ask('Archiver cet objectif ? Il ne comptera plus dans le plan.', 'Archiver'))) return;
      updateGoal(id, (g) => { g.status = v; });
      C.ui.toast(v === 'done' ? 'Objectif atteint 🎉' : v === 'archived' ? 'Objectif archivé' : 'Objectif remis en cours');
    });
    C.action('objectif.supprimer', async (el) => {
      const g = goalById(el.dataset.id);
      if (!g) return;
      if (!(await C.ui.ask(`Supprimer « ${g.name} » et ses jalons ? Les tests déjà enregistrés sont gardés. Pour le garder en mémoire, archive-le plutôt.`, 'Supprimer', { danger: true }))) return;
      C.store.update((s) => { s.goals = (s.goals || []).filter((x) => x && x.id !== g.id); }, { silent: true });
      C.go('#/objectifs');
      C.ui.toast('Objectif supprimé');
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.goalsUI = {
    countdownCard, viewList, viewDetail,
    _t: { sortMilestones, progressOf, countdownItems, refreshDues, overridesFromForm, daysBadge, FIELDS },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
