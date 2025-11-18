import { Button, Paper, Stack, Typography } from "@mui/material"
import { MsgField } from "./MsgField"
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

export const GeneratedMsg = ({ title, copyButtonText, children, handleCopy }: { title: string, copyButtonText: string, children: React.ReactNode, handleCopy: () => void }) => {

    return (
        <Paper elevation={0}>
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
            >
              {copyButtonText}
            </Button>
          </Stack>
          {/* message */}
          <MsgField>{children}</MsgField>
        </Paper>    
    )
}