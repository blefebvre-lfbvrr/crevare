// Charge les scripts de Crevare (fonctions pures) dans Node pour les tests.
// Usage : const C = load(['js/core/util.js', 'js/core/schema.js']);
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function load(files, opts = {}) {
  if (opts.fresh !== false) delete globalThis.Crevare;
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  }
  return globalThis.Crevare;
}

// Ordre complet des scripts « sans DOM » (cœur + données).
const CORE = [
  'js/core/util.js', 'js/core/legacy-v1.js', 'js/core/schema.js', 'js/core/store.js',
  'js/data/exercises.js', 'js/data/benchmarks.js', 'js/data/goals.js', 'js/data/sessions.js',
  'js/core/planner.js', 'js/core/sessions.js', 'js/core/metrics.js', 'js/core/agenda.js',
];

// Charge le cœur et installe un état de test (C.state) sans localStorage.
function loadCore(today, mutate) {
  const C = load(CORE.filter((f) => fs.existsSync(path.join(ROOT, f))));
  if (today) C.util.setNow(today + 'T09:00:00');
  C.state = C.schema.defaultState(today);
  if (mutate) mutate(C.state, C);
  C.store.save = () => true; // pas de stockage en test
  return C;
}

module.exports = { load, loadCore, CORE, ROOT };
