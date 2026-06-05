// This script runs automatically on every webpage you visit. 
// It asks the background script if the site should be blocked based on the current session status.

function checkAndBlock() {
  chrome.runtime.sendMessage({ type: "CHECK_URL", url: window.location.href }, (response) => {
    if (response && response.shouldBlock) {
      // Redirect page to the local extension block screen
      window.location.href = chrome.runtime.getURL("blocked.html");
    }
  });
}

// Run immediately on page load
checkAndBlock();

// Also handle SPA navigation or dynamic URL updates
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    checkAndBlock();
  }
}).observe(document, { subtree: true, childList: true });