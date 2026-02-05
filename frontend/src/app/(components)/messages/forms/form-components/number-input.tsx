import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NumberInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
}

export const NumberInput = ({
  value,
  onChange,
  label,
  placeholder,
  required,
  min,
  max,
}: NumberInputProps) => {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        className="bg-background"
      />
    </div>
  );
};
