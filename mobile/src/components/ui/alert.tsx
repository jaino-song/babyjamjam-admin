import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from "lucide-react";

const alertVariants = cva(
  "relative w-full rounded-2xl border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>div]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive bg-destructive/10",
        success:
          "border-success/50 text-success dark:border-success [&>svg]:text-success bg-success/10",
        warning:
          "border-warning/50 text-warning dark:border-warning [&>svg]:text-warning bg-warning/10",
        info: "border-info/50 text-info dark:border-info [&>svg]:text-info bg-info/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const alertIcons = {
  default: Info,
  destructive: AlertCircle,
  success: CheckCircle,
  warning: AlertTriangle,
  info: Info,
};

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof alertVariants> {
  onClose?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  hideIcon?: boolean;
  contentClassName?: string;
  closeButtonClassName?: string;
  closeButtonLabel?: string;
  "data-component"?: string;
  dataComponents?: {
    root?: string;
    icon?: string;
    content?: string;
    closeButton?: string;
  };
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      className,
      variant = "default",
      children,
      onClose,
      icon,
      hideIcon = false,
      contentClassName,
      closeButtonClassName,
      closeButtonLabel = "Close alert",
      "data-component": dataComponent,
      dataComponents,
      ...props
    },
    ref
  ) => {
    const IconComponent = icon ?? alertIcons[variant || "default"];
    const componentName = dataComponent ?? "alert";
    const componentSlots = {
      root: dataComponents?.root ?? componentName,
      icon: dataComponents?.icon ?? `${componentName}-icon`,
      content: dataComponents?.content ?? `${componentName}-content`,
      closeButton:
        dataComponents?.closeButton ?? `${componentName}-close-button`,
    };

    return (
      <div
        ref={ref}
        role="alert"
        data-component={componentSlots.root}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {!hideIcon && <IconComponent data-component={componentSlots.icon} className="h-4 w-4" />}
        <div data-component={componentSlots.content} className={cn("flex-1", contentClassName)}>
          {children}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            data-component={componentSlots.closeButton}
            className={cn(
              "absolute right-2 top-2 rounded-2xl p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              closeButtonClassName
            )}
            aria-label={closeButtonLabel}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
