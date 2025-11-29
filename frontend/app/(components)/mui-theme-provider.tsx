"use client";

import { ThemeProvider } from "@mui/material/styles";
import { createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";

const HEADER_COLOR = "#ffffff";
const BACKGROUND_COLOR = "#f6f7fb";
const PRIMARY_COLOR = "#1e88e5";
const SECONDARY_COLOR = "#1b5e20";

const theme = createTheme({ 
    typography: {
      fontFamily: "var(--font-pretendard), 'Helvetica Neue', Arial, sans-serif",
    },
    palette: {
      background: {
        default: BACKGROUND_COLOR,
      },
      primary: {
        main: PRIMARY_COLOR,
      },
      secondary: {
        main: SECONDARY_COLOR,
      },
    },
    shape: { borderRadius: 14 },
  });

export const MuiThemeProvider = ({ children }: { children: React.ReactNode }) => {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <GlobalStyles styles={{
              html: {
                backgroundColor: HEADER_COLOR,
              },
              body: {
                backgroundColor: BACKGROUND_COLOR,
              },
            }} />
            {children}
        </ThemeProvider>
    );
}