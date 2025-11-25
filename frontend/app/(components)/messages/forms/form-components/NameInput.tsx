import { TextField } from "@mui/material";
import { useState } from "react";

// Regex to allow only letters (Korean, English, spaces)
const NAME_REGEX = /^[a-zA-Z가-힣\s]*$/;

export const NameInput = ({ name, setName, label, placeholder }: { name: string, setName: (name: string) => void, label: string, placeholder: string }) => {
    const [error, setError] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        
        // Check if input contains only valid characters
        if (NAME_REGEX.test(value)) {
            setName(value);
            setError(false);
        } else {
            // Show error but don't update the value
            setError(true);
        }
    };

    return (
        <TextField
            fullWidth
            label={label}
            value={name}
            onChange={handleChange}
            placeholder={placeholder}
            error={error}
            helperText={error ? "숫자나 특수문자는 입력할 수 없습니다" : ""}
        />
    );
};