"use client";

import React from "react";

interface PageHeaderProps {
  title: string;
  subtitle: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, icon: Icon, actions }: PageHeaderProps) {
  return (
    <div data-component="page-header" className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-v3-slide-up">
      <div data-component="page-header-title">
        <h1 className="text-[1.75rem] font-bold text-v3-dark flex items-center gap-2">
          {Icon && <Icon className="w-6 h-6 text-v3-primary" />}
          {title}
        </h1>
        <p className="text-[0.9rem] text-v3-text-muted mt-1">{subtitle}</p>
      </div>
      {actions && <div data-component="page-header-actions" className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
