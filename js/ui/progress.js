/* Crevare — écran Progrès (#/progres) : semaine (séances, minutes, charge), régularité, charge sur 8 semaines,
 * minutes par type ; tests de référence par objectif (meilleur test, dernier, tendance, cible et écart).
 * Fiche d'un test (#/progres/:benchId) : courbe, historique modifiable, ajout manuel, projection prudente. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Accès défensifs ───────── */

  const mfn = (name) => (C.metrics && typeof C.metrics[name] === 'function' ? C.metrics[name] : null);
  const D = () => C.data || {};
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.error(e); return fallback; }
  }
  const call = (name, ...args) => { const f = mfn(name); return f ? safe(() => f(...args), null) : null; };

  const CONTEXT_LABELS = { test: 'Test', entrainement: 'Entraînement', officiel: 'Officiel', sante: 'Apple Santé', ancien: 'Ancien format' };
  const CONTEXT_SMALL = { test: 'test', entrainement: 'entraînement', officiel: 'officiel', sante: 'Apple Santé', ancien: 'ancien format' };
  const KIND_INFO = {
    piscine: { label: 'Piscine', icon: '🏊', color: 'var(--loc-piscine)' },
    salle: { label: 'Salle', icon: '🏋️', color: 'var(--loc-salle)' },
    course: { label: 'Course', icon: '🏃', color: 'var(--loc-dehors)' },
    maison: { label: 'Maison', icon: '🏠', color: 'var(--loc-maison)' },
    autre: { label: 'Autre', icon: '•', color: 'var(--muted)' },
  };
  const GOAL_GROUPS = { ssa: 'SSA', hyrox: 'HYROX', pompier: 'Pompier', general: 'Général' };
  const UNIT_HINT = { time: 'm:ss', reps: 'répétitions', m: 'mètres', cm: 'cm', kg: 'kg', palier: 'palier', km: 'km' };

  // Mode d'affichage de la courbe par test (« tests seulement » ou « tout »), gardé le temps de la visite.
  const chartMode = {};

  /* ───────── Fonctions pures ───────── */

  function getBench(id) {
    const b = D().getBenchmark ? safe(() => D().getBenchmark(id), null) : null;
    if (b) return b;
    // Test inconnu de la bibliothèque (ancienne donnée) : on l'affiche quand même.
    return (C.state && C.state.benchmarks && C.state.benchmarks[id]) ? { id, name: id, unit: '', lower: false, goal: 'general', goals: ['general'], archived: true, protocol: '' } : null;
  }
  const allBenches = () => (Array.isArray(D().benchmarks) ? D().benchmarks : []);

  // Valeur lisible (texte brut, à échapper).
  function fmtVal(b, v) {
    if (v == null || v === '' || !isFinite(v)) return '—';
    switch (b && b.unit) {
      case 'time': return U.formatDuration(v);
      case 'reps': return `${U.fmtNum(v, 0)} rep${Math.abs(v) >= 2 ? 's' : ''}`;
      case 'palier': return `palier ${U.fmtNum(v, 1)}`;
      case 'm': return `${U.fmtNum(v, 2)} m`;
      case 'cm': return `${U.fmtNum(v, 1)} cm`;
      case 'kg': return `${U.fmtNum(v, 1)} kg`;
      case 'km': return `${U.fmtNum(v, 2)} km`;
      default: return U.fmtNum(v, 2);
    }
  }
  // Écart (toujours positif) : « 12 s », « 1:05 », « 3 reps », « 1,5 m »
  function fmtGap(b, d) {
    const a = Math.abs(d);
    if (b.unit === 'time') return a >= 60 ? U.formatDuration(a) : `${U.fmtNum(a, 0)} s`;
    if (b.unit === 'reps') return U.plural(Math.ceil(a - 1e-9), 'rep', 'reps');
    if (b.unit === 'palier') return `${U.fmtNum(a, 1)} palier${a >= 2 ? 's' : ''}`;
    return fmtVal(b, a);
  }
  const meets = (b, v, t) => (b.lower ? v <= t : v >= t);

  // Texte d'écart à la cible : « encore 12 s à gagner » / « cible atteinte ».
  function gapText(b, value, target) {
    if (value == null || target == null) return '';
    if (meets(b, value, target)) return 'cible atteinte';
    const d = b.lower ? value - target : target - value;
    return b.lower ? `encore ${fmtGap(b, d)} à gagner` : `encore ${fmtGap(b, d)}`;
  }

  // Flèche et texte de tendance.
  function trendBits(b, t) {
    if (!t) return null;
    const arrow = t.perMonth < 0 ? '↘' : t.perMonth > 0 ? '↗' : '→';
    const txt = t.direction === 'stable' ? 'stable' : mfn('fmtPerMonth') ? C.metrics.fmtPerMonth(b.unit, t.perMonth) : '';
    const word = t.direction === 'mieux' ? 'en progrès' : t.direction === 'moins-bien' ? 'en baisse' : 'stable';
    return { arrow: t.direction === 'stable' ? '→' : arrow, txt, cls: `is-${t.direction}`, aria: `Tendance ${word}${t.direction === 'stable' ? '' : ` : ${txt}`}` };
  }

  // Tests liés à un objectif actif.
  function benchesForGoal(g) {
    if (!g) return [];
    if (g.type === 'custom') {
      const id = g.details && g.details.benchId;
      const b = id ? getBench(id) : null;
      return b ? [b] : [];
    }
    return allBenches().filter((b) => !b.archived && (b.goals || [b.goal]).includes(g.type));
  }
  const activeGoals = () => (Array.isArray(C.state.goals) ? C.state.goals : [])
    .filter((g) => g && g.status === 'active')
    .sort((a, b) => (a.priority || 2) - (b.priority || 2) || String(a.date || '9999').localeCompare(String(b.date || '9999')));

  // Objectif actif le plus prioritaire lié à un test (pour comparer la projection à sa date).
  function goalForBench(b) {
    return activeGoals().find((g) => (g.type === 'custom' ? g.details && g.details.benchId === b.id : (b.goals || [b.goal]).includes(g.type))) || null;
  }

  function refFor(b) {
    if (!D().targetFor) return b.official || b.target ? { official: b.official || null, target: b.target || null } : null;
    return safe(() => D().targetFor(b.id, C.state.profile), null);
  }
  function statusFor(b, value, ref) {
    if (value == null) return null;
    if (D().benchStatus) return safe(() => D().benchStatus(b.id, value, ref), null);
    const t = ref && ref.target ? ref.target.value : ref && ref.official ? ref.official.value : null;
    if (t == null) return null;
    return meets(b, value, t) ? { level: 'cible', text: 'Cible atteinte.' } : { level: 'loin', text: 'Pas encore.' };
  }
  const STATUS_PILL = { cible: ['ok', 'Cible atteinte'], reussi: ['ok', 'Seuil atteint'], proche: ['warn', 'Presque'], loin: ['', 'Pas encore'] };

  const fmtMinutes = (m) => { m = Math.round(m || 0); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${U.pad(m % 60)}`; };
  const shortWeek = (monday) => { const d = U.parseKey(monday); return `${d.getDate()}/${d.getMonth() + 1}`; };

  // Hausse nette de la charge (repère, jamais un « risque ») : semaine en cours vs moyenne des 4 précédentes.
  function loadJump(loads) {
    if (loads.length < 5) return null;
    const prev = loads.slice(-5, -1);
    if (prev.some((v) => !v)) return null; // il faut 4 semaines pleines de données
    const avg = U.mean(prev);
    const cur = loads[loads.length - 1];
    return avg > 0 && cur > avg * 1.5 ? U.round(cur / avg, 1) : null;
  }

  /* ───────── #/progres ───────── */

  function weekCardHTML() {
    const today = U.todayKey();
    const mon = U.mondayOf(today);
    const ws = call('weekSummary', mon);
    const reg = call('regularityDetail', 4);
    const mondays = [7, 6, 5, 4, 3, 2, 1, 0].map((k) => U.addDays(mon, -7 * k));
    const loads = mondays.map((m) => call('weekLoad', m) || 0);
    const jump = loadJump(loads);
    const kinds = {};
    for (const m of mondays.slice(-4)) {
      const w = m === mon ? ws : call('weekSummary', m);
      if (!w || !w.byKind) continue;
      for (const [k, v] of Object.entries(w.byKind)) kinds[k] = (kinds[k] || 0) + (v || 0);
    }
    const kindMax = Math.max(1, ...Object.values(kinds));
    const kindRows = Object.keys(KIND_INFO).filter((k) => k !== 'autre' || kinds[k] > 0);

    const done = ws ? ws.done : 0;
    const kpi = (val, label, extra = '') => `<div class="prg-kpi"><b class="num">${esc(val)}</b><span class="tiny muted">${esc(label)}</span>${extra}</div>`;
    const sessionsTxt = ws && ws.planned != null ? `${done}/${ws.planned}` : String(done);
    const regTxt = reg && reg.pct != null ? `${reg.pct} %` : '—';
    return `<section class="card prg-week" aria-labelledby="prg-week-t">
      <div class="card-head"><h2 id="prg-week-t">Cette semaine</h2><a class="link" href="#/plan">Voir le plan</a></div>
      <div class="prg-kpis">
        ${kpi(sessionsTxt, ws && ws.planned != null ? 'séances faites / prévues' : 'séances faites')}
        ${kpi(fmtMinutes(ws ? ws.minutes : 0), 'd\'entraînement')}
        ${kpi(ws ? Math.round(ws.load) : 0, 'charge (sRPE)')}
        ${kpi(regTxt, 'régularité 4 sem.')}
      </div>
      ${ws && ws.bonus ? `<p class="tiny muted">+ ${esc(U.plural(ws.bonus, 'mini-séance bonus', 'mini-séances bonus'))} (non comptée${ws.bonus > 1 ? 's' : ''} dans la régularité).</p>` : ''}
      ${ws && ws.unrated ? `<p class="tiny muted">${esc(U.plural(ws.unrated, 'séance', 'séances'))} sans effort noté : pas comptée${ws.unrated > 1 ? 's' : ''} dans la charge.</p>` : ''}
      ${ws && ws.healthMin ? `<p class="tiny muted">Dont ${esc(fmtMinutes(ws.healthMin))} venues d'Apple Santé.</p>` : ''}
      ${reg && reg.planned ? `<p class="tiny muted">Régularité : ${esc(reg.done)} séance${reg.done > 1 ? 's' : ''} faite${reg.done > 1 ? 's' : ''} sur ${esc(reg.planned)} prévue${reg.planned > 1 ? 's' : ''} (jours passés, séances bonus exclues).</p>` : ''}

      <h3 class="prg-sub">Charge des 8 dernières semaines</h3>
      ${loads.some((v) => v > 0) ? `<div class="prg-bars">${C.ui.bars(mondays.map((m, i) => ({ label: shortWeek(m), value: loads[i], cls: m === mon ? 'prg-cur' : '' })), { height: 90, label: 'Charge des 8 dernières semaines', fmt: (v) => Math.round(v) })}</div>
        <p class="tiny muted">Charge = durée (min) × effort ressenti (1 à 10), additionnée sur la semaine.</p>`
        : '<p class="muted small">Note l\'effort (1 à 10) à la fin de tes séances : la charge apparaîtra ici.</p>'}
      ${jump ? `<p class="note warn small">Charge en nette hausse cette semaine (× ${esc(U.fmtNum(jump, 1))} par rapport à tes 4 semaines précédentes). Ce n'est qu'un repère : écoute tes sensations et ta douleur.</p>` : ''}

      <h3 class="prg-sub">Minutes par type · 4 semaines</h3>
      <ul class="prg-kinds">${kindRows.map((k) => {
        const info = KIND_INFO[k];
        const v = Math.round(kinds[k] || 0);
        return `<li class="prg-kind" style="--c:${info.color}"><span class="prg-kind-l"><span aria-hidden="true">${info.icon}</span> ${esc(info.label)}</span>
          <span class="prg-kind-bar" aria-hidden="true"><span style="width:${Math.round((v / kindMax) * 100)}%"></span></span>
          <span class="prg-kind-v num small">${esc(fmtMinutes(v))}</span></li>`;
      }).join('')}</ul>
    </section>`;
  }

  function benchCardHTML(b) {
    const best = call('benchBest', b.id);
    const last = call('benchLast', b.id);
    const trend = call('benchTrend', b.id);
    const ref = refFor(b);
    const tgt = ref && ref.target ? ref.target.value : null;
    const off = ref && ref.official ? ref.official.value : null;
    const st = statusFor(b, best ? best.value : null, ref);
    const pill = best ? STATUS_PILL[st && st.level] : null;
    const tb = trendBits(b, trend);
    const gapRef = tgt != null ? tgt : off;
    const gapVal = best ? best.value : last ? last.value : null;
    const gap = gapText(b, gapVal, gapRef);
    const refParts = [];
    if (off != null) refParts.push(`Seuil ${fmtVal(b, off)}`);
    if (tgt != null) refParts.push(`${ref.target.indicative ? 'Repère' : 'Cible'} ${fmtVal(b, tgt)}`);
    if (gap) refParts.push(best ? gap : `${gap} (entraînement)`);
    const lastIsBest = best && last && last.id === best.id;
    const href = `#/progres/${encodeURIComponent(b.id)}`;
    if (!best && !last) {
      // Pas encore de mesure comparable : carte compacte (avec l'ancien format de la v1 s'il existe).
      const old = (call('benchEntries', b.id, { contexts: ['ancien'] }) || []).pop();
      const sub = old ? [`Ancien format : ${fmtVal(b, old.value)} (${U.fmtShort(old.date)}), non comparable`] : refParts;
      return `<li><a class="card prg-bench is-empty" href="${esc(href)}">
        <div class="prg-b-top"><span class="prg-b-name">${esc(b.short || b.name)}</span><span class="pill">${old ? 'Archivé' : 'Pas encore mesuré'}</span></div>
        ${sub.length ? `<p class="prg-b-ref tiny muted">${esc(sub.join(' · '))}</p>` : ''}</a></li>`;
    }
    return `<li><a class="card prg-bench" href="${esc(href)}">
      <div class="prg-b-top"><span class="prg-b-name">${esc(b.short || b.name)}</span>
        ${pill ? `<span class="pill ${pill[0]}">${esc(pill[1])}</span>` : best ? '' : '<span class="pill">Pas encore testé</span>'}</div>
      <div class="prg-b-vals">
        <div class="prg-b-best"><span class="tiny muted">Meilleur test</span>
          <b class="num prg-big">${esc(best ? fmtVal(b, best.value) : '—')}</b>
          <span class="tiny muted">${best ? esc(U.fmtShort(best.date)) : 'pas encore de test'}</span></div>
        <div class="prg-b-last"><span class="tiny muted">Dernier</span>
          <b class="num">${esc(fmtVal(b, last.value))}</b>
          <span class="tiny muted">${esc(`${U.fmtShort(last.date)}${lastIsBest ? '' : ` · ${CONTEXT_SMALL[last.context] || ''}`}`)}</span>
          ${tb ? `<span class="prg-trend ${esc(tb.cls)}" role="img" aria-label="${esc(tb.aria)}"><span aria-hidden="true">${esc(tb.arrow)} ${esc(tb.txt)}</span></span>` : ''}</div>
      </div>
      ${refParts.length ? `<p class="prg-b-ref tiny muted">${esc(refParts.join(' · '))}</p>` : ''}
    </a></li>`;
  }

  function goalSectionHTML(g, benches, open) {
    const color = (C.ui.GOALS[g.type] || C.ui.GOALS.custom).color;
    const when = U.isKey(g.date) ? ` · ${U.fmtLong(g.date)}` : '';
    let body;
    if (benches.length) body = `<ul class="list prg-benches">${benches.map(benchCardHTML).join('')}</ul>`;
    else if (g.type === 'custom') body = `<p class="muted small">Aucun test lié à cet objectif. <a class="link" href="#/objectifs/${esc(encodeURIComponent(g.id))}">Choisir un test</a></p>`;
    else body = '<p class="muted small">Aucun test de référence pour cet objectif.</p>';
    return `<details class="prg-goal" style="--c:${color}" ${open ? 'open' : ''}>
      <summary><span class="prg-goal-t">${C.ui.goalTag(g.type)} <b>${esc(g.name)}</b></span><span class="tiny muted">${esc(U.plural(benches.length, 'test', 'tests'))}${esc(when)}</span></summary>
      ${body}</details>`;
  }

  function viewProgress() {
    if (!C.metrics) {
      return `<header class="top"><h1>Progrès</h1></header>${C.ui.empty('Statistiques indisponibles', 'Le module de mesures n\'est pas chargé.')}`;
    }
    const goals = activeGoals();
    const shown = new Set();
    const sections = goals.map((g, i) => {
      const benches = benchesForGoal(g).filter((b) => !shown.has(b.id));
      benches.forEach((b) => shown.add(b.id));
      return goalSectionHTML(g, benches, i === 0 || (g.priority || 2) <= 2);
    });
    // Tests avec des mesures, hors objectifs actifs (dont l'ancien format de la v1).
    const stored = Object.keys((C.state && C.state.benchmarks) || {}).filter((id) => !shown.has(id) && (call('benchEntries', id) || []).length);
    const others = stored.map(getBench).filter(Boolean);
    others.forEach((b) => shown.add(b.id));
    // Tous les autres tests, pour ajouter une première mesure.
    const rest = allBenches().filter((b) => !b.archived && !shown.has(b.id));
    const groups = {};
    for (const b of rest) (groups[b.goal || 'general'] = groups[b.goal || 'general'] || []).push(b);

    return `<header class="top"><h1>Progrès</h1>
        <p class="muted small">Ton meilleur test, ta dernière mesure et la tendance des 90 derniers jours.</p></header>
      ${weekCardHTML()}
      <h2 class="section">Tests par objectif</h2>
      ${goals.length ? sections.join('') : `<div class="card">${C.ui.empty('Aucun objectif actif', 'Ajoute tes objectifs (SSA, HYROX, pompier…) pour voir les tests qui comptent.', '<a class="btn" href="#/objectifs">Mes objectifs</a>')}</div>`}
      ${others.length ? `<details class="prg-goal" open><summary><span class="prg-goal-t"><b>Autres tests mesurés</b></span><span class="tiny muted">${esc(U.plural(others.length, 'test', 'tests'))}</span></summary>
        <ul class="list prg-benches">${others.map(benchCardHTML).join('')}</ul></details>` : ''}
      ${rest.length ? `<details class="prg-goal prg-all"><summary><span class="prg-goal-t"><b>Tous les tests</b></span><span class="tiny muted">pour ajouter une mesure</span></summary>
        ${Object.entries(groups).map(([k, list]) => `<h4>${esc(GOAL_GROUPS[k] || k)}</h4>
          <ul class="prg-links">${list.map((b) => `<li><a class="prg-link" href="#/progres/${esc(encodeURIComponent(b.id))}"><span>${esc(b.name)}</span><span aria-hidden="true">›</span></a></li>`).join('')}</ul>`).join('')}
      </details>` : ''}
      <p class="tiny muted center mt">Repères d'entraînement, pas un avis médical. Les seuils officiels peuvent changer : vérifie auprès de ton organisme.</p>`;
  }

  /* ───────── #/progres/:benchId ───────── */

  function valueInputHTML(b, id, value) {
    if (b.unit === 'time') {
      return C.ui.timeInput({ id, name: 'value', value, label: 'Valeur (minutes:secondes)', required: true, cls: 'prg-in' });
    }
    const mode = b.unit === 'reps' ? 'numeric' : 'decimal';
    const v = value != null ? U.fmtNum(value, b.unit === 'reps' ? 0 : 2) : '';
    const sign = b.unit === 'cm' ? `<button type="button" class="icon-btn small" data-action="progres.signe" data-for="${esc(id)}" aria-label="Changer le signe (valeur négative)">±</button>` : '';
    return `<span class="row gap"><input type="text" id="${esc(id)}" name="value" class="prg-in" inputmode="${mode}" autocomplete="off" enterkeyhint="done"
      value="${esc(v)}" required aria-label="Valeur en ${esc(UNIT_HINT[b.unit] || 'unités')}" placeholder="${esc(UNIT_HINT[b.unit] || '')}">${sign}</span>`;
  }

  function readValue(b, raw) {
    if (b.unit === 'time') { const v = U.parseDuration(raw); return v != null && v > 0 ? v : null; }
    const v = U.num(String(raw || '').replace('−', '-'));
    if (v == null) return null;
    if (b.unit !== 'cm' && v < 0) return null;
    return b.unit === 'reps' ? Math.round(v) : v;
  }

  function summaryHTML(b, ref) {
    const best = call('benchBest', b.id);
    const last = call('benchLast', b.id);
    const trend = call('benchTrend', b.id);
    const tb = trendBits(b, trend);
    const off = ref && ref.official;
    const tgt = ref && ref.target;
    const st = statusFor(b, best ? best.value : null, ref);
    const pill = best ? STATUS_PILL[st && st.level] : null;
    const gapRef = tgt ? tgt.value : off ? off.value : null;
    const gap = gapText(b, best ? best.value : last ? last.value : null, gapRef);
    const conf = off && off.confidence && off.confidence !== 'élevée' && !/confirm|vérifi/i.test(off.label || '');
    let proj = '';
    if (gapRef != null) {
      const p = call('benchProjection', b.id, gapRef);
      const g = goalForBench(b);
      if (p && p.date) {
        const vs = g && U.isKey(g.date) ? (p.date <= g.date ? ` C'est avant la date de ton objectif (${U.fmtLong(g.date)}).` : ` C'est après la date de ton objectif (${U.fmtLong(g.date)}) : il faudra accélérer un peu ou garder de la marge.`) : '';
        proj = `<p class="note small prg-proj"><b>Projection :</b> à ce rythme, ${esc(tgt ? 'cible' : 'seuil')} atteint${tgt ? 'e' : ''} vers ${esc(U.fmtMonthYear(p.date))}.${esc(vs)}
          <span class="tiny muted">Calcul prudent sur ${esc(p.n)} mesures des 90 derniers jours, en supposant une progression un peu plus lente qu'aujourd'hui. La progression ralentit souvent près du but : ce n'est pas une promesse.</span></p>`;
      } else if (p && p.beyond) {
        proj = '<p class="note warn small prg-proj"><b>Projection :</b> au rythme actuel, il faudrait plus de 2 ans. Parles-en avec ton club ou ajuste ton entraînement.</p>';
      }
    }
    const assumed = ref && Array.isArray(ref.assumed) && ref.assumed.length
      ? `<p class="tiny muted">Catégorie supposée (${esc(ref.assumed.join(', '))}) : complète ton profil dans les <a class="link" href="#/reglages">réglages</a>.</p>` : '';
    return `<section class="card prg-sum">
      <div class="prg-b-vals">
        <div class="prg-b-best"><span class="tiny muted">Meilleur test</span><b class="num prg-big">${esc(best ? fmtVal(b, best.value) : '—')}</b>
          <span class="tiny muted">${best ? esc(`${U.fmtShort(best.date)}${best.context === 'officiel' ? ' · officiel' : ''}`) : 'pas encore de test'}</span></div>
        <div class="prg-b-last"><span class="tiny muted">Dernier</span><b class="num">${esc(last ? fmtVal(b, last.value) : '—')}</b>
          <span class="tiny muted">${last ? esc(`${U.fmtShort(last.date)} · ${CONTEXT_SMALL[last.context] || ''}`) : '&nbsp;'}</span>
          ${tb ? `<span class="prg-trend ${esc(tb.cls)}" role="img" aria-label="${esc(tb.aria)}"><span aria-hidden="true">${esc(tb.arrow)} ${esc(tb.txt)}</span></span>` : '<span class="tiny muted">Tendance dès 3 mesures en 90 jours</span>'}</div>
      </div>
      ${pill || gap ? `<p class="prg-status">${pill ? `<span class="pill ${pill[0]}">${esc(pill[1])}</span> ` : ''}${gap ? `<span class="small">${esc(gap)}</span>` : ''}</p>` : ''}
      ${off || tgt ? `<dl class="prg-refs">
        ${off ? `<div><dt>Seuil officiel</dt><dd><b class="num">${esc(fmtVal(b, off.value))}</b>${conf ? ' <span class="pill warn">à confirmer</span>' : ''}<span class="tiny muted">${esc(off.label || '')}</span></dd></div>` : ''}
        ${tgt ? `<div><dt>${tgt.indicative ? 'Repère' : 'Ta cible'}</dt><dd><b class="num">${esc(fmtVal(b, tgt.value))}</b><span class="tiny muted">${esc(tgt.label || '')}</span></dd></div>` : ''}
      </dl>` : '<p class="tiny muted">Pas de seuil officiel connu : suis ta progression.</p>'}
      ${assumed}
      ${off && off.source ? `<p class="tiny"><a class="link" href="${esc(off.source)}" target="_blank" rel="noopener noreferrer">Source du seuil</a>${off.confidence ? ` <span class="muted">(fiabilité : ${esc(off.confidence)})</span>` : ''}</p>` : ''}
      ${proj}
    </section>`;
  }

  function chartHTML(b, ref) {
    const M = C.metrics;
    const tests = call('benchEntries', b.id, { contexts: M.BEST_CONTEXTS }) || [];
    const all = call('benchEntries', b.id, { contexts: M.LAST_CONTEXTS }) || [];
    const mode = chartMode[b.id] || (tests.length >= 2 || all.length < 2 ? 'tests' : 'tout');
    const list = mode === 'tests' ? tests : all;
    const color = (C.ui.GOALS[b.goal] || C.ui.GOALS.general).color;
    const target = ref && ref.target ? ref.target.value : ref && ref.official ? ref.official.value : null;
    const first = list[0];
    const pts = first ? list.map((e) => ({ x: U.daysBetween(first.date, e.date), y: e.value })) : [];
    const ys = pts.map((p) => p.y);
    const toggle = `<div class="prg-toggle" role="group" aria-label="Mesures affichées">
      <button type="button" class="prg-tg" data-action="progres.vue" data-bench="${esc(b.id)}" data-mode="tests" aria-pressed="${mode === 'tests'}">Tests seulement (${esc(tests.length)})</button>
      <button type="button" class="prg-tg" data-action="progres.vue" data-bench="${esc(b.id)}" data-mode="tout" aria-pressed="${mode === 'tout'}">Tout (${esc(all.length)})</button></div>`;
    const chart = pts.length >= 2
      ? `<div class="prg-chart" style="--c:${color}">${C.ui.sparkline(pts, { trend: pts.length >= 3, target, height: 140, label: `Évolution : ${b.name}` })}</div>
        <div class="prg-axis tiny muted"><span>${esc(U.fmtShort(first.date))}</span><span>${esc(`min ${fmtVal(b, Math.min(...ys))} · max ${fmtVal(b, Math.max(...ys))}`)}</span><span>${esc(U.fmtShort(list[list.length - 1].date))}</span></div>
        <p class="tiny muted">${b.lower ? 'Plus bas = mieux.' : 'Plus haut = mieux.'}${pts.length >= 3 ? ' Pointillés fins : tendance.' : ''}${target != null ? ' Tirets : cible.' : ''}</p>`
      : `<p class="muted small">${list.length ? 'Une seule mesure pour l\'instant : la courbe apparaîtra à la deuxième.' : 'Aucune mesure dans cette vue.'}</p>`;
    return `<section class="card"><div class="card-head"><h2>Évolution</h2></div>${toggle}${chart}</section>`;
  }

  function addFormHTML(b) {
    const today = U.todayKey();
    return `<form class="card prg-add" data-form="progres.ajouter" data-bench="${esc(b.id)}" novalidate>
      <h2>Ajouter une mesure</h2>
      <div class="prg-add-grid">
        <label class="field"><span>Date</span><input type="date" name="date" value="${esc(today)}" max="${esc(today)}" required></label>
        <div class="field"><label for="prg-add-v">${esc(b.unit === 'time' ? 'Temps' : `Valeur (${UNIT_HINT[b.unit] || 'nombre'})`)}</label>${valueInputHTML(b, 'prg-add-v', null)}</div>
      </div>
      ${b.unit === 'time' ? '<p class="tiny muted prg-hint">Tape seulement les chiffres : 345 donne 3:45, 10230 donne 1:02:30.</p>' : ''}
      <div class="field"><span>Contexte</span>${C.ui.segmented('context', [
        { value: 'test', label: 'Test' }, { value: 'entrainement', label: 'Entraînement' }, { value: 'officiel', label: 'Officiel' }], 'test')}</div>
      <label class="field"><span>Note (facultatif)</span><input type="text" name="note" maxlength="300" autocomplete="off" placeholder="${esc(b.unit === 'time' && b.cat !== 'course' ? 'Bassin de 25 m, départ dans l\'eau…' : 'Conditions, ressenti…')}"></label>
      <div class="row gap wrap"><button type="submit" class="btn grow">Enregistrer</button>${b.unit === 'time' ? '<a class="btn ghost" href="#/chrono">⏱ Chrono</a>' : ''}</div>
    </form>`;
  }

  function historyHTML(b) {
    const list = (call('benchEntries', b.id) || []).slice().reverse();
    if (!list.length) return '';
    const sessions = (C.state && C.state.sessions) || {};
    return `<section class="card"><div class="card-head"><h2>Historique</h2><span class="tiny muted">${esc(U.plural(list.length, 'mesure', 'mesures'))}</span></div>
      <ul class="prg-hist">${list.map((e) => {
        const sid = String(e.source || '').startsWith('seance:') ? e.source.slice(7) : null;
        const ses = sid ? sessions[sid] : null;
        return `<li class="prg-h-row">
          <button type="button" class="prg-h-btn" data-action="progres.modifier" data-bench="${esc(b.id)}" data-id="${esc(e.id)}" aria-label="Modifier la mesure du ${esc(U.fmtDate(e.date))}">
            <span class="prg-h-main"><span class="small">${esc(U.fmtDate(e.date))}</span><b class="num">${esc(fmtVal(b, e.value))}</b></span>
            <span class="prg-h-meta"><span class="pill prg-ctx-${esc(e.context)}">${esc(CONTEXT_LABELS[e.context] || e.context)}</span>${e.note ? `<span class="tiny muted">${esc(e.note)}</span>` : ''}</span>
          </button>
          ${ses ? `<a class="link tiny prg-h-ses" href="#/seance/${esc(encodeURIComponent(sid))}">Séance : ${esc(ses.title || 'voir')}</a>` : ''}
        </li>`;
      }).join('')}</ul>
      ${list.some((e) => e.context === 'ancien') ? '<p class="tiny muted">« Ancien format » : mesures de la v1, gardées pour mémoire mais non comparables (ni meilleur, ni tendance).</p>' : ''}
    </section>`;
  }

  function viewBench(params) {
    const b = getBench(params.benchId);
    if (!b) {
      return `<header class="top"><a class="back prg-back" href="#/progres">‹ Progrès</a><h1>Test introuvable</h1></header>
        ${C.ui.empty('Ce test n\'existe pas.', '', '<a class="btn" href="#/progres">Retour</a>')}`;
    }
    if (!C.metrics) return `<header class="top"><a class="back prg-back" href="#/progres">‹ Progrès</a><h1>${esc(b.name)}</h1></header>${C.ui.empty('Statistiques indisponibles', '')}`;
    const ref = refFor(b);
    const tags = C.ui.goalTags((b.goals || [b.goal]).filter((g) => C.ui.GOALS[g]));
    return `<header class="top"><a class="back prg-back" href="#/progres">‹ Progrès</a><h1>${esc(b.name)}</h1>
        <div class="row gap wrap">${tags}${b.archived ? '<span class="pill">archivé</span>' : ''}</div></header>
      ${summaryHTML(b, ref)}
      ${chartHTML(b, ref)}
      ${b.archived ? '' : addFormHTML(b)}
      ${historyHTML(b)}
      ${b.protocol ? `<details class="card prg-proto"><summary><b>Comment faire le test</b></summary><p class="small">${esc(b.protocol)}</p>
        ${b.safety ? '<p class="note warn small">Apnée : jamais seul (binôme, club ou MNS qui te regarde), pas d\'hyperventilation, arrêt au moindre signe.</p>' : ''}</details>` : ''}`;
  }

  /* ───────── Modale de modification ───────── */

  function openEdit(benchId, entryId) {
    const b = getBench(benchId);
    const e = (call('benchEntries', benchId) || []).find((x) => x.id === entryId);
    if (!b || !e) return;
    const today = U.todayKey();
    const ses = String(e.source || '').startsWith('seance:');
    const ctxOptions = ['test', 'entrainement', 'officiel', 'sante', 'ancien'];
    C.ui.openModal({
      title: 'Modifier la mesure',
      body: `<form data-form="progres.maj" data-bench="${esc(b.id)}" data-id="${esc(e.id)}" novalidate>
        <label class="field"><span>Date</span><input type="date" name="date" value="${esc(e.date)}" max="${esc(today)}" required></label>
        <div class="field"><label for="prg-edit-v">${esc(b.unit === 'time' ? 'Temps' : 'Valeur')}</label>${valueInputHTML(b, 'prg-edit-v', e.value)}</div>
        <label class="field"><span>Contexte</span><select name="context">${ctxOptions.map((c) => `<option value="${esc(c)}" ${c === e.context ? 'selected' : ''}>${esc(CONTEXT_LABELS[c])}</option>`).join('')}</select></label>
        <label class="field"><span>Note</span><input type="text" name="note" maxlength="300" value="${esc(e.note || '')}" autocomplete="off"></label>
        ${ses ? '<p class="tiny muted">Mesure venant d\'une séance : si tu modifies puis réenregistres la séance, elle sera recalculée.</p>' : ''}
        <div class="row gap wrap mt"><button type="submit" class="btn grow">Enregistrer</button>
          <button type="button" class="btn ghost danger" data-action="progres.supprimer" data-bench="${esc(b.id)}" data-id="${esc(e.id)}">Supprimer</button></div>
      </form>`,
    });
  }

  /* ───────── Enregistrement ───────── */

  function register() {
    C.route('#/progres', viewProgress, { tab: '#/plus', title: 'Progrès' });
    C.route('#/progres/:benchId', viewBench, { tab: '#/plus', title: 'Progrès' });
    C.menuItem({ hash: '#/progres', icon: '📈', label: 'Progrès', desc: 'Tests, charge, régularité', order: 1 });

    C.action('progres.vue', (el) => {
      chartMode[el.dataset.bench] = el.dataset.mode === 'tout' ? 'tout' : 'tests';
      C.rerender();
    });

    C.action('progres.signe', (el) => {
      const input = document.getElementById(el.dataset.for);
      if (!input) return;
      const v = String(input.value || '').trim();
      input.value = v.startsWith('-') || v.startsWith('−') ? v.slice(1) : `-${v}`;
      input.focus();
    });

    C.onSubmit('progres.ajouter', (form, fd) => {
      const b = getBench(form.dataset.bench);
      if (!b || !mfn('addBench')) return;
      const value = readValue(b, fd.get('value'));
      if (value == null) { C.ui.toast(b.unit === 'time' ? 'Temps illisible : tape par exemple 345 pour 3:45' : 'Valeur illisible'); return; }
      const date = U.isKey(fd.get('date')) && fd.get('date') <= U.todayKey() ? fd.get('date') : U.todayKey();
      const context = ['test', 'entrainement', 'officiel'].includes(fd.get('context')) ? fd.get('context') : 'test';
      const before = call('benchBest', b.id);
      C.metrics.addBench(b.id, { date, value, context, source: 'manuel:' + U.uid(), note: String(fd.get('note') || '').trim() });
      const isRecord = context !== 'entrainement' && (!before || (b.lower ? value < before.value : value > before.value));
      C.ui.toast(isRecord && before ? `🎉 Nouveau meilleur : ${fmtVal(b, value)}` : 'Mesure enregistrée');
    });

    C.action('progres.modifier', (el) => openEdit(el.dataset.bench, el.dataset.id));

    C.onSubmit('progres.maj', (form, fd) => {
      const b = getBench(form.dataset.bench);
      if (!b || !mfn('updateBench')) return;
      const value = readValue(b, fd.get('value'));
      if (value == null) { C.ui.toast('Valeur illisible'); return; }
      const date = U.isKey(fd.get('date')) && fd.get('date') <= U.todayKey() ? fd.get('date') : null;
      const patch = { value, context: fd.get('context'), note: String(fd.get('note') || '').trim() };
      if (date) patch.date = date;
      C.ui.closeModal();
      C.metrics.updateBench(b.id, form.dataset.id, patch);
      C.ui.toast('Mesure modifiée');
    });

    C.action('progres.supprimer', async (el) => {
      const { bench, id } = el.dataset;
      C.ui.closeModal();
      if (!(await C.ui.ask('Supprimer cette mesure ?', 'Supprimer', { danger: true }))) return;
      if (mfn('removeBench')) C.metrics.removeBench(bench, id);
      C.ui.toast('Mesure supprimée');
    });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.progressUI = {
    viewProgress, viewBench,
    _t: { fmtVal, fmtGap, gapText, trendBits, benchesForGoal, readValue, loadJump },
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
