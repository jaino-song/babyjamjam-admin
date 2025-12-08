import { Box, Card, Fade, Paper, Typography } from "@mui/material";
import { GeneratedMsg } from "../messages/templates/GeneratedMsg";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

interface ComponentContainerProps {
  textJSON: string;
  children: React.ReactNode;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
}

export const ComponentContainer = ({ textJSON, borderTopLeftRadius, borderTopRightRadius, children }: ComponentContainerProps) => {
  const locale = useLocale();
  const localeFile = `${textJSON}`;

  return (
    <Paper elevation={2} data-component="component-container" sx={{ display: "flex", flexDirection: "column", justifyContent: "center", p: 3, flexGrow: 1, width: "100%", minHeight: "70vh", bgcolor: "background.default" }}>
      <Fade in appear timeout={500}>
        <Box data-component="component-container-content" sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* title */}
          <Typography variant="h5" color="primary.main" data-component="component-container-title" fontWeight={700} gutterBottom>
            {t(locale, `${localeFile}.title`)}
          </Typography>
          {/* subtitle */}
          <Typography variant="body2" color="text.secondary" data-component="component-container-subtitle" sx={{ mb: 3 }}>
            {t(locale, `${localeFile}.subtitle`)}
          </Typography>

          {children}
        </Box>
      </Fade>
    </Paper>
  );
};