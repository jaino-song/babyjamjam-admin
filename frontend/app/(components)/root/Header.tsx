"use client";
import { AppBar, Toolbar, IconButton, Box, Typography, Avatar, Drawer } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import LoginIcon from '@mui/icons-material/Login';
import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/axios";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NavBar } from "../nav-bar/NavBar";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";

export const Header = () => {
  const locale = useLocale();
  const [isNavOpen, setIsNavOpen] = useState(false);

  const handleNavOpen = () => {
    setIsNavOpen(true);
  };

  const handleNavClose = () => {
    setIsNavOpen(false);
  };
  const pathname = usePathname();
  const isLoginPage = pathname?.includes('/login');

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
    enabled: !isLoginPage, // Don't fetch user data on login page
  });

  return (
    <>
      {/* Navbar Drawer */}
      <Drawer anchor="left" open={isNavOpen} onClose={handleNavClose} sx={{ '& .MuiDrawer-paper': { width: '50%' } }}>
        <NavBar onClose={handleNavClose} />
      </Drawer>
      {/* Header */}
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
          {/* Menu Icon */}
          <IconButton edge="start" color="inherit" aria-label="open navigation" onClick={handleNavOpen}>
            <MenuIcon />
          </IconButton>
          {/* Company Name */}
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" fontWeight={600}>
              {t(locale, "header.companyName")}
            </Typography>
            {/* Subtitle */}
            <Typography variant="body2" color="text.secondary">
              {t(locale, "header.companySubtitle")}
            </Typography>
          </Box>
          {/* Notifications Icon */}
          {/* <IconButton color="inherit" aria-label="notifications">
            <NotificationsNoneIcon />
          </IconButton> */}
          {/* User Profile */}
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
    </>
  );
}