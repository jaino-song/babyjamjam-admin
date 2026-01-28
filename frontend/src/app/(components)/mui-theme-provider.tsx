"use client";

import { ThemeProvider } from "@mui/material/styles";
import { createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";


const theme = createTheme({
  typography: {
    fontFamily: "var(--font-pretendard), 'Helvetica Neue', Arial, sans-serif",
  },
  palette: {
    background: {
      default: "#ffffff",
      paper: "#ffffff",
    },
    primary: {
      main: "#1e88e5",
    },
    secondary: {
      main: "#1b5e20",
    },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: "8px 16px",
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          "& fieldset": {
            borderColor: "#1e88e5",
          },
          "&:hover fieldset": {
            borderColor: "#1e88e5 !important",
          },
          "&.Mui-focused fieldset": {
            borderColor: "#1e88e5 !important",
          },
        },
      },
    },
    MuiInputAdornment: {
      styleOverrides: {
        root: {
          "& .MuiSvgIcon-root": {
            color: "#1e88e5",
          },
          "& .MuiIconButton-root": {
            color: "#1e88e5",
          },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        popupIndicator: {
          color: "#1e88e5",
        },
        clearIndicator: {
          color: "#1e88e5",
        },
      },
    },
  },
});

export const MuiThemeProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}