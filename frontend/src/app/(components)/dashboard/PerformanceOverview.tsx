import { Box, LinearProgress, Stack, Typography } from "@mui/material";
import { ContentPaper } from "../root/ContentPaper";

export interface PerformanceMetric {
  label: string;
  conversion: number;
  progress: number;
}

interface PerformanceOverviewProps {
  metrics: PerformanceMetric[];
  title: string;
  subtitle: string;
}

export const PerformanceOverview = ({ metrics, title, subtitle }: PerformanceOverviewProps) => {
  return (
    <ContentPaper elevation={0} disableAnimation sx={{ flex: 2, p: { xs: 2.5, sm: 3 } }}>
      <Typography variant="subtitle1" fontWeight={600}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {subtitle}
      </Typography>
      <Stack spacing={2.5} sx={{ mt: 3 }}>
        {metrics.map((metric) => (
          <Box key={metric.label}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>
                {metric.label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {metric.conversion}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={metric.progress}
              sx={{ height: 10, borderRadius: 999 }}
            />
          </Box>
        ))}
      </Stack>
    </ContentPaper>
  );
};

