"use client";

import React from "react";

interface StatMiniProps {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  colorIndex?: number;
  animationDelay?: React.CSSProperties["animationDelay"];
}

const colorVariants = [
  { bg: "bg-v3-primary-light", text: "text-v3-primary" },
  { bg: "bg-v3-orange-light", text: "text-v3-orange" },
  { bg: "bg-v3-green-light", text: "text-v3-green" },
  { bg: "bg-v3-burgundy-light", text: "text-v3-burgundy" },
] as const;

export function StatMini({
  icon: Icon,
  value,
  label,
  colorIndex = 0,
  animationDelay,
}: StatMiniProps) {
  const [isMounted, setIsMounted] = React.useState(false);
  const variant = colorVariants[colorIndex % colorVariants.length];
  const animationStyle = animationDelay ? { animationDelay } : undefined;

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setIsMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      data-component="stat-mini"
      className={isMounted
        ? "animate-[v3-pop-in_0.4s_cubic-bezier(0.34,1.56,0.64,1)_both] bg-white rounded-[20px] shadow-v3 hover:shadow-v3-hover hover:-translate-y-1 transition-[transform,box-shadow] duration-[500ms] p-4 will-change-transform"
        : "opacity-0 scale-[0.8] bg-white rounded-[20px] shadow-v3 hover:shadow-v3-hover hover:-translate-y-1 transition-[transform,box-shadow] duration-[500ms] p-4 will-change-transform"}
      style={animationStyle}
    >
      <div
        data-component="stat-mini-icon"
        className={`w-12 h-12 rounded-[14px] ${variant.bg} flex items-center justify-center mb-3`}
      >
        <Icon className={`w-6 h-6 ${variant.text}`} />
      </div>
      <p className="text-2xl font-bold text-v3-dark">{value}</p>
      <p className="text-[0.7rem] text-v3-text-muted">{label}</p>
    </div>
  );
}
