"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Regex to allow only letters (Korean, English, spaces)
// Includes:
// - a-zA-Z: English letters
// - ㄱ-ㅎ: Korean consonants (Jamo)
// - ㅏ-ㅣ: Korean vowels (Jamo)
// - 가-힣: Complete Korean syllables (Hangul)
// - ᄀ-ᇿ: Hangul compatibility Jamo (for IME composition)
// - \s: Whitespace
const NAME_REGEX = /^[a-zA-Z\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3·\s]*$/;

interface NameInputProps {
  name: string;
  setName: (name: string) => void;
  label: string;
  placeholder: string;
}

export const NameInput = ({
  name,
  setName,
  label,
  placeholder,
}: NameInputProps) => {
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
    <div className="space-y-2" data-component="name-input">
      <Label>{label}</Label>
      <Input
        value={name}
        onChange={handleChange}
        placeholder={placeholder}
        className={cn("bg-background", error && "border-destructive")}
      />
      {error && (
        <p className="text-xs text-destructive">
          숫자나 특수문자는 입력할 수 없습니다
        </p>
      )}
    </div>
  );
};
