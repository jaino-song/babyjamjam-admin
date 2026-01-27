"use client";

import { useState } from "react";
import {
  Box,
  FormControl,
  Select,
  MenuItem,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from "@mui/material";
import { Plus } from "lucide-react";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { DocumentDropzone } from "@/app/(components)/file-storage/document-dropzone";
import { DocumentList } from "@/app/(components)/file-storage/document-list";
import DocumentPreviewModal from "@/app/(components)/file-storage/document-preview-modal";
import { DocumentEditModal } from "@/app/(components)/file-storage/document-edit-modal";
import {
  useDocuments,
  useUploadDocument,
  useUpdateDocument,
  useDeleteDocument,
  Document as ApiDocument,
  getDownloadUrl,
} from "@/app/hooks/use-file-storage";

// Filter options
const CATEGORY_OPTIONS = [
  { value: "", label: "전체" },
  { value: "contract", label: "계약서" },
  { value: "invoice", label: "청구서" },
  { value: "receipt", label: "영수증" },
  { value: "report", label: "보고서" },
  { value: "certificate", label: "증명서" },
  { value: "form", label: "양식" },
  { value: "notice", label: "안내문" },
  { value: "employeecontract", label: "제공인력 계약서" },
];

export default function FileStoragePage() {
  // State
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<any | null>(null);
  const [editDocument, setEditDocument] = useState<any | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<any | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Hooks
  const { data: documents, isLoading } = useDocuments(
    categoryFilter ? { category: categoryFilter } : undefined
  );
  const uploadMutation = useUploadDocument();
  const updateMutation = useUpdateDocument();
  const deleteMutation = useDeleteDocument();

  // Handlers
  const handleUpload = (params: {
    file: File;
    name: string;
    description?: string;
    category: string;
    tags: string[];
  }) => {
    // Rename file if name is different (though usually handled by metadata)
    // Here we mainly rely on the metadata passed to the API
    // Since the API hook constructs FormData using the File object directly,
    // and doesn't take a separate 'name' parameter for the file content itself,
    // we create a new File object with the updated name to ensure consistency if needed.
    const renamedFile = new File([params.file], params.name, {
      type: params.file.type,
      lastModified: params.file.lastModified,
    });

    uploadMutation.mutate(
      {
        file: renamedFile,
        category: params.category,
        tags: params.tags,
        description: params.description,
        onProgress: (progress) => setUploadProgress(progress),
      },
      {
        onSuccess: () => {
          setShowUploadForm(false);
          setUploadProgress(0);
        },
      }
    );
  };

  const handlePreview = (doc: any) => {
    setPreviewDocument({
      id: doc.id,
      name: doc.name,
      mimeType: doc.mimetype,
    });
  };

  const handleDownload = (doc: any) => {
    window.open(getDownloadUrl(doc.id, true), "_blank");
  };

  const handlePrint = (doc: any) => {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = getDownloadUrl(doc.id);

    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
      } catch (e) {
        window.open(getDownloadUrl(doc.id), "_blank");
      }
      setTimeout(() => iframe.remove(), 1000);
    };

    document.body.appendChild(iframe);
  };

  const handleEdit = (doc: any) => {
    setEditDocument(doc);
  };

  const handleEditSave = (
    id: string,
    updates: {
      name?: string;
      description?: string;
      category?: string;
      tags?: string[];
    }
  ) => {
    updateMutation.mutate(
      { id, params: updates },
      {
        onSuccess: () => {
          setEditDocument(null);
        },
      }
    );
  };

  const handleDeleteClick = (doc: any) => {
    setDeleteDocument(doc);
  };

  const handleDeleteConfirm = () => {
    if (deleteDocument) {
      deleteMutation.mutate(deleteDocument.id, {
        onSuccess: () => {
          setDeleteDocument(null);
        },
      });
    }
  };

  // Map API data to DocumentList expected format (lowercase keys)
  const listDocuments =
    documents?.map((doc) => ({
      id: doc.id,
      name: doc.name,
      description: doc.description,
      category: doc.category,
      tags: doc.tags,
      mimetype: doc.mimeType,
      filesize: doc.fileSize,
      storagepath: doc.storagePath,
      storageurl: doc.storageUrl,
      createdat: doc.createdAt,
      updatedat: doc.updatedAt,
    })) || [];

  return (
    <Box sx={{ bgcolor: "background.paper", minHeight: "100vh" }}>
      <Box
        component="section"
        sx={{
          px: { xs: 2, sm: 3, md: 6 },
          py: { xs: 3, sm: 4 },
          mx: "auto",
        }}
      >
        <ContentPaper
          title="문서 관리"
          subtitle="문서를 업로드하고 관리합니다"
          sx={{ minHeight: "70vh" }}
        >
          {/* Toolbar */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 3,
            }}
          >
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <Select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                displayEmpty
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <IconButton
              size="medium"
              sx={{
                color: showUploadForm ? "error.main" : "#1e88e5",
                transition: "transform 0.2s",
                transform: showUploadForm ? "rotate(45deg)" : "none",
              }}
              onClick={() => setShowUploadForm(!showUploadForm)}
              aria-label="upload document"
            >
              <Plus size={30} strokeWidth={2} />
            </IconButton>
          </Box>

          {/* Upload Form */}
          {showUploadForm && (
            <Box sx={{ mb: 4 }}>
              <DocumentDropzone
                onUpload={handleUpload}
                isLoading={uploadMutation.isPending}
                uploadProgress={uploadProgress}
                error={uploadMutation.error ? "업로드 중 오류가 발생했습니다." : null}
              />
            </Box>
          )}

          {/* Document List */}
          <DocumentList
            documents={listDocuments}
            isloading={isLoading}
            onpreview={handlePreview}
            ondownload={handleDownload}
            onprint={handlePrint}
            onedit={handleEdit}
            ondelete={handleDeleteClick}
          />
        </ContentPaper>
      </Box>

      {/* Modals */}
      <DocumentPreviewModal
        open={!!previewDocument}
        document={previewDocument}
        onClose={() => setPreviewDocument(null)}
      />

      <DocumentEditModal
        open={!!editDocument}
        document={editDocument}
        onClose={() => setEditDocument(null)}
        onSave={handleEditSave}
        isSaving={updateMutation.isPending}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteDocument}
        onClose={() => setDeleteDocument(null)}
      >
        <DialogTitle>문서 삭제</DialogTitle>
        <DialogContent>
          <Typography>
            정말로 '{deleteDocument?.name}' 문서를 삭제하시겠습니까?
            <br />
            삭제된 문서는 복구할 수 없습니다.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDocument(null)}>취소</Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "삭제 중..." : "삭제"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
