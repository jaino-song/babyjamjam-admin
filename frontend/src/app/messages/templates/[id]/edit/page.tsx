"use client";

import { useRouter, useParams } from "next/navigation";
import { Box, CircularProgress, Alert, IconButton } from "@mui/material";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { TemplateEditor } from "@/app/(components)/my-templates/template-editor";
import { useMessageTemplate } from "@/app/hooks/use-message-templates";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

export default function EditTemplatePage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;
    const locale = useLocale();

    const { data: template, isLoading, error } = useMessageTemplate(id);

    const BackButton = () => (
        <Box sx={{ mb: 2 }}>
            <IconButton
                component={Link}
                href="/messages/templates"
                sx={{ color: "text.secondary" }}
            >
                <ArrowLeft size={24} />
            </IconButton>
        </Box>
    );

    if (isLoading) {
        return (
            <Box sx={{ bgcolor: "background.paper" }}>
                <Box sx={{ px: { xs: 2, sm: 3, md: 6 }, py: { xs: 3, sm: 4 }, mx: "auto" }}>
                    <BackButton />
                    <ContentPaper
                        title={t(locale, "template-editor.edit-title")}
                        sx={{ minHeight: "70vh", display: "flex", justifyContent: "center", alignItems: "center" }}
                    >
                        <CircularProgress />
                    </ContentPaper>
                </Box>
            </Box>
        );
    }

    if (error || !template) {
        return (
            <Box sx={{ bgcolor: "background.paper" }}>
                <Box sx={{ px: { xs: 2, sm: 3, md: 6 }, py: { xs: 3, sm: 4 }, mx: "auto" }}>
                    <BackButton />
                    <ContentPaper
                        title={t(locale, "template-editor.edit-title")}
                        sx={{ minHeight: "70vh" }}
                    >
                        <Alert severity="error">{t(locale, "common.error-loading")}</Alert>
                    </ContentPaper>
                </Box>
            </Box>
        );
    }

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
                <BackButton />
                <ContentPaper
                    title={t(locale, "template-editor.edit-title")}
                    subtitle={t(locale, "template-editor.edit-subtitle")}
                    sx={{ minHeight: "70vh" }}
                >
                    <TemplateEditor initialData={template} />
                </ContentPaper>
            </Box>
        </Box>
    );
}

