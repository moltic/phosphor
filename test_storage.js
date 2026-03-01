import { saveDials } from './core/storage.js';

// Mock chrome
global.chrome = {
  storage: {
    sync: {
      set: async (obj) => {
        console.log('Setting:', Object.keys(obj));
        // trigger listener
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
      get: async () => ({})
    }
  }
};

global.listener = (changes, area) => {
  if (area !== 'sync') return;
  console.log('Listener received changes for:', Object.keys(changes));
  if (changes.dials) console.log('renderDials called!');
};

saveDials([{ alias: 'test', type: 'link', url: 'http://test.com' }]);
