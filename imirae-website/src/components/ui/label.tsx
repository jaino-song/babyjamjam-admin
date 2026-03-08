import { type LabelHTMLAttributes, type ReactNode } from "react";

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  dataComponent?: string;
  children: ReactNode;
}

export function Label({
  required = false,
  dataComponent,
  children,
  ...props
}: LabelProps) {
  return (
    <label
      data-component={dataComponent ?? "label"}
      style={{
        display: "block",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--font-medium)" as string,
        color: "var(--color-neutral-700)",
        marginBottom: "var(--space-2)",
      }}
      {...props}
    >
      {children}
      {required && (
        <span
          style={{ color: "var(--color-primary-500)", marginLeft: "2px" }}
          aria-hidden="true"
        >
          *
        </span>
      )}
    </label>
  );
}
