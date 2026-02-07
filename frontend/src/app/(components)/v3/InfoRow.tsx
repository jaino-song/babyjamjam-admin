"use client";

import React from "react";

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
}

export function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div data-component="info-row" className="flex items-center justify-between py-2.5 border-b border-v3-border last:border-b-0">
      <span className="text-[0.8rem] text-v3-text-muted">{label}</span>
      <span className="text-[0.8rem] font-semibold text-v3-dark">{value}</span>
    </div>
  );
}
