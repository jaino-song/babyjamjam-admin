"use client";

import { useMemo, useState } from "react";
import {
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    DialogActions,
    Typography,
    Snackbar,
    Alert,
    CircularProgress,
    IconButton,
    Chip,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import {
    PictureAsPdf as PdfIcon,
    Image as ImageIcon,
    Description as FileIcon,
} from "@mui/icons-material";
import { Plus } from "lucide-react";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";

import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { ContentPaper } from "../root/content-paper";
import { DocumentDropzone } from "./document-dropzone";
import { formatDate } from "./document-list";
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
import { DataTable, type DataTableColumn } from "@/app/(components)/ui/datatable";


export function DocumentsTable() {
    const locale = useLocale();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));

    const muiChipColorValues = [
        "default",
        "primary",
        "secondary",
        "error",
        "info",
        "success",
        "warning",
    ] as const;
    type MuiChipColor = (typeof muiChipColorValues)[number];
    const isMuiChipColor = (value: string): value is MuiChipColor =>
        (muiChipColorValues as readonly string[]).includes(value);

    const [filterCategory, setFilterCategory] = useState<string | null>(null);
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
        filterCategory ?? undefined
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
    const tableData = useMemo(() => {
        return [...documents]
            .map((doc) => ({
                ...doc,
                tags: doc.tags?.join(" ") ?? "",
                raw: doc,
            }))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [documents]);

    const filterOptions = useMemo(() => {
        return [
            { label: "전체", value: null },
            ...categories.map((category) => ({
                label: category.label,
                value: category.id,
                color: isMuiChipColor(category.color) ? category.color : "default",
                chipSx: isMuiChipColor(category.color)
                    ? undefined
                    : {
                        bgcolor: category.color,
                        color: theme.palette.getContrastText(category.color),
                    },
            })),
        ];
    }, [categories, theme]);

    const getCategoryLabel = (categoryId: string, items: DocumentCategory[]): string => {
        const category = items.find((c) => c.id === categoryId);
        return category?.label || categoryId;
    };

    const getFileIcon = (mimeType: string) => {
        if (mimeType.includes("pdf")) {
            return <PdfIcon className="text-red-500" />;
        }
        if (mimeType.includes("image")) {
            return <ImageIcon className="text-blue-500" />;
        }
        return <FileIcon className="text-gray-500" />;
    };

    type DocumentRow = Omit<Document, "tags"> & { tags: string; raw: Document };
    const columns = useMemo<DataTableColumn<DocumentRow>[]>(() => {
        const baseColumns: DataTableColumn<DocumentRow>[] = [
            {
                key: "name",
                header: "문서명",
                align: "center",
                render: (row: DocumentRow) => (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "left" }}>
                        {getFileIcon(row.raw.mimeType)}
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {row.raw.name}
                        </Typography>
                    </Box>
                ),
            },
            {
                key: "createdAt",
                header: "등록일",
                align: "center",
                width: "110px",
                render: (row: DocumentRow) => formatDate(row.raw.createdAt),
            },
        ];

        if (!isMobile) {
            baseColumns.push({
                key: "categoryId",
                header: "카테고리",
                align: "center",
                width: "120px",
                render: (row: DocumentRow) => {
                    const category = categories.find((c) => c.id === row.raw.categoryId);
                    const label = getCategoryLabel(row.raw.categoryId, categories);

                    if (!category) {
                        return (
                            <Chip
                                label={label}
                                size="small"
                                sx={{ bgcolor: "rgba(0, 0, 0, 0.08)", color: "rgba(0, 0, 0, 0.87)" }}
                            />
                        );
                    }

                    if (isMuiChipColor(category.color)) {
                        return <Chip label={label} size="small" color={category.color} />;
                    }

                    return (
                        <Chip
                            label={label}
                            size="small"
                            sx={{
                                bgcolor: category.color,
                                color: theme.palette.getContrastText(category.color),
                            }}
                        />
                    );
                },
            });
        }

        return baseColumns;
    }, [categories, isMobile, theme]);
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
                <DataTable
                    data={tableData}
                    columns={columns}
                    isLoading={false}
                    getRowKey={(row: DocumentRow) => row.id}
                    onRowClick={(row: DocumentRow) => setPreviewDoc(row.raw)}
                    searchEnabled
                    searchFields={["name", "description", "tags"]}
                    searchPlaceholder="문서 검색"
                    filterOptions={filterOptions}
                    filterValue={filterCategory}
                    onFilterChange={(value: string | null) => setFilterCategory(value)}
                    filterAddAction={{
                        label: "카테고리 추가",
                        onClick: () => setIsAddCategoryOpen(true),
                    }}
                    pagination="none"
                    emptyMessage="등록된 문서가 없습니다"
                    toolbarActions={(
                        <IconButton
                            size="medium"
                            sx={{ color: "#1e88e5" }}
                            onClick={() => setIsUploadOpen(true)}
                        >
                            <Plus size={30} strokeWidth={2} />
                        </IconButton>
                    )}
                />
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
