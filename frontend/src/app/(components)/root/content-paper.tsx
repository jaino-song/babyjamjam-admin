"use client";

import { Paper, PaperProps, Typography, Box } from "@mui/material";
import { ReactNode } from "react";

interface ContentPaperProps extends PaperProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export function ContentPaper({
  title,
  subtitle,
  children,
  sx,
  ...props
}: ContentPaperProps) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        ...sx,
      }}
      {...props}
    >
      {(title || subtitle) && (
        <Box sx={{ mb: 3 }}>
          {title && (
            <Typography variant="h5" component="h1" fontWeight={600}>
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      )}
      {children}
    </Paper>
  );
}
