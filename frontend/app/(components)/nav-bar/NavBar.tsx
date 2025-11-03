"use client";
import { AppBar, Toolbar, IconButton, Box, Typography, Avatar } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";

export const NavBar = () => {
    return (
        <AppBar
          position="static"
          elevation={0}
          sx={{
            bgcolor: "background.paper",
            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
            color: "text.primary",
          }}
        >
          <Toolbar sx={{ gap: 1, minHeight: { xs: 64, sm: 72 } }}>
            <IconButton edge="start" color="inherit" aria-label="open navigation">
              <MenuIcon />
            </IconButton>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" fontWeight={600}>
                Admin Dashboard
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Monitor operations at a glance
              </Typography>
            </Box>
            <IconButton color="inherit" aria-label="notifications">
              <NotificationsNoneIcon />
            </IconButton>
            <Avatar sx={{ width: 40, height: 40 }}>JP</Avatar>
          </Toolbar>
        </AppBar>
    );
}