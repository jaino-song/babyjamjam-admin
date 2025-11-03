"use client";

import { ThemeProvider } from "@mui/material/styles";
import { createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";


const theme = createTheme({ 
    typography: {
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    },
    palette: {
      background: {
        default: "#f6f7fb",
      },
      primary: {
        main: "#1e88e5",
      },
      secondary: {
        main: "#1b5e20",
      },
    },
    shape: { borderRadius: 14 },
  });

export const MuiThemeProvider = ({ children }: { children: React.ReactNode }) => {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    );
}