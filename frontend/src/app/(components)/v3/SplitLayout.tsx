"use client";

import React from "react";

interface SplitLayoutProps {
  children: React.ReactNode;
}

export function SplitLayout({ children }: SplitLayoutProps) {
  return (
    <div
      data-component="split-layout"
      className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6"
    >
      {children}
    </div>
  );
}
