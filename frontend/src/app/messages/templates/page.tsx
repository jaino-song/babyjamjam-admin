"use client";

import { Box } from "@mui/material";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { TemplateList } from "@/app/(components)/my-templates/template-list";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

export default function MyTemplatesPage() {
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
                    title={t(locale, "nav.my-templates")}
                    subtitle={t(locale, "template-list.subtitle")}
                    sx={{ minHeight: "70vh" }}
                >
                    <TemplateList />
                </ContentPaper>
            </Box>
        </Box>
    );
}
