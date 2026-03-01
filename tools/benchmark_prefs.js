import { loadPrefs } from '../core/storage.js';

let changedCb = null;

// Mock chrome API
globalThis.chrome = {
  storage: {
    sync: {
      get: async () => {
        // simulate async I/O
        await new Promise(r => setTimeout(r, 2));
        return { prefs: { theme: 'blue' } };
      },
      set: async (val) => {
        if (changedCb) changedCb({ prefs: { newValue: val.prefs } }, 'sync');
      }
    },
    onChanged: {
      addListener: (cb) => { changedCb = cb; }
    }
  }
};

async function run() {
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    await loadPrefs();
  }
  const end = performance.now();
  console.log(`Time taken: ${(end - start).toFixed(2)}ms`);
}

run();
