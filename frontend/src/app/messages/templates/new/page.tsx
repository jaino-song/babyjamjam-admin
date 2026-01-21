"use client";

import { Box } from "@mui/material";
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
