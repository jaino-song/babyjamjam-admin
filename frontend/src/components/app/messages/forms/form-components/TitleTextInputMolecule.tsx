"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface TitleTextInputMoleculeProps
  extends Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange"> {
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
  error?: boolean;
  helperText?: string;
  helperTextClassName?: string;
  containerClassName?: string;
  inputClassName?: string;
  dataComponent?: string;
}

export const TitleTextInputMolecule = ({
  id,
  label,
  value,
  onValueChange,
  required = false,
  error = false,
  helperText,
  helperTextClassName,
  containerClassName,
  inputClassName,
  dataComponent = "messages-form-title-text-input-molecule",
  ...inputProps
}: TitleTextInputMoleculeProps) => {
  const generatedId = useId();
  const fieldId = id ?? `title-text-input-${generatedId.replace(/:/g, "")}`;

  return (
    <div
      className={cn("flex flex-col gap-2", containerClassName)}
      data-component={dataComponent}
    >
      <Label htmlFor={fieldId}>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Input
        id={fieldId}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn("bg-background", error && "border-destructive", inputClassName)}
        {...inputProps}
      />
      {helperText ? (
        <p className={cn("text-xs text-destructive", helperTextClassName)}>{helperText}</p>
      ) : null}
    </div>
  );
};
