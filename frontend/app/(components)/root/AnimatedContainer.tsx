"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";
import { Box } from "@mui/material";

import { usePathname } from "next/navigation";

interface AnimatedContainerProps {
    children: ReactNode;
    minHeight?: string;
    minWidth?: string;
}

export default function AnimatedContainer({
    children,
    minHeight,
    minWidth
}: AnimatedContainerProps) {
    const pathname = usePathname();

    return (
        <Box
            component={motion.article}
            data-component="animated-container"
            key={pathname}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1 }}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                alignItems: 'center',
                flexGrow: 1,
                bgcolor: 'background.paper',
            }}
        >
            {children}
        </Box>
    );
}
