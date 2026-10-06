// Parcours de bout en bout dans Chromium (format iPhone).
// Prérequis : serveur statique sur BASE (par défaut http://localhost:8765), ex. `python3 -m http.server 8765`.
// Usage : node tests/e2e.js [dossier_captures]
'use strict';
const PW = process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright';
const { chromium } = require(PW);
const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOTS = process.argv[2] || null;

const ROUTES = [
  '#/', '#/plan', '#/plan-apercu', '#/agenda', '#/agenda-reglages', '#/chrono', '#/chrono/chrono', '#/chrono/minuteur',
  '#/chrono/intervalles', '#/chrono/ssa-entree', '#/chrono/ssa-tsa', '#/chrono/hyrox', '#/chrono/luc-leger',
  '#/plus', '#/progres', '#/habitudes', '#/corps', '#/objectifs', '#/bibliotheque', '#/mes-seances', '#/mes-seances/nouvelle',
  '#/exercice/pullup_strict', '#/exercice/ssa_entry_test', '#/reglages', '#/donnees', '#/sante',
];

async function onboard(p) {
  await p.fill('#onb-birthYear', '2006');
  await p.check('input[name=onb-sex][value=H]');
  await p.click('[data-action="onb.suivant"]');
  await p.click('[data-zone="cheville"]'); await p.check('input[name=onb-side-0][value=gauche]');
  await p.click('[data-zone="genou"]'); await p.check('input[name=onb-side-1][value=gauche]');
  await p.click('[data-action="onb.suivant"]');
  for (let i = 0; i < 4; i++) { await p.locator('input[data-change="onb.objectif"]').nth(i).check(); await p.waitForTimeout(100); }
  await p.selectOption('select:near(:text("Course"))', 'lyon-2027').catch(() => {});
  await p.click('[data-action="onb.suivant"]');
  // Disponibilités : mardi, jeudi, samedi (par défaut) ; 3 séances ; 2 h ; début lundi prochain
  await p.check('input[name=onb-start][value=monday]');
  await p.click('[data-action="onb.suivant"]');
  await p.click('[data-action="onb.piscine"]:has-text("25")');
  await p.click('[data-action="onb.piscine"]:has-text("50")');
  await p.fill('#onb-gymName', 'Fitness Park Fresnes');
  await p.check('input[name=onb-gymHyrox][value=oui]');
  await p.fill('#onb-apneaBuddy', 'Club de natation');
  await p.click('[data-action="onb.suivant"]');
  await p.check('input[name=onb-runPerWeek][value="3"]');
  await p.fill('#onb-runKm', '8');
  await p.fill('#onb-pullups', '1');
  await p.fill('#onb-pushups', '30');
  await p.fill('#onb-plankSec', '100');
  await p.click('[data-action="onb.suivant"]');
  await p.click('[data-action="onb.creer"]');
  await p.click('[data-action="onb.fin"]');
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: process.env.SCHEME || 'dark', serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(`[${p.url().split('#')[1] || '/'}] pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${p.url().split('#')[1] || '/'}] console: ${m.text()}`); });
  p.on('dialog', (d) => { errors.push('dialog natif utilisé : ' + d.message()); d.dismiss(); });

  await p.goto(BASE);
  await onboard(p);
  const st = await p.evaluate(() => window.Crevare.state);
  if (!st.profile.onboarded) errors.push('questionnaire non validé');
  if (st.goals.length < 4) errors.push(`objectifs créés : ${st.goals.length}`);

  const problems = [];
  for (const r of ROUTES) {
    await p.evaluate((h) => { location.hash = h; }, r);
    await p.waitForTimeout(250);
    const res = await p.evaluate(() => {
      const app = document.querySelector('#app');
      const txt = app.innerText;
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      return { len: txt.length, recovery: /Un problème est survenu/.test(txt), notFound: /Page introuvable/.test(txt), overflow, h1: (app.querySelector('h1') || {}).textContent };
    });
    if (res.recovery || res.notFound || res.len < 20) problems.push(`${r} : ${JSON.stringify(res)}`);
    if (res.overflow) problems.push(`${r} : débordement horizontal`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/route-${r.replace(/[#/]+/g, '_') || 'home'}.png`, fullPage: true });
    await p.evaluate(() => window.Crevare.ui && window.Crevare.ui.closeModal && window.Crevare.ui.closeModal());
  }
  console.log('Routes vérifiées :', ROUTES.length);
  if (problems.length) console.log('PROBLÈMES :\n- ' + problems.join('\n- '));
  if (errors.length) console.log('ERREURS :\n- ' + [...new Set(errors)].join('\n- '));
  await b.close();
  process.exit(problems.length || errors.length ? 1 : 0);
})();
