import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/toaster";

// The public record page sits outside the `(shell)` tree, so the shell's
// Toaster never renders here. Mount one for this route; it is the only mount
// besides the shell's (asserted in mobile-shell-providers.test.ts).
export default function ServiceRecordTokenLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
