import { Textarea } from "@/components/ui/textarea";

interface MsgFieldProps {
  value: string;
  onChange?: (value: string) => void;
}

export const MsgField = ({ value, onChange }: MsgFieldProps) => {
  return (
    <Textarea
      data-component="messages-msg-field"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      rows={12}
      className="font-inherit text-base leading-relaxed max-h-[50vh] resize-none"
    />
  );
};
