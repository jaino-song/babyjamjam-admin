import type { ReactNode } from "react";

export interface ListCardLoadMoreProps {
  children: ReactNode;
}

export function ListCardLoadMore({ children }: ListCardLoadMoreProps) {
  return (
    <div className="list-card-load-more" data-component="mobile-redesign-list-load-more">
      {children}
    </div>
  );
}
