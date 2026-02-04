import Link from "next/link";
import { FileSignature, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeroBannerProps {
  title: string;
  subtitle: string;
  description?: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  primaryActionDisabled?: boolean;
  secondaryActionDisabled?: boolean;
  primaryActionHref?: string;
  secondaryActionHref?: string;
}

export function HeroBanner({
  title,
  subtitle,
  description,
  primaryActionLabel,
  secondaryActionLabel,
  primaryActionDisabled = false,
  secondaryActionDisabled = false,
  primaryActionHref,
  secondaryActionHref,
}: HeroBannerProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl p-6",
        "bg-gradient-to-br from-primary via-primary to-accent",
        "shadow-lg hover-lift opacity-0 animate-fade-in"
      )}
    >
      {/* Background decoration - creates depth without images */}
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -left-10 -bottom-10 h-32 w-32 rounded-full bg-white/5 blur-xl" />

      <div className="relative z-10 space-y-4">
        {/* Greeting */}
        <div className="space-y-1">
          <p
            className="text-sm font-medium text-primary-foreground/80 opacity-0 animate-fade-in"
            style={{ animationDelay: "100ms" }}
          >
            {subtitle}
          </p>
          <h1
            className="text-2xl font-bold text-primary-foreground flex items-center gap-2 opacity-0 animate-fade-in"
            style={{ animationDelay: "150ms" }}
          >
            {title} <span className="text-2xl">😀</span>
          </h1>
          {description && (
            <p
              className="text-sm text-primary-foreground/70 max-w-md opacity-0 animate-fade-in"
              style={{ animationDelay: "175ms" }}
            >
              {description}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div
          className="flex gap-3 opacity-0 animate-fade-in"
          style={{ animationDelay: "200ms" }}
        >
          <Button
            variant="outline"
            asChild={!primaryActionDisabled}
            disabled={primaryActionDisabled}
            className={cn(
              "border-2 border-primary-foreground/30 bg-transparent text-primary-foreground",
              "hover:bg-primary-foreground/10 hover:border-primary-foreground/50",
              "transition-all duration-200 hover:scale-105 active:scale-95",
              "flex-1 min-w-0 px-4"
            )}
          >
            {primaryActionDisabled ? (
              <span className="flex items-center">
                <FileSignature className="mr-2 h-4 w-4 shrink-0" />
                <span className="truncate">{primaryActionLabel}</span>
              </span>
            ) : (
              <Link href={primaryActionHref || "#"}>
                <FileSignature className="mr-2 h-4 w-4 shrink-0" />
                <span className="truncate">{primaryActionLabel}</span>
              </Link>
            )}
          </Button>
          <Button
            variant="outline"
            asChild={!secondaryActionDisabled}
            disabled={secondaryActionDisabled}
            className={cn(
              "border-2 border-primary-foreground/30 bg-transparent text-primary-foreground",
              "hover:bg-primary-foreground/10 hover:border-primary-foreground/50",
              "transition-all duration-200 hover:scale-105 active:scale-95",
              "flex-1 min-w-0 px-4"
            )}
          >
            {secondaryActionDisabled ? (
              <span className="flex items-center">
                <MessageSquare className="mr-2 h-4 w-4 shrink-0" />
                <span className="truncate">{secondaryActionLabel}</span>
              </span>
            ) : (
              <Link href={secondaryActionHref || "#"}>
                <MessageSquare className="mr-2 h-4 w-4 shrink-0" />
                <span className="truncate">{secondaryActionLabel}</span>
              </Link>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
