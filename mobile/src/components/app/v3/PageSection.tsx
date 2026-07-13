import type { ReactNode } from "react";

export interface PageSectionProps {
  name: string;
  children: ReactNode;
}

export function PageSection({ name, children }: PageSectionProps) {
  return (
    <section
      data-component={name}
      className="flex flex-col gap-6 h-[calc(100dvh-176px)] md:h-[calc(100dvh-64px)]"
    >
      {children}
    </section>
  );
}
