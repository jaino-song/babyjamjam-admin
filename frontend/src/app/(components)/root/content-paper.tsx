import { Box, Fade, Paper, PaperProps, Typography } from "@mui/material";
import { SxProps, Theme } from "@mui/material/styles";

export interface ContentPaperProps extends Omit<PaperProps, 'elevation'> {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  header?: React.ReactNode;
  elevation?: number;
  disableAnimation?: boolean;
  sx?: SxProps<Theme>;
}

export const ContentPaper = ({
  children,
  title,
  subtitle,
  header,
  elevation = 2,
  disableAnimation = false,
  sx,
  ...paperProps
}: ContentPaperProps) => {
  const defaultSx: SxProps<Theme> = {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    p: 3,
    bgcolor: "background.default",
  };

  const mergedSx = {
    ...defaultSx,
    ...sx,
  } as SxProps<Theme>;

  const renderHeader = () => {
    if (header) {
      return header;
    }

    if (title || subtitle) {
      return (
        <Box sx={{ mb: title || subtitle ? 3 : 0 }}>
          {title && (
            <Typography
              variant="h5"
              color="primary.main"
              fontWeight={700}
              gutterBottom
            >
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      );
    }

    return null;
  };

  const content = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {renderHeader()}
      {children}
    </Box>
  );

  return (
    <Paper
      elevation={elevation}
      data-component="ContentPaper"
      data-testid="ContentPaper"
      sx={mergedSx}
      {...paperProps}
    >
      {disableAnimation ? (
        content
      ) : (
        <Fade in appear timeout={500}>
          {content}
        </Fade>
      )}
    </Paper>
  );
};
