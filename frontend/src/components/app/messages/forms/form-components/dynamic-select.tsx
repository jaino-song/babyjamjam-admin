"use client";

import { useQuery } from "@tanstack/react-query";
import { LoadingState } from "@/components/app/ui/LoadingState";
import { api } from "@/lib/api/client";
import { getDataSourceById } from "@/lib/template/data-sources";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DynamicSelectProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  optionType?: "custom" | "dataSource";
  options?: string[];
  dataSourceId?: string;
}

export const DynamicSelect = ({
  value,
  onChange,
  label,
  required,
  optionType,
  options,
  dataSourceId,
}: DynamicSelectProps) => {
  const dataSource = dataSourceId
    ? getDataSourceById(dataSourceId)
    : undefined;

  const { data: remoteOptions, isLoading } = useQuery({
    queryKey: ["data-source", dataSourceId],
    queryFn: async () => {
      if (!dataSource) return [];
      const { data } = await api.get(dataSource.endpoint);
      return data;
    },
    enabled: optionType === "dataSource" && !!dataSource,
  });

  const renderOptions = () => {
    if (optionType === "custom" && options) {
      return options.map((opt) => (
        <SelectItem key={opt} value={opt}>
          {opt}
        </SelectItem>
      ));
    }

    if (optionType === "dataSource" && remoteOptions && dataSource) {
      return remoteOptions.map((item: Record<string, string>) => (
        <SelectItem
          key={item[dataSource.valueField]}
          value={item[dataSource.valueField]}
        >
          {item[dataSource.labelField]}
        </SelectItem>
      ));
    }

    return null;
  };

  return (
    <div className="space-y-2" data-component="desktop_messages_sections_form-dynamic-select">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={onChange} disabled={isLoading} required={required}>
          <SelectTrigger>
            {isLoading ? (
              <SelectValue placeholder="" />
            ) : (
              <SelectValue placeholder="선택하세요" />
            )}
          </SelectTrigger>
          <SelectContent>{renderOptions()}</SelectContent>
        </Select>
        {isLoading ? (
          <LoadingState inline size="sm" label={`${label} 선택 항목을 불러오는 중`} data-component="desktop_messages_sections_form-dynamic-select_loading" />
        ) : null}
      </div>
    </div>
  );
};
