// This file connects to local storage, displays values, tracks down calculations for current ranks,
// and updates a visual ticking timer when the pop-up is active.

// Duplicate rank architecture for clean pop-up rendering calculations
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
  { name: "Ascendant 3", min: 10000, max: 99999, icon: "icons/ranks/ascendant-2.png" },
  { name: "Immortal 1", min: 10000, max: 99999, icon: "icons/ranks/immortal-1.png" },
  { name: "Immortal 2", min: 10000, max: 99999, icon: "icons/ranks/immortal-2.png" },
  { name: "Immortal 3", min: 10000, max: 99999, icon: "icons/ranks/immortal-3.png" },
  { name: "Radiant", min: 10000, max: 99999, icon: "icons/ranks/radiant.png" },
];

let timerInterval = null;

document.addEventListener("DOMContentLoaded", () => {
  updateUI();
  timerInterval = setInterval(updateUI, 1000); 

  document.getElementById("startBtn").addEventListener("click", startSession);
  document.getElementById("stopBtn").addEventListener("click", stopSessionManually);
  document.getElementById("claimBtn").addEventListener("click", claimPoints);
});

async function updateUI() {
  const data = await chrome.storage.local.get(["points", "inSession", "sessionEndTime", "pendingXP"]);
  const points = Math.floor(data.points || 0);
  const pendingXP = data.pendingXP || 0;

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
      timerDisplay.innerText = "00:00";
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
}

function startSession() {
  const durationInput = document.getElementById("durationInput").value;
  const minutes = parseInt(durationInput, 10) || 25;

  const msToLock = minutes * 60 * 1000;
  const sessionEndTime = Date.now() + msToLock;

  chrome.storage.local.set({
    inSession: true,
    sessionEndTime: sessionEndTime,
    sessionDurationMinutes: minutes
  }, () => {
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

async function claimPoints() {
  const data = await chrome.storage.local.get(["points", "pendingXP"]);
  const newPoints = (data.points || 0) + (data.pendingXP || 0);

  // Commit points to ledger and wipe pending
  await chrome.storage.local.set({
    points: newPoints,
    pendingXP: 0
  });

  updateUI();
}