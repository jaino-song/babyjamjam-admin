import { Button, Paper, Stack, Typography } from "@mui/material"
import { MsgField } from "./MsgField"
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

interface GeneratedMsgProps {
  title: string;
  copyButtonText: string;
  message: string;
  onMessageChange?: (value: string) => void;
  handleCopy: () => void;
}

export const GeneratedMsg = ({ title, copyButtonText, message, onMessageChange, handleCopy }: GeneratedMsgProps) => {

    return (
        <Paper elevation={0} data-component="generated-msg" sx={{ bgcolor: "background.default" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            {/* title */}
            <Typography variant="h6" color="primary.main" fontWeight={600}>
              {title}
            </Typography>
            {/* copy button */}
            <Button
              variant="outlined"
              size="medium"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopy}
              data-component="generated-msg-copy-button"
            >
              {copyButtonText}
            </Button>
          </Stack>
          {/* message */}
          <MsgField value={message} onChange={onMessageChange} />
        </Paper>    
    )
}