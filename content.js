// This script runs automatically on every webpage you visit. 
// It asks the background script if the site should be blocked based on the current session status.

function checkAndBlock() {
  chrome.runtime.sendMessage({ type: "CHECK_URL", url: window.location.href }, (response) => {
    if (response && response.shouldBlock) {
      // Ask the background script to navigate this tab to the extension's block screen.
      // Doing the navigation from the background avoids chrome-extension://invalid/ issues
      // that can occur when content scripts attempt to navigate directly to extension pages.
      chrome.runtime.sendMessage({ type: "NAVIGATE_TO_BLOCKED" });
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