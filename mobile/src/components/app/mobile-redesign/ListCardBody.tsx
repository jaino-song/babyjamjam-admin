import type { ReactNode, RefObject } from "react";

export interface ListCardBodyProps {
  children: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export function ListCardBody({ children, scrollRef }: ListCardBodyProps) {
  return (
    <div
      ref={scrollRef}
      className="list-card-scroll"
      data-component="mobile-redesign-list-scroll"
    >
      {children}
    </div>
  );
}
