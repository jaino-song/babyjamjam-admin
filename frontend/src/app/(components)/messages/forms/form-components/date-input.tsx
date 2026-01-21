import { TextField } from "@mui/material";

interface DateInputProps {
    value: string;
    onChange: (value: string) => void;
    label: string;
    required?: boolean;
}

export const DateInput = ({ value, onChange, label, required }: DateInputProps) => {
    return (
        <TextField
            fullWidth
            type="date"
            label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
            InputLabelProps={{ shrink: true }}
            sx={{ bgcolor: "background.default" }}
        />
    );
};
