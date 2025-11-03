"use client";

import { Fragment } from "react";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ChecklistIcon from "@mui/icons-material/Checklist";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

const stats = [
  {
    label: "Active Users",
    value: "1,248",
    helper: "+18% vs last week",
    icon: PeopleOutlineIcon,
  },
  {
    label: "Pending Approvals",
    value: "32",
    helper: "5 require follow-up",
    icon: ChecklistIcon,
  },
  {
    label: "Revenue",
    value: "$42.8k",
    helper: "+6.2% growth",
    icon: TrendingUpIcon,
  },
  {
    label: "Reports",
    value: "14",
    helper: "Updated today",
    icon: AssessmentIcon,
  },
];

const activity = [
  {
    primary: "New partner onboarded",
    secondary: "Today · Kelly Park",
  },
  {
    primary: "Invoice #3481 approved",
    secondary: "1 hr ago · Finance",
  },
  {
    primary: "Policy update published",
    secondary: "Yesterday · Compliance",
  },
  {
    primary: "System maintenance complete",
    secondary: "2 days ago · IT",
  },
];

const quickActions = [
  "Add User",
  "Review Requests",
  "Create Report",
  "Schedule Meeting",
];

export default function Home() {
  return (
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <Box
          component="main"
          sx={{
            px: { xs: 2, sm: 3, md: 6 },
            py: { xs: 3, sm: 4 },
            maxWidth: 1200,
            mx: "auto",
          }}
        >
          <Stack spacing={3}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 2.5, sm: 3 },
                bgcolor: "primary.main",
                color: "primary.contrastText",
                borderRadius: 3,
                backgroundImage:
                  "linear-gradient(135deg, rgba(30,136,229,0.9), rgba(21,101,192,0.85))",
              }}
            >
              <Typography variant="subtitle2" sx={{ opacity: 0.85 }}>
                Welcome back,
              </Typography>
              <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
                Jeong Park
              </Typography>
              <Typography variant="body2" sx={{ mt: 1.5, maxWidth: 420 }}>
                Your organization is operating smoothly. Review today&apos;s highlights
                and respond to pending approvals to keep everything on track.
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  color="secondary"
                  size="small"
                  endIcon={<ArrowForwardIcon />}
                >
                  View Insights
                </Button>
                <Button variant="outlined" color="inherit" size="small">
                  Schedule Briefing
                </Button>
              </Stack>
            </Paper>

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

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Paper elevation={0} sx={{ flex: 2, p: { xs: 2.5, sm: 3 } }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Weekly Performance
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Total conversion rate compared to the previous period.
                </Typography>
                <Stack spacing={2.5} sx={{ mt: 3 }}>
                  {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, index) => (
                    <Box key={day}>
                      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {day}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {75 + index * 5}%
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={70 + index * 6}
                        sx={{ height: 10, borderRadius: 999 }}
                      />
                    </Box>
                  ))}
                </Stack>
              </Paper>

              <Paper elevation={0} sx={{ flex: 1, p: { xs: 2.5, sm: 3 } }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Quick Actions
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Stay ahead of today&apos;s priorities.
                </Typography>
                <Stack spacing={1.5} sx={{ mt: 2.5 }}>
                  {quickActions.map((action) => (
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
              </Paper>
            </Stack>

            <Paper elevation={0} sx={{ p: { xs: 2.5, sm: 3 } }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle1" fontWeight={600}>
                  Recent Activity
                </Typography>
                <Button size="small" endIcon={<ArrowForwardIcon />}>
                  View all
                </Button>
              </Stack>
              <List sx={{ mt: 1.5 }}>
                {activity.map((item, index) => (
                  <Fragment key={item.primary}>
                    <ListItem sx={{ px: 0 }}>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}>
                          {item.primary.charAt(0)}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Typography variant="body1" fontWeight={600}>
                            {item.primary}
                          </Typography>
                        }
                        secondary={
                          <Typography variant="body2" color="text.secondary">
                            {item.secondary}
                          </Typography>
                        }
                      />
                    </ListItem>
                    {index < activity.length - 1 && <Divider component="li" sx={{ ml: 7 }} />}
                  </Fragment>
                ))}
              </List>
            </Paper>
          </Stack>
        </Box>
      </Box>
  );
}
