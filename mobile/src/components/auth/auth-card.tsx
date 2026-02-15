import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AuthCardProps {
  children: React.ReactNode;
  title: string;
  description?: string;
  className?: string;
  "data-component"?: string;
}

export function AuthCard({ children, title, description, className, "data-component": dataComponent }: AuthCardProps) {
  return (
    <div data-component={dataComponent} className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card
        className={cn(
          "w-full max-w-[400px] animate-scale-in shadow-lg",
          className
        )}
      >
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold">{title}</CardTitle>
          {description && (
            <CardDescription className="text-base">{description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
