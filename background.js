// This handles the heavy lifting: tracking active sessions using Chrome Alarms (which persist across browser restarts),
// passive tracking for point deductions, and the XP/Ranking configurations.

// --- CONFIG LOADING ---
let BLOCKED_URLS = [];
let RANKS = [];

async function loadConfigs() {
  try {
    const blockedResp = await fetch(chrome.runtime.getURL('config/blocked_urls.json'));
    BLOCKED_URLS = await blockedResp.json();

    const ranksResp = await fetch(chrome.runtime.getURL('config/ranks.json'));
    RANKS = await ranksResp.json();
  } catch (err) {
    console.error('Failed to load config files', err);
  }
}

// Load configs on startup (service worker may initialize on demand)
loadConfigs();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['points','inSession','pendingXP'], (res) => {
    const defaults = {};
    if (typeof res.points === 'undefined') defaults.points = 0;
    if (typeof res.inSession === 'undefined') defaults.inSession = false;
    if (typeof res.pendingXP === 'undefined') defaults.pendingXP = 0;
    if (Object.keys(defaults).length) chrome.storage.local.set(defaults);
  });
});

// Periodic check to penalize if on blocked sites while NOT in a session
chrome.alarms.create("passiveTracking", { periodInMinutes: 1/6 }); 

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "lockInAlarm") {
    endSessionSuccessfully();
  } else if (alarm.name === "passiveTracking") {
    handlePassiveTracking();
  }
});

async function endSessionSuccessfully() {
  const data = await chrome.storage.local.get(["sessionDurationMinutes", "pendingXP"]);
  const mins = data.sessionDurationMinutes || 0;
  
  // XP formula: {0.9 - 1.1} * minutes
  const multiplier = 0.9 + Math.random() * 0.2;
  const xpGained = Math.round(multiplier * mins);

  // Accumulate just in case multiple sessions somehow finished unclaimed
  const currentPending = data.pendingXP || 0;

  await chrome.storage.local.set({
    pendingXP: currentPending + xpGained,
    inSession: false,
    sessionEndTime: null,
    sessionDurationMinutes: 0
  });

  chrome.alarms.clear("lockInAlarm");
}

async function handlePassiveTracking() {
  if (!BLOCKED_URLS || BLOCKED_URLS.length === 0) {
    await loadConfigs();
  }
  const data = await chrome.storage.local.get(["inSession", "points"]);
  if (data.inSession) return; 

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;

  const currentUrl = tabs[0].url;
  if (!currentUrl) return;

  const isBlocked = BLOCKED_URLS.some(url => currentUrl.includes(url));
  if (isBlocked) {
    let newPoints = (data.points || 0) - 0.333;
    if (newPoints < 0) newPoints = 0;
    await chrome.storage.local.set({ points: newPoints });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_URL") {
    const url = message.url;

    const respond = () => {
      const isBlocked = (BLOCKED_URLS || []).some(bUrl => url.includes(bUrl));
      chrome.storage.local.get(["inSession"], (data) => {
        sendResponse({ shouldBlock: isBlocked && data.inSession });
      });
    };

    if (!BLOCKED_URLS || BLOCKED_URLS.length === 0) {
      loadConfigs().then(respond).catch(() => respond());
    } else {
      respond();
    }
    return true; 
  }

  // Allows the popup (or other clients) to request the background finalize
  // a session that expired while the browser/extension was not active.
  if (message.type === "FORCE_END_SESSION") {
    endSessionSuccessfully()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err && err.message }));
    return true; // indicate async response
  }
});