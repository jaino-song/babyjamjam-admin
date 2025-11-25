"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

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
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ minHeight, minWidth }}
            className="flex flex-col justify-center items-center h-full w-full"
        >
            {children}
        </motion.div>
    );
}
