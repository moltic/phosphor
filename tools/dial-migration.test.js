#!/usr/bin/env node
// ── tools/dial-migration.test.js ─────────────────────────────────────────────
// Self-contained unit tests for the DialStore v1 migration layer.
//
// Run with:  node tools/dial-migration.test.js
//
// The pure conversion functions (flatArrayToDialStore, dialStoreToFlatArray)
// are copied here verbatim so this file has zero runtime dependencies and
// never touches chrome.* APIs.  The async migration guard
// (migrateDialsToV1) is exercised through a lightweight chrome.storage mock.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// ── Reproduce the pure helpers from core/storage.js ──────────────────────────
// (Kept in sync manually; if the originals change, update here too.)

const DIAL_STORE_VERSION = 1;

function flatArrayToDialStore(flatDials) {
  const categories = [];
  let currentCat = { id: 'cat_default', label: '', collapsed: false, items: [] };
  categories.push(currentCat);

  for (const d of flatDials) {
    // ── dividers → item within current category
    if (d.type === 'divider') {
      const item = { id: d.alias, type: 'divider', alias: d.alias };
      if (d.col) item.col = true;
      currentCat.items.push(item);
      continue;
    }

    if (d.type === 'group-header') {
      currentCat = { id: d.alias, label: d.label || '', collapsed: false, items: [] };
      categories.push(currentCat);
      continue;
    }

    const item = {
      id:    d.alias,
      type:  d.type === 'weather' ? 'weather' : 'link',
      alias: d.alias,
      label: d.label || d.alias || '',
      url:   d.url   || '',
    };
    if (d.icon) item.icon = d.icon;
    currentCat.items.push(item);
  }

  if (
    categories.length > 1 &&
    categories[0].label === '' &&
    categories[0].items.length === 0
  ) {
    categories.shift();
  }

  if (categories.length === 0) {
    categories.push({ id: 'cat_default', label: '', collapsed: false, items: [] });
  }

  return { version: DIAL_STORE_VERSION, categories };
}

function dialStoreToFlatArray(store) {
  const flat = [];
  for (const cat of store.categories) {
    if (cat.label) {
      flat.push({ type: 'group-header', alias: cat.id, label: cat.label });
    }
    for (const item of cat.items) {
      if (item.type === 'divider') {
        const d = { type: 'divider', alias: item.alias };
        if (item.col) d.col = true;
        flat.push(d);
      } else if (item.type === 'weather') {
        flat.push({ type: 'weather', alias: item.alias, label: item.label, url: item.url });
      } else {
        const d = { alias: item.alias, label: item.label, url: item.url };
        if (item.icon) d.icon = item.icon;
        flat.push(d);
      }
    }
  }
  return flat;
}

// ── Minimal chrome.storage mock ───────────────────────────────────────────────

function makeMockStorage(syncInit = {}, localInit = {}) {
  const syncDb  = { ...syncInit };
  const localDb = { ...localInit };

  function makeArea(db) {
    return {
      async get(defaults) {
        const result = {};
        for (const [k, def] of Object.entries(defaults)) {
          result[k] = k in db ? db[k] : def;
        }
        return result;
      },
      async set(obj) {
        Object.assign(db, obj);
      },
      _db: db,
    };
  }

  return { storage: { sync: makeArea(syncDb), local: makeArea(localDb) } };
}

// Inline migrateDialsToV1 with an injected chrome object for testing.
async function migrateDialsToV1(chrome) {
  const flag = await chrome.storage.local.get({ _dialsMigratedV1: false });
  if (flag._dialsMigratedV1) return;

  const data = await chrome.storage.sync.get({ dials: [], dialStore: null });

  if (data.dialStore?.version === DIAL_STORE_VERSION) {
    await chrome.storage.local.set({ _dialsMigratedV1: true });
    return;
  }

  const legacyDials = Array.isArray(data.dials) ? data.dials : [];

  if (legacyDials.length > 0) {
    await chrome.storage.local.set({
      _dialBackupV0:   JSON.stringify(legacyDials),
      _dialBackupV0ts: Date.now(),
    });

    const store = flatArrayToDialStore(legacyDials);
    await chrome.storage.sync.set({ dialStore: store });
  }

  await chrome.storage.local.set({ _dialsMigratedV1: true });
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ── Suite: flatArrayToDialStore ───────────────────────────────────────────────
console.log('\nflatArrayToDialStore()');

test('empty array → single default category with no items', () => {
  const store = flatArrayToDialStore([]);
  assert.equal(store.version, 1);
  assert.equal(store.categories.length, 1);
  assert.equal(store.categories[0].label, '');
  assert.equal(store.categories[0].items.length, 0);
});

test('links only → all items in single default category', () => {
  const flat = [
    { alias: 'gh',  label: 'GitHub',      url: 'https://github.com' },
    { alias: 'hn',  label: 'Hacker News', url: 'https://news.ycombinator.com' },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories.length, 1);
  assert.equal(store.categories[0].items.length, 2);
  assert.equal(store.categories[0].items[0].type, 'link');
  assert.equal(store.categories[0].items[0].alias, 'gh');
  assert.equal(store.categories[0].items[1].alias, 'hn');
});

test('weather tile → type:"weather" item preserved', () => {
  const flat = [
    { type: 'weather', alias: 'weather', label: 'WEATHER', url: 'https://weather.com' },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories[0].items[0].type, 'weather');
  assert.equal(store.categories[0].items[0].url, 'https://weather.com');
});

test('icon field preserved on link items', () => {
  const flat = [{ alias: 'wiki', label: 'Wikipedia', url: 'https://en.wikipedia.org', icon: '📖' }];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories[0].items[0].icon, '📖');
});

test('dividers are preserved as items', () => {
  const flat = [
    { alias: 'gh',         label: 'GitHub', url: 'https://github.com' },
    { type: 'divider',     alias: '__div_1__' },
    { type: 'divider',     alias: '__div_2__', col: true },
    { alias: 'hn',         label: 'HN',     url: 'https://news.ycombinator.com' },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories[0].items.length, 4);
  const divs = store.categories[0].items.filter(i => i.type === 'divider');
  assert.equal(divs.length, 2);
  assert.equal(divs[1].col, true);
});

test('group headers become named categories', () => {
  const flat = [
    { alias: 'gh',  label: 'GitHub',  url: 'https://github.com' },
    { type: 'group-header', alias: '__grp_work__', label: 'Work' },
    { alias: 'jira', label: 'Jira',   url: 'https://jira.example.com' },
    { alias: 'cf',   label: 'Confluence', url: 'https://conf.example.com' },
    { type: 'group-header', alias: '__grp_social__', label: 'Social' },
    { alias: 'tw',   label: 'Twitter', url: 'https://x.com' },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories.length, 3);
  // Default (unnamed) bucket
  assert.equal(store.categories[0].label, '');
  assert.equal(store.categories[0].items.length, 1);
  assert.equal(store.categories[0].items[0].alias, 'gh');
  // Work category
  assert.equal(store.categories[1].id, '__grp_work__');
  assert.equal(store.categories[1].label, 'Work');
  assert.equal(store.categories[1].items.length, 2);
  // Social category
  assert.equal(store.categories[2].id, '__grp_social__');
  assert.equal(store.categories[2].label, 'Social');
  assert.equal(store.categories[2].items.length, 1);
});

test('leading default category is pruned when it has no items and named cats follow', () => {
  const flat = [
    { type: 'group-header', alias: '__grp_a__', label: 'A' },
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories.length, 1);
  assert.equal(store.categories[0].label, 'A');
});

test('leading default category is kept when it has items', () => {
  const flat = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
    { type: 'group-header', alias: '__grp_a__', label: 'A' },
    { alias: 'hn', label: 'HN', url: 'https://news.ycombinator.com' },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories.length, 2);
  assert.equal(store.categories[0].label, '');
  assert.equal(store.categories[0].items[0].alias, 'gh');
});

test('alias used as stable category id (needed for dialGroupCollapsed)', () => {
  const flat = [
    { type: 'group-header', alias: '__grp_42__', label: 'Stuff' },
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories[0].id, '__grp_42__');
});

test('missing url field defaults to empty string', () => {
  const flat = [{ alias: 'nurl', label: 'No URL' }]; // no url property
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories[0].items[0].url, '');
});

test('missing label field falls back to alias', () => {
  const flat = [{ alias: 'nolabel', url: 'https://example.com' }];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories[0].items[0].label, 'nolabel');
});

test('sequential group-headers produce separate named categories (first may be empty)', () => {
  const flat = [
    { type: 'group-header', alias: '__grp_a__', label: 'A' },
    { type: 'group-header', alias: '__grp_b__', label: 'B' },
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories.length, 2);
  assert.equal(store.categories[0].label, 'A');
  assert.equal(store.categories[0].items.length, 0); // A is empty
  assert.equal(store.categories[1].label, 'B');
  assert.equal(store.categories[1].items.length, 1);
});

test('all-dividers flat array → single default category with divider items', () => {
  const flat = [
    { type: 'divider', alias: '__div_1__' },
    { type: 'divider', alias: '__div_2__', col: true },
  ];
  const store = flatArrayToDialStore(flat);
  assert.equal(store.categories.length, 1);
  assert.equal(store.categories[0].label, '');
  assert.equal(store.categories[0].items.length, 2);
  assert.equal(store.categories[0].items[0].type, 'divider');
  assert.equal(store.categories[0].items[1].col, true);
});

// ── Suite: dialStoreToFlatArray ───────────────────────────────────────────────
console.log('\ndialStoreToFlatArray()');

test('unnamed category → no group-header emitted', () => {
  const store = {
    version: 1,
    categories: [{ id: 'cat_default', label: '', collapsed: false, items: [
      { id: 'gh', type: 'link', alias: 'gh', label: 'GitHub', url: 'https://github.com' },
    ]}],
  };
  const flat = dialStoreToFlatArray(store);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].alias, 'gh');
  assert(!('type' in flat[0]));
});

test('named category → group-header emitted before items', () => {
  const store = {
    version: 1,
    categories: [
      { id: '__grp_work__', label: 'Work', collapsed: false, items: [
        { id: 'jira', type: 'link', alias: 'jira', label: 'Jira', url: 'https://jira.example.com' },
      ]},
    ],
  };
  const flat = dialStoreToFlatArray(store);
  assert.equal(flat.length, 2);
  assert.equal(flat[0].type, 'group-header');
  assert.equal(flat[0].alias, '__grp_work__');
  assert.equal(flat[0].label, 'Work');
  assert.equal(flat[1].alias, 'jira');
});

test('weather item → type:"weather" in flat array', () => {
  const store = {
    version: 1,
    categories: [{ id: 'cat_default', label: '', collapsed: false, items: [
      { id: 'weather', type: 'weather', alias: 'weather', label: 'WEATHER', url: 'https://weather.com' },
    ]}],
  };
  const flat = dialStoreToFlatArray(store);
  assert.equal(flat[0].type, 'weather');
  assert.equal(flat[0].url, 'https://weather.com');
});

test('link item icon passes through', () => {
  const store = {
    version: 1,
    categories: [{ id: 'cat_default', label: '', collapsed: false, items: [
      { id: 'wiki', type: 'link', alias: 'wiki', label: 'Wikipedia', url: 'https://en.wikipedia.org', icon: '📖' },
    ]}],
  };
  const flat = dialStoreToFlatArray(store);
  assert.equal(flat[0].icon, '📖');
});

test('weather item icon NOT added (weather has no icon field in flat model)', () => {
  const store = {
    version: 1,
    categories: [{ id: 'cat_default', label: '', collapsed: false, items: [
      { id: 'weather', type: 'weather', alias: 'weather', label: 'WEATHER', url: 'https://weather.com' },
    ]}],
  };
  const flat = dialStoreToFlatArray(store);
  assert(!('icon' in flat[0]), 'weather flat entries should not have icon');
});

test('link item without icon field does not emit icon key in flat array', () => {
  const store = {
    version: 1,
    categories: [{ id: 'cat_default', label: '', collapsed: false, items: [
      { id: 'gh', type: 'link', alias: 'gh', label: 'GitHub', url: 'https://github.com' },
    ]}],
  };
  const flat = dialStoreToFlatArray(store);
  assert(!('icon' in flat[0]), 'link without icon should not emit icon key');
});

// ── Suite: round-trip fidelity ────────────────────────────────────────────────
console.log('\nRound-trip fidelity');

test('links + weather + groups survive flat → store → flat', () => {
  const original = [
    { alias: 'gh',  label: 'GitHub',  url: 'https://github.com' },
    { alias: 'hn',  label: 'HN',      url: 'https://news.ycombinator.com' },
    { type: 'weather', alias: 'weather', label: 'WEATHER', url: 'https://weather.com' },
    { type: 'group-header', alias: '__grp_work__', label: 'Work' },
    { alias: 'jira', label: 'Jira',   url: 'https://jira.example.com' },
  ];
  const roundTrip = dialStoreToFlatArray(flatArrayToDialStore(original));
  assert.deepEqual(roundTrip, original);
});

test('dividers survive flat → store → flat round-trip', () => {
  const original = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
    { type: 'divider', alias: '__div_1__' },
    { alias: 'hn', label: 'HN',    url: 'https://news.ycombinator.com' },
    { type: 'divider', alias: '__div_2__', col: true },
  ];
  const roundTrip = dialStoreToFlatArray(flatArrayToDialStore(original));
  assert.deepEqual(roundTrip, original);
});

test('icon field survives round-trip on link items', () => {
  const original = [{ alias: 'wiki', label: 'Wikipedia', url: 'https://en.wikipedia.org', icon: '🌐' }];
  const roundTrip = dialStoreToFlatArray(flatArrayToDialStore(original));
  assert.equal(roundTrip[0].icon, '🌐');
});

test('empty default category survives round-trip when no named cats exist', () => {
  const original = [];
  const roundTrip = dialStoreToFlatArray(flatArrayToDialStore(original));
  assert.equal(roundTrip.length, 0); // no items to emit
});

test('sequential group-headers (one empty) survive round-trip', () => {
  const original = [
    { type: 'group-header', alias: '__grp_a__', label: 'A' },
    { type: 'group-header', alias: '__grp_b__', label: 'B' },
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
  ];
  const roundTrip = dialStoreToFlatArray(flatArrayToDialStore(original));
  // A is empty \u2014 its header still round-trips because the category exists.
  assert.equal(roundTrip[0].type, 'group-header');
  assert.equal(roundTrip[0].label, 'A');
  assert.equal(roundTrip[1].type, 'group-header');
  assert.equal(roundTrip[1].label, 'B');
  assert.equal(roundTrip[2].alias, 'gh');
});

// ── Suite: migrateDialsToV1 (async) ─────────────────────────────────────────-
console.log('\nmigrateDialsToV1()');

await asyncTest('no-ops when _dialsMigratedV1 flag is set', async () => {
  const chrome = makeMockStorage(
    { dials: [{ alias: 'gh', label: 'GitHub', url: 'https://github.com' }] },
    { _dialsMigratedV1: true },
  );
  await migrateDialsToV1(chrome);
  // dialStore must NOT have been written
  assert.equal(chrome.storage.sync._db.dialStore, undefined);
});

await asyncTest('converts legacy dials when dialStore absent', async () => {
  const legacy = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
    { type: 'weather', alias: 'weather', label: 'WEATHER', url: 'https://weather.com' },
  ];
  const chrome = makeMockStorage({ dials: legacy }, {});
  await migrateDialsToV1(chrome);

  const store = chrome.storage.sync._db.dialStore;
  assert.ok(store, 'dialStore should be written');
  assert.equal(store.version, 1);
  assert.equal(store.categories[0].items.length, 2);
  assert.equal(store.categories[0].items[1].type, 'weather');
});

await asyncTest('stores _dialBackupV0 with original JSON in local storage', async () => {
  const legacy = [{ alias: 'gh', label: 'GitHub', url: 'https://github.com' }];
  const chrome = makeMockStorage({ dials: legacy }, {});
  await migrateDialsToV1(chrome);

  const backup = chrome.storage.local._db._dialBackupV0;
  assert.ok(backup, '_dialBackupV0 should be set');
  assert.deepEqual(JSON.parse(backup), legacy);
});

await asyncTest('sets _dialsMigratedV1 flag after migration', async () => {
  const chrome = makeMockStorage({ dials: [] }, {});
  await migrateDialsToV1(chrome);
  assert.equal(chrome.storage.local._db._dialsMigratedV1, true);
});

await asyncTest('does NOT overwrite dialStore already at v1', async () => {
  const existingStore = { version: 1, categories: [{ id: 'cat_default', label: '', collapsed: false, items: [] }] };
  const chrome = makeMockStorage({ dialStore: existingStore }, {});
  await migrateDialsToV1(chrome);
  // dialStore must remain identical (same reference held by syncDb)
  assert.deepEqual(chrome.storage.sync._db.dialStore, existingStore);
});

await asyncTest('does NOT write _dialBackupV0 when legacy dials is empty', async () => {
  const chrome = makeMockStorage({ dials: [] }, {});
  await migrateDialsToV1(chrome);
  assert.equal(chrome.storage.local._db._dialBackupV0, undefined);
});

await asyncTest('migration is idempotent — second call is a no-op', async () => {
  const legacy = [{ alias: 'gh', label: 'GitHub', url: 'https://github.com' }];
  const chrome = makeMockStorage({ dials: legacy }, {});
  await migrateDialsToV1(chrome);
  const storeAfterFirst = JSON.stringify(chrome.storage.sync._db.dialStore);

  // Second call — legacy dials still present in sync storage.
  await migrateDialsToV1(chrome);
  assert.equal(JSON.stringify(chrome.storage.sync._db.dialStore), storeAfterFirst);
});

await asyncTest('group-headers become named categories', async () => {
  const legacy = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
    { type: 'group-header', alias: '__grp_work__', label: 'Work' },
    { alias: 'jira', label: 'Jira', url: 'https://jira.example.com' },
  ];
  const chrome = makeMockStorage({ dials: legacy }, {});
  await migrateDialsToV1(chrome);

  const store = chrome.storage.sync._db.dialStore;
  assert.equal(store.categories.length, 2);
  assert.equal(store.categories[1].label, 'Work');
  assert.equal(store.categories[1].items[0].alias, 'jira');
});

await asyncTest('dividers are preserved during migration', async () => {
  const legacy = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
    { type: 'divider', alias: '__div_1__' },
    { type: 'divider', alias: '__div_2__', col: true },
    { alias: 'hn', label: 'HN', url: 'https://news.ycombinator.com' },
  ];
  const chrome = makeMockStorage({ dials: legacy }, {});
  await migrateDialsToV1(chrome);

  const flat = dialStoreToFlatArray(chrome.storage.sync._db.dialStore);
  const dividers = flat.filter(d => d.type === 'divider');
  assert.equal(dividers.length, 2, 'both dividers should survive migration');
  assert.equal(dividers[0].alias, '__div_1__');
  assert.equal(dividers[1].alias, '__div_2__');
  assert.equal(dividers[1].col, true);
  assert.equal(flat.length, 4);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`${'─'.repeat(52)}\n`);

if (failed > 0) process.exit(1);
