"use client";
import { AppBar, Toolbar, IconButton, Box, Typography, Avatar } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import LoginIcon from '@mui/icons-material/Login';
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";

interface HeaderProps {
    language: string;
}

export const Header = ({ language }: HeaderProps) => {

    const { data: user, isLoading } = useQuery({
        queryKey: ['currentUser'],
        queryFn: async () => {
            try {
                const { data } = await api.get('/auth/me');
                return data;
            } catch {
                // If the request fails (e.g., 401), user is not logged in
                return null;
            }
        },
        retry: false,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
    
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
                {language === "ko" ? "관리자 대시보드" : "Admin Dashboard"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {language === "ko" ? "운영을 한눈에 모니터링" : "Monitor operations at a glance"}
              </Typography>
            </Box>
            <IconButton color="inherit" aria-label="notifications">
              <NotificationsNoneIcon />
            </IconButton>
            <IconButton color="inherit" aria-label={user ? "user" : "login"} disabled={isLoading}>
              {isLoading ? (
                <Avatar />
              ) : user ? (
                <Avatar alt={user?.name || 'User'} src={user?.profile_image || ''} />
              ) : (
                <LoginIcon />
              )}
            </IconButton>
          </Toolbar>
        </AppBar>
    );
}