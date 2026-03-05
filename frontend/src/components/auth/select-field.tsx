import * as React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface SelectFieldProps {
  label: string;
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: { value: string; label: string }[];
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "data-component"?: string;
}

export function SelectField({
  label,
  value,
  onValueChange,
  placeholder,
  options,
  error,
  disabled,
  id,
  className,
  "data-component": dataComponent,
}: SelectFieldProps) {
  const fieldId = id || label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-2" data-component={dataComponent}>
      <Label htmlFor={fieldId}>{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={fieldId}
          className={cn(
            "w-full shadow-none",
            error && "border-destructive focus-visible:ring-destructive",
            className,
          )}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          aria-invalid={!!error}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p
          id={`${fieldId}-error`}
          className="text-sm text-destructive animate-fade-in"
        >
          {error}
        </p>
      )}
    </div>
  );
}
