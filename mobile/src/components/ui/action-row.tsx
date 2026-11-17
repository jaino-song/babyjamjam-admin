import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/lib/utils";

type ActionRowProps = ComponentProps<"div"> & { "data-component"?: string };

/** Exact thirds after the gap, independent of each action's padding. */
export function ActionRow({ className, ...props }: ActionRowProps): ReactElement {
  return (
    <div
      data-slot="action-row"
      data-source-component="ActionRow"
      className={cn("grid! grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 [&>*]:min-w-0", className)}
      {...props}
    />
  );
}
