import { TextField } from "@mui/material"

interface MsgFieldProps {
  defaultValue: string;
  onChange?: (value: string) => void;
}

export const MsgField = ({ defaultValue, onChange }: MsgFieldProps) => {
  return (
    <TextField
      multiline
      fullWidth
      defaultValue={defaultValue}
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
