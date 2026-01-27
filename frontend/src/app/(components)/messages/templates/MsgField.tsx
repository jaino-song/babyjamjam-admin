import { TextField } from "@mui/material"

interface MsgFieldProps {
  value: string;
  onChange?: (value: string) => void;
}

export const MsgField = ({ value, onChange }: MsgFieldProps) => {
  return (
    <TextField
      data-component="MsgField"
      multiline
      fullWidth
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      rows={12}
      slotProps={{
        input: {
          sx: {
            fontFamily: "inherit",
            fontSize: "1rem",
            lineHeight: 1.6,

          },
        },
      }}
      sx={{
        "& .MuiOutlinedInput-root": {
          maxHeight: "50vh",
          overflowY: "auto",
          alignItems: "flex-start",
        },
      }}
    />
  )
}
