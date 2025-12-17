import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Monitor, Palette, Check } from "lucide-react";
import { LinearTheme, useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const themes: { value: LinearTheme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
  { value: "dark-contrast", label: "Dark (High Contrast)", icon: <Monitor className="h-4 w-4" /> },
  { value: "linear-light", label: "Linear Light", icon: <Palette className="h-4 w-4" /> },
];

export function ThemeSelector() {
  const { theme, changeTheme } = useTheme();

  const currentTheme = themes.find((t) => t.value === theme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 h-8">
          {currentTheme?.icon}
          <span className="text-xs">{currentTheme?.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 bg-popover border-border z-50">
        {themes.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onClick={() => changeTheme(t.value)}
            className={cn(
              "flex items-center justify-between cursor-pointer",
              theme === t.value && "bg-accent"
            )}
          >
            <div className="flex items-center gap-2">
              {t.icon}
              <span className="text-sm">{t.label}</span>
            </div>
            {theme === t.value && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
