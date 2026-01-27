import { TextField } from "@mui/material";

interface NumberInputProps {
    value: string;
    onChange: (value: string) => void;
    label: string;
    placeholder?: string;
    required?: boolean;
    min?: number;
    max?: number;
}

export const NumberInput = ({ value, onChange, label, placeholder, required, min, max }: NumberInputProps) => {
    return (
        <TextField
            fullWidth
            type="number"
            label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            inputProps={{ min, max }}
            sx={{ bgcolor: "background.default" }}
        />
    );
};
