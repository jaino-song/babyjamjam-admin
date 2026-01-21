"use client";

import { 
    Box, 
    Typography, 
    Button, 
    Card, 
    CardContent, 
    CardActions, 
    Grid, 
    IconButton, 
    Tooltip,
    CircularProgress,
    Stack,
    Chip
} from "@mui/material";
import { Edit as EditIcon, Delete as DeleteIcon, Visibility as VisibilityIcon, Add as AddIcon } from "@mui/icons-material";
import { useRouter } from "next/navigation";
import { useMessageTemplates, useDeleteMessageTemplate } from "@/app/hooks/use-message-templates";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { MessageTemplate } from "@/lib/template/types";

export const TemplateList = () => {
    const router = useRouter();
    const locale = useLocale();
    const { data: templates, isLoading } = useMessageTemplates();
    const { mutate: deleteTemplate } = useDeleteMessageTemplate();

    const handleEdit = (id: string) => {
        router.push(`/messages/templates/${id}/edit`);
    };

    const handleDelete = (id: string) => {
        if (confirm(t(locale, "common.delete-confirm"))) {
            deleteTemplate(id);
        }
    };

    const handleCreate = () => {
        router.push("/messages/templates/new");
    };

    if (isLoading) {
        return (
            <Box sx={{ display: "flex", justifyContent: "center", p: 5 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
                <Typography variant="h5" fontWeight={600}>
                    {t(locale, "nav.my-templates")}
                </Typography>
                <Button 
                    variant="contained" 
                    startIcon={<AddIcon />} 
                    onClick={handleCreate}
                >
                    {t(locale, "common.create")}
                </Button>
            </Box>

            <Grid container spacing={2}>
                {templates?.map((template: MessageTemplate) => (
                    <Grid key={template.id} size={{ xs: 12, sm: 6, md: 4 }}>
                        <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                            <CardContent sx={{ flexGrow: 1 }}>
                                <Typography variant="h6" gutterBottom noWrap>
                                    {template.name}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ 
                                    display: "-webkit-box",
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                    mb: 2
                                }}>
                                    {template.content}
                                </Typography>
                                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                    {template.variables.map(v => (
                                        <Chip key={v.key} label={v.label} size="small" variant="outlined" />
                                    ))}
                                </Stack>
                            </CardContent>
                            <CardActions sx={{ justifyContent: "flex-end", borderTop: 1, borderColor: "divider" }}>
                                <Tooltip title={t(locale, "common.view")}>
                                    <IconButton size="small" color="primary">
                                        <VisibilityIcon />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title={t(locale, "common.edit")}>
                                    <IconButton size="small" color="primary" onClick={() => handleEdit(template.id)}>
                                        <EditIcon />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title={t(locale, "common.delete")}>
                                    <IconButton size="small" color="error" onClick={() => handleDelete(template.id)}>
                                        <DeleteIcon />
                                    </IconButton>
                                </Tooltip>
                            </CardActions>
                        </Card>
                    </Grid>
                ))}
                {templates?.length === 0 && (
                    <Grid size={{ xs: 12 }}>
                        <Box sx={{ textAlign: "center", py: 10, bgcolor: "background.paper", borderRadius: 2 }}>
                            <Typography color="text.secondary">
                                {t(locale, "common.no-data")}
                            </Typography>
                        </Box>
                    </Grid>
                )}
            </Grid>
        </Box>
    );
};
