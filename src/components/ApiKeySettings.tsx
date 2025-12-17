import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const API_KEY_STORAGE_KEY = "clockify_api_key";

export function useClockifyApiKey() {
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    setApiKey(stored);
  }, []);

  const saveApiKey = (key: string) => {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
    setApiKey(key);
  };

  const clearApiKey = () => {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    setApiKey(null);
  };

  return { apiKey, saveApiKey, clearApiKey, isConfigured: !!apiKey };
}

interface ApiKeySettingsProps {
  onSave?: () => void;
}

export function ApiKeySettings({ onSave }: ApiKeySettingsProps) {
  const { apiKey, saveApiKey, isConfigured } = useClockifyApiKey();
  const [inputValue, setInputValue] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (apiKey) {
      setInputValue(apiKey);
    }
  }, [apiKey]);

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

  const maskedValue = inputValue ? "•".repeat(Math.min(inputValue.length, 20)) + inputValue.slice(-4) : "";

  return (
    <div className="space-y-2">
      <Label htmlFor="api-key" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Key className="h-3 w-3" />
        Clockify API Key
      </Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id="api-key"
            type={showKey ? "text" : "password"}
            placeholder="Enter your API key"
            value={showKey ? inputValue : (inputValue ? maskedValue : "")}
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
        <Button
          size="sm"
          onClick={handleSave}
          className="h-8 px-3 bg-clockify hover:bg-clockify/90 text-clockify-foreground"
        >
          {isConfigured ? <Check className="h-3 w-3" /> : "Save"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
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
  );
}
