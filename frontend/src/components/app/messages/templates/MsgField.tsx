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
      className="min-h-[280px] rounded-none border-0 bg-transparent px-0 py-0 font-sans text-[0.88rem] leading-7 text-v3-dark shadow-none resize-none focus-visible:ring-0 focus-visible:ring-offset-0"
    />
  );
};
