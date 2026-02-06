"use client";

import React from "react";

interface InfoCardProps {
  title: string;
  children: React.ReactNode;
}

export function InfoCard({ title, children }: InfoCardProps) {
  return (
    <div className="bg-v3-dim-white rounded-[18px] p-4">
      <h3 className="text-[0.7rem] uppercase tracking-[0.1em] text-v3-text-muted font-semibold mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}
