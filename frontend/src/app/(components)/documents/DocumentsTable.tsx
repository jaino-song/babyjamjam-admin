"use client";

import { useState } from "react";
import {
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    DialogActions,
    MenuItem,
    Select,
    Typography,
    Snackbar,
    Alert,
    CircularProgress,
    Divider,
    IconButton,
} from "@mui/material";
import { Search, Plus } from "lucide-react";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";

import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { ContentPaper } from "../root/content-paper";
import { DocumentDropzone } from "./document-dropzone";
import DocumentList from "./document-list";
import DocumentPreviewModal from "./document-preview-modal";
import { DocumentEditModal } from "./document-edit-modal";
import {
    useDocuments,
    useUploadDocument,
    useUpdateDocument,
    useDeleteDocument,
    Document,
} from "@/app/hooks/use-documents";

const CATEGORIES = [
    { value: "", label: "전체" },
    { value: "contract", label: "계약서" },
    { value: "invoice", label: "청구서" },
    { value: "receipt", label: "영수증" },
    { value: "report", label: "보고서" },
    { value: "certificate", label: "증명서" },
    { value: "form", label: "양식" },
    { value: "notice", label: "안내문" },
    { value: "employee-contract", label: "제공인력 계약서" },
];

export function DocumentsTable() {
    const locale = useLocale();

    const [filterCategory, setFilterCategory] = useState("");
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
    const [editDoc, setEditDoc] = useState<Document | null>(null);
    const [deleteDoc, setDeleteDoc] = useState<Document | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);

    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: "success" | "error";
    }>({
        open: false,
        message: "",
        severity: "success",
    });

    const { data: documents = [], isLoading, error } = useDocuments(
        filterCategory || undefined
    );

    const uploadMutation = useUploadDocument();
    const updateMutation = useUpdateDocument();
    const deleteMutation = useDeleteDocument();

    const handleCloseSnackbar = () => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    };

    const showSnackbar = (message: string, severity: "success" | "error") => {
        setSnackbar({ open: true, message, severity });
    };

    const handleUpload = async (params: {
        file: File;
        name: string;
        description?: string;
        category: string;
        tags: string[];
    }) => {
        try {
            setUploadProgress(0);
            await uploadMutation.mutateAsync({
                ...params,
                onProgress: (progress) => setUploadProgress(progress),
            });
            setIsUploadOpen(false);
            showSnackbar(t(locale, "documents.upload-success"), "success");
        } catch (err) {
            console.error(err);
            showSnackbar("문서 업로드에 실패했습니다.", "error");
        }
    };

    const handleUpdate = async (
        id: string,
        params: {
            name?: string;
            description?: string;
            category?: string;
            tags?: string[];
        }
    ) => {
        try {
            await updateMutation.mutateAsync({ id, ...params });
            setEditDoc(null);
            showSnackbar(t(locale, "documents.update-success"), "success");
        } catch (err) {
            console.error(err);
            showSnackbar("문서 수정에 실패했습니다.", "error");
        }
    };

    const handleDelete = async () => {
        if (!deleteDoc) return;
        try {
            await deleteMutation.mutateAsync(deleteDoc.id);
            setDeleteDoc(null);
            showSnackbar(t(locale, "documents.delete-success"), "success");
        } catch (err) {
            console.error(err);
            showSnackbar("문서 삭제에 실패했습니다.", "error");
        }
    };

    if (isLoading) {
        return (
            <ContentPaper
                title={t(locale, "documents.title")}
                subtitle="문서 및 파일을 관리합니다"
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            </ContentPaper>
        );
    }

    if (error) {
        return (
            <ContentPaper
                title={t(locale, "documents.title")}
                subtitle="문서 및 파일을 관리합니다"
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <Alert severity="error">{t(locale, "common.error")}</Alert>
            </ContentPaper>
        );
    }

    return (
        <ContentPaper
            title={t(locale, "documents.title")}
            subtitle="문서 및 파일을 관리합니다"
            sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
        >
            <Box data-component="documents-table-container">
                <Box
                    data-component="documents-toolbar"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-around",
                    }}
                >
                    <Box
                        data-component="documents-toolbar-buttons"
                        sx={{
                            display: "flex",
                            justifyContent: "space-around",
                            alignItems: "center",
                            gap: 1,
                            width: "100%",
                        }}
                    >
                        <IconButton size="medium" sx={{ color: "grey.600" }}>
                            <Search size={24} strokeWidth={2} />
                        </IconButton>

                        <Select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            displayEmpty
                            size="small"
                            sx={{ minWidth: 120, bgcolor: "background.paper" }}
                        >
                            {CATEGORIES.map((cat) => (
                                <MenuItem key={cat.value} value={cat.value}>
                                    {cat.label}
                                </MenuItem>
                            ))}
                        </Select>

                        <Box sx={{ flex: 1 }} />

                        <IconButton
                            size="medium"
                            sx={{ color: "#1e88e5" }}
                            onClick={() => setIsUploadOpen(true)}
                        >
                            <Plus size={30} strokeWidth={2} />
                        </IconButton>
                    </Box>
                </Box>

                <Divider />

                <Box sx={{ minHeight: 200, width: "100%" }}>
                    <DocumentList
                        documents={documents}
                        isLoading={false}
                        onPreview={(doc) => setPreviewDoc(doc)}
                        onEdit={(doc) => setEditDoc(doc)}
                        onDelete={(doc) => setDeleteDoc(doc)}
                    />
                </Box>
            </Box>

            <Dialog
                open={isUploadOpen}
                onClose={() => !uploadMutation.isPending && setIsUploadOpen(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <CloudUploadIcon color="primary" />
                    {t(locale, "documents.upload-title")}
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ mt: 1 }}>
                        <DocumentDropzone
                            onUpload={handleUpload}
                            isLoading={uploadMutation.isPending}
                            uploadProgress={uploadProgress}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setIsUploadOpen(false)}
                        disabled={uploadMutation.isPending}
                    >
                        {t(locale, "common.cancel")}
                    </Button>
                </DialogActions>
            </Dialog>

            <DocumentPreviewModal
                open={!!previewDoc}
                onClose={() => setPreviewDoc(null)}
                doc={previewDoc}
                onEdit={(doc) => {
                    setPreviewDoc(null);
                    setEditDoc(doc);
                }}
                onDelete={(doc) => {
                    setPreviewDoc(null);
                    setDeleteDoc(doc);
                }}
            />

            <DocumentEditModal
                open={!!editDoc}
                onClose={() => setEditDoc(null)}
                doc={editDoc}
                onSave={handleUpdate}
                isLoading={updateMutation.isPending}
            />

            <Dialog
                open={!!deleteDoc}
                onClose={() => setDeleteDoc(null)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>{t(locale, "documents.delete-confirm-title")}</DialogTitle>
                <DialogContent>
                    <Typography>
                        {t(locale, "documents.delete-confirm-message")}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDeleteDoc(null)}
                        disabled={deleteMutation.isPending}
                    >
                        {t(locale, "common.cancel")}
                    </Button>
                    <Button
                        onClick={handleDelete}
                        color="error"
                        variant="contained"
                        disabled={deleteMutation.isPending}
                        autoFocus
                    >
                        {deleteMutation.isPending ? t(locale, "common.deleting") : t(locale, "common.delete")}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            >
                <Alert
                    onClose={handleCloseSnackbar}
                    severity={snackbar.severity}
                    sx={{ width: "100%" }}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </ContentPaper>
    );
}
