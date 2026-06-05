// This file connects to local storage, displays values, tracks down calculations for current ranks,
// and updates a visual ticking timer when the pop-up is active.

// Duplicate rank architecture for clean pop-up rendering calculations
const RANKS = [
  { name: "Unranked", min: 0, max: 99, icon: "icons/rank_unranked.png" },
  { name: "Bronze", min: 100, max: 299, icon: "icons/rank_bronze.png" },
  { name: "Silver", min: 300, max: 599, icon: "icons/rank_silver.png" },
  { name: "Gold", min: 600, max: 999999, icon: "icons/rank_silver.png" }
];

let timerInterval = null;

document.addEventListener("DOMContentLoaded", () => {
  updateUI();
  timerInterval = setInterval(updateUI, 1000); // Keep timer/points updated while popup is open

  document.getElementById("startBtn").addEventListener("click", startSession);
  document.getElementById("stopBtn").addEventListener("click", stopSessionManually);
});

async function updateUI() {
  const data = await chrome.storage.local.get(["points", "inSession", "sessionEndTime"]);
  const points = Math.floor(data.points || 0);

  // 1. Handle Ranking Engine
  let currentRank = RANKS[0];
  for (const rank of RANKS) {
    if (points >= rank.min && points <= rank.max) {
      currentRank = rank;
      break;
    }
  }

  document.getElementById("rankName").innerText = currentRank.name;
  document.getElementById("rankIcon").src = currentRank.icon;
  document.getElementById("pointsText").innerText = `${points} XP`;

  // Calculate Progress Bar percentage
  const range = currentRank.max - currentRank.min;
  const progressInRank = points - currentRank.min;
  const percent = range > 0 ? (progressInRank / range) * 100 : 100;
  document.getElementById("expBar").style.width = `${Math.min(100, Math.max(0, percent))}%`;

  // 2. Handle Session View / Timer Engine
  const setupMode = document.getElementById("setupMode");
  const activeMode = document.getElementById("activeMode");
  const timerDisplay = document.getElementById("timerDisplay");

  if (data.inSession && data.sessionEndTime) {
    setupMode.classList.add("hidden");
    activeMode.classList.remove("hidden");

    const now = Date.now();
    const timeLeft = data.sessionEndTime - now;

    if (timeLeft <= 0) {
      // The background script might be in the middle of processing this, update UI gracefully
      timerDisplay.innerText = "00:00";
    } else {
      const totalSeconds = Math.floor(timeLeft / 1000);
      const mins = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
      const secs = (totalSeconds % 60).toString().padStart(2, "0");
      timerDisplay.innerText = `${mins}:${secs}`;
    }
  } else {
    setupMode.classList.remove("hidden");
    activeMode.classList.add("hidden");
  }
}

function startSession() {
  const durationInput = document.getElementById("durationInput").value;
  const minutes = parseInt(durationInput, 10) || 25;

  const msToLock = minutes * 60 * 1000;
  const sessionEndTime = Date.now() + msToLock;

  // Save to persistence storage
  chrome.storage.local.set({
    inSession: true,
    sessionEndTime: sessionEndTime,
    sessionDurationMinutes: minutes
  }, () => {
    // Spin up standard Chrome alarm for execution robustness
    chrome.alarms.create("lockInAlarm", { delayInMinutes: minutes });
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