import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TimeTrackingWidget } from "@/components/TimeTrackingWidget";
import "./index.css";

function ContentWidget() {
  // Apply dark class to html element for dark theme
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <TooltipProvider>
      <Toaster />
      <TimeTrackingWidget />
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ContentWidget />
  </StrictMode>
);
