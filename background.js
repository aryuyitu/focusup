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

const RANKS = [
  { name: "Unranked", min: 0, max: 99, icon: "icons/rank_unranked.png" },
  { name: "Bronze", min: 100, max: 299, icon: "icons/rank_bronze.png" },
  { name: "Silver", min: 300, max: 599, icon: "icons/rank_silver.png" },
  { name: "Gold", min: 600, max: 999999, icon: "icons/rank_silver.png" } // Scale up as needed
];

// Initialize global state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    points: 0,
    inSession: false,
    sessionEndTime: null,
    sessionDurationMinutes: 0
  });
});

// Periodic check (every 10 seconds) to penalize if on blocked sites while NOT in a session
chrome.alarms.create("passiveTracking", { periodInMinutes: 1/6 }); 

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "lockInAlarm") {
    // Session completed successfully!
    endSessionSuccessfully();
  } else if (alarm.name === "passiveTracking") {
    handlePassiveTracking();
  }
});

async function endSessionSuccessfully() {
  const data = await chrome.storage.local.get(["sessionDurationMinutes", "points"]);
  const mins = data.sessionDurationMinutes || 0;
  
  // XP formula: {0.9 - 1.1} * minutes
  const multiplier = 0.9 + Math.random() * 0.2;
  const xpGained = Math.round(multiplier * mins);

  let newPoints = (data.points || 0) + xpGained;
  if (newPoints < 0) newPoints = 0;

  await chrome.storage.local.set({
    points: newPoints,
    inSession: false,
    sessionEndTime: null,
    sessionDurationMinutes: 0
  });

  chrome.alarms.clear("lockInAlarm");
}

async function handlePassiveTracking() {
  const data = await chrome.storage.local.get(["inSession", "points"]);
  if (data.inSession) return; // Handled by content script blockades

  // Check active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;

  const currentUrl = tabs[0].url;
  if (!currentUrl) return;

  const isBlocked = BLOCKED_URLS.some(url => currentUrl.includes(url));
  if (isBlocked) {
    // 2 points per minute = ~0.33 points per 10 seconds
    let newPoints = (data.points || 0) - 0.333;
    if (newPoints < 0) newPoints = 0;
    await chrome.storage.local.set({ points: newPoints });
  }
}

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_URL") {
    const url = message.url;
    const isBlocked = BLOCKED_URLS.some(bUrl => url.includes(bUrl));
    
    chrome.storage.local.get(["inSession"], (data) => {
      sendResponse({ shouldBlock: isBlocked && data.inSession });
    });
    return true; // Keep channel open for async response
  }
});