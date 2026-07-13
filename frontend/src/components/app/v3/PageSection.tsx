import type { CSSProperties, ReactNode } from "react";

export interface PageSectionProps {
  name: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function PageSection({ name, children, style }: PageSectionProps) {
  return (
    <section
      data-component={name}
      className="flex h-full min-h-0 flex-col gap-[calc(24px*var(--glint-ui-scale,1))]"
      style={style}
    >
      {children}
    </section>
  );
}
