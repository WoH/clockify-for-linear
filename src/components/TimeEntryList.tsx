import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Clock } from "lucide-react";
import { format } from "date-fns";

export interface TimeEntry {
  id: string;
  description: string;
  duration: number;
  startTime: Date;
  endTime: Date;
}

interface TimeEntryListProps {
  entries: TimeEntry[];
  onDelete: (id: string) => void;
}

const formatDuration = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m`;
};

export function TimeEntryList({ entries, onDelete }: TimeEntryListProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No time entries yet</p>
        <p className="text-xs">Start tracking to see your entries here</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Recent Entries</h4>
        <span className="text-xs text-muted-foreground">{entries.length} entries</span>
      </div>
      <ScrollArea className="h-[180px] pr-3">
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-start justify-between gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
            >
              <div className="space-y-1 flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight truncate">
                  {entry.description}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{format(entry.startTime, "HH:mm")}</span>
                  <span>-</span>
                  <span>{format(entry.endTime, "HH:mm")}</span>
                  <span>•</span>
                  <span>{format(entry.startTime, "MMM d")}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-mono font-medium text-clockify">
                  {formatDuration(entry.duration)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onDelete(entry.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
