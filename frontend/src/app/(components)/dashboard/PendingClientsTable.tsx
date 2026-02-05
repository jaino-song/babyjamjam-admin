"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pendingClients } from "@/app/data/mockData";

const statusConfig = {
  waiting: {
    label: "대기중",
    badgeClass: "bg-warning/10 text-warning border-warning/30",
    avatarClass: "bg-success/10 text-success",
  },
  inProgress: {
    label: "진행중",
    badgeClass: "bg-success/10 text-success border-success/30",
    avatarClass: "bg-primary/10 text-primary",
  },
  completed: {
    label: "완료",
    badgeClass: "bg-primary text-primary-foreground border-primary",
    avatarClass: "bg-warning/10 text-warning",
  },
};

export function PendingClientsTable() {
  return (
    <div data-component="pending-clients-table" className="opacity-0 animate-fade-in" style={{ animationDelay: "300ms" }}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">List Item Cards</p>
      <div className="rounded-xl border bg-card overflow-hidden">
        {pendingClients.map((client, index) => {
          const statusKey = index === 0 ? "inProgress" : index === 1 ? "waiting" : "completed";
          const status = statusConfig[statusKey];
          const initials = client.name.slice(0, 2);

          return (
            <div
              key={client.id}
              data-component="list-item-card"
              className={cn(
                "flex items-center gap-3 px-4 py-3",
                "transition-colors cursor-pointer hover:bg-muted/50",
                index !== pendingClients.length - 1 && "border-b"
              )}
            >
              <div
                className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                  status.avatarClass
                )}
              >
                {initials}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{client.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {client.type} · {client.startDate}
                </p>
              </div>

              <div
                className={cn(
                  "px-2.5 py-1 rounded-full border text-xs font-medium shrink-0",
                  status.badgeClass
                )}
              >
                {status.label}
              </div>

              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
