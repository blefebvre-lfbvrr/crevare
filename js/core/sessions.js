/* Crevare — séances enregistrées (instances) : création depuis le plan, une séance perso
 * ou une séance libre ; lecture par date ; saisie des séries.
 * Le contenu d'une séance (exercices) est figé à la création : modifier le plan ensuite
 * ne réécrit jamais une séance commencée ou terminée. */
(function (C) {
  'use strict';
  const U = C.util;

  const all = () => Object.values(C.state.sessions).sort((a, b) => a.date.localeCompare(b.date) || String(a.startedAt).localeCompare(String(b.startedAt)));
  const get = (id) => C.state.sessions[id] || null;
  const forDate = (date) => all().filter((s) => s.date === date && s.status !== 'skipped');
  // Séance principale du jour (une seule séance par jour dans l'usage courant).
  const main = (date) => forDate(date)[0] || null;
  const isDone = (date) => forDate(date).some((s) => s.status === 'done');
  const doneBetween = (from, to) => all().filter((s) => s.status === 'done' && s.date >= from && s.date <= to);

  // Crée une séance (sans l'enregistrer si opts.dryRun).
  // opts : { templateId } | { customSessionId } | { free: true, title?, loc? } ; opts.variant : 'normal'|'allege'|'express'|'doux'
  function build(date, opts = {}) {
    let base;
    if (opts.free) {
      base = { title: opts.title || 'Séance libre', loc: opts.loc || 'autre', kind: 'libre', durationMin: null, intro: '', exercises: [] };
    } else {
      base = C.planner.instantiate(date, opts);
    }
    const id = U.uid();
    const exercises = (base.exercises || []).map((it, i) => ({ ...it, key: it.key || `${it.exId}#${i}` }));
    return {
      id, date,
      source: opts.free ? 'libre' : opts.customSessionId ? 'perso' : 'plan',
      templateId: base.templateId || opts.templateId || null,
      customSessionId: opts.customSessionId || null,
      variant: opts.variant || 'normal',
      title: base.title, loc: base.loc, kind: base.kind || null, goals: base.goals || [],
      plannedMin: base.durationMin || null, intro: base.intro || '', safety: base.safety || [],
      exercises, log: {}, status: 'in_progress',
      startedAt: null, finishedAt: null, durationMin: null, rpe: null, pain: {}, feeling: null, notes: '',
      poolId: null, poolLength: null, watch: null,
    };
  }

  function create(date, opts = {}) {
    const s = build(date, opts);
    C.store.update((st) => { st.sessions[s.id] = s; }, { silent: !!opts.silent });
    return s.id;
  }

  // Ouvre la séance du jour si elle existe déjà, sinon la crée.
  function open(date, opts = {}) {
    const existing = main(date);
    if (existing && !opts.forceNew) return existing.id;
    return create(date, opts);
  }

  function remove(id) { C.store.update((st) => { delete st.sessions[id]; }); }

  // Enregistre une série sans re-rendre la page (saisie en cours).
  function patchSet(id, key, index, patch, opts = {}) {
    C.store.update((st) => {
      const s = st.sessions[id];
      if (!s) return;
      if (!s.startedAt) s.startedAt = Date.now();
      const sets = (s.log[key] ||= []);
      sets[index] = { ...(sets[index] || {}), ...patch };
    }, { silent: opts.silent !== false });
  }

  function patch(id, fields, opts = {}) {
    C.store.update((st) => { if (st.sessions[id]) Object.assign(st.sessions[id], fields); }, opts);
  }

  // Ajoute un exercice de la bibliothèque à une séance (séance libre ou ajout ponctuel).
  function addExercise(id, exId, item = {}) {
    const ex = C.data.getExercise(exId);
    if (!ex) throw new Error('Exercice introuvable');
    C.store.update((st) => {
      const s = st.sessions[id];
      if (!s) return;
      s.exercises.push({
        key: `${exId}#${s.exercises.length}-${Date.now().toString(36)}`, exId, name: ex.name, track: ex.track,
        sets: item.sets || ex.defaultSets || 3, reps: item.reps || ex.defaultReps || '', rest: item.rest ?? ex.defaultRest ?? 60,
        note: item.note || '', target: item.target || {}, apnea: !!ex.apnea, impact: ex.impact || 0,
      });
    });
  }

  // Durée réelle (min) : saisie > fin − début > durée prévue.
  function durationOf(s) {
    if (s.durationMin) return s.durationMin;
    if (s.startedAt && s.finishedAt) return Math.max(1, Math.round((s.finishedAt - s.startedAt) / 60000));
    return s.plannedMin || null;
  }

  C.sessions = { all, get, forDate, main, isDone, doneBetween, build, create, open, remove, patchSet, patch, addExercise, durationOf };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
