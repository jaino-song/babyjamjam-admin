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
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={cn(
            "text-[0.8rem] pb-2 px-3 transition-colors",
            activeTab === tab.key
              ? "text-v3-primary font-semibold border-b-2 border-v3-primary"
              : "text-v3-text-muted hover:text-v3-text"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
