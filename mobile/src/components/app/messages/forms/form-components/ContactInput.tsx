"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PHONE_REGEX = /^[0-9-]*$/;

interface ContactInputProps {
  phone: string;
  setPhone: (phone: string) => void;
  label: string;
  placeholder: string;
}

export const ContactInput = ({
  phone,
  setPhone,
  label,
  placeholder,
}: ContactInputProps) => {
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
    <div className="space-y-2" data-component="messages-form-contact-input">
      <Label>{label}</Label>
      <Input
        value={phone}
        onChange={handleChange}
        placeholder={placeholder}
        className={cn(error && "border-destructive")}
      />
      {error && (
        <p className="text-xs text-destructive">숫자만 입력할 수 있습니다</p>
      )}
    </div>
  );
};
