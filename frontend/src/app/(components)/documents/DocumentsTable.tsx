"use client";

import { useState, useMemo } from "react";
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
    TextField,
} from "@mui/material";
import { Search, Plus } from "lucide-react";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";

import { useLocale } from "../LocaleProvider";
import { matchesKoreanSearch } from "@/app/lib/utils/korean-search";
import { t } from "@/app/lib/i18n/translations";
import { ContentPaper } from "../root/content-paper";
import { DocumentDropzone } from "./document-dropzone";
import DocumentList from "./document-list";
import DocumentPreviewModal from "./document-preview-modal";
import { DocumentEditModal } from "./document-edit-modal";
import { AddCategoryModal } from "./add-category-modal";
import {
    useDocuments,
    useUploadDocument,
    useUpdateDocument,
    useDeleteDocument,
    Document,
} from "@/app/hooks/use-documents";
import { useDocumentCategories, useCreateDocumentCategory, DocumentCategory } from "@/app/hooks/use-document-categories";


export function DocumentsTable() {
    const locale = useLocale();

    const [filterCategory, setFilterCategory] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
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

    const { data: categories = [] } = useDocumentCategories();
    const createCategoryMutation = useCreateDocumentCategory();

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
        categoryId: string;
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
            categoryId?: string;
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

    const handleSearchIconClick = () => {
        setIsSearchOpen(true);
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchInput(e.target.value);
    };

    const handleSearchBlur = () => {
        if (!searchInput.trim()) {
            setIsSearchOpen(false);
        }
    };


    const handleAddCategory = async (category: { value: string; label: string; color: string }) => {
        try {
            await createCategoryMutation.mutateAsync(category);
            setIsAddCategoryOpen(false);
            showSnackbar("태그가 추가되었습니다.", "success");
        } catch (err) {
            console.error(err);
            showSnackbar("태그 추가에 실패했습니다.", "error");
        }
    };

    const existingColors = categories.filter((c) => c.isCustom).map((c) => c.color);
    const filteredDocuments = useMemo(() => {
        if (!searchInput.trim()) return documents;
        return documents.filter((doc) =>
            matchesKoreanSearch(doc.name || '', searchInput.trim())
        );
    }, [documents, searchInput]);

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
                            gap: 0,
                            width: "100%",
                        }}
                    >
                        {isSearchOpen ? (
                            <TextField
                                size="small"
                                placeholder="문서 검색"
                                value={searchInput}
                                onChange={handleSearchChange}
                                onBlur={handleSearchBlur}
                                autoFocus
                                sx={{
                                    width: 60,
                                    "& .MuiOutlinedInput-root": {
                                        backgroundColor: "transparent",
                                    },
                                    "& .MuiOutlinedInput-notchedOutline": {
                                        border: "none",
                                    },
                                    "& .MuiInputBase-input": {
                                        padding: "8px 0",
                                    },
                                }}
                            />
                        ) : (
                            <IconButton
                                size="medium"
                                sx={{ color: "grey.600", width: 60 }}
                                onClick={handleSearchIconClick}
                                aria-label="문서 검색"
                            >
                                <Search size={24} strokeWidth={2} />
                            </IconButton>
                        )}

                        <Select
                            value={filterCategory}
                            onChange={(e) => { if (e.target.value !== "__add_new__") setFilterCategory(e.target.value); }}
                            displayEmpty
                            size="small"
                            sx={{ minWidth: 120, bgcolor: "background.paper" }}
                        >
                            <MenuItem key="__all__" value="">
                                전체
                            </MenuItem>
                            {categories.map((cat) => (
                                <MenuItem key={cat.id} value={cat.id}>
                                    {cat.label}
                                </MenuItem>
                            ))}
                            <Divider sx={{ my: 0.5 }} />
                            <MenuItem value="__add_new__"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setIsAddCategoryOpen(true);
                                }}
                                sx={{ color: "primary.main", fontWeight: 500 }}
                            >
                                <Plus size={16} style={{ marginRight: 8 }} />
                                태그 추가
                            </MenuItem>
                        </Select>


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
                        documents={filteredDocuments}
                        categories={categories}
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
                categories={categories}
                onEdit={(doc) => {
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

            <AddCategoryModal
                open={isAddCategoryOpen}
                onClose={() => setIsAddCategoryOpen(false)}
                onAdd={handleAddCategory}
                existingColors={existingColors}
                isLoading={createCategoryMutation.isPending}
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
