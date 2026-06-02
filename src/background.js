// Nodea Tree for Claude — service worker.
// Relays toolbar-icon clicks to the active claude.ai tab so the content script
// can toggle the panel.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return
  chrome.tabs.sendMessage(tab.id, { type: 'NX_TOGGLE' }).catch(() => {})
})
