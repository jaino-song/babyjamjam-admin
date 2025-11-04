import { Avatar, Card, CardContent, Typography, Box } from "@mui/material";
import { Grid } from "@mui/material";
import { SvgIconComponent } from "@mui/icons-material";

export interface StatItem {
  label: string;
  value: string;
  helper: string;
  icon: SvgIconComponent;
}

interface StatsGridProps {
  stats: StatItem[];
}

export const StatsGrid = ({ stats }: StatsGridProps) => {
  return (
    <Grid container spacing={2}>
      {stats.map((item) => {
        const Icon = item.icon;
        return (
          <Grid key={item.label} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Card elevation={0} sx={{ p: 1.5 }}>
              <CardContent sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                <Avatar
                  sx={{
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                    width: 44,
                    height: 44,
                  }}
                >
                  <Icon fontSize="small" />
                </Avatar>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {item.label}
                  </Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {item.value}
                  </Typography>
                  <Typography variant="caption" color="success.main" fontWeight={600}>
                    {item.helper}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
};

