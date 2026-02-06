"use client";

import React from "react";

interface TabItem {
  label: string;
  value: string;
}

interface ListPanelProps {
  title: string;
  tabs?: TabItem[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}

export function ListPanel({
  title,
  tabs,
  activeTab,
  onTabChange,
  children,
  headerActions,
}: ListPanelProps) {
  return (
    <div className="bg-white rounded-[28px] shadow-v3">
      <div className="flex items-center justify-between p-6 pb-0">
        <h2 className="text-lg font-bold text-v3-dark">{title}</h2>
        {headerActions && <div>{headerActions}</div>}
      </div>

      {tabs && tabs.length > 0 && (
        <div className="flex gap-1 px-6 pt-4">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onTabChange?.(tab.value)}
              className={`text-[0.8rem] pb-2 px-3 transition-colors ${
                activeTab === tab.value
                  ? "text-v3-primary font-semibold border-b-2 border-v3-primary"
                  : "text-v3-text-muted hover:text-v3-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-y-auto max-h-[calc(100vh-300px)] p-6">
        {children}
      </div>
    </div>
  );
}
