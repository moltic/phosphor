import { DIAL_STORE_VERSION } from './core/storage.js';

let renderCount = 0;
let renderTime = 0;

// Mock chrome
global.chrome = {
  storage: {
    sync: {
      get: async () => ({
        dialStore: {
          version: DIAL_STORE_VERSION,
          categories: [
            { id: 'cat_default', label: '', collapsed: false, items: [{ id: 'a', type: 'link', alias: 'a', label: 'a', url: 'https://a.com' }, { id: 'b', type: 'link', alias: 'b', label: 'b', url: 'https://b.com' }] }
          ]
        },
        dials: []
      }),
      set: async (obj) => {
        if (global.listener) {
          const changes = {};
          for (const k of Object.keys(obj)) {
            changes[k] = { newValue: obj[k] };
          }
          global.listener(changes, 'sync');
        }
      }
    },
    local: {
      get: async () => ({ dialGroupCollapsed: {} }),
      set: async () => {}
    },
    onChanged: {
      addListener: (fn) => {
        global.listener = fn;
      }
    }
  }
};

// Mock DOM
import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!DOCTYPE html>
<html>
<body>
  <div id="speed-dial"></div>
  <div id="speed-dial-wrap"></div>
  <input id="cmd-input">
</body>
</html>
`);
global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;

// Dynamically import to allow mocks to be set up first
async function run() {
  const dialsMod = await import('./ui/dials.js');
  const storageMod = await import('./core/storage.js');
  const mainMod = await import('./main.js');

  // Inject tracking into renderDials
  const originalRenderDials = dialsMod.renderDials;
  dialsMod.renderDials = async function() {
    renderCount++;
    const start = performance.now();
    await originalRenderDials.apply(this, arguments);
    renderTime += performance.now() - start;
  };

  // Give main.js a moment to register listeners
  await new Promise(r => setTimeout(r, 100));

  // Reset counters
  renderCount = 0;
  renderTime = 0;

  console.log('--- Baseline Measurement ---');
  const startTotal = performance.now();

  // Call _moveDialAliasToIndex through the exported drag events (or by mocking)
  // Since _moveDialAliasToIndex is internal, we can just load dials, get the array and call the inner logic or copy the function:
  const current = await storageMod.loadDials();
  const fromIndex = current.findIndex(d => d.alias === 'a');

  // Simulate _moveDialAliasToIndex behavior
  function _arrayMove(arr, fromIndex, toIndex) {
    const next = [...arr];
    const clampedTo = Math.max(0, Math.min(toIndex, next.length - 1));
    const [item] = next.splice(fromIndex, 1);
    next.splice(clampedTo, 0, item);
    return next;
  }
  const next = _arrayMove(current, fromIndex, 1);

  // Actually, we want to measure the exact _moveDialAliasToIndex from ui/dials.js
  // Let's trigger a drop event which calls it internally:

  // The drop event calls _moveDialAliasToIndex if it's on the grid.
  // dialGridEl.addEventListener('drop', ... )
  // We can just trigger a drop on dialGridEl.
  const dialGridEl = document.getElementById('speed-dial');

  const dropEvent = new dom.window.Event('drop');
  dropEvent.dataTransfer = {
    getData: () => 'a',
    dropEffect: 'move'
  };
  dialGridEl.dispatchEvent(dropEvent);

  // Wait for async operations to complete
  await new Promise(r => setTimeout(r, 100));

  const endTotal = performance.now();

  console.log(`Total time: ${(endTotal - startTotal).toFixed(2)}ms`);
  console.log(`renderDials called: ${renderCount} times`);
  console.log(`renderDials total time: ${renderTime.toFixed(2)}ms`);

  process.exit(0);
}

run().catch(console.error);
