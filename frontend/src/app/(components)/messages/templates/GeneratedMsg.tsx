import { memo } from "react";
import { motion } from "framer-motion";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MsgField } from "./MsgField";

interface GeneratedMsgProps {
  title: string;
  copyButtonText: string;
  message: string;
  onMessageChange?: (value: string) => void;
  handleCopy: () => void;
}

export const GeneratedMsg = memo(function GeneratedMsg({
  title,
  copyButtonText,
  message,
  onMessageChange,
  handleCopy,
}: GeneratedMsgProps) {
  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(10px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.8 }}
    >
      <div className="flex flex-row justify-between items-center mb-4">
        <h6 className="text-lg font-semibold text-primary">{title}</h6>
        <Button
          variant="outline"
          size="default"
          className="w-20 gap-2"
          onClick={handleCopy}
          data-component="generated-msg-copy-button"
        >
          <Copy className="h-4 w-4" />
          {copyButtonText}
        </Button>
      </div>
      <MsgField value={message} onChange={onMessageChange} />
    </motion.div>
  );
});
