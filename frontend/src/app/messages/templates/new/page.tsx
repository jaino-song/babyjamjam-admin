"use client";

import { Box, IconButton } from "@mui/material";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { TemplateEditor } from "@/app/(components)/my-templates/template-editor";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

export default function NewTemplatePage() {
    const locale = useLocale();

    return (
        <Box sx={{ bgcolor: "background.paper" }}>
            <Box
                component="section"
                sx={{
                    px: { xs: 2, sm: 3, md: 6 },
                    py: { xs: 3, sm: 4 },
                    mx: "auto",
                }}
            >
                <Box sx={{ mb: 2 }}>
                    <IconButton
                        component={Link}
                        href="/messages/templates"
                        sx={{ color: "text.secondary" }}
                    >
                        <ArrowLeft size={24} />
                    </IconButton>
                </Box>
                <ContentPaper
                    title={t(locale, "template-editor.create-title")}
                    subtitle={t(locale, "template-editor.create-subtitle")}
                    sx={{ minHeight: "70vh" }}
                >
                    <TemplateEditor />
                </ContentPaper>
            </Box>
        </Box>
    );
}

