import { Paper, Typography } from "@mui/material"

export const MsgField = ({ children }: { children: React.ReactNode }) => {
  return (
    <Paper elevation={0} sx={{ p: 2, border: 2, borderColor: "grey.200", maxHeight: "50vh", overflow: "auto"  }}>
      <Typography
        variant="body2"
        component="pre"
        sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "1rem" }}
      >
        {children}
      </Typography>
    </Paper>
  )
}
