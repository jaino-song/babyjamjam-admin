import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { Button, Stack, Typography } from "@mui/material";
import { ContentPaper } from "../root/content-paper";

interface HeroBannerProps {
  title: string;
  subtitle: string;
  description?: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  primaryActionDisabled?: boolean;
  secondaryActionDisabled?: boolean;
  primaryActionHref?: string;
  secondaryActionHref?: string;
}

export const HeroBanner = ({
  title,
  subtitle,
  description,
  primaryActionLabel,
  secondaryActionLabel,
  primaryActionDisabled = false,
  secondaryActionDisabled = false,
  primaryActionHref,
  secondaryActionHref,
}: HeroBannerProps) => {
  return (
    <ContentPaper
      elevation={0}
      disableAnimation
      sx={{
        p: { xs: 2.5, sm: 3 },
        bgcolor: "primary.main",
        color: "primary.contrastText",
        borderRadius: 3,
        backgroundImage: "linear-gradient(135deg, rgba(30,136,229,0.9), rgba(21,101,192,0.85))",
      }}
    >
      <Typography variant="subtitle2" sx={{ opacity: 0.9, fontSize: "1rem" }}>
        {subtitle}
      </Typography>
      <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ mt: 1.5, maxWidth: 420 }}>
        {description}
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
        <Button href={primaryActionHref} variant="outlined" color="inherit" size="small" disabled={primaryActionDisabled} sx={{ px: 3, width: "50%" }}>
          {primaryActionLabel}
        </Button>
        <Button href={secondaryActionHref} variant="outlined" color="inherit" size="small" disabled={secondaryActionDisabled} sx={{ width: "50%" }}>
          {secondaryActionLabel}
        </Button>
      </Stack>
    </ContentPaper>
  );
};

