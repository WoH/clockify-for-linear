import type { MessageType, MessageResponse, TimerState, TimeEntry, StorageData, LinearIssue } from "./extension/types";

const DEFAULT_TIMER_STATE: TimerState = {
  isRunning: false,
  startTime: null,
  elapsedTime: 0,
  description: "",
  projectId: null,
  linearIssue: null,
};

async function getStorageData(): Promise<StorageData> {
  const result = await chrome.storage.local.get(["timerState", "entries", "clockifyApiKey"]);
  return {
    timerState: result.timerState || DEFAULT_TIMER_STATE,
    entries: result.entries || [],
    clockifyApiKey: result.clockifyApiKey || null,
  };
}

async function saveTimerState(state: TimerState): Promise<void> {
  await chrome.storage.local.set({ timerState: state });
}

async function saveEntries(entries: TimeEntry[]): Promise<void> {
  await chrome.storage.local.set({ entries });
}

async function saveApiKey(apiKey: string | null): Promise<void> {
  await chrome.storage.local.set({ clockifyApiKey: apiKey });
}

let timerInterval: ReturnType<typeof setInterval> | null = null;

function startTimerInterval(): void {
  if (timerInterval) return;

  timerInterval = setInterval(async () => {
    const { timerState } = await getStorageData();
    if (timerState.isRunning && timerState.startTime) {
      const elapsed = Math.floor((Date.now() - new Date(timerState.startTime).getTime()) / 1000);
      await saveTimerState({ ...timerState, elapsedTime: elapsed });

      chrome.runtime.sendMessage({ type: "TIMER_TICK", elapsedTime: elapsed }).catch(() => {
        // Popup might be closed, that's ok
      });
    }
  }, 1000);
}

function stopTimerInterval(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function handleMessage(
  message: MessageType,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): Promise<boolean> {
  try {
    const { timerState, entries } = await getStorageData();

    switch (message.type) {
      case "GET_TIMER_STATE": {
        if (timerState.isRunning && timerState.startTime) {
          const elapsed = Math.floor((Date.now() - new Date(timerState.startTime).getTime()) / 1000);
          sendResponse({ success: true, data: { ...timerState, elapsedTime: elapsed } });
        } else {
          sendResponse({ success: true, data: timerState });
        }
        break;
      }

      case "START_TIMER": {
        const newState: TimerState = {
          isRunning: true,
          startTime: new Date().toISOString(),
          elapsedTime: 0,
          description: message.payload.description,
          projectId: message.payload.projectId,
          linearIssue: message.payload.linearIssue,
        };
        await saveTimerState(newState);
        startTimerInterval();
        sendResponse({ success: true, data: newState });
        break;
      }

      case "STOP_TIMER": {
        if (timerState.isRunning && timerState.startTime) {
          const endTime = new Date().toISOString();
          const elapsed = Math.floor((Date.now() - new Date(timerState.startTime).getTime()) / 1000);

          const newEntry: TimeEntry = {
            id: Date.now().toString(),
            description: timerState.description || "No description",
            duration: elapsed,
            startTime: timerState.startTime,
            endTime,
            projectId: timerState.projectId || undefined,
            linearIssueId: timerState.linearIssue?.id,
            linearIssueIdentifier: timerState.linearIssue?.identifier,
          };

          const newEntries = [newEntry, ...entries];
          await saveEntries(newEntries);

          const newState = DEFAULT_TIMER_STATE;
          await saveTimerState(newState);
          stopTimerInterval();

          sendResponse({ success: true, data: { timerState: newState, entry: newEntry } });
        } else {
          sendResponse({ success: true, data: { timerState: DEFAULT_TIMER_STATE } });
        }
        break;
      }

      case "UPDATE_DESCRIPTION": {
        const newState = { ...timerState, description: message.payload.description };
        await saveTimerState(newState);
        sendResponse({ success: true });
        break;
      }

      case "UPDATE_PROJECT": {
        const newState = { ...timerState, projectId: message.payload.projectId };
        await saveTimerState(newState);
        sendResponse({ success: true });
        break;
      }

      case "GET_ENTRIES": {
        sendResponse({ success: true, data: entries });
        break;
      }

      case "DELETE_ENTRY": {
        const newEntries = entries.filter((e) => e.id !== message.payload.id);
        await saveEntries(newEntries);
        sendResponse({ success: true, data: newEntries });
        break;
      }

      case "GET_API_KEY": {
        const { clockifyApiKey } = await getStorageData();
        sendResponse({ success: true, data: clockifyApiKey });
        break;
      }

      case "SET_API_KEY": {
        await saveApiKey(message.payload.apiKey);
        sendResponse({ success: true });
        break;
      }

      case "CLEAR_API_KEY": {
        await saveApiKey(null);
        sendResponse({ success: true });
        break;
      }

      case "LINEAR_ISSUE_DETECTED": {
        // Store the current Linear issue context for later use
        await chrome.storage.local.set({ currentLinearIssue: message.payload });
        sendResponse({ success: true });
        break;
      }

      case "GET_CURRENT_LINEAR_ISSUE": {
        const result = await chrome.storage.local.get(["currentLinearIssue"]);
        sendResponse({ success: true, data: result.currentLinearIssue || null });
        break;
      }

      default:
        sendResponse({ success: false, error: "Unknown message type" });
    }
  } catch (error) {
    sendResponse({ success: false, error: String(error) });
  }

  return true; // Keep the message channel open for async response
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

// Restore timer interval on extension startup if timer was running
chrome.runtime.onStartup.addListener(async () => {
  const { timerState } = await getStorageData();
  if (timerState.isRunning) {
    startTimerInterval();
  }
});

// Also check on install/update
chrome.runtime.onInstalled.addListener(async () => {
  const { timerState } = await getStorageData();
  if (timerState.isRunning) {
    startTimerInterval();
  }
});

console.log("Clockify for Linear: Background service worker initialized");
