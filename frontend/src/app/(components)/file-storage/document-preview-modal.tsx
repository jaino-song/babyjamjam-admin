"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Button,
  Typography,
  Box,
  CircularProgress,
} from "@mui/material";
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  Print as PrintIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
} from "@mui/icons-material";
import { Document as PdfDocument, Page as PdfPage } from "react-pdf";
import "@/app/lib/pdf-config"; // Initialize PDF worker
import { getDownloadUrl } from "@/app/hooks/use-file-storage";

// Styles for the PDF viewer to ensure it fits within the modal
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

interface DocumentData {
  id: string;
  name: string;
  mimeType: string;
  storageUrl?: string | null; // deprecated
}

interface DocumentPreviewModalProps {
  open: boolean;
  document: DocumentData | null;
  onClose: () => void;
}

export default function DocumentPreviewModal({
  open,
  document,
  onClose,
}: DocumentPreviewModalProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(true);

  // Reset state when document changes
  useEffect(() => {
    if (open) {
      setNumPages(null);
      setPageNumber(1);
      setLoading(true);
    }
  }, [open, document]);

  if (!document) return null;

  const isPdf = document.mimeType === "application/pdf";
  const isImage = document.mimeType.startsWith("image/");

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
  };

  const changePage = (offset: number) => {
    setPageNumber((prevPageNumber) => prevPageNumber + offset);
  };

  const handlePrint = () => {
    if (!document) return;

    const iframe = window.document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = getDownloadUrl(document.id);

    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
      } catch (e) {
        console.warn("Cross-origin print blocked, falling back to new tab", e);
        window.open(getDownloadUrl(document.id), "_blank");
      }
      setTimeout(() => iframe.remove(), 1000);
    };

    window.document.body.appendChild(iframe);
  };

  const handleDownload = () => {
    window.open(getDownloadUrl(document.id, true), "_blank");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
    >
      <DialogTitle
        sx={{
          m: 0,
          p: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h6" component="div" noWrap sx={{ maxWidth: "80%" }}>
          {document.name}
        </Typography>
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

      <DialogContent dividers sx={{ p: 0, minHeight: "400px", display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" }}>
        {isPdf && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
              height: "100%",
              overflow: "auto",
              p: 2,
            }}
          >
            <PdfDocument
              file={getDownloadUrl(document.id)}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                  <CircularProgress />
                </Box>
              }
              error={
                <Box sx={{ p: 4, textAlign: "center" }}>
                  <Typography color="error">Failed to load PDF.</Typography>
                </Box>
              }
            >
              <PdfPage 
                pageNumber={pageNumber} 
                width={800} // Set a base width, or implement resize observer for responsive width
                renderTextLayer={false}
                renderAnnotationLayer={false}
                scale={1.0}
              />
            </PdfDocument>

            {numPages && numPages > 1 && (
              <Box sx={{ display: "flex", alignItems: "center", mt: 2, gap: 2, position: "sticky", bottom: 0, bgcolor: "rgba(255,255,255,0.9)", p: 1, borderRadius: 1, boxShadow: 1 }}>
                <Button
                  disabled={pageNumber <= 1}
                  onClick={() => changePage(-1)}
                  startIcon={<NavigateBeforeIcon />}
                  size="small"
                >
                  Prev
                </Button>
                <Typography variant="body2">
                  Page {pageNumber} of {numPages}
                </Typography>
                <Button
                  disabled={pageNumber >= numPages}
                  onClick={() => changePage(1)}
                  endIcon={<NavigateNextIcon />}
                  size="small"
                >
                  Next
                </Button>
              </Box>
            )}
          </Box>
        )}

        {isImage && (
          <Box
            component="img"
            src={getDownloadUrl(document.id)}
            alt={document.name}
            sx={{
              maxWidth: "100%",
              maxHeight: "70vh",
              objectFit: "contain",
              display: "block",
            }}
          />
        )}

        {!isPdf && !isImage && (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography>Preview not available for this file type.</Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={handleDownload}
          startIcon={<DownloadIcon />}
          color="primary"
        >
          Download
        </Button>
        <Button
          onClick={handlePrint}
          startIcon={<PrintIcon />}
          color="primary"
          variant="contained"
        >
          Print
        </Button>
      </DialogActions>
    </Dialog>
  );
}
