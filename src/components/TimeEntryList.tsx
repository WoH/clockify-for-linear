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
  projectId?: string;
  projectName?: string;
  projectColor?: string;
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
      <div className="text-center py-4 text-muted-foreground">
        <Clock className="h-6 w-6 mx-auto mb-1.5 opacity-50" />
        <p className="text-xs">No time entries yet</p>
        <p className="text-[10px]">Start tracking to see your entries</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium">Recent Entries</h4>
        <span className="text-[10px] text-muted-foreground">{entries.length} entries</span>
      </div>
      <ScrollArea className="h-[120px] pr-2 overflow-x-hidden">
        <div className="space-y-1.5">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-start justify-between gap-2 rounded border bg-card p-2 transition-colors hover:bg-muted/50"
            >
              <div className="space-y-0.5 flex-1 min-w-0">
                <p className="text-xs font-medium leading-tight truncate">
                  {entry.description}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
                  {entry.projectName && (
                    <span className="flex items-center gap-1">
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: entry.projectColor }}
                      />
                      <span className="truncate max-w-[80px]">{entry.projectName}</span>
                    </span>
                  )}
                  <span>{format(entry.startTime, "HH:mm")} - {format(entry.endTime, "HH:mm")}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-mono font-medium text-clockify">
                  {formatDuration(entry.duration)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onDelete(entry.id)}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
