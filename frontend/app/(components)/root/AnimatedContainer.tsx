"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";
import { Box } from "@mui/material";

interface AnimatedMessagesContainerProps {
    children: ReactNode;
    minHeight?: string;
    minWidth?: string;
}

export default function AnimatedMessagesContainer({
    children,
    minHeight,
    minWidth
}: AnimatedMessagesContainerProps) {
    return (
        <Box
            component={motion.div}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            sx={{
                minHeight: minHeight || '100%',
                minWidth: minWidth || '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                width: '100%',
            }}
        >
            {children}
        </Box>
    );
}
