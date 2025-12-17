import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Folder } from "lucide-react";

export interface ClockifyProject {
  id: string;
  name: string;
  color: string;
  clientName?: string;
}

interface ProjectSelectorProps {
  projects: ClockifyProject[];
  selectedProjectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  disabled?: boolean;
}

export function ProjectSelector({
  projects,
  selectedProjectId,
  onProjectChange,
  disabled = false,
}: ProjectSelectorProps) {
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <Select
      value={selectedProjectId || "none"}
      onValueChange={(value) => onProjectChange(value === "none" ? null : value)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 text-sm bg-background">
        <div className="flex items-center gap-2">
          {selectedProject ? (
            <>
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: selectedProject.color }}
              />
              <SelectValue>
                <span className="truncate">{selectedProject.name}</span>
              </SelectValue>
            </>
          ) : (
            <>
              <Folder className="h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Select project" />
            </>
          )}
        </div>
      </SelectTrigger>
      <SelectContent className="bg-popover border-border z-50">
        <SelectItem value="none" className="text-muted-foreground">
          <div className="flex items-center gap-2">
            <Folder className="h-4 w-4" />
            <span>No project</span>
          </div>
        </SelectItem>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span>{project.name}</span>
              {project.clientName && (
                <span className="text-xs text-muted-foreground">
                  • {project.clientName}
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
