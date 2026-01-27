"use client";

import { Box, Typography } from "@mui/material";
import { TemplateVariable } from "@/lib/template/types";

interface TemplatePreviewProps {
    content: string;
    variables: TemplateVariable[];
}

export const TemplatePreview = ({ content, variables }: TemplatePreviewProps) => {
    const renderPreview = () => {
        let preview = content;
        variables.forEach((v) => {
            const regex = new RegExp(`\\{\\{\\s*${v.key}\\s*\\}\\}`, "g");
            preview = preview.replace(regex, `[${v.label}]`);
        });

        return preview.split("\n").map((line, i) => (
            <span key={i}>
                {line}
                <br />
            </span>
        ));
    };

    return (
        <Box sx={{ 
            p: 2, 
            bgcolor: "background.paper", 
            borderRadius: 1, 
            border: 1, 
            borderColor: "divider",
            minHeight: 100,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
        }}>
            <Typography variant="body1" sx={{ fontFamily: "monospace" }}>
                {renderPreview()}
            </Typography>
        </Box>
    );
};
