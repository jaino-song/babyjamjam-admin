"use client";

import { useState, KeyboardEvent, useRef } from "react";
import { Box, TextField, IconButton, InputAdornment } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";

interface ChatInputProps {
    onSubmit: (message: string) => void;
    onFocus?: () => void;
    disabled?: boolean;
    placeholder?: string;
    compact?: boolean;
}

export function ChatInput({
    onSubmit,
    onFocus,
    disabled = false,
    placeholder = "무엇을 도와드릴까요?",
    compact = true,
}: ChatInputProps) {
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = () => {
        const trimmed = value.trim();
        if (trimmed && !disabled) {
            onSubmit(trimmed);
            setValue("");
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <Box
            sx={{
                width: "100%",
                maxWidth: compact ? 600 : "100%",
                mx: "auto",
            }}
        >
            <TextField
                fullWidth
                inputRef={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={onFocus}
                disabled={disabled}
                placeholder={placeholder}
                variant="outlined"
                size={compact ? "medium" : "medium"}
                multiline={!compact}
                maxRows={compact ? 1 : 4}
                slotProps={{
                    input: {
                        startAdornment: (
                            <InputAdornment position="start">
                                <AutoAwesomeIcon
                                    sx={{
                                        color: "primary.main",
                                        fontSize: 20,
                                    }}
                                />
                            </InputAdornment>
                        ),
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    onClick={handleSubmit}
                                    disabled={disabled || !value.trim()}
                                    color="primary"
                                    size="small"
                                >
                                    <SendIcon fontSize="small" />
                                </IconButton>
                            </InputAdornment>
                        ),
                    },
                }}
                sx={{
                    "& .MuiOutlinedInput-root": {
                        borderRadius: 3,
                        bgcolor: "background.paper",
                        transition: "box-shadow 0.2s ease-in-out",
                        "&:hover": {
                            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        },
                        "&.Mui-focused": {
                            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                        },
                    },
                }}
            />
        </Box>
    );
}
