import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TimeTrackingWidget } from "@/components/TimeTrackingWidget";
import "./index.css";

function Popup() {
  return (
    <TooltipProvider>
      <Toaster />
      <div className="w-[400px] bg-background">
        <TimeTrackingWidget />
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
