// ── background.js ─────────────────────────────────────────────────────────────
// Background service worker.
// Handles the global Ctrl+Shift+D command: captures the active tab's URL and
// title, stores them in local storage, then opens a new tab.  The Phosphor new-
// tab page reads the pending entry on load and opens the pre-filled add dialog.

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'add-current-tab-dial') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Persist the tab data so the new-tab page can pick it up.
  await chrome.storage.local.set({
    _pendingTabDial: { url: tab.url || '', title: tab.title || '' },
  });

  // Open a new tab (Phosphor).  It will consume _pendingTabDial on init.
  chrome.tabs.create({});
});
