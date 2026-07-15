"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface CompactDateSelectOption {
  label: string;
  value: string;
}

interface CompactDateSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: CompactDateSelectOption[];
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  dataComponent?: string;
  contentDataComponent?: string;
  triggerClassName?: string;
  contentClassName?: string;
  defaultOpen?: boolean;
}

const COMPACT_DATE_SELECT_WIDTH_CLASS_NAME = "w-[4.75rem]";
const COMPACT_DATE_SELECT_CONTENT_WIDTH_CLASS_NAME = "!min-w-[4.75rem] w-[4.75rem]";

export function CompactDateSelect({
  value,
  onValueChange,
  options,
  placeholder,
  id,
  ariaLabel,
  disabled = false,
  dataComponent,
  contentDataComponent,
  triggerClassName,
  contentClassName,
  defaultOpen,
}: CompactDateSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      defaultOpen={defaultOpen}
    >
      <SelectTrigger
        id={id}
        size="sm"
        aria-label={ariaLabel}
        data-component={dataComponent}
        className={cn(
          COMPACT_DATE_SELECT_WIDTH_CLASS_NAME,
          "justify-between gap-1 px-1.5 [&_[data-slot=select-value]]:flex-none [&_svg]:!size-3",
          triggerClassName,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        data-component={contentDataComponent}
        className={cn(COMPACT_DATE_SELECT_CONTENT_WIDTH_CLASS_NAME, contentClassName)}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="rounded-[10px] px-2 py-1.5 pr-2 text-[0.76rem] data-[state=checked]:!bg-[hsl(var(--v3-primary))] data-[state=checked]:!text-white data-[state=checked]:font-semibold [&_span[data-slot=select-item-indicator]]:hidden"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
