"use client";
import { Box, Stack, IconButton } from "@mui/material";
import CloseIcon from '@mui/icons-material/Close';
import { House, MessageCircle, File, Settings } from 'lucide-react';
import { t } from "@/app/lib/i18n/translations";
import { usePathname } from "next/navigation";
import { NavButton } from "./NavButton";
import { LanguageSwitcher } from "./LanguageSwitcher";
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';

interface NavBarProps {
    onClose: () => void;
}

export const NavBar = ({ onClose }: NavBarProps) => {
    const pathname = usePathname();
    const isDashboard = pathname === "/dashboard";
    const isMessages = pathname?.includes("/messages");
    const isContracts = pathname === "/contracts";
    const isClients = pathname === "/clients";
    const isSettings = pathname === "/settings";

    return (
        <Box sx={{ width: '100%', height: '100%', p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Box sx={{ height: '90%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                    <IconButton onClick={onClose}>
                        <CloseIcon />
                    </IconButton>
                </Box>
                <Stack spacing={1}>
                    <NavButton href="/dashboard" label={t("ko", "nav-bar.dashboard")} icon={<House size={15} />} active={isDashboard} onClick={onClose} />
                    <NavButton href="/messages/greeting" label={t("ko", "nav-bar.messages")} icon={<MessageCircle size={15} />} active={isMessages} onClick={onClose} />
                    <NavButton disabled={true} href="/clients" label={t("ko", "nav-bar.clients")} icon={<PeopleOutlineIcon fontSize="small" />} active={isClients} onClick={onClose} />
                    <NavButton disabled={true} href="/contracts" label={t("ko", "nav-bar.contracts")} icon={<File size={15} />} active={isContracts} onClick={onClose} />
                    <NavButton disabled={true} href="/settings" label={t("ko", "nav-bar.settings")} icon={<Settings size={15} />} active={isSettings} onClick={onClose} />
                </Stack>
            </Box>
            <LanguageSwitcher />
        </Box>
    );
}