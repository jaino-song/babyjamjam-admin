"use client";
import { Box, Stack, IconButton } from "@mui/material";
import CloseIcon from '@mui/icons-material/Close';
import { House, MessageCircle, File, Settings } from 'lucide-react';
import { t } from "@/app/lib/i18n/translations";
import { usePathname } from "next/navigation";
import { NavButton } from "./NavButton";
import { LanguageSwitcher } from "./LanguageSwitcher";
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import AssignmentIndOutlinedIcon from '@mui/icons-material/AssignmentIndOutlined';
import { useLocale } from "@/app/(components)/LocaleProvider";

interface NavBarProps {
    onClose: () => void;
}

export const NavBar = ({ onClose }: NavBarProps) => {
    const locale = useLocale();
    const pathname = usePathname();
    const isDashboard = pathname === "/dashboard";
    const isMessages = pathname?.includes("/messages");
    const isContracts = pathname === "/contracts";
    const isClients = pathname === "/clients";
    const isSettings = pathname === "/settings";
    const isEmployees = pathname === "/employees";

    return (
        <Box sx={{ width: '100%', height: '100%', p: 2, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Box sx={{ height: '90%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                    <IconButton onClick={onClose}>
                        <CloseIcon />
                    </IconButton>
                </Box>
                <Stack spacing={1}>
                    <NavButton href="/dashboard" label={t(locale, "nav-bar.dashboard")} icon={<House size={15} />} active={isDashboard} onClick={onClose} />
                    <NavButton href="/messages" label={t(locale, "nav-bar.messages")} icon={<MessageCircle size={15} />} active={isMessages} onClick={onClose} />
                    <NavButton href="/contracts" label={t(locale, "nav-bar.contracts")} icon={<File size={15} />} active={isContracts} onClick={onClose} />
                    <NavButton href="/clients" label={t(locale, "nav-bar.clients")} icon={<PeopleOutlineIcon fontSize="small" />} active={isClients} onClick={onClose} />
                    <NavButton href="/employees" label={t(locale, "nav-bar.employees")} icon={<AssignmentIndOutlinedIcon fontSize="small" />} active={isEmployees} onClick={onClose} />
                    <NavButton disabled={true} href="/settings" label={t(locale, "nav-bar.settings")} icon={<Settings size={15} />} active={isSettings} onClick={onClose} />
                </Stack>
            </Box>
            <LanguageSwitcher />
        </Box>
    );
}