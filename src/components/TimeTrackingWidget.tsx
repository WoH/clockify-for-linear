import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Play, Square, Clock, ExternalLink, Timer } from "lucide-react";
import { TimeEntryList, TimeEntry } from "./TimeEntryList";
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

export function TimeTrackingWidget({ issue, className }: TimeTrackingWidgetProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [description, setDescription] = useState("");
  const [entries, setEntries] = useState<TimeEntry[]>([
    {
      id: "1",
      description: "Initial implementation",
      duration: 3600,
      startTime: new Date(Date.now() - 7200000),
      endTime: new Date(Date.now() - 3600000),
    },
    {
      id: "2",
      description: "Code review and fixes",
      duration: 1800,
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() - 1800000),
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
      const newEntry: TimeEntry = {
        id: Date.now().toString(),
        description: description || "No description",
        duration: elapsedTime,
        startTime: startTime,
        endTime: new Date(),
      };
      setEntries((prev) => [newEntry, ...prev]);
    }
    setIsRunning(false);
    setElapsedTime(0);
    setDescription("");
    setStartTime(null);
  }, [startTime, elapsedTime, description]);

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

  return (
    <Card className={cn("w-full max-w-md shadow-lg", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-linear">
              <span className="text-xs font-bold text-linear-foreground">Li</span>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-clockify">
              <Clock className="h-4 w-4 text-clockify-foreground" />
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            Widget v1.0
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Issue Context */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono text-xs shrink-0">
                  {currentIssue.identifier}
                </Badge>
                <Badge 
                  variant="outline" 
                  className={cn("text-xs shrink-0", getPriorityColor(currentIssue.priority))}
                >
                  P{currentIssue.priority}
                </Badge>
              </div>
              <h3 className="font-medium text-sm leading-tight truncate">
                {currentIssue.title}
              </h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-clockify" />
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
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Timer Display */}
        <div className="text-center py-4">
          <div className={cn(
            "font-mono text-5xl font-bold tracking-tight transition-colors",
            isRunning ? "text-clockify" : "text-foreground"
          )}>
            {formatTime(elapsedTime)}
          </div>
          <div className="flex items-center justify-center gap-1 mt-2 text-sm text-muted-foreground">
            <Timer className="h-4 w-4" />
            <span>Total: {formatDuration(totalTrackedTime + (isRunning ? elapsedTime : 0))}</span>
          </div>
        </div>

        {/* Description Input */}
        <Input
          placeholder="What are you working on?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isRunning}
          className="text-sm"
        />

        {/* Control Buttons */}
        <div className="flex gap-2">
          {!isRunning ? (
            <Button 
              onClick={handleStart} 
              className="flex-1 bg-clockify hover:bg-clockify/90 text-clockify-foreground"
            >
              <Play className="mr-2 h-4 w-4" />
              Start Timer
            </Button>
          ) : (
            <Button 
              onClick={handleStop} 
              variant="destructive" 
              className="flex-1"
            >
              <Square className="mr-2 h-4 w-4" />
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
