import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Play, Square, Clock, ExternalLink, Timer } from "lucide-react";
import { TimeEntryList, TimeEntry } from "./TimeEntryList";
import { ProjectSelector, ClockifyProject } from "./ProjectSelector";
import { ApiKeySetup, LogoutButton, useClockifyApiKey } from "./ApiKeySettings";
import { cn } from "@/lib/utils";

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  assignee?: string;
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

// Mock Clockify projects
const mockProjects: ClockifyProject[] = [
  { id: "1", name: "Linear Integration", color: "#5E6AD2", clientName: "Internal" },
  { id: "2", name: "Frontend Development", color: "#03BB85", clientName: "Acme Corp" },
  { id: "3", name: "API Development", color: "#F2994A", clientName: "Acme Corp" },
  { id: "4", name: "Design System", color: "#EB5757", clientName: "Internal" },
  { id: "5", name: "Bug Fixes", color: "#9B51E0" },
];

export function TimeTrackingWidget({ issue, className }: TimeTrackingWidgetProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [description, setDescription] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>("1");
  const { isConfigured } = useClockifyApiKey();
  const [entries, setEntries] = useState<TimeEntry[]>([
    {
      id: "1",
      description: "Initial implementation",
      duration: 3600,
      startTime: new Date(Date.now() - 7200000),
      endTime: new Date(Date.now() - 3600000),
      projectId: "1",
      projectName: "Linear Integration",
      projectColor: "#5E6AD2",
    },
    {
      id: "2",
      description: "Code review and fixes",
      duration: 1800,
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() - 1800000),
      projectId: "2",
      projectName: "Frontend Development",
      projectColor: "#03BB85",
    },
  ]);
  const [startTime, setStartTime] = useState<Date | null>(null);

  const totalTrackedTime = entries.reduce((acc, entry) => acc + entry.duration, 0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning) {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning]);

  const handleStart = useCallback(() => {
    setIsRunning(true);
    setStartTime(new Date());
  }, []);

  const handleStop = useCallback(() => {
    if (startTime && elapsedTime > 0) {
      const selectedProject = mockProjects.find((p) => p.id === selectedProjectId);
      const newEntry: TimeEntry = {
        id: Date.now().toString(),
        description: description || "No description",
        duration: elapsedTime,
        startTime: startTime,
        endTime: new Date(),
        projectId: selectedProjectId || undefined,
        projectName: selectedProject?.name,
        projectColor: selectedProject?.color,
      };
      setEntries((prev) => [newEntry, ...prev]);
    }
    setIsRunning(false);
    setElapsedTime(0);
    setDescription("");
    setStartTime(null);
  }, [startTime, elapsedTime, description, selectedProjectId]);

  const handleDeleteEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const defaultIssue: LinearIssue = {
    id: "1",
    identifier: "ENG-142",
    title: "Implement Clockify time tracking widget",
    status: "In Progress",
    priority: 2,
    assignee: "You",
  };

  const currentIssue = issue || defaultIssue;

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1:
        return "bg-destructive/10 text-destructive border-destructive/20";
      case 2:
        return "bg-warning/10 text-warning border-warning/20";
      case 3:
        return "bg-success/10 text-success border-success/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  // Show setup screen if not configured
  if (!isConfigured) {
    return (
      <Card className={cn("w-full max-w-md shadow-lg", className)}>
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center justify-center gap-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-linear">
              <span className="text-[10px] font-bold text-linear-foreground">Li</span>
            </div>
            <div className="flex h-6 w-6 items-center justify-center rounded bg-clockify">
              <Clock className="h-3 w-3 text-clockify-foreground" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <ApiKeySetup />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full max-w-md shadow-lg", className)}>
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-linear">
              <span className="text-[10px] font-bold text-linear-foreground">Li</span>
            </div>
            <div className="flex h-6 w-6 items-center justify-center rounded bg-clockify">
              <Clock className="h-3 w-3 text-clockify-foreground" />
            </div>
          </div>
          <LogoutButton className="h-6 w-6" />
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-3 pb-3">
        {/* Issue Context */}
        <div className="rounded-md border bg-muted/30 p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="font-mono text-[10px] h-5 shrink-0">
                  {currentIssue.identifier}
                </Badge>
                <Badge 
                  variant="outline" 
                  className={cn("text-[10px] h-5 shrink-0", getPriorityColor(currentIssue.priority))}
                >
                  P{currentIssue.priority}
                </Badge>
              </div>
              <h3 className="font-medium text-xs leading-tight truncate">
                {currentIssue.title}
              </h3>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-clockify" />
                  {currentIssue.status}
                </span>
                {currentIssue.assignee && (
                  <>
                    <span>•</span>
                    <span>{currentIssue.assignee}</span>
                  </>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
              <ExternalLink className="h-3 w-3" />
            </Button>
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
            <Timer className="h-3 w-3" />
            <span>Total: {formatDuration(totalTrackedTime + (isRunning ? elapsedTime : 0))}</span>
          </div>
        </div>

        {/* Project Selector */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">Clockify Project</label>
          <ProjectSelector
            projects={mockProjects}
            selectedProjectId={selectedProjectId}
            onProjectChange={setSelectedProjectId}
            disabled={isRunning}
          />
        </div>

        {/* Description Input */}
        <Input
          placeholder="What are you working on?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isRunning}
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
            <Button 
              onClick={handleStop} 
              variant="destructive" 
              className="flex-1 h-8 text-xs"
            >
              <Square className="mr-1.5 h-3 w-3" />
              Stop Timer
            </Button>
          )}
        </div>

        <Separator />

        {/* Time Entries */}
        <TimeEntryList entries={entries} onDelete={handleDeleteEntry} />
      </CardContent>
    </Card>
  );
}
