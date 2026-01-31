"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";
import { Box } from "@mui/material";

import { usePathname } from "next/navigation";

const SKIP_ANIMATION_ROUTES = ["/chat"];

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
    const skipAnimation = SKIP_ANIMATION_ROUTES.includes(pathname);

    return (
        <Box
            component={skipAnimation ? "article" : motion.article}
            data-component="AnimatedContainer"
            key={skipAnimation ? undefined : pathname}
            initial={skipAnimation ? undefined : { opacity: 0, y: 20 }}
            animate={skipAnimation ? undefined : { opacity: 1, y: 0 }}
            transition={skipAnimation ? undefined : { duration: 1 }}
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
