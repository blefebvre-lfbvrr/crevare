/* Crevare — habitudes (#/habitudes), poids et alimentation (#/corps), check-in du matin.
 * Widgets pour « Aujourd'hui » : C.habitsUI.todayCard(date), C.bodyUI.todayCard(date), C.bodyUI.checkinCard(date).
 * Habitudes : à faire (tous les jours ou x fois par semaine), chiffrées (cible + unité), à éviter (on note les écarts,
 * on compte les jours sans). Série tolérante et taux : C.metrics. Corps : pas de calcul calorique, pas de jugement. */
(function (C) {
  'use strict';
  const U = C.util;
  const esc = U.esc;

  /* ───────── Accès défensifs ───────── */

  const mfn = (name) => (C.metrics && typeof C.metrics[name] === 'function' ? C.metrics[name] : null);
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.error(e); return fallback; }
  }
  const call = (name, ...args) => { const f = mfn(name); return f ? safe(() => f(...args), null) : null; };
  const st = () => C.state || {};
  const habitsAll = () => (Array.isArray(st().habits) ? st().habits : []);
  const habitById = (id) => habitsAll().find((h) => h && h.id === id) || null;

  const FOOD = {
    peu: { label: 'Peu', icon: '🥄' },
    normal: { label: 'Normal', icon: '🍽️' },
    beaucoup: { label: 'Beaucoup', icon: '🍲' },
  };
  const ZONE_LABELS = { genou: 'Genou', cheville: 'Cheville', epaule: 'Épaule', dos: 'Dos', hanche: 'Hanche', poignet: 'Poignet', coude: 'Coude', nuque: 'Nuque', autre: 'Autre zone' };
  const SCALES = [
    { f: 'sleep', label: 'Sommeil', low: 'très mauvais', high: 'très bon' },
    { f: 'energy', label: 'Énergie', low: 'à plat', high: 'au top' },
    { f: 'soreness', label: 'Courbatures', low: 'aucune', high: 'très fortes' },
  ];
  const READY = {
    vert: { title: 'Feu vert', cls: 'is-vert' },
    orange: { title: 'Feu orange', cls: 'is-orange' },
    rouge: { title: 'Feu rouge', cls: 'is-rouge' },
  };
  const SUGGESTION = {
    normal: 'Séance prévue, normalement.',
    allege: 'Version allégée conseillée (environ un tiers de volume en moins).',
    doux: 'Version douce conseillée : sans sauts, et sans course si ça tire.',
    repos: 'Repos ou mobilité douce aujourd\'hui.',
  };
  const EMOJIS = ['💧', '😴', '🦵', '🧘', '🍎', '📚', '🚭', '🍺', '🏊', '🥩'];
  const MILESTONE = 66;

  // État d'affichage gardé le temps de la visite.
  const ciEditing = new Set(); // dates dont le check-in est ouvert (en cours de saisie ou rouvert)
  let bodyRange = 90;

  /* ───────── Fonctions pures ───────── */

  // Découpe en caractères visibles (un emoji composé = un seul caractère).
  function graphemes(s) {
    const str = String(s || '');
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        return Array.from(new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(str), (x) => x.segment);
      }
    } catch (e) { /* repli ci-dessous */ }
    return graphemesFallback(str);
  }
  // Repli sans Intl.Segmenter : regroupe ZWJ, sélecteurs de variante, teintes de peau, tags, keycaps et drapeaux.
  function graphemesFallback(str) {
    const out = [];
    const isRI = (cp) => cp >= 0x1F1E6 && cp <= 0x1F1FF;
    for (const ch of Array.from(String(str || ''))) {
      const cp = ch.codePointAt(0);
      const prev = out.length ? out[out.length - 1] : null;
      const prevCps = prev ? Array.from(prev) : [];
      const glue = prev && (
        cp === 0x200D || cp === 0xFE0F || cp === 0xFE0E || cp === 0x20E3
        || (cp >= 0x1F3FB && cp <= 0x1F3FF) || (cp >= 0xE0020 && cp <= 0xE007F) || (cp >= 0x0300 && cp <= 0x036F)
        || prev.endsWith('‍')
        || (isRI(cp) && prevCps.length === 1 && isRI(prevCps[0].codePointAt(0))));
      if (glue) out[out.length - 1] += ch; else out.push(ch);
    }
    return out;
  }
  // Icône : jusqu'à 8 caractères visibles, sans couper un emoji composé, et ≤ 16 unités (limite du stockage).
  function clipIcon(raw, maxChars = 8, maxUnits = 16) {
    let out = '';
    for (const g of graphemes(String(raw || '').trim()).slice(0, maxChars)) {
      if ((out + g).length > maxUnits) break;
      out += g;
    }
    return out.trim();
  }

  // Pas du +/− d'une habitude chiffrée : ~1/6 de la cible, arrondi à 1, 2, 2,5 ou 5 × 10^n (1,5 L → 0,25).
  function stepFor(h) {
    const t = U.num(h && h.target);
    if (!t || t <= 0) return 1;
    const raw = t / 6;
    const p = 10 ** Math.floor(Math.log10(raw));
    let best = p;
    for (const m of [1, 2, 2.5, 5]) if (m * p <= raw + 1e-9) best = m * p;
    return best;
  }
  const fmtQty = (n) => U.fmtNum(n, 2);

  // Valeurs du formulaire → { habit } ou { error }.
  function habitFromForm(v, prev, today) {
    const t = today || U.todayKey();
    const name = String(v.name || '').trim().slice(0, 80);
    if (!name) return { error: 'Donne un nom à ton habitude.' };
    const type = ['check', 'number', 'avoid'].includes(v.type) ? v.type : 'check';
    const created = U.isKey(v.createdAt) && v.createdAt <= t ? v.createdAt : prev && U.isKey(prev.createdAt) ? prev.createdAt : t;
    const h = {
      id: prev ? prev.id : U.uid(), name, icon: clipIcon(v.icon) || '✓', type, target: null, unit: '', perWeek: null,
      cue: String(v.cue || '').trim().replace(/^après\s+/i, '').slice(0, 200), createdAt: created, archivedAt: prev ? prev.archivedAt || null : null,
    };
    if (type === 'number') {
      const target = U.num(v.target);
      if (target == null || target <= 0) return { error: 'Indique une cible, par exemple 1,5.' };
      h.target = U.round(target, 2);
      h.unit = String(v.unit || '').trim().slice(0, 12);
    }
    if (type !== 'avoid' && v.freq === 'week') {
      const n = Math.round(U.num(v.perWeek));
      if (!(n >= 1 && n <= 6)) return { error: 'Choisis entre 1 et 6 fois par semaine.' };
      h.perWeek = n;
    }
    return { habit: h };
  }

  const isWeekly = (h) => h.type !== 'avoid' && U.num(h.perWeek) >= 1 && U.num(h.perWeek) < 7;
  function kindText(h) {
    if (h.type === 'avoid') return 'À éviter · on compte les jours sans';
    const freq = isWeekly(h) ? `${h.perWeek} fois par semaine` : 'Tous les jours';
    if (h.type === 'number') return `${freq} · objectif ${fmtQty(h.target)}${h.unit ? ' ' + h.unit : ''}`;
    return freq;
  }
  // Classe de l'icône : plus petite quand elle fait plusieurs caractères.
  const iconCls = (h) => (graphemes(h.icon || '✓').length > 1 ? 'hab-ico is-long' : 'hab-ico');
  const cueText = (h) => (h.cue ? `Après ${String(h.cue).replace(/^après\s+/i, '')}` : '');

  // 4 semaines complètes (lundi → dimanche), la dernière contenant aujourd'hui.
  function gridDays(today) {
    const start = U.addDays(U.mondayOf(today), -21);
    return U.range(start, U.addDays(start, 27));
  }
  const isSlip = (v) => v === true || (typeof v === 'number' && v > 0);
  function habitValue(h, date) {
    const day = U.isObj(st().habitLog) ? st().habitLog[date] : null;
    return U.isObj(day) ? day[h.id] : undefined;
  }
  function habitDone(h, date) {
    const f = mfn('habitDone');
    if (f) return f(h, date);
    const v = habitValue(h, date);
    return h.type === 'avoid' ? !isSlip(v) : h.type === 'number' ? (U.num(v) || 0) >= (U.num(h.target) || 1e-9) : isSlip(v);
  }
  // État d'une case de la grille.
  function cellState(h, date, today) {
    if (date > today) return 'futur';
    if (U.isKey(h.createdAt) && date < h.createdAt) return 'avant';
    const v = habitValue(h, date);
    if (h.type === 'avoid') return isSlip(v) ? 'ecart' : 'ok';
    if (habitDone(h, date)) return 'ok';
    if (h.type === 'number' && U.num(v) > 0) return 'partiel';
    if (date === today) return 'attente';
    return isWeekly(h) ? 'vide' : 'manque';
  }
  function cellLabel(h, state, date) {
    switch (state) {
      case 'ok': return h.type === 'avoid' ? 'jour sans' : 'fait';
      case 'ecart': return 'écart noté';
      case 'partiel': return `en partie (${fmtQty(U.num(habitValue(h, date)))}${h.unit ? ' ' + h.unit : ''})`;
      case 'attente': return 'pas encore fait';
      case 'manque': return 'pas fait';
      case 'vide': return 'pas fait';
      case 'avant': return 'avant la création';
      default: return 'à venir';
    }
  }

  // Écrit une valeur dans le journal (valeur vide → entrée retirée).
  function setLog(s, date, id, value) {
    if (!U.isObj(s.habitLog)) s.habitLog = {};
    const day = U.isObj(s.habitLog[date]) ? s.habitLog[date] : (s.habitLog[date] = {});
    if (value == null || value === false || value === 0) delete day[id]; else day[id] = value;
    if (!Object.keys(day).length) delete s.habitLog[date];
  }

  // Poids saisi (virgule acceptée) → nombre plausible ou null.
  function parseWeight(raw) {
    const n = U.num(String(raw == null ? '' : raw).replace(/\s*kg$/i, ''));
    return n != null && n > 20 && n < 400 ? U.round(n, 2) : null;
  }
  function foodCounts(days) {
    const body = U.isObj(st().body) ? st().body : {};
    const out = { peu: 0, normal: 0, beaucoup: 0, vide: 0 };
    for (const d of days) { const f = U.isObj(body[d]) ? body[d].food : null; out[FOOD[f] ? f : 'vide']++; }
    return out;
  }
  // Zones de douleur suivies : blessures actives du profil (une ligne par zone).
  function painZones(profile) {
    const seen = new Map();
    for (const i of (profile && Array.isArray(profile.injuries) ? profile.injuries : [])) {
      if (!i || i.active === false || !i.zone || seen.has(i.zone)) continue;
      seen.set(i.zone, `${ZONE_LABELS[i.zone] || i.zone}${i.side ? ' ' + i.side : ''}`);
    }
    return [...seen].map(([zone, label]) => ({ zone, label }));
  }
  const fmtKg = (v) => `${U.fmtNum(v, 1)} kg`;

  /* ───────── Habitudes : contrôles ───────── */

  function controlHTML(h, date, compact) {
    const v = habitValue(h, date);
    const name = h.name;
    if (h.type === 'number') {
      const n = U.num(v) || 0;
      const t = U.num(h.target);
      const step = stepFor(h);
      const done = t ? n >= t - 1e-9 : n > 0;
      const unit = h.unit ? ' ' + h.unit : '';
      return `<div class="hab-num ${done ? 'is-done' : ''} ${compact ? 'is-compact' : ''}">
        <button type="button" class="hab-pm" data-action="habit.moins" data-id="${esc(h.id)}" data-date="${esc(date)}" aria-label="${esc(`${name} : retirer ${fmtQty(step)}${unit}`)}" ${n <= 0 ? 'disabled' : ''}>−</button>
        <span class="hab-num-v num">${esc(fmtQty(n))}${t ? `<span class="muted"> / ${esc(fmtQty(t))}</span>` : ''}${esc(unit)}</span>
        <button type="button" class="hab-pm" data-action="habit.plus" data-id="${esc(h.id)}" data-date="${esc(date)}" aria-label="${esc(`${name} : ajouter ${fmtQty(step)}${unit}`)}">+</button></div>`;
    }
    if (h.type === 'avoid') {
      const slip = isSlip(v);
      return `<button type="button" class="hab-avoid ${slip ? 'is-slip' : ''} ${compact ? 'is-compact' : ''}" data-action="habit.ecart" data-id="${esc(h.id)}" data-date="${esc(date)}"
        aria-pressed="${slip}" aria-label="${esc(`${name} : ${slip ? 'écart noté, toucher pour annuler' : 'jour sans, toucher pour noter un écart'}`)}">
        ${slip ? 'Écart noté' : '✓ Jour sans'}<small>${slip ? 'annuler' : 'noter un écart'}</small></button>`;
    }
    const done = habitDone(h, date);
    return `<button type="button" class="hab-tick ${done ? 'is-done' : ''} ${compact ? 'is-compact' : ''}" data-action="habit.cocher" data-id="${esc(h.id)}" data-date="${esc(date)}"
      aria-pressed="${done}" aria-label="${esc(`${name} : ${done ? 'fait' : 'à faire'}`)}">${compact ? '<span aria-hidden="true">✓</span>' : done ? '✓ Fait' : 'Je l\'ai fait'}</button>`;
  }

  function streakText(h, info) {
    if (!info) return '';
    const parts = [];
    if (info.streak) parts.push(`🔥 ${info.streak} ${info.weekly ? 'sem.' : 'j'}`);
    if (info.weekly && info.weekNeed) parts.push(`${info.weekDone}/${info.weekNeed} cette semaine`);
    return parts.join(' · ');
  }

  /* ───────── Habitudes : widget « Aujourd'hui » ───────── */

  function habitsTodayCard(date) {
    const d = U.isKey(date) ? date : U.todayKey();
    const list = habitsAll().filter((h) => h && !h.archivedAt && (!U.isKey(h.createdAt) || h.createdAt <= d));
    if (!list.length) {
      return `<section class="card hab-today"><div class="card-head"><h2>Habitudes</h2><a class="link" href="#/habitudes">Gérer</a></div>
        <p class="muted small">Aucune habitude suivie. <a class="link" href="#/habitudes">En ajouter une</a></p></section>`;
    }
    const done = list.filter((h) => habitDone(h, d)).length;
    return `<section class="card hab-today" aria-labelledby="hab-today-t-${esc(d)}">
      <div class="card-head"><h2 id="hab-today-t-${esc(d)}">Habitudes</h2><span class="row gap"><span class="tiny muted num">${esc(done)}/${esc(list.length)}</span><a class="link" href="#/habitudes">Tout voir</a></span></div>
      <ul class="hab-rows">${list.map((h) => {
        const info = call('habitInfo', h.id);
        const sub = [streakText(h, info), cueText(h)].filter(Boolean).join(' · ');
        return `<li class="hab-row">
          <span class="${iconCls(h)}" aria-hidden="true">${esc(h.icon || '✓')}</span>
          <span class="hab-row-t"><b>${esc(h.name)}</b>${sub ? `<small class="muted">${esc(sub)}</small>` : ''}</span>
          ${controlHTML(h, d, true)}</li>`;
      }).join('')}</ul></section>`;
  }

  /* ───────── #/habitudes ───────── */

  function gridHTML(h, today) {
    const days = gridDays(today);
    return `<div class="hab-grid" role="group" aria-label="${esc(`4 dernières semaines : ${h.name}`)}">
      ${U.DAYS_SHORT.map((x) => `<span class="hab-dow" aria-hidden="true">${esc(x)}</span>`).join('')}
      ${days.map((d) => {
        const s = cellState(h, d, today);
        const off = s === 'futur' || s === 'avant';
        return `<button type="button" class="hab-cell is-${esc(s)} ${d === today ? 'is-today' : ''}" data-action="habit.case" data-id="${esc(h.id)}" data-date="${esc(d)}"
          ${off ? 'disabled' : ''} aria-label="${esc(`${U.fmtDate(d)} : ${cellLabel(h, s, d)}`)}"><span>${esc(U.parseKey(d).getDate())}</span></button>`;
      }).join('')}</div>`;
  }

  function habitCardHTML(h, today) {
    const info = call('habitInfo', h.id) || {};
    const rate = info.rateAll;
    const total = info.total || 0;
    const pct = Math.min(100, Math.round((total / MILESTONE) * 100));
    const reached = total >= MILESTONE;
    return `<article class="card hab-card" id="hab-${esc(h.id)}">
      <div class="hab-head">
        <span class="${iconCls(h)} hab-ico-big" aria-hidden="true">${esc(h.icon || '✓')}</span>
        <div class="grow"><h3 class="hab-name">${esc(h.name)}</h3><p class="tiny muted">${esc(kindText(h))}</p>
          ${h.cue ? `<p class="small hab-cue"><span aria-hidden="true">↪</span> ${esc(cueText(h))}</p>` : ''}</div>
        <button type="button" class="icon-btn" data-action="habit.modifier" data-id="${esc(h.id)}" aria-label="${esc(`Modifier « ${h.name} »`)}">✎</button>
      </div>
      <div class="hab-ctl">${controlHTML(h, today, false)}</div>
      <div class="hab-stats">
        <div><b class="num">${esc(info.streak || 0)}</b><span class="tiny muted">${esc(info.weekly ? 'semaines de série' : h.type === 'avoid' ? 'jours sans (série)' : 'jours de série')}</span></div>
        <div><b class="num">${rate == null ? '—' : esc(rate + ' %')}</b><span class="tiny muted">réussite depuis le ${esc(U.fmtShort(h.createdAt || today))}</span></div>
        ${info.weekly ? `<div><b class="num">${esc(info.weekDone)}/${esc(info.weekNeed)}</b><span class="tiny muted">cette semaine</span></div>` : ''}
      </div>
      <div class="hab-ms" aria-label="${esc(`Jalon de 66 jours : ${Math.min(total, MILESTONE)} sur 66`)}">
        <div class="hab-ms-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
        <span class="tiny ${reached ? 'ok-text' : 'muted'}">${reached ? '🎉 66 jours réussis : en moyenne, c\'est le temps qu\'il faut pour qu\'une habitude devienne automatique.' : esc(`Jalon 66 jours : ${total}/66`)}</span>
      </div>
      ${gridHTML(h, today)}
    </article>`;
  }

  function viewHabits() {
    const today = U.todayKey();
    const active = habitsAll().filter((h) => h && !h.archivedAt);
    const archived = habitsAll().filter((h) => h && h.archivedAt);
    const recent = active.filter((h) => U.isKey(h.createdAt) && U.daysBetween(h.createdAt, today) < 30).length;
    return `<header class="top"><h1>Habitudes</h1>
        <p class="muted small">Un jour manqué ne casse pas ta série. Deux de suite, oui.</p></header>
      <button type="button" class="btn block" data-action="habit.nouvelle">+ Nouvelle habitude</button>
      ${recent > 3 ? '<p class="note small mt">Conseil : pas plus de 3 nouvelles habitudes à la fois. Mieux vaut en tenir peu que tout lâcher.</p>' : ''}
      ${active.length ? active.map((h) => habitCardHTML(h, today)).join('')
        : `<div class="card">${C.ui.empty('Aucune habitude', 'Commence petit : une seule habitude, liée à un moment précis de ta journée.')}</div>`}
      <p class="tiny muted">Touche une case pour corriger un jour. ${active.some((h) => h.type === 'avoid') ? 'Habitudes à éviter : chaque jour sans écart noté compte comme réussi.' : ''}</p>
      ${archived.length ? `<details class="card hab-arch"><summary><b>Archivées (${esc(archived.length)})</b></summary>
        <ul class="hab-arch-list">${archived.map((h) => `<li class="row gap between">
          <span class="row gap grow"><span aria-hidden="true">${esc(h.icon || '✓')}</span><span class="grow">${esc(h.name)}<small class="muted tiny"> · archivée le ${esc(U.fmtShort(h.archivedAt))}</small></span></span>
          <span class="row gap"><button type="button" class="btn ghost small" data-action="habit.reactiver" data-id="${esc(h.id)}">Réactiver</button>
          <button type="button" class="icon-btn" data-action="habit.supprimer" data-id="${esc(h.id)}" aria-label="${esc(`Supprimer « ${h.name} »`)}">🗑</button></span></li>`).join('')}</ul>
      </details>` : ''}`;
  }

  /* ───────── Formulaires (modales) ───────── */

  function openHabitForm(h) {
    const today = U.todayKey();
    const type = h ? h.type : 'check';
    const weekly = h ? isWeekly(h) : false;
    const per = h && h.perWeek ? h.perWeek : 3;
    C.ui.openModal({
      title: h ? 'Modifier l\'habitude' : 'Nouvelle habitude',
      body: `<form class="hab-form" data-form="habit.enregistrer" data-id="${esc(h ? h.id : '')}" novalidate>
        <label class="field"><span>Nom</span><input type="text" name="name" maxlength="80" required autocomplete="off" value="${esc(h ? h.name : '')}" placeholder="Ex. 10 min de mobilité"></label>
        <div class="field"><label for="hab-f-icon">Icône (un emoji, ou quelques caractères)</label>
          <div class="row gap hab-icon-row"><input type="text" id="hab-f-icon" name="icon" class="hab-icon-in" maxlength="40" autocomplete="off" value="${esc(h ? h.icon : '✓')}">
          <div class="hab-emojis" role="group" aria-label="Suggestions d'icônes">${EMOJIS.map((e) => `<button type="button" class="hab-emoji" data-action="habit.emoji" data-v="${esc(e)}" aria-label="${esc('Choisir ' + e)}">${esc(e)}</button>`).join('')}</div></div></div>
        <div class="field"><span>Type</span>${C.ui.segmented('type', [
          { value: 'check', label: 'À faire' }, { value: 'number', label: 'Chiffrée' }, { value: 'avoid', label: 'À éviter' }], type, 'data-change="habit.form-type"')}</div>
        <div class="hab-f-number" ${type === 'number' ? '' : 'hidden'}>
          <div class="row gap">
            <label class="field grow"><span>Cible par jour</span><input type="text" name="target" inputmode="decimal" autocomplete="off" value="${esc(h && h.target != null ? fmtQty(h.target) : '')}" placeholder="1,5"></label>
            <label class="field grow"><span>Unité</span><input type="text" name="unit" maxlength="12" autocomplete="off" value="${esc(h ? h.unit || '' : '')}" placeholder="L"></label>
          </div></div>
        <div class="hab-f-freq" ${type === 'avoid' ? 'hidden' : ''}>
          <div class="field"><span>Fréquence</span>${C.ui.segmented('freq', [{ value: 'day', label: 'Tous les jours' }, { value: 'week', label: 'X fois par semaine' }], weekly ? 'week' : 'day', 'data-change="habit.form-freq"')}</div>
          <label class="field hab-f-per" ${weekly ? '' : 'hidden'}><span>Combien de fois par semaine ?</span>
            <select name="perWeek">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === per ? 'selected' : ''}>${n} fois</option>`).join('')}</select></label>
        </div>
        <p class="tiny muted hab-f-avoid" ${type === 'avoid' ? '' : 'hidden'}>Tu notes seulement les écarts ; chaque jour sans écart compte comme réussi.</p>
        <div class="field"><label for="hab-f-cue">Déclencheur (facultatif) : « Après …, je … »</label>
          <div class="row gap"><span class="muted">Après</span><input type="text" id="hab-f-cue" name="cue" class="grow" maxlength="200" autocomplete="off" value="${esc(h ? String(h.cue || '').replace(/^après\s+/i, '') : '')}" placeholder="le café du matin"></div></div>
        <label class="field"><span>Commencée le</span><input type="date" name="createdAt" max="${esc(today)}" value="${esc(h && h.createdAt ? h.createdAt : today)}"></label>
        <button type="submit" class="btn block">Enregistrer</button>
        ${h ? `<div class="row gap wrap mt">
          <button type="button" class="btn ghost grow" data-action="habit.archiver" data-id="${esc(h.id)}">Archiver</button>
          <button type="button" class="btn ghost danger grow" data-action="habit.supprimer" data-id="${esc(h.id)}">Supprimer</button></div>` : ''}
      </form>`,
    });
  }

  function openNumberDay(h, date) {
    const v = U.num(habitValue(h, date));
    C.ui.openModal({
      title: `${h.name} · ${U.fmtDate(date)}`,
      body: `<form data-form="habit.valeur" data-id="${esc(h.id)}" data-date="${esc(date)}" novalidate>
        <label class="field"><span>Quantité${h.unit ? ` (${esc(h.unit)})` : ''} · objectif ${esc(fmtQty(h.target))}</span>
          <input type="text" name="value" inputmode="decimal" autocomplete="off" value="${esc(v ? fmtQty(v) : '')}" placeholder="${esc(fmtQty(h.target))}"></label>
        <div class="row gap wrap"><button type="submit" class="btn grow">Enregistrer</button>
          <button type="button" class="btn ghost" data-action="habit.effacer" data-id="${esc(h.id)}" data-date="${esc(date)}">Effacer</button></div>
      </form>`,
    });
  }

  /* ───────── Corps : widget « Aujourd'hui » ───────── */

  function bodyTodayCard(date) {
    const d = U.isKey(date) ? date : U.todayKey();
    const e = U.isObj(st().body) && U.isObj(st().body[d]) ? st().body[d] : {};
    const series = call('weightSeries', 0) || [];
    const lastW = series.filter((p) => p.date <= d).pop();
    const prev = series.filter((p) => p.date < d).pop();
    const hint = lastW && lastW.date === d ? `Moyenne 7 jours : ${fmtKg(lastW.avg7)}` : prev ? `Dernière pesée : ${fmtKg(prev.weight)} (${U.fmtShort(prev.date)})` : 'Le matin, à jeun, c\'est plus comparable.';
    const id = `bdy-w-${d}`;
    return `<section class="card bdy-today" aria-labelledby="bdy-t-${esc(d)}">
      <div class="card-head"><h2 id="bdy-t-${esc(d)}">Poids & repas</h2><a class="link" href="#/corps">Courbe</a></div>
      <form class="bdy-weight" data-form="corps.poids" data-date="${esc(d)}" novalidate>
        <label for="${esc(id)}" class="small">Poids</label>
        <div class="row gap">
          <input type="text" id="${esc(id)}" name="weight" class="bdy-w-in num" inputmode="decimal" autocomplete="off" enterkeyhint="done"
            data-change="corps.poids-champ" data-date="${esc(d)}" value="${esc(e.weight != null ? U.fmtNum(e.weight, 2) : '')}" placeholder="${esc(prev ? U.fmtNum(prev.weight, 1) : '70,0')}" aria-describedby="${esc(id)}-hint">
          <span class="muted">kg</span>
          <button type="submit" class="btn small">OK</button>
        </div>
        <p class="tiny muted" id="${esc(id)}-hint">${esc(hint)}</p>
      </form>
      <p class="small bdy-food-q" id="bdy-fq-${esc(d)}">${d === U.todayKey() ? 'Aujourd\'hui, tu as mangé :' : 'Ce jour-là, tu as mangé :'}</p>
      <div class="bdy-food" role="group" aria-labelledby="bdy-fq-${esc(d)}">
        ${Object.entries(FOOD).map(([k, f]) => `<button type="button" class="bdy-food-btn" data-action="corps.repas" data-date="${esc(d)}" data-v="${esc(k)}" aria-pressed="${e.food === k}">
          <span aria-hidden="true">${f.icon}</span>${esc(f.label)}</button>`).join('')}
      </div>
    </section>`;
  }

  /* ───────── Check-in du matin ───────── */

  function readinessHTML(r) {
    if (!r || !r.level) return '';
    const R = READY[r.level];
    const strong = r.reasons.some((x) => /forte/.test(x));
    return `<div class="bdy-ready ${R.cls}" role="status">
      <span class="bdy-light" aria-hidden="true"></span>
      <div class="grow"><b>${esc(R.title)}</b><p class="small">${esc(SUGGESTION[r.suggestion] || '')}</p>
        ${r.reasons.length ? `<p class="tiny muted">${esc(r.reasons.join(' · '))}</p>` : ''}
        ${strong ? '<p class="tiny">Si la douleur persiste ou augmente, consulte un médecin ou un kiné.</p>' : ''}</div></div>`;
  }

  function checkinCard(date) {
    const d = U.isKey(date) ? date : U.todayKey();
    const c = U.isObj(st().checkins) && U.isObj(st().checkins[d]) ? st().checkins[d] : null;
    const r = call('readiness', d);
    const complete = c && SCALES.every((s) => U.num(c[s.f]) != null);
    const zones = painZones(st().profile);
    const dayLink = C.planner ? `<a class="link small" href="#/jour/${esc(d)}">Voir la séance du jour</a>` : '';
    if (complete && !ciEditing.has(d)) {
      return `<section class="card bdy-ci" aria-labelledby="bdy-ci-t-${esc(d)}">
        <div class="card-head"><h2 id="bdy-ci-t-${esc(d)}">Forme du jour</h2><button type="button" class="link" data-action="corps.ci-modifier" data-date="${esc(d)}">Modifier</button></div>
        ${readinessHTML(r)}
        <p class="tiny muted">${esc(SCALES.map((s) => `${s.label} ${c[s.f]}/5`).concat(zones.filter((z) => c.pain && U.num(c.pain[z.zone]) != null).map((z) => `${z.label} ${c.pain[z.zone]}/10`)).join(' · '))}${c.note ? ` · « ${esc(c.note)} »` : ''}</p>
        ${dayLink}
      </section>`;
    }
    const pain = c && U.isObj(c.pain) ? c.pain : {};
    return `<section class="card bdy-ci" aria-labelledby="bdy-ci-t-${esc(d)}">
      <div class="card-head"><h2 id="bdy-ci-t-${esc(d)}">Check-in du matin</h2><span class="tiny muted">30 s · facultatif</span></div>
      ${SCALES.map((s) => `<div class="bdy-ci-q">
        <span class="small" id="bdy-ci-${esc(s.f)}-${esc(d)}">${esc(s.label)} <span class="tiny muted">(1 = ${esc(s.low)}, 5 = ${esc(s.high)})</span></span>
        <div class="bdy-scale" role="group" aria-labelledby="bdy-ci-${esc(s.f)}-${esc(d)}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="bdy-sc" data-action="corps.ci" data-date="${esc(d)}" data-f="${esc(s.f)}" data-v="${n}"
          aria-pressed="${c && Number(c[s.f]) === n}" aria-label="${esc(`${s.label} : ${n} sur 5`)}">${n}</button>`).join('')}</div></div>`).join('')}
      ${zones.map((z) => {
        const v = U.num(pain[z.zone]);
        const rid = `bdy-ci-p-${z.zone}-${d}`;
        return `<div class="bdy-ci-q"><label class="small" for="${esc(rid)}">Douleur ${esc(z.label.toLowerCase())} <span class="tiny muted">(0 à 10)</span></label>
          <div class="row gap bdy-range"><input type="range" id="${esc(rid)}" min="0" max="10" step="1" value="${esc(v == null ? 0 : v)}"
            data-change="corps.ci-douleur" data-input="corps.ci-douleur-vue" data-date="${esc(d)}" data-zone="${esc(z.zone)}" aria-valuetext="${esc(v == null ? 'non noté' : `${v} sur 10`)}">
          <output class="num bdy-range-v" for="${esc(rid)}">${esc(v == null ? '—' : v)}</output></div></div>`;
      }).join('')}
      <label class="field"><span class="small">Note (facultatif)</span><input type="text" maxlength="300" autocomplete="off" data-change="corps.ci-note" data-date="${esc(d)}" value="${esc(c && c.note ? c.note : '')}" placeholder="Stress, nuit coupée…"></label>
      ${readinessHTML(r)}
      <div class="row gap wrap between">${c ? `<button type="button" class="btn small" data-action="corps.ci-fini" data-date="${esc(d)}">Terminer</button>` : '<span></span>'}${dayLink}</div>
    </section>`;
  }

  /* ───────── #/corps ───────── */

  function weightChartSVG(series) {
    if (series.length < 2) return '';
    const W = 320, H = 150, PX = 8, PY = 10;
    const x0 = series[0].date;
    const span = Math.max(1, U.daysBetween(x0, series[series.length - 1].date));
    const vals = series.flatMap((p) => [p.weight, p.avg7]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(0.3, (hi - lo) * 0.1);
    lo -= pad; hi += pad;
    const x = (d) => (PX + (U.daysBetween(x0, d) / span) * (W - 2 * PX)).toFixed(1);
    const y = (v) => (H - PY - ((v - lo) / (hi - lo)) * (H - 2 * PY)).toFixed(1);
    const avg = series.map((p) => `${x(p.date)},${y(p.avg7)}`).join(' ');
    return `<svg class="bdy-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Poids du ${U.fmtShort(series[0].date)} au ${U.fmtShort(series[series.length - 1].date)} : points = pesées, ligne = moyenne sur 7 jours`)}">
      ${series.map((p) => `<circle class="bdy-dot" cx="${x(p.date)}" cy="${y(p.weight)}" r="3"/>`).join('')}
      <polyline class="bdy-avg" points="${avg}"/></svg>`;
  }

  function viewBody() {
    const today = U.todayKey();
    const series = call('weightSeries', bodyRange) || [];
    const all = call('weightSeries', 0) || [];
    const last = all[all.length - 1];
    let change = '';
    if (last) {
      const ref = all.filter((p) => U.daysBetween(p.date, last.date) >= 21 && U.daysBetween(p.date, last.date) <= 35).pop();
      if (ref) {
        const diff = U.round(last.avg7 - ref.avg7, 1);
        change = diff === 0 ? 'stable sur 4 semaines' : `${diff > 0 ? '+' : '−'}${U.fmtNum(Math.abs(diff), 1)} kg en ${Math.round(U.daysBetween(ref.date, last.date) / 7)} semaines`;
      }
    }
    const days28 = U.range(U.addDays(today, -27), today);
    const counts = foodCounts(days28);
    const body = U.isObj(st().body) ? st().body : {};
    const hist = Object.keys(body).filter((k) => U.isKey(k) && U.isObj(body[k])).sort().reverse().slice(0, 60);
    const ys = series.map((p) => p.weight);
    return `<header class="top"><h1>Poids & alimentation</h1>
        <p class="muted small">Pour suivre une tendance, pas pour juger une journée. Pas de calcul de calories.</p></header>
      ${bodyTodayCard(today)}
      <section class="card bdy-curve" aria-labelledby="bdy-curve-t">
        <div class="card-head"><h2 id="bdy-curve-t">Poids</h2>
          <div class="bdy-range-tg" role="group" aria-label="Période">${[30, 90, 365].map((n) => `<button type="button" class="bdy-tg" data-action="corps.periode" data-v="${n}" aria-pressed="${bodyRange === n}">${n === 365 ? '1 an' : `${n} j`}</button>`).join('')}</div></div>
        ${last ? `<p class="bdy-now"><b class="num">${esc(fmtKg(last.avg7))}</b> <span class="small muted">moyenne 7 jours${change ? ` · ${esc(change)}` : ''}</span></p>` : ''}
        ${series.length >= 2 ? `${weightChartSVG(series)}
          <div class="bdy-legend tiny muted"><span><span class="bdy-key-dot" aria-hidden="true"></span> pesées</span><span><span class="bdy-key-line" aria-hidden="true"></span> moyenne 7 jours</span>
            <span class="num">${esc(`${U.fmtNum(Math.min(...ys), 1)} – ${U.fmtNum(Math.max(...ys), 1)} kg`)}</span></div>`
          : `<p class="muted small">${series.length ? 'Une seule pesée sur la période : la courbe apparaîtra à la deuxième.' : 'Aucune pesée sur la période.'}</p>`}
        <p class="tiny muted">Le poids varie d'un jour à l'autre (eau, repas, entraînement) : regarde plutôt la moyenne sur 7 jours.</p>
      </section>
      <section class="card" aria-labelledby="bdy-food-t">
        <div class="card-head"><h2 id="bdy-food-t">Repas · 28 derniers jours</h2></div>
        <div class="bdy-band" role="img" aria-label="${esc(`28 derniers jours : ${counts.peu} peu, ${counts.normal} normal, ${counts.beaucoup} beaucoup, ${counts.vide} non notés`)}">
          ${days28.map((d) => { const f = U.isObj(body[d]) ? body[d].food : null; return `<span class="bdy-band-c is-${esc(FOOD[f] ? f : 'vide')}"></span>`; }).join('')}</div>
        <div class="bdy-band-axis tiny muted"><span>${esc(U.fmtShort(days28[0]))}</span><span>aujourd'hui</span></div>
        <div class="bdy-food-legend small">${Object.entries(FOOD).map(([k, f]) => `<span><span class="bdy-key is-${esc(k)}" aria-hidden="true"></span>${esc(f.label)} <b class="num">${esc(counts[k])}</b></span>`).join('')}
          <span><span class="bdy-key is-vide" aria-hidden="true"></span>Non noté <b class="num">${esc(counts.vide)}</b></span></div>
      </section>
      ${checkinCard(today)}
      <section class="card" aria-labelledby="bdy-hist-t">
        <div class="card-head"><h2 id="bdy-hist-t">Historique</h2><button type="button" class="link" data-action="corps.ajouter">+ Autre jour</button></div>
        ${hist.length ? `<ul class="bdy-hist">${hist.map((d) => {
          const e = body[d];
          return `<li><button type="button" class="bdy-h-btn" data-action="corps.modifier" data-date="${esc(d)}" aria-label="${esc(`Modifier le ${U.fmtDate(d)}`)}">
            <span class="small">${esc(U.fmtDate(d))}</span>
            <span class="row gap"><b class="num">${esc(e.weight != null ? fmtKg(e.weight) : '—')}</b><span class="pill bdy-h-food ${FOOD[e.food] ? `bdy-pill-${esc(e.food)}` : 'is-none'}">${esc(FOOD[e.food] ? FOOD[e.food].label : '—')}</span></span></button></li>`;
        }).join('')}</ul>` : '<p class="muted small">Rien de noté pour l\'instant.</p>'}
      </section>`;
  }

  function openBodyForm(date) {
    const today = U.todayKey();
    const isNew = !date;
    const e = !isNew && U.isObj(st().body) && U.isObj(st().body[date]) ? st().body[date] : {};
    C.ui.openModal({
      title: isNew ? 'Ajouter un jour' : U.fmtDate(date),
      body: `<form data-form="corps.enregistrer" data-date="${esc(date || '')}" novalidate>
        ${isNew ? `<label class="field"><span>Date</span><input type="date" name="date" max="${esc(today)}" value="${esc(U.addDays(today, -1))}" required></label>` : ''}
        <label class="field"><span>Poids (kg)</span><input type="text" name="weight" inputmode="decimal" autocomplete="off" value="${esc(e.weight != null ? U.fmtNum(e.weight, 2) : '')}" placeholder="70,0"></label>
        <div class="field"><span>Repas</span>${C.ui.segmented('food', [...Object.entries(FOOD).map(([k, f]) => ({ value: k, label: f.label })), { value: '', label: 'Non noté' }], e.food || '')}</div>
        <div class="row gap wrap mt"><button type="submit" class="btn grow">Enregistrer</button>
          ${isNew ? '' : `<button type="button" class="btn ghost danger" data-action="corps.supprimer" data-date="${esc(date)}">Supprimer</button>`}</div>
      </form>`,
    });
  }

  /* ───────── Écritures ───────── */

  function saveWeight(date, raw, opts = {}) {
    const txt = String(raw == null ? '' : raw).trim();
    const w = parseWeight(txt);
    if (txt && w == null) { C.ui.toast('Poids illisible : tape par exemple 72,4'); return false; }
    const cur = U.isObj(st().body) && U.isObj(st().body[date]) ? st().body[date].weight : undefined;
    if ((w == null && cur == null) || w === cur) return true;
    C.store.update((s) => {
      if (!U.isObj(s.body)) s.body = {};
      const e = U.isObj(s.body[date]) ? s.body[date] : {};
      if (w == null) delete e.weight; else e.weight = w;
      if (Object.keys(e).length) s.body[date] = e; else delete s.body[date];
    }, opts);
    return true;
  }

  function setCheckin(date, fn) {
    C.store.update((s) => {
      if (!U.isObj(s.checkins)) s.checkins = {};
      const c = U.isObj(s.checkins[date]) ? s.checkins[date] : {};
      fn(c);
      if (!U.isObj(c.pain) || !Object.keys(c.pain).length) delete c.pain;
      if (Object.keys(c).length) s.checkins[date] = c; else delete s.checkins[date];
    });
  }

  /* ───────── Enregistrement ───────── */

  function register() {
    C.route('#/habitudes', viewHabits, { tab: '#/plus', title: 'Habitudes' });
    C.route('#/corps', viewBody, { tab: '#/plus', title: 'Poids & alimentation' });
    C.menuItem({ hash: '#/habitudes', icon: '✅', label: 'Habitudes', desc: 'Suivi quotidien, séries et jalon de 66 jours', order: 10 });
    C.menuItem({ hash: '#/corps', icon: '⚖️', label: 'Poids & alimentation', desc: 'Poids, repas et forme du jour', order: 11 });

    // — Habitudes : saisie du jour
    C.action('habit.cocher', (el) => {
      const h = habitById(el.dataset.id);
      if (!h) return;
      const done = habitDone(h, el.dataset.date);
      C.store.update((s) => setLog(s, el.dataset.date, h.id, done ? null : true));
    });
    C.action('habit.ecart', (el) => {
      const h = habitById(el.dataset.id);
      if (!h) return;
      const slip = isSlip(habitValue(h, el.dataset.date));
      C.store.update((s) => setLog(s, el.dataset.date, h.id, slip ? null : true));
    });
    const bump = (el, dir) => {
      const h = habitById(el.dataset.id);
      if (!h) return;
      const cur = U.num(habitValue(h, el.dataset.date)) || 0;
      const next = Math.max(0, U.round(cur + dir * stepFor(h), 3));
      C.store.update((s) => setLog(s, el.dataset.date, h.id, next || null));
    };
    C.action('habit.plus', (el) => bump(el, 1));
    C.action('habit.moins', (el) => bump(el, -1));

    // — Grille : corriger un jour
    C.action('habit.case', (el) => {
      const h = habitById(el.dataset.id);
      const d = el.dataset.date;
      if (!h || !U.isKey(d) || d > U.todayKey()) return;
      if (h.type === 'number') { openNumberDay(h, d); return; }
      const v = habitValue(h, d);
      C.store.update((s) => setLog(s, d, h.id, isSlip(v) ? null : true));
    });
    C.onSubmit('habit.valeur', (form, fd) => {
      const h = habitById(form.dataset.id);
      if (!h) return;
      const raw = String(fd.get('value') || '').trim();
      const n = U.num(raw);
      if (raw && (n == null || n < 0)) { C.ui.toast('Quantité illisible'); return; }
      C.ui.closeModal();
      C.store.update((s) => setLog(s, form.dataset.date, h.id, n ? U.round(n, 3) : null));
    });
    C.action('habit.effacer', (el) => {
      C.ui.closeModal();
      C.store.update((s) => setLog(s, el.dataset.date, el.dataset.id, null));
    });

    // — Créer, modifier, archiver, supprimer
    C.action('habit.nouvelle', () => openHabitForm(null));
    C.action('habit.modifier', (el) => { const h = habitById(el.dataset.id); if (h) openHabitForm(h); });
    C.action('habit.emoji', (el) => {
      const input = el.closest('form') && el.closest('form').querySelector('[name="icon"]');
      if (input) { input.value = el.dataset.v; input.focus(); }
    });
    C.onChange('habit.form-type', (el) => {
      const form = el.closest('form');
      if (!form) return;
      form.querySelector('.hab-f-number').hidden = el.value !== 'number';
      form.querySelector('.hab-f-freq').hidden = el.value === 'avoid';
      form.querySelector('.hab-f-avoid').hidden = el.value !== 'avoid';
    });
    C.onChange('habit.form-freq', (el) => {
      const form = el.closest('form');
      if (form) form.querySelector('.hab-f-per').hidden = el.value !== 'week';
    });
    C.onSubmit('habit.enregistrer', (form, fd) => {
      const prev = form.dataset.id ? habitById(form.dataset.id) : null;
      const values = Object.fromEntries(['name', 'icon', 'type', 'target', 'unit', 'freq', 'perWeek', 'cue', 'createdAt'].map((k) => [k, fd.get(k)]));
      const res = habitFromForm(values, prev);
      if (res.error) { C.ui.toast(res.error); return; }
      C.ui.closeModal();
      C.store.update((s) => {
        if (!Array.isArray(s.habits)) s.habits = [];
        const i = s.habits.findIndex((x) => x && x.id === res.habit.id);
        if (i >= 0) s.habits[i] = res.habit; else s.habits.push(res.habit);
      });
      C.ui.toast(prev ? 'Habitude modifiée' : 'Habitude ajoutée');
    });
    C.action('habit.archiver', (el) => {
      C.ui.closeModal();
      C.store.update((s) => { const h = (s.habits || []).find((x) => x && x.id === el.dataset.id); if (h) h.archivedAt = U.todayKey(); });
      C.ui.toast('Habitude archivée (historique gardé)');
    });
    C.action('habit.reactiver', (el) => {
      C.store.update((s) => { const h = (s.habits || []).find((x) => x && x.id === el.dataset.id); if (h) h.archivedAt = null; });
    });
    C.action('habit.supprimer', async (el) => {
      const h = habitById(el.dataset.id);
      if (!h) return;
      C.ui.closeModal();
      if (!(await C.ui.ask(`Supprimer « ${h.name} » et tout son historique ? Pour la mettre de côté sans rien perdre, archive-la plutôt.`, 'Supprimer', { danger: true }))) return;
      C.store.update((s) => {
        s.habits = (s.habits || []).filter((x) => x && x.id !== h.id);
        for (const d of Object.keys(s.habitLog || {})) setLog(s, d, h.id, null);
      });
      C.ui.toast('Habitude supprimée');
    });

    // — Corps
    C.onSubmit('corps.poids', (form, fd) => {
      if (saveWeight(form.dataset.date, fd.get('weight'))) {
        const input = form.querySelector('input[name="weight"]');
        if (input) input.blur();
      }
    });
    C.onChange('corps.poids-champ', (el) => { saveWeight(el.dataset.date, el.value); });
    C.action('corps.repas', (el) => {
      const d = el.dataset.date, v = el.dataset.v;
      if (!U.isKey(d) || !FOOD[v]) return;
      C.store.update((s) => {
        if (!U.isObj(s.body)) s.body = {};
        const e = U.isObj(s.body[d]) ? s.body[d] : {};
        if (e.food === v) delete e.food; else e.food = v;
        if (Object.keys(e).length) s.body[d] = e; else delete s.body[d];
      });
    });
    C.action('corps.periode', (el) => { bodyRange = [30, 90, 365].includes(Number(el.dataset.v)) ? Number(el.dataset.v) : 90; C.rerender(); });
    C.action('corps.ajouter', () => openBodyForm(null));
    C.action('corps.modifier', (el) => openBodyForm(el.dataset.date));
    C.onSubmit('corps.enregistrer', (form, fd) => {
      const d = form.dataset.date || fd.get('date');
      if (!U.isKey(d) || d > U.todayKey()) { C.ui.toast('Date invalide'); return; }
      const raw = String(fd.get('weight') || '').trim();
      const w = parseWeight(raw);
      if (raw && w == null) { C.ui.toast('Poids illisible : tape par exemple 72,4'); return; }
      const food = FOOD[fd.get('food')] ? fd.get('food') : null;
      C.ui.closeModal();
      C.store.update((s) => {
        if (!U.isObj(s.body)) s.body = {};
        const e = {};
        if (w != null) e.weight = w;
        if (food) e.food = food;
        if (Object.keys(e).length) s.body[d] = e; else delete s.body[d];
      });
    });
    C.action('corps.supprimer', async (el) => {
      const d = el.dataset.date;
      C.ui.closeModal();
      if (!(await C.ui.ask(`Effacer le poids et les repas du ${U.fmtDate(d)} ?`, 'Effacer', { danger: true }))) return;
      C.store.update((s) => { if (U.isObj(s.body)) delete s.body[d]; });
    });

    // — Check-in
    C.action('corps.ci', (el) => {
      const d = el.dataset.date, f = el.dataset.f, v = Number(el.dataset.v);
      if (!U.isKey(d) || !SCALES.some((s) => s.f === f) || !(v >= 1 && v <= 5)) return;
      ciEditing.add(d); // le check-in reste ouvert jusqu'à « Terminer »
      setCheckin(d, (c) => { if (Number(c[f]) === v) delete c[f]; else c[f] = v; });
    });
    C.onInput('corps.ci-douleur-vue', (el) => {
      const out = el.parentElement && el.parentElement.querySelector('output');
      if (out) out.textContent = el.value;
    });
    C.onChange('corps.ci-douleur', (el) => {
      const d = el.dataset.date, z = el.dataset.zone, v = Math.round(Number(el.value));
      if (!U.isKey(d) || !z || !(v >= 0 && v <= 10)) return;
      ciEditing.add(d);
      setCheckin(d, (c) => { c.pain = U.isObj(c.pain) ? c.pain : {}; c.pain[z] = v; });
    });
    C.onChange('corps.ci-note', (el) => {
      const d = el.dataset.date;
      if (!U.isKey(d)) return;
      const note = String(el.value || '').trim().slice(0, 300);
      setCheckin(d, (c) => { if (note) c.note = note; else delete c.note; });
    });
    C.action('corps.ci-fini', (el) => { ciEditing.delete(el.dataset.date); C.rerender(); });
    C.action('corps.ci-modifier', (el) => { ciEditing.add(el.dataset.date); C.rerender(); });
  }

  (C.bootHooks = C.bootHooks || []).push(register);

  C.habitsUI = {
    todayCard: habitsTodayCard, view: viewHabits,
    _t: { graphemes, graphemesFallback, clipIcon, stepFor, habitFromForm, kindText, cueText, gridDays, cellState, setLog, parseWeight, painZones, foodCounts },
  };
  C.bodyUI = { todayCard: bodyTodayCard, checkinCard, view: viewBody };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
