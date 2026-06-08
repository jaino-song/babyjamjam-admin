import type { ReactNode } from "react";

export interface PageSectionProps {
  name: string;
  children: ReactNode;
}

export function PageSection({ name, children }: PageSectionProps) {
  return (
    <section
      data-component={name}
      className="flex h-full min-h-0 flex-col gap-6"
    >
      {children}
    </section>
  );
}
