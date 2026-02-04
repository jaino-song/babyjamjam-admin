"use client";

import { UserPlus, CalendarPlus, Send, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const actions = [
  {
    title: "고객 등록",
    icon: UserPlus,
    variant: "default" as const,
  },
  {
    title: "일정 추가",
    icon: CalendarPlus,
    variant: "outline" as const,
  },
  {
    title: "메시지 발송",
    icon: Send,
    variant: "outline" as const,
  },
  {
    title: "계약서 작성",
    icon: FileSignature,
    variant: "outline" as const,
  },
];

export function QuickActions() {
  return (
    <Card className="opacity-0 animate-fade-in" style={{ animationDelay: "400ms" }}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">빠른 실행</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action, index) => (
            <Button
              key={action.title}
              variant={action.variant}
              className={cn(
                "h-auto flex-col gap-2 py-4 transition-all duration-200",
                "hover:scale-105 hover:-translate-y-0.5 active:scale-95",
                "group opacity-0 animate-scale-in"
              )}
              style={{ animationDelay: `${450 + index * 50}ms` }}
            >
              <action.icon className="h-5 w-5 transition-transform duration-200 group-hover:-translate-y-1" />
              <span className="text-xs">{action.title}</span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
