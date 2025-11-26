import { Avatar, Card, CardContent, Typography, Box, Stack } from "@mui/material";
import { Grid } from "@mui/material";
import { SvgIconComponent } from "@mui/icons-material";

export interface StatItem {
  title: string;
  firstDataLabel?: string;
  secondDataLabel?: string;
  firstDataValue: string;
  secondDataValue?: string;
  icon?: SvgIconComponent;
}

interface StatsGridProps {
  stats: StatItem[];
  disabled?: boolean;
}

export const StatsGrid = ({ stats, disabled=false }: StatsGridProps) => {
  return (
    /* Grid for Stats */
    <Grid container spacing={2}>
      {stats.map((item) => {
        const Icon = item.icon;
        return (
          /* Grid Item */
          <Grid key={item.title} size={{ xs: 6, sm: 6, lg: 3 }} sx={{ opacity: disabled ? 0.5 : 1 }}>
            {/* Card */}
            <Card elevation={0} sx={{ py: 2.5, px: 3, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 2 }}>
              <Box sx={{ display: "flex", justifyContent: "center" }}>
                <Typography variant="body1" fontWeight={600} color="text.secondary">
                  {item.title}
                </Typography>
              </Box>
              <CardContent sx={{ display: "flex", alignItems: "center", justifyContent: "center", '&:last-child': { p: 0 } }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1.5 }}>
                <Stack direction="column" spacing={1}>
                  <Box key={`${item.firstDataLabel}-${item.firstDataValue}`} sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5 }}>
                    <Avatar
                      sx={{
                        bgcolor: disabled ? "text.secondary" : "primary.main",
                        color: disabled ? "white" : "primary.contrastText",
                        width: 44,
                        height: 44,
                      }}
                    >
                      {item.firstDataLabel && <Typography variant="body1" fontWeight={700} color="white">
                        {item.firstDataLabel}
                      </Typography>}
                      {!item.firstDataLabel && item.icon && <item.icon fontSize="small" />}
                    </Avatar>
                    <Box sx={{ minWidth: 50 }}>
                      <Typography variant="h6" fontWeight={700} sx={{ width: "100%" }}>
                        {item.firstDataValue}
                      </Typography>
                    </Box>
                  </Box>
                  {item.secondDataValue && (
                    <Box key={`${item.secondDataLabel}-${item.secondDataValue}`}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5 }}>
                      <Avatar
                        sx={{
                          bgcolor: disabled ? "text.secondary" : "primary.main",
                          color: disabled ? "white" : "primary.contrastText",
                          width: 44,
                          height: 44,
                        }}
                      >
                        {item.secondDataLabel && <Typography variant="body1" fontWeight={700} color="white">
                          {item.secondDataLabel}
                        </Typography>}
                      </Avatar>
                      <Box sx={{ minWidth: 50 }}>
                        <Typography variant="h6" fontWeight={700} sx={{ width: "100%" }}>
                          {item.secondDataValue}
                        </Typography>
                      </Box>
                    </Box>
                    </Box>
                  )}
                </Stack>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
};

