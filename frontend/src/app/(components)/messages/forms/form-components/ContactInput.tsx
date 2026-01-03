import { TextField } from "@mui/material";
import { useState } from "react";

const PHONE_REGEX = /^[0-9-]*$/;

export const ContactInput = ({ phone, setPhone, label, placeholder }: { phone: string, setPhone: (phone: string) => void, label: string, placeholder: string }) => {
    const [error, setError] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        
        if (PHONE_REGEX.test(value)) {
            setPhone(value);
            setError(false);
        } else {
            setError(true);
        }
    };

    return (
        <TextField
            fullWidth
            label={label}
            value={phone}
            error={error}
            onChange={handleChange}
            helperText={error ? "숫자만 입력할 수 있습니다" : ""}
            placeholder={placeholder}
        />
    );
};