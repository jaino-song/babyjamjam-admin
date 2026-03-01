import * as React from "react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./Input";

type InputFieldProps = {
  title: React.ReactNode;
  message?: React.ReactNode;
  messageTone?: "muted" | "error";
  className?: string;
  labelClassName?: string;
  headerClassName?: string;
  messageClassName?: string;
  messageId?: string;
  inputClassName?: string;
  inputProps: Omit<InputProps, "className">;
  renderInput?: (resolvedInputProps: InputProps) => React.ReactNode;
};

export function InputField({
  title,
  message,
  messageTone = "muted",
  className,
  labelClassName,
  headerClassName,
  messageClassName,
  messageId,
  inputClassName,
  inputProps,
  renderInput,
}: InputFieldProps) {
  const resolvedInputProps: InputProps = {
    ...inputProps,
    className: inputClassName,
  };

  return (
    <div data-component="input-field" className={cn("m-0.5 flex flex-col gap-1.5", className)}>
      <div className={cn("flex items-center justify-between gap-2", headerClassName)}>
        <label
          htmlFor={typeof inputProps.id === "string" ? inputProps.id : undefined}
          className={cn("text-xs font-semibold text-v3-text-muted", labelClassName)}
        >
          {title}
        </label>
        {message ? (
          <span
            id={messageId}
            aria-live="polite"
            className={cn(
              "text-[0.7rem] font-semibold leading-none",
              messageTone === "error" ? "text-v3-burgundy" : "text-v3-text-muted",
              messageClassName
            )}
          >
            {message}
          </span>
        ) : null}
      </div>
      {renderInput ? renderInput(resolvedInputProps) : <Input {...resolvedInputProps} />}
    </div>
  );
}
