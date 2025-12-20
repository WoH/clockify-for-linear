// Content loader - injects an iframe with the full widget UI directly visible

const CONTAINER_ID = "clockify-linear-container";
const IFRAME_ID = "clockify-linear-iframe";

// Track the last detected issue to avoid stale titles
let lastDetectedIdentifier: string | null = null;
let lastDetectedTitle: string | null = null;

function isLinearIssuePage(): boolean {
  return /linear\.app\/[^/]+\/issue\/[A-Z]+-\d+/.test(window.location.href);
}

function parseLinearIssue() {
  const url = window.location.href;
  const match = url.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/);
  if (!match) return null;

  const identifier = match[1];

  // Linear uses the first <p> in main as the issue title
  const mainContent = document.querySelector('main');
  const firstP = mainContent?.querySelector('p');
  const title = firstP?.textContent?.trim() || identifier;

  const statusEl = document.querySelector('[data-testid="issue-status"]') ||
                   document.querySelector('[class*="StatusBadge"]');
  const status = statusEl?.textContent?.trim() || "Unknown";

  return { id: identifier, identifier, title, status, priority: 2, url };
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = /*css*/`
    #${CONTAINER_ID} {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      width: 48px;
      height: 48px;
      transition: width 0.2s ease, height 0.2s ease;
    }

    #${CONTAINER_ID}.expanded {
      width: 400px;
      height: 520px;
    }

    #${IFRAME_ID} {
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 50%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
      background: transparent;
      transition: border-radius 0.2s ease;
    }

    #${CONTAINER_ID}.expanded #${IFRAME_ID} {
      border-radius: 12px;
    }
  `;
  document.head.appendChild(style);
}

function createIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.id = IFRAME_ID;
  iframe.src = chrome.runtime.getURL("content.html");
  return iframe;
}

// Listen for messages from widget iframe
window.addEventListener("message", (event) => {
  if (event.data?.type === "CLOCKIFY_MINIMIZED") {
    const container = document.getElementById(CONTAINER_ID);
    if (container) {
      container.className = event.data.minimized ? "" : "expanded";
    }
  }
});

function init() {
  if (document.getElementById(CONTAINER_ID)) return;

  injectStyles();

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.className = "expanded"; // Start expanded

  const iframe = createIframe();
  container.appendChild(iframe);
  document.body.appendChild(container);

  // Track active retry interval to cancel on new navigation
  let activeRetryInterval: ReturnType<typeof setInterval> | null = null;

  // Send issue update to background AND directly to iframe
  const notifyIssue = (issue: ReturnType<typeof parseLinearIssue>) => {
    if (issue) {
      lastDetectedIdentifier = issue.identifier;
      lastDetectedTitle = issue.title;
      // Send to background for storage
      chrome.runtime.sendMessage({ type: "LINEAR_ISSUE_DETECTED", payload: issue });
      // Send directly to iframe (Firefox fix - runtime.sendMessage doesn't reach iframes)
      iframe.contentWindow?.postMessage({ type: "LINEAR_ISSUE_UPDATED", payload: issue }, "*");
    }
  };

  // Check if the title looks valid (not stale)
  const isTitleValid = (issue: NonNullable<ReturnType<typeof parseLinearIssue>>, previousTitle: string | null) => {
    // Title is invalid if it equals the identifier (DOM not loaded yet)
    if (issue.title === issue.identifier) return false;
    // Title is invalid if it's the same as the previous issue's title (stale DOM)
    if (previousTitle && issue.title === previousTitle) return false;
    return true;
  };

  // Detect Linear issue and handle visibility
  const detectWithRetry = () => {
    // Cancel any pending retry from previous navigation
    if (activeRetryInterval) {
      clearInterval(activeRetryInterval);
      activeRetryInterval = null;
    }

    if (!isLinearIssuePage()) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    const issue = parseLinearIssue();
    if (!issue) return;

    // Check if we switched to a different issue
    const isNewIssue = issue.identifier !== lastDetectedIdentifier;
    
    // Remember the old title to detect stale DOM
    const previousTitle = isNewIssue ? lastDetectedTitle : null;

    // If title is valid, send immediately
    if (isTitleValid(issue, previousTitle)) {
      notifyIssue(issue);
      return;
    }

    // Title might be stale - retry until DOM updates
    let retries = 0;
    activeRetryInterval = setInterval(() => {
      retries++;
      const newIssue = parseLinearIssue();
      
      if (newIssue && isTitleValid(newIssue, previousTitle)) {
        notifyIssue(newIssue);
        if (activeRetryInterval) {
          clearInterval(activeRetryInterval);
          activeRetryInterval = null;
        }
      } else if (retries >= 20) {
        // After 20 retries (10 seconds), give up and use what we have
        if (newIssue) {
          notifyIssue(newIssue);
        }
        if (activeRetryInterval) {
          clearInterval(activeRetryInterval);
          activeRetryInterval = null;
        }
      }
    }, 500);
  };

  detectWithRetry();

  // Watch for SPA navigation using MutationObserver
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      detectWithRetry();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Run when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
