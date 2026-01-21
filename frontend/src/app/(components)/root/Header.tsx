"use client";
import { AppBar, Toolbar, IconButton, Box, Typography, Avatar, Drawer } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import LoginIcon from '@mui/icons-material/Login';
import { useState } from "react";
import { NavBar } from "../nav-bar/nav-bar";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { useGetAuthUser, AuthUser } from "@/app/hooks/useGetAuthUser";
import { NotificationBell } from "../notifications";

interface HeaderProps {
  // 서버에서 prefetch된 사용자 데이터 (duplicate fetch 방지)
  initialUser?: AuthUser | null;
}

export const Header = ({ initialUser }: HeaderProps) => {
  const locale = useLocale();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const handleNavOpen = () => {
    setIsNavOpen(true);
  };

  const handleNavClose = () => {
    setIsNavOpen(false);
  };

  // initialUser가 있으면 즉시 사용, 없으면 client-side fetch
  const { data: user, isLoading } = useGetAuthUser({ initialData: initialUser });
  const isE2EAuth = typeof window !== 'undefined'
    && (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__;

  const shouldShowNotifications = Boolean(user) || isE2EAuth;

  return (
    <>
      {/* Navbar Drawer */}
      <Drawer anchor="left" open={isNavOpen} onClose={handleNavClose} sx={{ '& .MuiDrawer-paper': { width: '50%' } }}>
        <NavBar onClose={handleNavClose} />
      </Drawer>
      {/* Header */}
      <AppBar
        position="static"
        data-component="header"
        elevation={0}
        sx={{
          bgcolor: "background.default",
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
          {/* Notifications */}
          {shouldShowNotifications && <NotificationBell />}
          {/* User Profile */}
          {/* initialUser가 있으면 로딩 상태 없이 즉시 렌더링 */}
          <IconButton color="inherit" aria-label={user ? "user" : "login"} disabled={!initialUser && isLoading}>
            {!initialUser && isLoading ? (
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