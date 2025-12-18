import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, LogOut, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// Check if we're in a Chrome extension context
const isChromeExtension = typeof chrome !== "undefined" && chrome.runtime?.id;

const CLOCKIFY_API_BASE = "https://api.clockify.me/api/v1";

// Validate API key by fetching current user
async function validateClockifyApiKey(apiKey: string): Promise<{ valid: boolean; userName?: string; error?: string }> {
  try {
    const response = await fetch(`${CLOCKIFY_API_BASE}/user`, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    if (response.ok) {
      const user = await response.json();
      return { valid: true, userName: user.name };
    } else if (response.status === 401) {
      return { valid: false, error: "Invalid API key" };
    } else {
      return { valid: false, error: `API error: ${response.status}` };
    }
  } catch (error) {
    return { valid: false, error: "Network error. Please check your connection." };
  }
}

export function useClockifyApiKey() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load API key on mount
    if (isChromeExtension) {
      chrome.runtime.sendMessage({ type: "GET_API_KEY" }, (response) => {
        if (response?.success) {
          setApiKey(response.data as string | null);
        }
        setIsLoading(false);
      });
    } else {
      setApiKey(localStorage.getItem("clockify_api_key"));
      setIsLoading(false);
    }
  }, []);

  const saveApiKey = useCallback((key: string) => {
    if (isChromeExtension) {
      chrome.runtime.sendMessage({ type: "SET_API_KEY", payload: { apiKey: key } }, (response) => {
        if (response?.success) {
          setApiKey(key);
        }
      });
    } else {
      localStorage.setItem("clockify_api_key", key);
      setApiKey(key);
    }
  }, []);

  const clearApiKey = useCallback(() => {
    if (isChromeExtension) {
      chrome.runtime.sendMessage({ type: "CLEAR_API_KEY" }, (response) => {
        if (response?.success) {
          setApiKey(null);
        }
      });
    } else {
      localStorage.removeItem("clockify_api_key");
      setApiKey(null);
    }
  }, []);

  return { apiKey, saveApiKey, clearApiKey, isConfigured: !!apiKey, isLoading };
}

interface ApiKeySetupProps {
  onSave?: () => void;
}

export function ApiKeySetup({ onSave }: ApiKeySetupProps) {
  const { saveApiKey } = useClockifyApiKey();
  const [inputValue, setInputValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const handleSave = async () => {
    if (!inputValue.trim()) {
      toast({
        title: "API Key Required",
        description: "Please enter your Clockify API key",
        variant: "destructive",
      });
      return;
    }

    setIsValidating(true);
    const result = await validateClockifyApiKey(inputValue.trim());
    setIsValidating(false);

    if (!result.valid) {
      toast({
        title: "Invalid API Key",
        description: result.error || "Please check your API key and try again",
        variant: "destructive",
      });
      return;
    }

    saveApiKey(inputValue.trim());
    toast({
      title: "Connected to Clockify",
      description: `Welcome, ${result.userName}!`,
    });
    onSave?.();
  };

  return (
    <div className="space-y-3 py-2">
      <div className="text-center space-y-1">
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
              disabled={isValidating}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-8 w-8"
              onClick={() => setShowKey(!showKey)}
              disabled={isValidating}
            >
              {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
          </div>
        </div>
        <Button
          onClick={handleSave}
          className="w-full h-8 text-xs bg-clockify hover:bg-clockify/90 text-clockify-foreground"
          disabled={isValidating}
        >
          {isValidating ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Validating...
            </>
          ) : (
            "Save & Connect"
          )}
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
  onLogout?: () => void;
}

export function LogoutButton({ className, onLogout }: LogoutButtonProps) {
  const { clearApiKey } = useClockifyApiKey();

  const handleLogout = () => {
    clearApiKey();
    toast({
      title: "Logged out",
      description: "Your Clockify API key has been removed",
    });
    onLogout?.();
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
