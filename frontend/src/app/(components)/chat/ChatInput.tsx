"use client";

import { useState, KeyboardEvent, useRef } from "react";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const handleSubmit = () => {
        const trimmed = value.trim();
        if (trimmed && !disabled) {
            onSubmit(trimmed);
            setValue("");
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div
            className={cn(
                "w-full mx-auto",
                compact && "max-w-[600px]"
            )}
        >
            <div
                className={cn(
                    "flex items-center gap-2 px-4 py-3 rounded-xl bg-card border border-border",
                    "transition-shadow duration-200",
                    "hover:shadow-md focus-within:shadow-lg focus-within:border-primary/50"
                )}
            >
                <Sparkles className="w-5 h-5 text-primary shrink-0" />
                <textarea
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={onFocus}
                    disabled={disabled}
                    placeholder={placeholder}
                    rows={compact ? 1 : 4}
                    className={cn(
                        "flex-1 bg-transparent text-foreground placeholder:text-muted-foreground",
                        "focus:outline-none resize-none",
                        "text-base leading-normal",
                        compact && "max-h-[24px] overflow-hidden"
                    )}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSubmit}
                    disabled={disabled || !value.trim()}
                    className="shrink-0 text-primary hover:text-primary hover:bg-primary/10"
                >
                    <Send className="w-5 h-5" />
                </Button>
            </div>
        </div>
    );
}
