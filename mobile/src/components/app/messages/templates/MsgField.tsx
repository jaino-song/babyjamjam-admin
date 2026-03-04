import { Textarea } from "@/components/ui/textarea";

interface MsgFieldProps {
  value: string;
  onChange?: (value: string) => void;
}

export const MsgField = ({ value, onChange }: MsgFieldProps) => {
  return (
    <div className="rounded-2xl border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background">
      <Textarea
        data-component="messages-msg-field"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        rows={12}
        className="font-inherit text-base leading-relaxed max-h-[50vh] resize-none rounded-none border-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </div>
  );
};
