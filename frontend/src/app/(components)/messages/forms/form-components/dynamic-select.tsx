import { FormControl, InputLabel, MenuItem, Select, CircularProgress } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/axios/client";
import { getDataSourceById } from "@/lib/template/data-sources";

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
    dataSourceId 
}: DynamicSelectProps) => {
    const dataSource = dataSourceId ? getDataSourceById(dataSourceId) : undefined;

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
                <MenuItem key={opt} value={opt}>
                    {opt}
                </MenuItem>
            ));
        }

        if (optionType === "dataSource" && remoteOptions && dataSource) {
            return remoteOptions.map((item: any) => (
                <MenuItem key={item[dataSource.valueField]} value={item[dataSource.valueField]}>
                    {item[dataSource.labelField]}
                </MenuItem>
            ));
        }

        return null;
    };

    return (
        <FormControl fullWidth required={required}>
            <InputLabel shrink={!!value || isLoading}>{label}</InputLabel>
            <Select
                value={value}
                onChange={(e) => onChange(e.target.value as string)}
                label={label}
                notched={!!value || isLoading}
                IconComponent={isLoading ? () => <CircularProgress size={20} sx={{ mr: 1 }} /> : undefined}
                sx={{ bgcolor: "background.default" }}
            >
                {renderOptions()}
            </Select>
        </FormControl>
    );
};
