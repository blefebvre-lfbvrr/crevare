/* Crevare — stockage local (localStorage), abonnements, sauvegarde/restauration.
 * Les données ne quittent jamais l'appareil. */
(function (C) {
  'use strict';
  const U = C.util;
  const KEY = 'crevare.v2';
  const KEY_V1 = 'crevare.v1';
  const KEY_BACKUP = 'crevare.backup';

  const listeners = new Set();
  let lastError = null;

  function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { lastError = e; return false; }
  }

  // Charge l'état : v2 si présent, sinon migration de la v1, sinon état neuf (enregistré tout de suite).
  function load() {
    let state = null;
    const raw2 = safeGet(KEY);
    if (raw2) {
      try { state = C.schema.fromAny(raw2); } catch (e) {
        // Données illisibles : on les met de côté au lieu de les écraser.
        safeSet(KEY + '.corrompu.' + Date.now(), raw2);
        lastError = e;
      }
    }
    if (!state) {
      const raw1 = safeGet(KEY_V1);
      if (raw1) {
        try { state = C.schema.fromAny(raw1); safeSet(KEY_BACKUP, raw1); } catch (e) { lastError = e; }
      }
    }
    if (!state) state = C.schema.defaultState();
    C.state = state;
    save();
    return state;
  }

  function save() {
    C.state.updatedAt = new Date().toISOString();
    const ok = safeSet(KEY, JSON.stringify(C.state));
    if (!ok && C.ui && C.ui.toast) C.ui.toast('⚠️ Sauvegarde impossible : mémoire du navigateur pleine ou bloquée.');
    return ok;
  }

  // Modifie l'état puis enregistre et prévient les abonnés.
  // fn reçoit l'état ; ce qu'elle renvoie est renvoyé par update().
  function update(fn, opts = {}) {
    const res = fn(C.state);
    save();
    if (!opts.silent) emit();
    return res;
  }

  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach((fn) => { try { fn(C.state); } catch (e) { console.error(e); } }); }

  // Autre onglet / autre fenêtre : on recharge pour ne pas écraser ses modifications.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try { C.state = C.schema.fromAny(e.newValue); emit(); } catch (err) { /* ignore : on garde l'état courant */ }
    });
  }

  function exportJSON(pretty) {
    return JSON.stringify(C.state, null, pretty ? 2 : 0);
  }

  // Remplace l'état par une sauvegarde. Copie de secours de l'état actuel d'abord.
  // Jette une Error lisible si la sauvegarde est invalide (l'état actuel reste intact).
  function importJSON(text) {
    const next = C.schema.fromAny(text);
    safeSet(KEY_BACKUP, JSON.stringify(C.state));
    C.state = next;
    save();
    emit();
    return next;
  }

  function hasBackup() { return !!safeGet(KEY_BACKUP); }
  function restoreBackup() {
    const raw = safeGet(KEY_BACKUP);
    if (!raw) throw new Error('Aucune copie de secours.');
    const next = C.schema.fromAny(raw);
    safeSet(KEY_BACKUP, JSON.stringify(C.state));
    C.state = next; save(); emit();
  }

  function reset() {
    safeSet(KEY_BACKUP, JSON.stringify(C.state));
    C.state = C.schema.defaultState();
    save(); emit();
  }

  // Demande au navigateur de ne pas effacer les données (Safari peut purger après 7 jours sans visite
  // pour un site non installé). Renvoie true si la persistance est accordée.
  async function persist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { /* non supporté */ }
    return false;
  }

  // Taille approximative des données (octets).
  function size() { return (safeGet(KEY) || '').length * 2; }

  C.store = { KEY, load, save, update, on, emit, exportJSON, importJSON, hasBackup, restoreBackup, reset, persist, size, lastError: () => lastError };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
