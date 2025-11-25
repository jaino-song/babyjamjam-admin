'use client';

import { Button, Typography } from "@mui/material";
import Link from "next/link";

interface NavButtonProps {
    href: string;
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
}

export const NavButton = ({ href, label, icon, active=false, onClick }: NavButtonProps) => {
    return (
        <Button 
            component={Link} 
            href={href} 
            onClick={onClick} 
            sx={{ 
                mt: 0, 
                px: 1.5, 
                py: 1.5, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'flex-start', 
                gap: 1,
                backgroundColor: active ? 'rgba(25, 118, 210, 0.15)' : 'transparent',
                color: active ? 'primary.main' : 'text.secondary',
                '&:hover': {
                    backgroundColor: active ? 'rgba(25, 118, 210, 0.12)' : 'action.hover',
                    color: active ? 'primary.dark' : 'text.primary',
                }
            }}
        >
            {icon}
            <Typography variant="body1" fontWeight={500}>{label}</Typography>
        </Button>
    );
};