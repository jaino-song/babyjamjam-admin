"use client";

import React from "react";

interface StatMiniProps {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  colorIndex?: number;
}

const colorVariants = [
  { bg: "bg-v3-primary-light", text: "text-v3-primary" },
  { bg: "bg-v3-orange-light", text: "text-v3-orange" },
  { bg: "bg-v3-green-light", text: "text-v3-green" },
  { bg: "bg-v3-burgundy-light", text: "text-v3-burgundy" },
] as const;

export function StatMini({ icon: Icon, value, label, colorIndex = 0 }: StatMiniProps) {
  const variant = colorVariants[colorIndex % colorVariants.length];

  return (
    <div data-component="stat-mini" className="bg-white rounded-[20px] shadow-v3 hover:shadow-v3-hover hover:-translate-y-1 transition-all duration-300 p-4">
      <div
        className={`w-12 h-12 rounded-[14px] ${variant.bg} flex items-center justify-center mb-3`}
      >
        <Icon className={`w-6 h-6 ${variant.text}`} />
      </div>
      <p className="text-2xl font-bold text-v3-dark">{value}</p>
      <p className="text-[0.7rem] text-v3-text-muted">{label}</p>
    </div>
  );
}
