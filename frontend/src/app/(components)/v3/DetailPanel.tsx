"use client";

import React from "react";

interface DetailPanelProps {
  header: React.ReactNode;
  children: React.ReactNode;
}

export function DetailPanel({ header, children }: DetailPanelProps) {
  return (
    <div data-component="detail-panel" className="bg-white rounded-[28px] shadow-v3 animate-v3-slide-up">
      <div data-component="detail-panel-header" className="p-6">{header}</div>
      <div className="overflow-y-auto max-h-[calc(100vh-200px)] p-6 pt-0">
        {children}
      </div>
    </div>
  );
}
