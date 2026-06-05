// This handles the heavy lifting: tracking active sessions using Chrome Alarms (which persist across browser restarts),
// passive tracking for point deductions, and the XP/Ranking configurations.

// --- CONFIGURATIONS ---
const BLOCKED_URLS = [
  "youtube.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "reddit.com"
];

// 1 day to get out of iron
// 12 hours = 720 mins, make it 750 for nice number
// 900 mins for silver
// 1050 mins for gold
// 

const RANKS = [
  { name: "Iron 1", min: 0, max: 249, icon: "icons/ranks/iron-1.png" },
  { name: "Iron 2", min: 250, max: 499, icon: "icons/ranks/iron-2.png" },
  { name: "Iron 3", min: 500, max: 749, icon: "icons/ranks/iron-3.png" }, 
  { name: "Bronze 1", min: 750, max: 1049, icon: "icons/ranks/bronze-1.png" },
  { name: "Bronze 2", min: 1050, max: 1349, icon: "icons/ranks/bronze-2.png" },
  { name: "Bronze 3", min: 1350, max: 9999, icon: "icons/ranks/bronze-3.png" },
  { name: "Silver 1", min: 10000, max: 99999, icon: "icons/ranks/silver-1.png" },
  { name: "Silver 2", min: 10000, max: 99999, icon: "icons/ranks/silver-2.png" },
  { name: "Silver 3", min: 10000, max: 99999, icon: "icons/ranks/silver-3.png" },
  { name: "Gold 1", min: 10000, max: 99999, icon: "icons/ranks/gold-1.png" },
  { name: "Gold 2", min: 10000, max: 99999, icon: "icons/ranks/gold-2.png" },
  { name: "Gold 3", min: 10000, max: 99999, icon: "icons/ranks/gold-3.png" },
  { name: "Platinum 1", min: 10000, max: 99999, icon: "icons/ranks/platinum-1.png" },
  { name: "Platinum 2", min: 10000, max: 99999, icon: "icons/ranks/platinum-2.png" },
  { name: "Platinum 3", min: 10000, max: 99999, icon: "icons/ranks/platinum-3.png" },
  { name: "Diamond 1", min: 10000, max: 99999, icon: "icons/ranks/diamond-1.png" },
  { name: "Diamond 2", min: 10000, max: 99999, icon: "icons/ranks/diamond-2.png" },
  { name: "Diamond 3", min: 10000, max: 99999, icon: "icons/ranks/diamond-3.png" },
  { name: "Ascendant 1", min: 10000, max: 99999, icon: "icons/ranks/ascendant-1.png" },
  { name: "Ascendant 2", min: 10000, max: 99999, icon: "icons/ranks/ascendant-2.png" },
  { name: "Ascendant 3", min: 10000, max: 99999, icon: "icons/ranks/ascendant-2.png" }, // Scale up as needed
  { name: "Immortal 1", min: 10000, max: 99999, icon: "icons/ranks/immortal-1.png" },
  { name: "Immortal 2", min: 10000, max: 99999, icon: "icons/ranks/immortal-2.png" },
  { name: "Immortal 3", min: 10000, max: 99999, icon: "icons/ranks/immortal-3.png" },
  { name: "Radiant", min: 10000, max: 99999, icon: "icons/ranks/radiant.png" },
];

// Initialize global state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    points: 0,
    inSession: false,
    sessionEndTime: null,
    sessionDurationMinutes: 0,
    pendingXP: 0 // New state tracking for unclaimed XP
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
  // const mins = data.sessionDurationMinutes || 0;
  const mins = 100
  
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
    const isBlocked = BLOCKED_URLS.some(bUrl => url.includes(bUrl));
    
    chrome.storage.local.get(["inSession"], (data) => {
      sendResponse({ shouldBlock: isBlocked && data.inSession });
    });
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