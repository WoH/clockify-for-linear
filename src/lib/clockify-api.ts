const CLOCKIFY_API_BASE = "https://api.clockify.me/api/v1";

export interface ClockifyUser {
  id: string;
  name: string;
  email: string;
  defaultWorkspace: string;
  activeWorkspace: string;
}

export interface ClockifyProject {
  id: string;
  name: string;
  color: string;
  clientId?: string;
  clientName?: string;
  workspaceId: string;
  archived: boolean;
}

export interface ClockifyWorkspace {
  id: string;
  name: string;
}

export interface ClockifyTimeEntry {
  id: string;
  description: string;
  timeInterval: {
    start: string;
    end: string | null;
    duration: string | null;
  };
  workspaceId: string;
  projectId: string | null;
  userId: string;
}

export class ClockifyAPI {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${CLOCKIFY_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Clockify API error: ${response.status}`);
    }

    return response.json();
  }

  async getUser(): Promise<ClockifyUser> {
    return this.fetch<ClockifyUser>("/user");
  }

  async getWorkspaces(): Promise<ClockifyWorkspace[]> {
    return this.fetch<ClockifyWorkspace[]>("/workspaces");
  }

  async getProjects(workspaceId: string): Promise<ClockifyProject[]> {
    const projects = await this.fetch<any[]>(
      `/workspaces/${workspaceId}/projects?archived=false&page-size=500`
    );

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      clientId: p.clientId,
      clientName: p.clientName,
      workspaceId: p.workspaceId,
      archived: p.archived,
    }));
  }

  async getProjectsForDefaultWorkspace(): Promise<ClockifyProject[]> {
    const user = await this.getUser();
    return this.getProjects(user.activeWorkspace || user.defaultWorkspace);
  }

  async getRunningTimeEntry(): Promise<ClockifyTimeEntry | null> {
    const user = await this.getUser();
    const workspaceId = user.activeWorkspace || user.defaultWorkspace;

    try {
      const entries = await this.fetch<ClockifyTimeEntry[]>(
        `/workspaces/${workspaceId}/user/${user.id}/time-entries?in-progress=true`
      );
      return entries.length > 0 ? entries[0] : null;
    } catch {
      return null;
    }
  }

  async startTimeEntry(params: {
    description?: string;
    projectId?: string | null;
  }): Promise<ClockifyTimeEntry> {
    const user = await this.getUser();
    const workspaceId = user.activeWorkspace || user.defaultWorkspace;

    return this.fetch<ClockifyTimeEntry>(
      `/workspaces/${workspaceId}/time-entries`,
      {
        method: "POST",
        body: JSON.stringify({
          start: new Date().toISOString(),
          description: params.description || "",
          projectId: params.projectId || undefined,
        }),
      }
    );
  }

  async stopTimeEntry(): Promise<ClockifyTimeEntry | null> {
    const user = await this.getUser();
    const workspaceId = user.activeWorkspace || user.defaultWorkspace;

    try {
      return await this.fetch<ClockifyTimeEntry>(
        `/workspaces/${workspaceId}/user/${user.id}/time-entries`,
        {
          method: "PATCH",
          body: JSON.stringify({
            end: new Date().toISOString(),
          }),
        }
      );
    } catch {
      return null;
    }
  }

  async updateTimeEntry(
    entryId: string,
    params: { projectId?: string | null; description?: string }
  ): Promise<ClockifyTimeEntry | null> {
    const user = await this.getUser();
    const workspaceId = user.activeWorkspace || user.defaultWorkspace;

    // Get the current entry to preserve its start time
    const runningEntry = await this.getRunningTimeEntry();
    if (!runningEntry || runningEntry.id !== entryId) {
      return null;
    }

    try {
      return await this.fetch<ClockifyTimeEntry>(
        `/workspaces/${workspaceId}/time-entries/${entryId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            start: runningEntry.timeInterval.start,
            description: params.description ?? runningEntry.description,
            projectId: params.projectId ?? runningEntry.projectId,
          }),
        }
      );
    } catch {
      return null;
    }
  }

  async deleteTimeEntry(entryId: string): Promise<boolean> {
    const user = await this.getUser();
    const workspaceId = user.activeWorkspace || user.defaultWorkspace;

    try {
      await this.fetch<void>(
        `/workspaces/${workspaceId}/time-entries/${entryId}`,
        { method: "DELETE" }
      );
      return true;
    } catch {
      return false;
    }
  }
}

// Validate API key and return user info
export async function validateApiKey(
  apiKey: string
): Promise<{ valid: boolean; user?: ClockifyUser; error?: string }> {
  try {
    const api = new ClockifyAPI(apiKey);
    const user = await api.getUser();
    return { valid: true, user };
  } catch (error) {
    if (error instanceof Error && error.message.includes("401")) {
      return { valid: false, error: "Invalid API key" };
    }
    return { valid: false, error: "Network error. Please check your connection." };
  }
}

// Fetch projects for a given API key
export async function fetchProjects(
  apiKey: string
): Promise<{ projects?: ClockifyProject[]; error?: string }> {
  try {
    const api = new ClockifyAPI(apiKey);
    const projects = await api.getProjectsForDefaultWorkspace();
    return { projects };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch projects" };
  }
}

// Get the currently running time entry
export async function getRunningTimer(
  apiKey: string
): Promise<{
  isRunning: boolean;
  entry?: ClockifyTimeEntry;
  elapsedSeconds?: number;
  error?: string;
}> {
  try {
    const api = new ClockifyAPI(apiKey);
    const entry = await api.getRunningTimeEntry();

    if (entry) {
      const startTime = new Date(entry.timeInterval.start).getTime();
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      return { isRunning: true, entry, elapsedSeconds };
    }

    return { isRunning: false };
  } catch (error) {
    return { isRunning: false, error: error instanceof Error ? error.message : "Failed to fetch timer" };
  }
}

// Start a time entry in Clockify
export async function startTimer(
  apiKey: string,
  params: { description?: string; projectId?: string | null }
): Promise<{ entry?: ClockifyTimeEntry; error?: string }> {
  try {
    const api = new ClockifyAPI(apiKey);
    const entry = await api.startTimeEntry(params);
    return { entry };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to start timer" };
  }
}

// Stop the running time entry in Clockify
export async function stopTimer(
  apiKey: string
): Promise<{ entry?: ClockifyTimeEntry; error?: string }> {
  try {
    const api = new ClockifyAPI(apiKey);
    const entry = await api.stopTimeEntry();
    return { entry: entry || undefined };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to stop timer" };
  }
}

// Update a running time entry in Clockify
export async function updateRunningTimer(
  apiKey: string,
  entryId: string,
  params: { projectId?: string | null; description?: string }
): Promise<{ entry?: ClockifyTimeEntry; error?: string }> {
  try {
    const api = new ClockifyAPI(apiKey);
    const entry = await api.updateTimeEntry(entryId, params);
    return { entry: entry || undefined };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update timer" };
  }
}

// Abort/discard the running time entry without saving
export async function abortTimer(
  apiKey: string,
  entryId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const api = new ClockifyAPI(apiKey);
    const success = await api.deleteTimeEntry(entryId);
    return { success };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to abort timer" };
  }
}
