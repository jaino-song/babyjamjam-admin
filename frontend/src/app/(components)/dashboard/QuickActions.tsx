import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { Button, Stack, Typography } from "@mui/material";
import { ContentPaper } from "../root/content-paper";

interface QuickActionsProps {
  actions: string[];
  title: string;
  subtitle: string;
}

export const QuickActions = ({ actions, title, subtitle }: QuickActionsProps) => {
  return (
    <ContentPaper elevation={0} disableAnimation sx={{ flex: 1, p: { xs: 2.5, sm: 3 } }}>
      <Typography variant="subtitle1" fontWeight={600}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {subtitle}
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 2.5 }}>
        {actions.map((action) => (
          <Button
            key={action}
            variant="outlined"
            color="inherit"
            endIcon={<ArrowForwardIcon />}
            sx={{ justifyContent: "space-between", borderRadius: 2 }}
          >
            {action}
          </Button>
        ))}
      </Stack>
    </ContentPaper>
  );
};

