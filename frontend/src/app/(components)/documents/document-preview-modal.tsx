"use client";

import React, { useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Button,
  Typography,
  Box,
  Chip,
  Divider,
  Menu,
  MenuItem,
} from "@mui/material";
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  MoreVert as MoreVertIcon,
} from "@mui/icons-material";
import { Document, getDownloadUrl } from "@/app/hooks/use-documents";
import { DocumentCategory } from "@/app/hooks/use-document-categories";
import { formatFileSize, formatDate } from "./document-list";

interface DocumentPreviewModalProps {
  open: boolean;
  onClose: () => void;
  doc: Document | null;
  categories: DocumentCategory[];
  onEdit?: (doc: Document) => void;
  onDelete?: (doc: Document) => void;
}

function getCategoryLabel(categoryId: string, categories: DocumentCategory[]): string {
  const category = categories.find((c) => c.id === categoryId);
  return category?.label || categoryId;
}

export default function DocumentPreviewModal({
  open,
  onClose,
  doc,
  categories,
  onEdit,
  onDelete,
}: DocumentPreviewModalProps) {
  const [zoom, setZoom] = useState(1);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const printFrameRef = useRef<HTMLIFrameElement>(null);

   if (!doc) return null;

   // Helper to get file extension from mimetype
   const getExtensionFromMimetype = (mimetype: string): string => {
     const mimeToExt: Record<string, string> = {
       "application/pdf": ".pdf",
       "image/jpeg": ".jpg",
       "image/png": ".png",
       "image/gif": ".gif",
       "image/webp": ".webp",
       "application/msword": ".doc",
       "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
       "application/vnd.ms-excel": ".xls",
       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
     };
     return mimeToExt[mimetype] || "";
   };

    const handlePrint = () => {
     // Create a hidden iframe for printing
     const iframe = window.document.createElement("iframe");
     iframe.style.display = "none";
     iframe.src = getDownloadUrl(doc.id);
    
    // When loaded, print
    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
      } catch (e) {
        console.error("Print failed", e);
      }
      // Cleanup after a delay to ensure print dialog has opened
      setTimeout(() => {
        window.document.body.removeChild(iframe);
      }, 2000);
    };

    window.document.body.appendChild(iframe);
  };

    const handleDownload = () => {
      let filename = doc.name;
      // Add extension if missing
      if (!filename.includes(".")) {
        filename += getExtensionFromMimetype(doc.mimeType);
      }
      const link = window.document.createElement("a");
      link.href = getDownloadUrl(doc.id, true);
      link.download = filename;
      link.target = "_blank";
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
    };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));

  const isPdf = doc.mimeType === "application/pdf";
  const isImage = doc.mimeType.startsWith("image/");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { height: "90vh", display: "flex", flexDirection: "column" },
      }}
    >
       <DialogTitle
         sx={{
           m: 0,
           p: 2,
           display: "flex",
           justifyContent: "space-between",
           alignItems: "flex-start",
           borderBottom: 1,
           borderColor: "divider",
         }}
       >
         <Box>
           <Typography variant="h6" component="div">
             {doc.name}
           </Typography>
            <Chip
              label={getCategoryLabel(doc.categoryId, categories)}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ mt: 0.5 }}
            />
         </Box>
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          p: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
        }}
      >
        {/* Metadata Section */}
        <Box sx={{ p: 2, bgcolor: "grey.50", borderBottom: 1, borderColor: "divider" }}>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 1 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                파일 크기
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {formatFileSize(doc.fileSize)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                등록일
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {formatDate(doc.createdAt)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                파일 포맷
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, textTransform: "uppercase" }}>
                {doc.mimeType.split("/")[1]?.replace("jpeg", "jpg").replace("plain", "txt") || "Unknown"}
              </Typography>
            </Box>
            {(onEdit || onDelete) && (
              <Box sx={{ ml: "auto", alignSelf: "center" }}>
                <IconButton
                  size="small"
                  onClick={(e) => setMenuAnchor(e.currentTarget)}
                >
                  <MoreVertIcon />
                </IconButton>
                <Menu
                  anchorEl={menuAnchor}
                  open={Boolean(menuAnchor)}
                  onClose={() => setMenuAnchor(null)}
                >
                  {onEdit && (
                    <MenuItem
                      onClick={() => {
                        setMenuAnchor(null);
                        onEdit(doc);
                      }}
                    >
                      수정
                    </MenuItem>
                  )}
                  {onDelete && (
                    <MenuItem
                      onClick={() => {
                        setMenuAnchor(null);
                        onDelete(doc);
                        onClose();
                      }}
                    >
                      삭제
                    </MenuItem>
                  )}
                </Menu>
              </Box>
            )}
          </Box>
          {doc.tags && doc.tags.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                태그
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
                {doc.tags.map((tag, index) => (
                  <Chip key={index} label={`#${tag}`} size="small" variant="outlined" />
                ))}
              </Box>
            </Box>
          )}
          {doc.description && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                설명
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {doc.description}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Preview Section */}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            bgcolor: "grey.100",
            overflow: "hidden",
            position: "relative",
            minHeight: 400,
          }}
        >
          {isPdf && (
            <Box
              component="iframe"
              src={`${getDownloadUrl(doc.id)}#toolbar=0`}
              sx={{
                width: "100%",
                height: "100%",
                border: "none",
              }}
              title={doc.name}
            />
          )}

          {isImage && (
            <Box
              sx={{
                width: "100%",
                height: "100%",
                overflow: "auto",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                p: 2,
              }}
            >
              <Box
                component="img"
                src={`${getDownloadUrl(doc.id)}#toolbar=0`}
                alt={doc.name}
                sx={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  transform: `scale(${zoom})`,
                  transition: "transform 0.2s",
                  transformOrigin: "center center",
                }}
              />

              {/* Zoom controls for image */}
              <Box
                sx={{
                  position: "absolute",
                  bottom: 16,
                  left: "50%",
                  transform: "translateX(-50%)",
                  bgcolor: "rgba(0, 0, 0, 0.6)",
                  borderRadius: 4,
                  display: "flex",
                  gap: 1,
                  p: 0.5,
                }}
              >
                <IconButton onClick={handleZoomOut} size="small" sx={{ color: "white" }}>
                  <ZoomOutIcon />
                </IconButton>
                <Typography variant="body2" sx={{ color: "white", alignSelf: "center", px: 1 }}>
                  {Math.round(zoom * 100)}%
                </Typography>
                <IconButton onClick={handleZoomIn} size="small" sx={{ color: "white" }}>
                  <ZoomInIcon />
                </IconButton>
              </Box>
            </Box>
          )}

          {!isPdf && !isImage && (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
              }}
            >
              <Typography variant="body1" color="text.secondary">
                Preview not available for this file type
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

       <DialogActions sx={{ p: 2, borderTop: 1, borderColor: "divider", justifyContent: "flex-end" }}>
          <Button
            onClick={handlePrint}
            startIcon={<PrintIcon />}
            color="inherit"
          >
            인쇄
          </Button>
          <Button
            onClick={handleDownload}
            variant="contained"
            startIcon={<DownloadIcon />}
          >
            다운로드
          </Button>
       </DialogActions>
    </Dialog>
  );
}
