import type { ReactNode } from "react";

interface AuthPageLayoutProps {
  children: ReactNode;
  "data-component": string;
}

export function AuthPageLayout({ children, "data-component": dataComponent }: AuthPageLayoutProps) {
  return (
    <div data-component={dataComponent} data-slot="auth-layout" data-source-component="AuthPageLayout" className="auth-layout">
      <div data-component={`${dataComponent}_content`} data-slot="auth-page-content" className="auth-page-content">
        {children}
      </div>
    </div>
  );
}
