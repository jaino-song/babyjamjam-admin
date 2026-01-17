"use client";
import { useEffect } from "react";
import { Box, Stack, IconButton } from "@mui/material";
import CloseIcon from '@mui/icons-material/Close';
import { House, MessageCircle, File, Settings } from 'lucide-react';
import { t } from "@/app/lib/i18n/translations";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { NavButton } from "./NavButton";
import { LanguageSwitcher } from "./LanguageSwitcher";
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import AssignmentIndOutlinedIcon from '@mui/icons-material/AssignmentIndOutlined';
import { useLocale } from "@/app/(components)/LocaleProvider";
import { eformsignQueryKeys } from "@/app/hooks/useEformsignDocuments";
import { eformsignApi } from "@/services/api";

interface NavBarProps {
    onClose: () => void;
}

function isEformsignAuthenticated(): boolean {
    if (typeof window === "undefined") return false;
    const authTimeStr = sessionStorage.getItem("eformsign_auth_time");
    if (!authTimeStr) return false;
    const authTime = parseInt(authTimeStr, 10);
    const tokenExpiryMs = 60 * 60 * 1000;
    const bufferMs = 5 * 60 * 1000;
    return Date.now() - authTime < tokenExpiryMs - bufferMs;
}

export const NavBar = ({ onClose }: NavBarProps) => {
    const locale = useLocale();
    const pathname = usePathname();
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!isEformsignAuthenticated()) return;
        
        queryClient.prefetchQuery({
            queryKey: eformsignQueryKeys.allDocuments(),
            queryFn: () => eformsignApi.getAllDocuments(),
            staleTime: 1000 * 60 * 5,
        });
    }, [queryClient]);
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
                    <NavButton href="/settings" label={t(locale, "nav-bar.settings")} icon={<Settings size={15} />} active={isSettings} onClick={onClose} />
                </Stack>
            </Box>
            <LanguageSwitcher />
        </Box>
    );
}