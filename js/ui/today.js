/* Crevare — écran « Aujourd'hui » (#/) : l'écran ouvert chaque jour.
 * En-tête (date, période), check-in facultatif, séance du jour (commencer, imprévu, créneau, bonus),
 * puis les cartes des autres modules (agenda, habitudes, poids, objectifs, semaine, sauvegarde).
 * Chaque carte d'un autre module est facultative : si le module manque ou plante, elle est omise.
 * Les actions sur la séance (commencer, versions, déplacer…) sont celles de plan.js (C.planUI, « plan.* »). */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Accès défensifs ───────── */

  const has = (mod, name) => !!(mod && typeof mod[name] === 'function');
  function safe(fn, fallback) {
    try { const r = fn(); return r === undefined ? fallback : r; } catch (e) { if (typeof console !== 'undefined') console.error(e); return fallback; }
  }
  // Carte HTML d'un autre module ('' si absent ou en erreur).
  function widget(mod, name, ...args) {
    if (!has(mod, name)) return '';
    const html = safe(() => mod[name](...args), '');
    return typeof html === 'string' ? html : '';
  }
  const st = () => C.state || {};
  const P = () => C.planUI || null;
  const T = () => (C.planUI && C.planUI._t) || null;
  const dayPlan = (date) => (has(C.planner, 'day') ? safe(() => C.planner.day(date), null) : null);
  const sessionsOn = (date) => (has(C.sessions, 'forDate') ? safe(() => C.sessions.forDate(date), []) || [] : []);
  const LOC = (loc) => (C.ui && C.ui.LOCATIONS && (C.ui.LOCATIONS[loc] || C.ui.LOCATIONS.autre)) || { label: loc || '', icon: '•', color: 'var(--muted)' };
  const tplTitle = (tid) => { const t = C.data && C.data.sessionTemplates && C.data.sessionTemplates[tid]; return t ? t.title : tid; };

  /* ───────── État de l'écran (mémoire, remis à zéro chaque jour) ───────── */

  const ui = { date: null, ci: null, touched: false, bonus: null };
  function uiFor(date) {
    if (ui.date !== date) Object.assign(ui, { date, ci: null, touched: false, bonus: null });
    return ui;
  }

  /* ───────── Fonctions pures ───────── */

  const SCALES = ['sleep', 'energy', 'soreness'];
  // Check-in du jour : 'none' (rien), 'partial' (commencé), 'done' (les 3 échelles notées).
  function checkinStatus(c) {
    if (!U.isObj(c)) return 'none';
    const n = SCALES.filter((k) => U.num(c[k]) != null).length;
    if (n === SCALES.length) return 'done';
    const pain = U.isObj(c.pain) && Object.values(c.pain).some((v) => U.num(v) != null);
    return n || pain || (c.note && String(c.note).trim()) ? 'partial' : 'none';
  }

  // Affichage du check-in : 'hidden' (fait : le feu s'affiche dans la carte séance), 'closed' (une ligne), 'open'.
  function checkinMode(status, pref, touched) {
    if (pref === 'open') return 'open';
    if (pref === 'closed') return status === 'done' ? 'hidden' : 'closed';
    if (touched) return 'open';
    if (status === 'done') return 'hidden';
    return status === 'partial' ? 'open' : 'closed';
  }

  const greeting = (firstName) => (String(firstName || '').trim() ? `Salut ${String(firstName).trim()}` : 'Aujourd\'hui');

  // « Version douce conseillée » après une douleur notée en fin de séance (séance.softUntil, cf. session.js).
  function softFrom(sessions, date) {
    let found = null;
    for (const s of Object.values(sessions || {})) {
      if (!s || s.status !== 'done' || !U.isKey(s.softUntil)) continue;
      if (s.date >= date || s.softUntil < date) continue;
      if (!found || s.date > found.from) found = { from: s.date, until: s.softUntil };
    }
    return found;
  }

  const RANK = { normal: 0, allege: 1, doux: 2, repos: 3 };
  const FEU = { vert: 'Feu vert', orange: 'Feu orange', rouge: 'Feu rouge' };
  const ADVICE_TEXT = { normal: 'séance normale', allege: 'version allégée conseillée', doux: 'version douce conseillée (sans impact)', repos: 'repos conseillé aujourd\'hui' };

  // Conseil du jour à partir du feu (check-in) et d'une douleur récente : la suggestion la plus prudente gagne.
  function advice(readiness, soft) {
    const r = U.isObj(readiness) ? readiness : null;
    let suggestion = r && RANK[r.suggestion] != null ? r.suggestion : 'normal';
    const reasons = r && Array.isArray(r.reasons) ? r.reasons.slice() : [];
    if (soft && RANK.doux > RANK[suggestion]) suggestion = 'doux';
    if (soft) reasons.push(`Douleur notée le ${U.fmtShort(soft.from)} : prudence jusqu'au ${U.fmtShort(soft.until)}`);
    const level = r && r.level ? r.level : soft ? 'orange' : null;
    if (!level) return null;
    return { level, suggestion, reasons, text: ADVICE_TEXT[suggestion], title: FEU[level] || 'Forme du jour' };
  }

  // Raison du repos sans la phrase « En option : … » (les bonus sont listés à part).
  const stripOption = (reason) => String(reason || '').replace(/\s*En option\s*:.*$/s, '').trim();

  const legInjury = (profile) => (Array.isArray(profile && profile.injuries) ? profile.injuries : [])
    .some((i) => i && i.active !== false && (i.zone === 'genou' || i.zone === 'cheville'));

  // Mini-séances facultatives du jour : bonus du plan (jours de repos) + minuteurs rapides
  // (abdos avec voix, réhab cheville/genou si blessure), sans doublon.
  function bonusItems(dp, opts = {}) {
    const out = [];
    const tids = dp && dp.kind === 'rest' ? (dp.bonus || []) : [];
    for (const tid of tids) out.push({ kind: 'session', tid });
    if (opts.timer) {
      if (!tids.includes('home_core')) out.push({ kind: 'timer', preset: 'abdos10', title: 'Abdos 10 min', desc: 'Chrono vocal : annonce de l\'exercice, « 5, 4, 3, 2, 1 » et bip.' });
      if (opts.leg && !tids.includes('home_rehab')) out.push({ kind: 'timer', preset: 'rehab', title: 'Cheville et genou', desc: 'Minuteur guidé, environ 10 min, sans douleur.' });
    }
    return out;
  }

  // Séance manquée hier, à rattraper aujourd'hui (jour de repos libre) ?
  function canCatchUp(yState, dpToday, hasMainToday) {
    return !!yState && yState.key === 'manque' && !!dpToday && dpToday.kind === 'rest' && !hasMainToday
      && !['event', 'veille', 'apres-course'].includes(dpToday.blocked);
  }

  const STRIP_ICON = { fait: '✓', 'en-cours': '◐', 'a-terminer': '◐', manque: '✕', evenement: '🏁', repos: '·' };

  /* ───────── Rendu ───────── */

  function header(date, ph) {
    const prof = st().profile || {};
    const pills = ph ? [ph.deload ? '<span class="pill ok">Semaine allégée</span>' : '', ph.taper ? '<span class="pill warn">Affûtage</span>' : ''].join('') : '';
    const color = ph && P() ? (P().PHASE_COLORS[ph.key] || 'var(--muted)') : 'var(--muted)';
    return `<header class="top tdy-top">
      <p class="tdy-date">${esc(U.fmtDate(date))}</p>
      <h1>${esc(greeting(prof.firstName))}</h1>
      ${ph ? `<a class="tdy-phase" href="#/plan-apercu" style="--k:${color}"><span class="tdy-phase-dot" aria-hidden="true"></span>
        <span>${esc(ph.label || '')}${ph.weekInPhase ? ` · semaine ${esc(ph.weekInPhase)}` : ''}</span>${pills}<span class="muted" aria-hidden="true">›</span></a>` : ''}
    </header>`;
  }

  function checkinSection(date) {
    if (!has(C.bodyUI, 'checkinCard')) return '';
    const s = uiFor(date);
    const status = checkinStatus((st().checkins || {})[date]);
    const mode = checkinMode(status, s.ci, s.touched);
    if (mode === 'hidden') return '';
    if (mode === 'closed') {
      return `<button type="button" class="tdy-ci-row" data-action="today.checkin" data-date="${esc(date)}" aria-expanded="false">
        <span class="tdy-ci-i" aria-hidden="true">🌤️</span><span class="grow"><b>Check-in du matin</b><small class="muted">30 s, facultatif : adapte ta séance à ta forme</small></span><span aria-hidden="true">›</span></button>`;
    }
    const card = widget(C.bodyUI, 'checkinCard', date);
    if (!card) return '';
    return `<div class="tdy-ci" data-tdy-ci="${esc(date)}">${card}
      <button type="button" class="link small tdy-ci-fold" data-action="today.checkin-replier" data-date="${esc(date)}" aria-expanded="true">Replier le check-in</button></div>`;
  }

  // Ligne « feu » dans la carte séance (seulement si la séance n'est pas encore commencée).
  function adviceLine(date, adv, actionable) {
    if (!adv) return '';
    let btn = '';
    if (actionable && adv.suggestion === 'repos') btn = `<button type="button" class="btn small" data-action="plan.repos" data-date="${esc(date)}">Repos</button>`;
    else if (actionable && adv.suggestion !== 'normal') btn = `<button type="button" class="btn small" data-action="plan.version" data-date="${esc(date)}" data-variant="${esc(adv.suggestion)}">Prendre</button>`;
    const edit = has(C.bodyUI, 'checkinCard') ? `<button type="button" class="link tiny" data-action="today.checkin" data-date="${esc(date)}">Modifier le check-in</button>` : '';
    return `<div class="tdy-ready lvl-${esc(adv.level)}" role="status"><span class="tdy-dot" aria-hidden="true"></span>
      <div class="grow"><b>${esc(adv.title)}</b> · ${esc(adv.text)}${adv.reasons.length ? `<small class="muted">${esc(adv.reasons.join(' · '))}</small>` : ''}
      ${adv.reasons.some((x) => /forte/i.test(x)) ? '<small>Si la douleur persiste ou augmente, consulte un médecin ou un kiné.</small>' : ''}${edit}</div>${btn}</div>`;
  }

  function bonusSection(date, dp, list, defaultOpen) {
    const s = uiFor(date);
    const items = bonusItems(dp, { timer: has(C.timer, 'open'), leg: legInjury(st().profile) });
    if (!items.length) return '';
    const open = s.bonus == null ? defaultOpen : s.bonus;
    const rows = items.map((it) => {
      if (it.kind === 'session') {
        const done = list.find((x) => x.templateId === it.tid);
        const dur = has(C.planner, 'instantiate') ? safe(() => C.planner.instantiate(date, { templateId: it.tid }).durationMin, null) : null;
        return `<li class="tdy-bonus-row"><span class="grow"><b>${esc(tplTitle(it.tid))}</b><small class="muted">${dur ? `≈ ${esc(dur)} min · ` : ''}facultatif</small></span>
          ${done ? `<a class="btn ghost small" href="#/seance/${esc(encodeURIComponent(done.id))}">${done.status === 'done' ? '✓ Faite' : 'Reprendre'}</a>`
          : `<button type="button" class="btn ghost small" data-action="plan.bonus" data-date="${esc(date)}" data-tid="${esc(it.tid)}">Commencer</button>`}</li>`;
      }
      return `<li class="tdy-bonus-row"><span class="grow"><b>⏱ ${esc(it.title)}</b><small class="muted">${esc(it.desc)}</small></span>
        <button type="button" class="btn ghost small" data-action="plan.minuteur" data-preset="${esc(it.preset)}">Lancer</button></li>`;
    }).join('');
    return `<div class="tdy-bonus">
      <button type="button" class="tdy-bonus-t" data-action="today.bonus" data-date="${esc(date)}" aria-expanded="${open}">
        <span>Bonus facultatif <span class="tiny muted">(${esc(items.length)})</span></span><span aria-hidden="true">${open ? '▾' : '▸'}</span></button>
      ${open ? `<ul class="tdy-bonus-list">${rows}</ul>` : ''}</div>`;
  }

  function sessionDone(s) {
    const bits = [s.durationMin ? `${s.durationMin} min` : '', s.rpe ? `effort ${s.rpe}/10` : '', s.feeling ? `ressenti : ${s.feeling}` : ''].filter(Boolean);
    return `<p class="tdy-done"><span aria-hidden="true">✓</span> Séance faite${bits.length ? ` · ${esc(bits.join(' · '))}` : ''}</p>
      <div class="tdy-actions"><a class="btn ghost block" href="#/seance/${esc(encodeURIComponent(s.id))}">Voir la séance</a></div>`;
  }

  // Check-list du jour J, ou de la veille d'une épreuve (« prépare tes affaires »).
  function checklists(date, dp) {
    if (!P() || !dp) return '';
    if (dp.kind === 'event') return dp.event && dp.event.checklist ? P().checklistHTML(date, dp.event.checklist) : '';
    const tomorrow = dayPlan(U.addDays(date, 1));
    if (!tomorrow || tomorrow.kind !== 'event' || !tomorrow.event || !tomorrow.event.checklist) return '';
    return P().checklistHTML(tomorrow.date, tomorrow.event.checklist, { intro: `Demain : ${tomorrow.event.title || tomorrow.title}. Prépare tes affaires ce soir.` });
  }

  // Carte « Séance du jour » (+ check-list éventuelle).
  function sessionCard(date) {
    const dp = dayPlan(date);
    return sessionCardOnly(date, dp) + checklists(date, dp);
  }

  // Séance prévue, commencée, faite, repos ou jour J.
  function sessionCardOnly(date, dp) {
    const list = sessionsOn(date);
    const t = T();

    if (!dp || !t) {
      // Sans planificateur : on montre au moins la séance enregistrée du jour.
      const s = list[0];
      return `<section class="card tdy-sess" style="--c:var(--muted)"><span class="tdy-kicker">Séance du jour</span>
        ${s ? `<h2>${esc(s.title)}</h2>${s.status === 'done' ? sessionDone(s) : `<div class="tdy-actions"><a class="btn block" href="#/seance/${esc(encodeURIComponent(s.id))}">Reprendre</a></div>`}`
        : '<p class="muted small">Le plan n\'est pas disponible pour le moment.</p><div class="tdy-actions"><a class="btn ghost block" href="#/mes-seances">Mes séances</a></div>'}
      </section>`;
    }

    const main = t.pickMain(list, dp);
    const readiness = has(C.metrics, 'readiness') ? safe(() => C.metrics.readiness(date), null) : null;
    const adv = advice(readiness, softFrom(st().sessions, date));
    const L = dp.kind === 'event' ? { color: 'var(--danger)', icon: '🏁', label: 'Jour J' } : LOC(main ? main.loc : dp.loc);
    const pills = [
      dp.overridden ? '<span class="tag tdy-mod">modifié</span>' : '',
      main && main.variant && main.variant !== 'normal' ? `<span class="pill">${esc((P().VARIANTS[main.variant] || {}).label || main.variant)}</span>` : '',
    ].join('');

    // Séance déjà ouverte (en cours ou faite)
    if (main) {
      const prog = P().progressOf(main);
      const empty = t.isEmptySession(main);
      return `<section class="card tdy-sess" style="--c:${L.color}" aria-labelledby="tdy-sess-t">
        <div class="tdy-sess-h"><span class="tdy-kicker">Séance du jour</span><span class="row gap">${pills}</span></div>
        <h2 id="tdy-sess-t">${esc(main.title)}</h2>
        <p class="tdy-meta">${C.ui.locBadge(main.loc)}${main.plannedMin ? `<span class="num">≈ ${esc(main.plannedMin)} min</span>` : ''}</p>
        ${main.status === 'done' ? sessionDone(main) : `
          ${empty ? adviceLine(date, adv, true) : ''}
          <p class="small muted">${empty ? 'Séance ouverte, rien de noté pour l\'instant.' : `${esc(prog.done)}/${esc(prog.total)} séries notées.`}</p>
          <div class="tdy-actions"><a class="btn block" href="#/seance/${esc(encodeURIComponent(main.id))}">${empty ? 'Commencer' : 'Reprendre'}</a>
            <a class="btn ghost" href="#/jour/${esc(date)}">Détail</a></div>
          ${empty ? `<button type="button" class="link small tdy-imprevu" data-action="plan.imprevu" data-date="${esc(date)}" ${adv && adv.suggestion !== 'normal' ? `data-recommend="${esc(adv.suggestion)}"` : ''}>Pas en forme / imprévu ?</button>` : ''}`}
        ${bonusSection(date, dp, list, false)}
      </section>`;
    }

    // Jour J
    if (dp.kind === 'event') {
      const inst = has(C.planner, 'instantiate') ? safe(() => C.planner.instantiate(date), null) : null;
      return `<section class="card tdy-sess tdy-event" style="--c:var(--danger)" aria-labelledby="tdy-sess-t">
          <div class="tdy-sess-h"><span class="tdy-kicker">🏁 Jour J</span><span class="row gap">${pills}</span></div>
          <h2 id="tdy-sess-t">${esc(dp.title)}</h2>
          ${inst && inst.intro ? `<p class="small">${esc(inst.intro)}</p>` : ''}
          <div class="tdy-actions"><button type="button" class="btn block" data-action="plan.commencer" data-date="${esc(date)}">Noter mon résultat</button>
            <a class="btn ghost" href="#/jour/${esc(date)}">Détail</a></div>
        </section>`;
    }

    // Repos
    if (dp.kind !== 'session') {
      const y = U.addDays(date, -1);
      const dpY = dayPlan(y);
      const yState = dpY ? t.dayState(dpY, sessionsOn(y), date) : null;
      const catchUp = canCatchUp(yState, dp, false)
        ? `<div class="note small tdy-catch">Tu as manqué « ${esc(dpY.title)} » hier. Tu as le temps aujourd'hui ?
            <button type="button" class="btn small mt" data-action="plan.deplacer-vers" data-date="${esc(y)}" data-to="${esc(date)}">La faire aujourd'hui</button></div>` : '';
      const reason = stripOption(dp.reason);
      return `<section class="card tdy-sess tdy-rest" style="--c:var(--loc-repos)" aria-labelledby="tdy-sess-t">
          <div class="tdy-sess-h"><span class="tdy-kicker">Aujourd'hui</span><span class="row gap">${pills}</span></div>
          <h2 id="tdy-sess-t">Repos <span aria-hidden="true">🧘</span></h2>
          <p class="small">${esc(reason && reason !== 'Repos.' ? reason : 'C\'est pendant la récupération que tu progresses.')}</p>
          ${catchUp}
          ${bonusSection(date, dp, list, true)}
          <a class="link small tdy-more" href="#/jour/${esc(date)}">Faire quand même une séance</a>
        </section>`;
    }

    // Séance prévue, pas encore ouverte
    const inst = has(C.planner, 'instantiate') ? safe(() => C.planner.instantiate(date), null) : null;
    const slot = P().slotFor(date, dp.durationMin);
    const goals = inst && C.ui.goalTags ? C.ui.goalTags((inst.goals || []).filter((g) => g !== 'general')) : '';
    return `<section class="card tdy-sess" style="--c:${L.color}" aria-labelledby="tdy-sess-t">
      <div class="tdy-sess-h"><span class="tdy-kicker">Séance du jour</span><span class="row gap">${pills}</span></div>
      <h2 id="tdy-sess-t">${esc(dp.title)}</h2>
      <p class="tdy-meta">${C.ui.locBadge(dp.loc)}${dp.durationMin ? `<span class="num">≈ ${esc(dp.durationMin)} min</span>` : ''}${goals}</p>
      ${dp.reason ? `<p class="small muted">${esc(dp.reason)}</p>` : ''}
      ${inst && inst.intro ? `<p class="small tdy-intro">${esc(inst.intro)}</p>` : ''}
      ${slot ? `<p class="tdy-slot"><span aria-hidden="true">🕒</span> <b class="num">${esc(slot)}</b></p>` : ''}
      ${adviceLine(date, adv, true)}
      <div class="tdy-actions">
        <button type="button" class="btn block" data-action="plan.commencer" data-date="${esc(date)}" data-variant="normal">Commencer</button>
        <a class="btn ghost" href="#/jour/${esc(date)}">Détail</a>
      </div>
      <button type="button" class="link small tdy-imprevu" data-action="plan.imprevu" data-date="${esc(date)}" ${adv && adv.suggestion !== 'normal' ? `data-recommend="${esc(adv.suggestion)}"` : ''}>Pas en forme / imprévu ?</button>
      ${bonusSection(date, dp, list, false)}
    </section>`;
  }

  // Bandeau de la semaine (7 jours) + mini-progrès.
  function weekCard(date) {
    const t = T();
    if (!t || !has(C.planner, 'week')) return '';
    const monday = U.mondayOf(date);
    const days = safe(() => C.planner.week(monday), []) || [];
    if (days.length !== 7) return '';
    const strip = days.map((dp) => {
      const s = t.dayState(dp, sessionsOn(dp.date), date);
      const icon = STRIP_ICON[s.key] || (dp.kind === 'event' ? '🏁' : LOC(dp.loc).icon);
      const label = `${U.fmtDate(dp.date)} : ${dp.kind === 'rest' ? 'repos' : dp.title} (${s.label.toLowerCase()})`;
      return `<li><a class="tdy-sd st-${esc(s.key)} ${dp.date === date ? 'is-today' : ''}" href="#/jour/${esc(dp.date)}" style="--c:${dp.kind === 'event' ? 'var(--danger)' : LOC(dp.loc).color}"
        aria-label="${esc(label)}" ${dp.date === date ? 'aria-current="date"' : ''}><small aria-hidden="true">${esc(U.DAYS_SHORT[U.dow(dp.date)])}</small><span aria-hidden="true">${esc(icon)}</span></a></li>`;
    }).join('');
    const sum = P().weekSummaryOf(monday, days);
    const reg = has(C.metrics, 'regularity') ? safe(() => C.metrics.regularity(4), null) : null;
    return `<section class="card tdy-week" aria-labelledby="tdy-week-t">
      <div class="card-head"><h2 id="tdy-week-t">Ta semaine</h2><a class="link tdy-more" href="#/plan">Voir le plan</a></div>
      <ol class="tdy-strip">${strip}</ol>
      <a class="tdy-prog" href="#/progres">
        <span><b class="num">${esc(sum.done)}/${esc(sum.planned)}</b><small>séances</small></span>
        <span><b class="num">${esc(sum.minutes)}</b><small>minutes</small></span>
        ${reg != null ? `<span><b class="num">${esc(reg)} %</b><small>régularité (4 sem.)</small></span>` : ''}
        <span class="tdy-prog-go">Progrès <span aria-hidden="true">›</span></span>
      </a>
    </section>`;
  }

  function view() {
    const date = U.todayKey();
    uiFor(date);
    const ph = has(C.planner, 'phase') ? safe(() => C.planner.phase(date), null) : null;
    const html = [
      header(date, ph),
      checkinSection(date),
      safe(() => sessionCard(date), `<section class="card"><p class="muted">La séance du jour n'a pas pu s'afficher.</p><a class="btn ghost" href="#/plan">Voir le plan</a></section>`),
      widget(C.agendaUI, 'todayCard', date),
      widget(C.habitsUI, 'todayCard', date),
      widget(C.bodyUI, 'todayCard', date),
      widget(C.goalsUI, 'countdownCard'),
      safe(() => weekCard(date), ''),
      widget(C.backupUI, 'reminderCard'),
    ].join('');
    return {
      html,
      after($app) {
        // Une saisie dans le check-in le garde ouvert jusqu'à « Replier » (même une fois complet).
        const box = $app.querySelector('[data-tdy-ci]');
        if (!box) return;
        const mark = () => { uiFor(box.dataset.tdyCi).touched = true; };
        box.addEventListener('click', mark);
        box.addEventListener('change', mark);
      },
    };
  }

  /* ───────── Enregistrement ───────── */

  function register() {
    C.route('#/', view, { tab: '#/', title: 'Aujourd\'hui' });
    C.action('today.checkin', (el) => { const s = uiFor(el.dataset.date); s.ci = 'open'; C.rerender(); });
    C.action('today.checkin-replier', (el) => { const s = uiFor(el.dataset.date); s.ci = 'closed'; s.touched = false; C.rerender(); });
    C.action('today.bonus', (el) => {
      const s = uiFor(el.dataset.date);
      s.bonus = el.getAttribute('aria-expanded') !== 'true';
      C.rerender();
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.todayUI = {
    view,
    _t: { checkinStatus, checkinMode, greeting, softFrom, advice, stripOption, legInjury, bonusItems, canCatchUp },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
