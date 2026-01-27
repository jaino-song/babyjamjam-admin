"use client";

import { Avatar, Button, Divider, List, ListItem, ListItemAvatar, ListItemText, Stack, Typography } from "@mui/material";
import { ContentPaper } from "../root/content-paper";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { Fragment } from "react";

export interface ActivityItem {
  primary: string;
  secondary: string;
}

interface RecentActivityProps {
  items: ActivityItem[];
  title: string;
  actionLabel: string;
}

export const RecentActivity = ({ items, title, actionLabel }: RecentActivityProps) => {
  return (
    <ContentPaper elevation={0} disableAnimation sx={{ p: { xs: 2.5, sm: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>
        <Button size="small" endIcon={<ArrowForwardIcon />}>
          {actionLabel}
        </Button>
      </Stack>
      <List sx={{ mt: 1.5 }}>
        {items.map((item, index) => (
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
            {index < items.length - 1 && <Divider component="li" sx={{ ml: 7 }} />}
          </Fragment>
        ))}
      </List>
    </ContentPaper>
  );
};

