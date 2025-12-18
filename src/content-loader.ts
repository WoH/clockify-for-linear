// Content loader - injects an iframe with the full widget UI directly visible

const CONTAINER_ID = "clockify-linear-container";
const IFRAME_ID = "clockify-linear-iframe";

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

// Listen for minimize state changes from widget
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

  // Detect Linear issue and notify background
  const detectAndNotify = () => {
    if (isLinearIssuePage()) {
      const issue = parseLinearIssue();
      if (issue) {
        chrome.runtime.sendMessage({ type: "LINEAR_ISSUE_DETECTED", payload: issue });
      }
      container.style.display = "block";
      return issue;
    } else {
      container.style.display = "none";
      return null;
    }
  };

  // Initial detection with retry for title
  const detectWithRetry = () => {
    const issue = detectAndNotify();

    // Retry title detection if we only got the identifier (DOM might not be ready)
    if (issue && issue.title === issue.identifier) {
      let retries = 0;
      const retryInterval = setInterval(() => {
        retries++;
        const newIssue = parseLinearIssue();
        if (newIssue && newIssue.title !== newIssue.identifier) {
          chrome.runtime.sendMessage({ type: "LINEAR_ISSUE_DETECTED", payload: newIssue });
          clearInterval(retryInterval);
        } else if (retries >= 10) {
          clearInterval(retryInterval);
        }
      }, 500);
    }
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
