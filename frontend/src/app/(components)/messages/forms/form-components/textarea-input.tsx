import { TextField } from "@mui/material";

interface TextareaInputProps {
    value: string;
    onChange: (value: string) => void;
    label: string;
    placeholder?: string;
    required?: boolean;
}

export const TextareaInput = ({ value, onChange, label, placeholder, required }: TextareaInputProps) => {
    return (
        <TextField
            fullWidth
            multiline
            rows={4}
            label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            sx={{ bgcolor: "background.default" }}
        />
    );
};
