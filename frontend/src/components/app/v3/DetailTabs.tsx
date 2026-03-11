import { cn } from "@/lib/utils";

export interface DetailTab {
  key: string;
  label: string;
}

export interface DetailTabsProps {
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function DetailTabs({ tabs, activeTab, onTabChange }: DetailTabsProps) {
  return (
    <div data-component="detail-tabs" className="flex gap-1 border-b border-v3-border">
      {tabs.map((tab) => (
        <button
          data-component="detail-tabs-button"
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={cn(
            "relative px-3 pb-2 text-[0.8rem] transition-colors",
            activeTab === tab.key
              ? "text-primary font-semibold"
              : "text-v3-text-muted hover:text-v3-text"
          )}
        >
          {tab.label}
          {activeTab === tab.key ? (
            <div
              data-component="detail-tabs-indicator"
              className="absolute bottom-0 left-0 h-0.5 w-full bg-primary"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}
