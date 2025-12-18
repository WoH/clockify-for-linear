import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Folder, Star } from "lucide-react";

export interface ClockifyProject {
  id: string;
  name: string;
  color: string;
  clientName?: string;
  favorite?: boolean;
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

  // Sort projects: favorites first, then alphabetically
  const sortedProjects = [...projects].sort((a, b) => {
    if (a.favorite && !b.favorite) return -1;
    if (!a.favorite && b.favorite) return 1;
    return a.name.localeCompare(b.name);
  });

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
      <SelectContent className="bg-popover border-border z-50 max-h-60 overflow-y-auto">
        <SelectItem value="none" className="text-muted-foreground">
          <div className="flex items-center gap-2">
            <Folder className="h-4 w-4" />
            <span>No project</span>
          </div>
        </SelectItem>
        {sortedProjects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <div className="flex items-center gap-2">
              {project.favorite ? (
                <Star
                  className="h-3 w-3 shrink-0"
                  style={{ color: project.color, fill: project.color }}
                />
              ) : (
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
              )}
              <span className="truncate">{project.name}</span>
              {project.clientName && (
                <span className="text-xs text-muted-foreground truncate">
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
