export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  assignee?: string;
  url?: string;
}

export interface TimeEntry {
  id: string;
  description: string;
  duration: number;
  startTime: string;
  endTime: string;
  projectId?: string;
  projectName?: string;
  projectColor?: string;
  linearIssueId?: string;
  linearIssueIdentifier?: string;
}

export interface ClockifyProject {
  id: string;
  name: string;
  color: string;
  clientName?: string;
}

export interface TimerState {
  isRunning: boolean;
  startTime: string | null;
  elapsedTime: number;
  description: string;
  projectId: string | null;
  linearIssue: LinearIssue | null;
}

export type MessageType =
  | { type: "GET_TIMER_STATE" }
  | { type: "START_TIMER"; payload: { description: string; projectId: string | null; linearIssue: LinearIssue | null } }
  | { type: "STOP_TIMER" }
  | { type: "UPDATE_DESCRIPTION"; payload: { description: string } }
  | { type: "UPDATE_PROJECT"; payload: { projectId: string | null } }
  | { type: "GET_ENTRIES" }
  | { type: "DELETE_ENTRY"; payload: { id: string } }
  | { type: "GET_CURRENT_LINEAR_ISSUE" }
  | { type: "LINEAR_ISSUE_DETECTED"; payload: LinearIssue }
  | { type: "GET_API_KEY" }
  | { type: "SET_API_KEY"; payload: { apiKey: string } }
  | { type: "CLEAR_API_KEY" };

export type MessageResponse =
  | { success: true; data?: unknown }
  | { success: false; error: string };

export interface StorageData {
  timerState: TimerState;
  entries: TimeEntry[];
  clockifyApiKey: string | null;
}
