// This file connects to local storage, displays values, tracks down calculations for current ranks,
// and updates a visual ticking timer when the pop-up is active.

// Ranks loaded from config/ranks.json at runtime
let RANKS = [];

async function loadRanks() {
  try {
    const resp = await fetch(chrome.runtime.getURL('config/ranks.json'));
    RANKS = await resp.json();
  } catch (err) {
    console.error('Failed to load ranks config', err);
  }
}

let timerInterval = null;
let forceEndRequested = false;

document.addEventListener("DOMContentLoaded", async () => {
  await loadRanks();
  updateUI();
  timerInterval = setInterval(updateUI, 1000); 

  document.getElementById("startBtn").addEventListener("click", startSession);
  document.getElementById("stopBtn").addEventListener("click", stopSessionManually);
  document.getElementById("claimBtn").addEventListener("click", claimPoints);
  const cog = document.getElementById('settingsCog');
  if (cog) {
    cog.addEventListener('click', () => {
      window.open(chrome.runtime.getURL('settings.html'));
    });
  }
});

async function updateUI() {
  const data = await chrome.storage.local.get(["points", "inSession", "sessionEndTime", "pendingXP"]);
  const points = Math.floor(data.points || 0);
  const pendingXP = data.pendingXP || 0;

  // 1. Handle Ranking Engine — prefer stored `currentRank`, fallback to computing from RANKS
  const storage = await chrome.storage.local.get(['currentRank']);
  let currentRank = storage.currentRank;
  if (!currentRank) {
    currentRank = (RANKS && RANKS.length > 0) ? RANKS[0] : { name: 'Iron 1', min: 0, max: 100, icon: 'icons/ranks/iron-1.png' };
    for (const rank of RANKS) {
      if (points >= rank.min && points <= rank.max) {
        currentRank = rank;
        break;
      }
    }
    // persist computed rank for subsequent opens
    try { chrome.storage.local.set({ currentRank }); } catch (e) { /* ignore */ }
  }

  const xpToNextRank = currentRank.max - points

  document.getElementById("rankName").innerText = currentRank.name;
  document.getElementById("rankIcon").src = currentRank.icon;
  document.getElementById("pointsText").innerText = `${points} XP - ${xpToNextRank} to next rank`;

  const range = currentRank.max - currentRank.min;
  const progressInRank = points - currentRank.min;
  const percent = range > 0 ? (progressInRank / range) * 100 : 100;
  document.getElementById("expBar").style.width = `${Math.min(100, Math.max(0, percent))}%`;

  // 2. State-Based View Management (Setup vs Active vs Claim)
  const setupMode = document.getElementById("setupMode");
  const activeMode = document.getElementById("activeMode");
  const claimMode = document.getElementById("claimMode");
  const timerDisplay = document.getElementById("timerDisplay");

  // Priority 1: If there is pending XP, force them to claim it first
  if (pendingXP > 0) {
    setupMode.classList.add("hidden");
    activeMode.classList.add("hidden");
    claimMode.classList.remove("hidden");
    
    document.getElementById("claimBtn").innerText = `Claim ${pendingXP} XP!`;
  } 
  // Priority 2: If currently locking in, track the timer
  else if (data.inSession && data.sessionEndTime) {
    setupMode.classList.add("hidden");
    activeMode.classList.remove("hidden");
    claimMode.classList.add("hidden");

    const now = Date.now();
    const timeLeft = data.sessionEndTime - now;

    if (timeLeft <= 0) {
      // Session expired while the extension/browser was inactive.
      // Ask the background to finalize the session so pendingXP is set.
      timerDisplay.innerText = "00:00";
      if (!forceEndRequested) {
        forceEndRequested = true;
        chrome.runtime.sendMessage({ type: "FORCE_END_SESSION" }, (resp) => {
          // Refresh UI after background processed the end
          forceEndRequested = false;
          updateUI();
        });
      }
    } else {
      const totalSeconds = Math.floor(timeLeft / 1000);
      const mins = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
      const secs = (totalSeconds % 60).toString().padStart(2, "0");
      timerDisplay.innerText = `${mins}:${secs}`;
    }
  } 
  // Priority 3: Default configuration view
  else {
    setupMode.classList.remove("hidden");
    activeMode.classList.add("hidden");
    claimMode.classList.add("hidden");
  }

  // Show settings cog only when in setupMode (no pending XP and not active session)
  const cog = document.getElementById('settingsCog');
  if (cog) {
    if (!setupMode.classList.contains('hidden')) {
      cog.classList.remove('hidden');
    } else {
      cog.classList.add('hidden');
    }
  }
}

function startSession() {
  const durationInput = document.getElementById("durationInput").value;
  const minutes = parseInt(durationInput, 10) || 60;

  const msToLock = minutes * 60 * 1000;
  const sessionEndTime = Date.now() + msToLock;

  chrome.storage.local.set({
    inSession: true,
    sessionEndTime: sessionEndTime,
    sessionDurationMinutes: minutes
  }, () => {
    chrome.alarms.create("lockInAlarm", { delayInMinutes: minutes });
    // Notify background so it can close any open settings pages.
    try { chrome.runtime.sendMessage({ type: 'SESSION_STARTED' }); } catch (e) { /* ignore */ }
    updateUI();
  });
}

function stopSessionManually() {
  chrome.storage.local.set({
    inSession: false,
    sessionEndTime: null,
    sessionDurationMinutes: 0
  }, () => {
    chrome.alarms.clear("lockInAlarm");
    updateUI();
  });
}

async function claimPoints() {
  const data = await chrome.storage.local.get(["points", "pendingXP"]);
  const newPoints = (data.points || 0) + (data.pendingXP || 0);

  // Commit points to ledger and wipe pending
  await chrome.storage.local.set({ points: newPoints, pendingXP: 0 });

  // Update stored rank after claiming
  if (RANKS && RANKS.length > 0) {
    let computedRank = RANKS[0];
    for (const rank of RANKS) {
      if (newPoints >= rank.min && newPoints <= rank.max) {
        computedRank = rank;
        break;
      }
    }
    try { await chrome.storage.local.set({ currentRank: computedRank }); } catch (e) { /* ignore */ }
  }

  updateUI();
}