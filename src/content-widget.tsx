import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TimeTrackingWidget } from "@/components/TimeTrackingWidget";
import "./index.css";

function ContentWidget() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for theme changes from parent (Linear)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "CLOCKIFY_THEME") {
        const theme = event.data.theme as "dark" | "light";
        if (theme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      }
    };

    window.addEventListener("message", handleMessage);

    // Default to dark until we hear from parent
    document.documentElement.classList.add("dark");

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Report height changes to parent for adaptive iframe sizing
  useEffect(() => {
    const reportHeight = () => {
      if (containerRef.current) {
        const height = containerRef.current.scrollHeight;
        window.parent.postMessage({ type: "CLOCKIFY_HEIGHT", height }, "*");
      }
    };

    // Report initial height
    reportHeight();

    // Observe size changes
    const observer = new ResizeObserver(reportHeight);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <TooltipProvider>
      <Toaster />
      <div ref={containerRef}>
        <TimeTrackingWidget />
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ContentWidget />
  </StrictMode>
);
