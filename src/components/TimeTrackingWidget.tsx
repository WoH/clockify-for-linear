import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Play, Square, Timer, Loader2, Trash2, Minimize2 } from "lucide-react";
import { TimeEntryList, TimeEntry } from "./TimeEntryList";
import { ProjectSelector, ClockifyProject } from "./ProjectSelector";
import { ApiKeySetup, LogoutButton } from "./ApiKeySettings";
import { fetchProjects, getRunningTimer, startTimer, stopTimer, updateRunningTimer, abortTimer } from "@/lib/clockify-api";
import { cn } from "@/lib/utils";
import andLogo from "@/assets/and-logo.svg";
import type { TimerState, LinearIssue as ExtLinearIssue, TimeEntry as ExtTimeEntry } from "@/extension/types";

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
}

interface TimeTrackingWidgetProps {
  issue?: LinearIssue;
  className?: string;
}

const formatTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const formatDuration = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m`;
};

// Check if we're in an extension context
const isExtension = typeof chrome !== "undefined" && chrome.runtime?.id;

// Convert extension TimeEntry to component TimeEntry
function convertEntry(entry: ExtTimeEntry): TimeEntry {
  return {
    id: entry.id,
    description: entry.description,
    duration: entry.duration,
    startTime: new Date(entry.startTime),
    endTime: new Date(entry.endTime),
    projectId: entry.projectId,
    projectName: entry.projectName,
    projectColor: entry.projectColor,
  };
}

export function TimeTrackingWidget({ issue, className }: TimeTrackingWidgetProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [description, setDescription] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentLinearIssue, setCurrentLinearIssue] = useState<LinearIssue | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(true);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [projects, setProjects] = useState<ClockifyProject[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [clockifyEntryId, setClockifyEntryId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false); // Start expanded

  // Notify parent frame about minimized state for iframe resizing
  useEffect(() => {
    window.parent.postMessage({ type: "CLOCKIFY_MINIMIZED", minimized: isMinimized }, "*");
  }, [isMinimized]);
  const timerStartRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const prefilledForIssueRef = useRef<string | null>(null);

  const isConfigured = !!apiKey;

  // Load API key
  useEffect(() => {
    if (isExtension) {
      chrome.runtime.sendMessage({ type: "GET_API_KEY" }, (response) => {
        if (response?.success) {
          setApiKey(response.data as string | null);
        }
        setIsApiKeyLoading(false);
      });
    } else {
      setApiKey(localStorage.getItem("clockify_api_key"));
      setIsApiKeyLoading(false);
    }
  }, []);

  // Callback for when user logs in
  const handleLogin = useCallback(() => {
    if (isExtension) {
      chrome.runtime.sendMessage({ type: "GET_API_KEY" }, (response) => {
        if (response?.success) {
          setApiKey(response.data as string | null);
        }
      });
    } else {
      setApiKey(localStorage.getItem("clockify_api_key"));
    }
  }, []);

  // Callback for when user logs out
  const handleLogout = useCallback(() => {
    setApiKey(null);
    setProjects([]);
    setSelectedProjectId(null);
    prefilledForIssueRef.current = null;
  }, []);

  // Fetch projects when API key is available
  useEffect(() => {
    if (!apiKey) {
      setProjects([]);
      return;
    }

    setIsProjectsLoading(true);
    fetchProjects(apiKey).then((result) => {
      if (result.projects) {
        setProjects(result.projects);
      }
      setIsProjectsLoading(false);
    });
  }, [apiKey]);

  // Get the active issue (from content script detection or props)
  const activeIssue = currentLinearIssue || issue;

  // Pre-fill description and auto-match project based on the Linear issue
  useEffect(() => {
    // Only pre-fill when not running a timer and we have both issue and projects
    if (isRunning || !activeIssue || projects.length === 0) return;

    // Only pre-fill once per issue+title combination (title may update as DOM loads)
    const issueKey = `${activeIssue.identifier}:${activeIssue.title}`;
    if (prefilledForIssueRef.current === issueKey) return;

    // Pre-fill description with the issue identifier (e.g., "OPS-123")
    setDescription(activeIssue.identifier);

    // Reset project selection when moving to a new issue
    setSelectedProjectId(null);

    // Try to match project based on code in title
    // Formats: "AU1002440: Description" or "Description (AU1002440)"
    const startMatch = activeIssue.title.match(/^([A-Za-z]+\d+)/);
    const parenMatch = activeIssue.title.match(/\(([A-Za-z]+\d+)\)/);
    const projectCode = (startMatch?.[1] || parenMatch?.[1])?.toUpperCase();

    if (projectCode) {
      // Find project with matching name (case-insensitive, flexible matching)
      const matchingProject = projects.find((p) => {
        const projectName = p.name.trim().toUpperCase();
        return projectName === projectCode ||
               projectName.startsWith(projectCode) ||
               projectCode.startsWith(projectName);
      });
      if (matchingProject) {
        setSelectedProjectId(matchingProject.id);
      }
    }

    // Mark as prefilled only after completing the full prefill
    prefilledForIssueRef.current = issueKey;
  }, [activeIssue, projects, isRunning]);

  // Sync timer state with Clockify
  const syncWithClockify = useCallback(async () => {
    if (!apiKey) return;

    setIsSyncing(true);
    const result = await getRunningTimer(apiKey);
    setIsSyncing(false);

    if (result.isRunning && result.entry) {
      // Timer is running in Clockify
      setIsRunning(true);
      setClockifyEntryId(result.entry.id);
      setDescription(result.entry.description || "");
      setSelectedProjectId(result.entry.projectId);

      // Calculate elapsed time from start
      const startTime = new Date(result.entry.timeInterval.start).getTime();
      timerStartRef.current = startTime;
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    } else {
      // No timer running
      setIsRunning(false);
      setClockifyEntryId(null);
      timerStartRef.current = null;
      setElapsedTime(0);
    }
  }, [apiKey]);

  // Sync on login and periodically
  useEffect(() => {
    if (!apiKey) return;

    // Initial sync
    syncWithClockify();

    // Sync every 30 seconds
    syncIntervalRef.current = setInterval(syncWithClockify, 30000);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [apiKey, syncWithClockify]);

  // Local timer tick for smooth UI updates
  useEffect(() => {
    if (isRunning && timerStartRef.current) {
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStartRef.current!) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [isRunning]);

  const totalTrackedTime = entries.reduce((acc, entry) => acc + entry.duration, 0);

  // Load initial state from background
  useEffect(() => {
    if (!isExtension) {
      setIsLoading(false);
      return;
    }

    // Get timer state
    chrome.runtime.sendMessage({ type: "GET_TIMER_STATE" }, (response) => {
      if (response?.success) {
        const state = response.data as TimerState;
        setIsRunning(state.isRunning);
        setElapsedTime(state.elapsedTime);
        setDescription(state.description);
        setSelectedProjectId(state.projectId);
        if (state.linearIssue) {
          setCurrentLinearIssue(state.linearIssue as LinearIssue);
        }
      }
    });

    // Get entries
    chrome.runtime.sendMessage({ type: "GET_ENTRIES" }, (response) => {
      if (response?.success) {
        const extEntries = response.data as ExtTimeEntry[];
        setEntries(extEntries.map(convertEntry));
      }
      setIsLoading(false);
    });

    // Get current Linear issue from content script detection (once on load)
    chrome.runtime.sendMessage({ type: "GET_CURRENT_LINEAR_ISSUE" }, (response) => {
      if (response?.success && response.data) {
        setCurrentLinearIssue(response.data as LinearIssue);
      }
    });

    // Listen for messages from background
    const handleMessage = (message: { type: string; elapsedTime?: number; payload?: LinearIssue }) => {
      if (message.type === "TIMER_TICK" && message.elapsedTime !== undefined) {
        setElapsedTime(message.elapsedTime);
      } else if (message.type === "LINEAR_ISSUE_UPDATED" && message.payload) {
        setCurrentLinearIssue(message.payload);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // Also listen for postMessage from content script (Firefox fix)
    const handleWindowMessage = (event: MessageEvent) => {
      if (event.data?.type === "LINEAR_ISSUE_UPDATED" && event.data?.payload) {
        setCurrentLinearIssue(event.data.payload);
      }
    };
    window.addEventListener("message", handleWindowMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      window.removeEventListener("message", handleWindowMessage);
    };
  }, []);

  const handleStart = useCallback(async () => {
    if (!apiKey) return;

    // Start timer in Clockify
    const result = await startTimer(apiKey, {
      description,
      projectId: selectedProjectId,
    });

    if (result.entry) {
      setIsRunning(true);
      setClockifyEntryId(result.entry.id);
      timerStartRef.current = new Date(result.entry.timeInterval.start).getTime();
      setElapsedTime(0);
    }
  }, [apiKey, description, selectedProjectId]);

  const handleStop = useCallback(async () => {
    if (!apiKey) return;

    // Stop timer in Clockify
    const result = await stopTimer(apiKey);

    setIsRunning(false);
    setClockifyEntryId(null);
    timerStartRef.current = null;
    setElapsedTime(0);
    setDescription(activeIssue?.identifier || "");

    // Add the completed entry to the local list
    if (result.entry) {
      const startTime = new Date(result.entry.timeInterval.start);
      const endTime = result.entry.timeInterval.end ? new Date(result.entry.timeInterval.end) : new Date();
      const duration = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);

      const project = projects.find(p => p.id === result.entry!.projectId);

      const newEntry: TimeEntry = {
        id: result.entry.id,
        description: result.entry.description || "",
        duration,
        startTime,
        endTime,
        projectId: result.entry.projectId || undefined,
        projectName: project?.name,
        projectColor: project?.color,
      };

      setEntries((prev) => [newEntry, ...prev]);
    }
  }, [apiKey, projects, activeIssue]);

  // Abort/discard the current timer without saving
  const handleAbort = useCallback(async () => {
    if (!apiKey || !clockifyEntryId) return;

    await abortTimer(apiKey, clockifyEntryId);

    setIsRunning(false);
    setClockifyEntryId(null);
    timerStartRef.current = null;
    setElapsedTime(0);
    setDescription(activeIssue?.identifier || "");

    // Reset prefill so it can re-prefill for the current issue
    prefilledForIssueRef.current = null;
  }, [apiKey, clockifyEntryId, activeIssue]);

  // Handle project change - update Clockify if timer is running
  const handleProjectChange = useCallback(async (projectId: string | null) => {
    setSelectedProjectId(projectId);

    // If timer is running, update the entry in Clockify
    if (isRunning && clockifyEntryId && apiKey) {
      await updateRunningTimer(apiKey, clockifyEntryId, { projectId });
    }
  }, [isRunning, clockifyEntryId, apiKey]);

  const handleDeleteEntry = useCallback((id: string) => {
    if (isExtension) {
      chrome.runtime.sendMessage({ type: "DELETE_ENTRY", payload: { id } }, (response) => {
        if (response?.success) {
          const extEntries = response.data as ExtTimeEntry[];
          setEntries(extEntries.map(convertEntry));
        }
      });
    } else {
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
    }
  }, []);

  const defaultIssue: LinearIssue = {
    id: "1",
    identifier: "ENG-142",
    title: "Implement Clockify time tracking widget",
  };

  // Use detected Linear issue from content script, then props, then default (for display only)
  const displayIssue = activeIssue || defaultIssue;

  // Minimized bubble view
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className={cn(
          "w-12 h-12 rounded-full shadow-lg flex items-center justify-center cursor-pointer transition-all hover:scale-110",
          isRunning ? "bg-clockify" : "bg-background border"
        )}
        title="Expand timer"
      >
        {isRunning ? (
          <span className="text-[10px] font-mono font-bold text-clockify-foreground">
            {formatTime(elapsedTime).slice(0, 5)}
          </span>
        ) : (
          <Timer className={cn("h-5 w-5", isRunning ? "text-clockify-foreground" : "text-muted-foreground")} />
        )}
      </button>
    );
  }

  // Show loading state
  if (isLoading || isApiKeyLoading) {
    return (
      <Card className={cn("w-[400px] shadow-lg", className)}>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Show setup screen if not configured
  if (!isConfigured) {
    return (
      <Card className={cn("w-[400px] shadow-lg", className)}>
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center justify-center">
            <img src={andLogo} alt="AND Solution" className="h-6 w-6" />
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <ApiKeySetup onSave={handleLogin} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-[400px] shadow-lg", className)}>
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <img src={andLogo} alt="AND Solution" className="h-6 w-6" />
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsMinimized(true)}
              title="Minimize"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
            <LogoutButton className="h-6 w-6" onLogout={handleLogout} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-3 pb-3">
        {/* Issue Context */}
        <div className="rounded-md border bg-muted/30 p-2">
          <div className="space-y-0.5">
            <Badge variant="secondary" className="font-mono text-[10px] h-5">
              {displayIssue.identifier}
            </Badge>
            <h3 className="font-medium text-xs leading-tight truncate">
              {displayIssue.title}
            </h3>
          </div>
        </div>

        {/* Timer Display */}
        <div className="text-center py-2">
          <div className={cn(
            "font-mono text-4xl font-bold tracking-tight transition-colors",
            isRunning ? "text-clockify" : "text-foreground"
          )}>
            {formatTime(elapsedTime)}
          </div>
          <div className="flex items-center justify-center gap-1 mt-1 text-xs text-muted-foreground">
            {isSyncing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Syncing...</span>
              </>
            ) : (
              <>
                <Timer className="h-3 w-3" />
                <span>Total: {formatDuration(totalTrackedTime + (isRunning ? elapsedTime : 0))}</span>
              </>
            )}
          </div>
        </div>

        {/* Project Selector */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-medium text-muted-foreground">Clockify Project</label>
            {isRunning && !selectedProjectId && (
              <span className="text-[10px] text-warning">Required to stop</span>
            )}
          </div>
          {isProjectsLoading ? (
            <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-background">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading projects...</span>
            </div>
          ) : (
            <ProjectSelector
              projects={projects}
              selectedProjectId={selectedProjectId}
              onProjectChange={handleProjectChange}
            />
          )}
        </div>

        {/* Description Input */}
        <Input
          placeholder="What are you working on?"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            // Update Clockify if timer is running (debounced via onBlur)
          }}
          onBlur={() => {
            if (isRunning && clockifyEntryId && apiKey) {
              updateRunningTimer(apiKey, clockifyEntryId, { description });
            }
          }}
          className="text-xs h-8"
        />

        {/* Control Buttons */}
        <div className="flex gap-2">
          {!isRunning ? (
            <Button
              onClick={handleStart}
              className="flex-1 h-8 text-xs bg-clockify hover:bg-clockify/90 text-clockify-foreground"
            >
              <Play className="mr-1.5 h-3 w-3" />
              Start Timer
            </Button>
          ) : (
            <>
              <Button
                onClick={handleStop}
                variant="destructive"
                className="flex-1 h-8 text-xs"
                disabled={!selectedProjectId}
                title={!selectedProjectId ? "Select a project first" : undefined}
              >
                <Square className="mr-1.5 h-3 w-3" />
                Stop Timer
              </Button>
              <Button
                onClick={handleAbort}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                title="Discard timer"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        <Separator />

        {/* Time Entries */}
        <TimeEntryList entries={entries} onDelete={handleDeleteEntry} />
      </CardContent>
    </Card>
  );
}
