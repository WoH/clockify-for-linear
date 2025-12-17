import { TimeTrackingWidget } from "@/components/TimeTrackingWidget";
import { ThemeSelector } from "@/components/ThemeSelector";
import { Clock, Zap } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-background transition-colors duration-200">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-linear">
                <span className="text-[10px] font-bold text-linear-foreground">Li</span>
              </div>
              <Zap className="h-3 w-3 text-muted-foreground" />
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-clockify">
                <Clock className="h-3.5 w-3.5 text-clockify-foreground" />
              </div>
            </div>
            <div className="h-4 w-px bg-border" />
            <span className="text-sm font-medium">Clockify for Linear</span>
          </div>
          <ThemeSelector />
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Hero Section */}
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-bold tracking-tight">
              Track Time on Linear Issues
            </h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              Seamlessly integrate Clockify time tracking directly into your Linear workflow. 
              Start, stop, and manage time entries without leaving your issues.
            </p>
          </div>

          {/* Widget Demo */}
          <div className="flex justify-center">
            <TimeTrackingWidget />
          </div>

          {/* Features */}
          <div className="grid sm:grid-cols-3 gap-4 pt-4">
            <FeatureCard
              icon={<Clock className="h-5 w-5 text-clockify" />}
              title="One-Click Tracking"
              description="Start and stop timers instantly from any Linear issue"
            />
            <FeatureCard
              icon={<Zap className="h-5 w-5 text-warning" />}
              title="Auto-Sync"
              description="Time entries automatically sync to your Clockify workspace"
            />
            <FeatureCard
              icon={
                <div className="flex h-5 w-5 items-center justify-center rounded bg-linear">
                  <span className="text-[8px] font-bold text-linear-foreground">Li</span>
                </div>
              }
              title="Linear Native"
              description="Designed to feel like a natural part of Linear"
            />
          </div>
        </div>
      </main>
    </div>
  );
};

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center space-y-2">
      <div className="flex justify-center">{icon}</div>
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export default Index;
