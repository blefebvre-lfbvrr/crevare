/* Crevare — sons, voix, écran allumé, vibration (C.audio).
 * iPhone d'abord :
 *  - un seul AudioContext, créé et débloqué au premier geste (buffer silencieux), relancé au retour
 *    de veille ou après une interruption (appel, autre app) ;
 *  - bips par oscillateur avec enveloppe (montée/descente de quelques ms : pas de « clic ») ;
 *  - bips programmables sur l'horloge de l'AudioContext (précision du Luc Léger) ;
 *  - voix française (speechSynthesis), file vidée avant chaque phrase ; sans voix française → false
 *    (l'appelant se replie sur des bips) ;
 *  - Wake Lock (écran allumé) redemandé au retour visible, plusieurs demandeurs possibles ;
 *  - vibration : sans effet sur iPhone (non supportée), tolérée ailleurs.
 * Réglages respectés : C.state.settings.sound (bips) et C.state.settings.voice (voix). */
(function (C) {
  'use strict';

  const hasWin = typeof window !== 'undefined';
  const hasDoc = typeof document !== 'undefined';

  const settings = () => (C.state && C.state.settings) || {};
  const soundOn = () => settings().sound !== false;
  const voiceOn = () => settings().voice !== false;

  /* ───────── AudioContext unique ───────── */

  let ctx = null;
  let unlocked = false; // buffer silencieux joué pendant un geste
  let speechPrimed = false;
  const scheduled = new Set(); // oscillateurs programmés (pour pouvoir les annuler)

  function AudioCtor() {
    if (!hasWin) return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }

  // Crée l'AudioContext si besoin (idéalement pendant un geste de l'utilisateur).
  function context() {
    if (ctx) return ctx;
    const Ctor = AudioCtor();
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch (e) { ctx = null; }
    return ctx;
  }

  function resume() {
    if (!ctx) return;
    // iOS : 'suspended' (pas encore de geste) ou 'interrupted' (appel, verrouillage).
    if (ctx.state !== 'running' && ctx.state !== 'closed' && typeof ctx.resume === 'function') {
      try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignoré */ }
    }
  }

  // À appeler au premier toucher (fait aussi automatiquement par les écouteurs ci-dessous).
  function unlock() {
    const c = context();
    if (c) {
      resume();
      if (!unlocked) {
        try {
          // Buffer silencieux d'un échantillon : débloque la sortie audio sur iOS.
          const buf = c.createBuffer(1, 1, 22050);
          const src = c.createBufferSource();
          src.buffer = buf;
          src.connect(c.destination);
          src.start(0);
          unlocked = true;
        } catch (e) { /* ignoré */ }
      }
    }
    primeSpeech();
    return !!c;
  }

  // iOS exige que la première phrase soit lancée pendant un geste : phrase vide, muette.
  function primeSpeech() {
    if (speechPrimed || !synth()) return;
    try {
      const u = new window.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.lang = 'fr-FR';
      synth().speak(u);
      speechPrimed = true;
    } catch (e) { /* ignoré */ }
  }

  const isRunning = () => !!ctx && ctx.state === 'running';
  // Heure de l'horloge audio (s) ou null si pas de contexte.
  const now = () => (ctx ? ctx.currentTime : null);

  /* ───────── Bips ───────── */

  /* beep({ freq=880, ms=150, count=1, gap=120, volume=0.5, type='sine', at, force })
   * at : heure de départ sur l'horloge audio (s) — sinon tout de suite.
   * Renvoie { start, end } (horloge audio) ou null si muet / indisponible. */
  function beep(opts = {}) {
    if (!opts.force && !soundOn()) return null;
    const c = context();
    if (!c) { vibrate(opts.count > 1 ? [120, 80, 120] : 120); return null; }
    resume();
    const freq = Number(opts.freq) || 880;
    const dur = Math.max(30, Number(opts.ms) || 150) / 1000;
    const count = Math.max(1, Math.min(10, Math.round(Number(opts.count) || 1)));
    const gap = Math.max(0, Number(opts.gap ?? 120)) / 1000;
    const vol = Math.max(0.01, Math.min(1, Number(opts.volume) || 0.5));
    const t0 = Math.max(c.currentTime + 0.01, Number.isFinite(opts.at) ? opts.at : c.currentTime + 0.01);
    let t = t0;
    try {
      for (let i = 0; i < count; i++) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = opts.type || 'sine';
        osc.frequency.setValueAtTime(freq, t);
        // Enveloppe : montée 8 ms, palier, descente 25 ms → pas de clic.
        const attack = Math.min(0.008, dur / 4);
        const release = Math.min(0.025, dur / 3);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
        g.gain.setValueAtTime(vol, t + dur - release);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        osc.connect(g);
        g.connect(c.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        scheduled.add(osc);
        osc.onended = () => { scheduled.delete(osc); try { g.disconnect(); } catch (e) { /* déjà déconnecté */ } };
        t += dur + gap;
      }
    } catch (e) { return null; }
    return { start: t0, end: t - gap };
  }

  // Coupe tous les bips programmés et pas encore joués (ex. arrêt du Luc Léger).
  function cancelScheduled() {
    scheduled.forEach((osc) => { try { osc.onended = null; osc.stop(); } catch (e) { /* déjà arrêté */ } });
    scheduled.clear();
  }

  /* ───────── Voix ───────── */

  const synth = () => (hasWin && window.speechSynthesis && window.SpeechSynthesisUtterance ? window.speechSynthesis : null);
  let voice = null;
  let voicesKnown = false;

  function pickVoice() {
    const s = synth();
    if (!s) return null;
    let list = [];
    try { list = s.getVoices() || []; } catch (e) { list = []; }
    if (!list.length) return null;
    voicesKnown = true;
    const lang = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
    const fr = list.filter((v) => lang(v).startsWith('fr'));
    voice = fr.find((v) => lang(v) === 'fr-fr' && v.localService && v.default)
      || fr.find((v) => lang(v) === 'fr-fr' && v.localService)
      || fr.find((v) => lang(v) === 'fr-fr')
      || fr[0] || null;
    return voice;
  }
  if (synth()) {
    pickVoice();
    try {
      if (typeof synth().addEventListener === 'function') synth().addEventListener('voiceschanged', pickVoice);
      else synth().onvoiceschanged = pickVoice;
    } catch (e) { /* ignoré */ }
  }

  // true : voix française disponible ; false : aucune (repli bips) ; null : liste pas encore connue.
  function hasVoice() {
    if (!synth()) return false;
    if (!voice) pickVoice();
    if (voice) return true;
    return voicesKnown ? false : null;
  }

  // Dit un texte en français. Vide la file avant (la phrase précédente est coupée).
  // Renvoie true si la phrase est lancée, false sinon (voix coupée, pas de voix française…).
  function say(text, opts = {}) {
    const s = synth();
    if (!s || !text) return false;
    if (!opts.force && !voiceOn()) return false;
    if (hasVoice() === false) return false;
    try {
      // On ne vide la file que si elle n'est pas vide : sur certains Safari, cancel() suivi
      // immédiatement de speak() fait sauter la nouvelle phrase.
      if (s.speaking || s.pending) s.cancel();
      const u = new window.SpeechSynthesisUtterance(String(text));
      u.lang = 'fr-FR';
      if (voice) u.voice = voice;
      u.rate = opts.rate || 1.05;
      u.pitch = 1;
      u.volume = 1;
      // Chrome : la synthèse peut rester « en pause » après une mise en arrière-plan.
      if (s.paused && s.resume) s.resume();
      s.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function cancelSpeech() {
    const s = synth();
    if (s) try { s.cancel(); } catch (e) { /* ignoré */ }
  }
  const speaking = () => { const s = synth(); return !!(s && (s.speaking || s.pending)); };

  /* ───────── Écran allumé (Wake Lock) ─────────
   * Plusieurs demandeurs (minuteur, chrono, séance…) : l'écran reste allumé tant qu'au moins un le demande.
   * request() / release() sans argument = demandeur « default ». */
  const wl = { owners: new Set(), sentinel: null, pending: false };
  const wlSupported = () => typeof navigator !== 'undefined' && !!navigator.wakeLock && typeof navigator.wakeLock.request === 'function';

  async function acquire() {
    if (!wlSupported() || wl.sentinel || wl.pending || !wl.owners.size) return;
    if (hasDoc && document.visibilityState !== 'visible') return;
    wl.pending = true;
    try {
      const s = await navigator.wakeLock.request('screen');
      wl.sentinel = s;
      s.addEventListener('release', () => { if (wl.sentinel === s) wl.sentinel = null; });
      // Libéré entre-temps par tous les demandeurs
      if (!wl.owners.size) drop();
    } catch (e) {
      /* Refusé (cadre claude.ai, économie d'énergie, ancien iOS en app installée) : on continue sans. */
    } finally { wl.pending = false; }
  }
  function drop() {
    const s = wl.sentinel;
    wl.sentinel = null;
    if (s && typeof s.release === 'function') { try { const p = s.release(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignoré */ } }
  }
  const wakeLock = {
    supported: wlSupported,
    request(owner = 'default') { wl.owners.add(String(owner)); acquire(); return wlSupported(); },
    release(owner = 'default') { wl.owners.delete(String(owner)); if (!wl.owners.size) drop(); },
    releaseAll() { wl.owners.clear(); drop(); },
    active: () => !!wl.sentinel,
    wanted: () => wl.owners.size > 0,
  };

  /* ───────── Vibration ───────── */

  function vibrate(pattern) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') return navigator.vibrate(pattern) === true;
    } catch (e) { /* cadre cross-origin : refusé */ }
    return false;
  }

  /* ───────── Écouteurs globaux ───────── */

  if (hasDoc) {
    // Premier geste (et suivants : relance après une interruption iOS). 'touchend' et 'click' comptent
    // comme activation sur iOS ; 'pointerdown' débloque plus tôt ailleurs.
    const onGesture = () => {
      if (ctx && ctx.state === 'running' && unlocked && speechPrimed) return;
      unlock();
    };
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach((type) => {
      document.addEventListener(type, onGesture, { capture: true, passive: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        resume();
        if (wl.owners.size) acquire();
        const s = synth();
        if (s && s.paused && s.resume) try { s.resume(); } catch (e) { /* ignoré */ }
      }
    });
    if (hasWin) window.addEventListener('pageshow', () => { resume(); if (wl.owners.size) acquire(); });
  }

  C.audio = {
    unlock, context, resume, isRunning, now, beep, cancelScheduled,
    say, cancelSpeech, speaking, hasVoice, wakeLock, vibrate,
    soundOn, voiceOn,
  };
})(typeof window !== 'undefined' ? (window.Crevare = window.Crevare || {}) : (globalThis.Crevare = globalThis.Crevare || {}));
