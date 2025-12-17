import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, LogOut } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import andLogo from "@/assets/and-favicon.ico";

const API_KEY_STORAGE_KEY = "clockify_api_key";

// Simple event emitter for API key changes
const listeners = new Set<() => void>();
const notifyListeners = () => listeners.forEach((l) => l());

export function useClockifyApiKey() {
  const [apiKey, setApiKey] = useState<string | null>(() => 
    localStorage.getItem(API_KEY_STORAGE_KEY)
  );

  useEffect(() => {
    const update = () => setApiKey(localStorage.getItem(API_KEY_STORAGE_KEY));
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);

  const saveApiKey = useCallback((key: string) => {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
    setApiKey(key);
    notifyListeners();
  }, []);

  const clearApiKey = useCallback(() => {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    setApiKey(null);
    notifyListeners();
  }, []);

  return { apiKey, saveApiKey, clearApiKey, isConfigured: !!apiKey };
}

interface ApiKeySetupProps {
  onSave?: () => void;
}

export function ApiKeySetup({ onSave }: ApiKeySetupProps) {
  const { saveApiKey } = useClockifyApiKey();
  const [inputValue, setInputValue] = useState("");
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    if (!inputValue.trim()) {
      toast({
        title: "API Key Required",
        description: "Please enter your Clockify API key",
        variant: "destructive",
      });
      return;
    }

    saveApiKey(inputValue.trim());
    toast({
      title: "API Key Saved",
      description: "Your Clockify API key has been saved securely",
    });
    onSave?.();
  };

  return (
    <div className="space-y-3 py-2">
      <div className="text-center space-y-1">
        <img src={andLogo} alt="AND Solution" className="h-10 w-10 mx-auto" />
        <h3 className="font-medium text-sm">Connect to Clockify</h3>
        <p className="text-[10px] text-muted-foreground">
          Enter your API key to start tracking time
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="api-key" className="text-xs font-medium text-muted-foreground">
          API Key
        </Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="api-key"
              type={showKey ? "text" : "password"}
              placeholder="Enter your API key"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="text-xs h-8 pr-8 font-mono"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-8 w-8"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
          </div>
        </div>
        <Button
          onClick={handleSave}
          className="w-full h-8 text-xs bg-clockify hover:bg-clockify/90 text-clockify-foreground"
        >
          Save & Connect
        </Button>
        <p className="text-[10px] text-muted-foreground text-center">
          Get your API key from{" "}
          <a
            href="https://clockify.me/user/settings"
            target="_blank"
            rel="noopener noreferrer"
            className="text-clockify hover:underline"
          >
            Clockify Settings
          </a>
        </p>
      </div>
    </div>
  );
}

interface LogoutButtonProps {
  className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {
  const { clearApiKey } = useClockifyApiKey();

  const handleLogout = () => {
    clearApiKey();
    toast({
      title: "Logged out",
      description: "Your Clockify API key has been removed",
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={handleLogout}
      title="Disconnect Clockify"
    >
      <LogOut className="h-3.5 w-3.5" />
    </Button>
  );
}
