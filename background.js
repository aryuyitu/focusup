// This handles the heavy lifting: tracking active sessions using Chrome Alarms (which persist across browser restarts),
// passive tracking for point deductions, and the XP/Ranking configurations.

// --- CONFIG LOADING ---
let BLOCKED_URLS = [];
let RANKS = [];

const DEFAULT_PASSIVE_PENALTY = 0.333; // fallback per-10s penalty

async function loadConfigs() {
  try {
    const blockedResp = await fetch(chrome.runtime.getURL('config/blocked_urls.json'));
    BLOCKED_URLS = await blockedResp.json();

    const ranksResp = await fetch(chrome.runtime.getURL('config/ranks.json'));
    RANKS = await ranksResp.json();
    // After loading ranks, ensure stored currentRank matches stored points
    try {
      const stored = await chrome.storage.local.get(['points']);
      const currentPoints = stored.points || 0;
      await updateStoredRank(currentPoints);
    } catch (err) {
      // non-fatal
    }
  } catch (err) {
    console.error('Failed to load config files', err);
  }
}

// Load configs on startup (service worker may initialize on demand)
loadConfigs();

// Utility to prefer user-configured blocked URLs from storage, falling back to bundled list
async function getBlockedUrls() {
  try {
    const stored = await chrome.storage.local.get(['blockedUrls']);
    if (stored && Array.isArray(stored.blockedUrls) && stored.blockedUrls.length > 0) {
      return stored.blockedUrls;
    }
  } catch (e) {
    // ignore
  }
  if (!BLOCKED_URLS || BLOCKED_URLS.length === 0) {
    await loadConfigs();
  }
  return BLOCKED_URLS || [];
}

function getPenaltyForPoints(points) {
  const p = (typeof points === 'number') ? points : (Number(points) || 0);
  if (!Array.isArray(RANKS) || RANKS.length === 0) return DEFAULT_PASSIVE_PENALTY;

  const rank = RANKS.find(r =>
    typeof r.min === 'number' && typeof r.max === 'number' && p >= r.min && p <= r.max
  );

  if (!rank) return DEFAULT_PASSIVE_PENALTY;
  if (typeof rank.passivePenalty === 'number') return rank.passivePenalty;
  if (typeof rank.penalty === 'number') return rank.penalty; // legacy support
  return DEFAULT_PASSIVE_PENALTY;
}

function computeRankForPoints(points) {
  const p = (typeof points === 'number') ? points : (Number(points) || 0);
  if (!Array.isArray(RANKS) || RANKS.length === 0) return null;
  return RANKS.find(r => typeof r.min === 'number' && typeof r.max === 'number' && p >= r.min && p <= r.max) || null;
}

async function updateStoredRank(points) {
  const rank = computeRankForPoints(points);
  if (!rank) return;
  try {
    const current = await chrome.storage.local.get(['currentRank']);
    const stored = current.currentRank;
    if (!stored || stored.name !== rank.name) {
      await chrome.storage.local.set({ currentRank: rank });
    }
  } catch (err) {
    // ignore storage errors
  }
}

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
  const data = await chrome.storage.local.get(["inSession", "points"]);
  if (data.inSession) return; 

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;

  const currentUrl = tabs[0].url;
  if (!currentUrl) return;

  const blocked = await getBlockedUrls();
  const isBlocked = blocked.some(url => currentUrl.includes(url));
  if (isBlocked) {
    const currentPoints = (typeof data.points === 'number') ? data.points : (Number(data.points) || 0);
    const penalty = getPenaltyForPoints(currentPoints);
    let newPoints = currentPoints - penalty;
    if (newPoints < 0) newPoints = 0;
    await chrome.storage.local.set({ points: newPoints });
    try { await updateStoredRank(newPoints); } catch (e) { /* ignore */ }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_URL") {
    const url = message.url;
    (async () => {
      try {
        const blocked = await getBlockedUrls();
        const isBlocked = (blocked || []).some(bUrl => url.includes(bUrl));
        chrome.storage.local.get(["inSession"], (data) => {
          sendResponse({ shouldBlock: isBlocked && data.inSession });
        });
      } catch (e) {
        chrome.storage.local.get(["inSession"], (data) => {
          sendResponse({ shouldBlock: false && data.inSession });
        });
      }
    })();
    return true;
  }

  // Close settings page if session started elsewhere
  if (message.type === 'SESSION_STARTED') {
    try {
      const settingsUrl = chrome.runtime.getURL('settings.html');
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) {
          try {
            if (t && t.url && (t.url === settingsUrl || t.url.startsWith(settingsUrl))) {
              chrome.tabs.remove(t.id);
            }
          } catch (e) { /* ignore per-tab errors */ }
        }
      });
    } catch (e) {
      // ignore
    }
    return; // no response needed
  }

  if (message.type === "NAVIGATE_TO_BLOCKED") {
    // Navigate the sender tab to the extension's blocked page. Do this from the
    // background because navigating directly from content scripts can yield
    // chrome-extension://invalid/ in some contexts.
    try {
      if (sender && sender.tab && typeof sender.tab.id !== 'undefined') {
        chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL('blocked.html') });
      }
    } catch (err) {
      console.error('Failed to navigate to blocked page', err);
    }
    return; // no async response
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