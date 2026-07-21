"use client";

import { useState } from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  TablePagination,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Radio,
} from "@mui/material";
import { Search, Filter, Plus } from "lucide-react";
import { useEformsignDocumentsByType } from "@/app/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/app/hooks/useEformsignAuth";
import { EformsignDocument, EformsignDocumentView } from "@/app/lib/eformsign/types";
import { 
  DocumentFilterType, 
  getLegacyDocumentCustomerName,
  getStatusColor,
  mapLegacyDocumentStatusToLabel,
} from "@/app/lib/eformsign/status-codes";
import { ComponentContainer } from "../root/ComponentContainer";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "../LocaleProvider";
import Link from "next/link";

type FilterOption = { label: string; value: DocumentFilterType };

const STATUS_OPTIONS: FilterOption[] = [
  { label: "전체", value: null },
  { label: "대기", value: "in-progress" },
  { label: "완료", value: "completed" },
  { label: "거부", value: "rejected" },
];

// Customer names to filter out (internal/test accounts)
const EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"];

// Transform API document to view model
const transformDocument = (doc: EformsignDocument): EformsignDocumentView | null => {
  const customerName = getLegacyDocumentCustomerName(doc, EXCLUDED_CUSTOMER_NAMES);

  // Skip documents without a customer name
  if (!customerName) {
    return null;
  }

  return {
    doc_id: doc.id,
    customer_name: customerName,
    created_date: doc.created_date,
    status: mapLegacyDocumentStatusToLabel(doc.current_status),
  };
};

// Date formatting helper
const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

export function DocumentsList() {
  const locale = useLocale();
  const [page, setPage] = useState(0);
  const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedFilter, setSelectedFilter] = useState<DocumentFilterType>(null);

  // Auth hook - checks existing token before making API call
  const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth();
  
  // Documents hook
  const { data, isLoading, error, isFetching } = useEformsignDocumentsByType(
    isAuthenticated, 
    selectedFilter
  );

  // Dynamic rows per page: 10 for all, 5 for filtered
  const rowsPerPage = selectedFilter === null ? 10 : 5;

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    setFilterAnchorEl(event.currentTarget);
  };

  const handleFilterClose = () => {
    setFilterAnchorEl(null);
  };

  const handleFilterSelect = (filterType: DocumentFilterType) => {
    setSelectedFilter(filterType);
    setPage(0);
    handleFilterClose();
  };

  const filterOpen = Boolean(filterAnchorEl);
  const currentFilterLabel = STATUS_OPTIONS.find(opt => opt.value === selectedFilter)?.label || "전체";

  // Initial auth loading state only (not filter changes)
  if (isLoadingAuth) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  // Error state
  if (authError || error) {
    const errorMessage = authError?.message || (error instanceof Error ? error.message : "Unknown error");
    return (
      <Box p={3}>
        <Alert severity="error">
          {authError ? "인증에 실패했습니다. 페이지를 새로고침 해주세요." : `문서를 불러오는데 실패했습니다: ${errorMessage}`}
        </Alert>
      </Box>
    );
  }

  // Transform and filter documents
  const documents: EformsignDocumentView[] = (data?.documents || [])
    .map(transformDocument)
    .filter((doc): doc is EformsignDocumentView => doc !== null);

  const paginatedDocuments = documents.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  return (
    <ComponentContainer textJSON="documents-list">
      <Box data-component="documents-list-container">
        {/* Toolbar */}
        <Box
          data-component="documents-list-toolbar"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-around",
          }}
        >
          <Box 
            data-component="documents-list-toolbar-buttons" 
            sx={{ 
              display: "flex", 
              justifyContent: "space-around", 
              alignItems: "center", 
              gap: 1, 
              width: "100%" 
            }}
          >
            {/* Search Button */}
            <IconButton size="medium" sx={{ color: "grey.600" }}>
              <Search size={24} strokeWidth={2} />
            </IconButton>

            {/* Filter Button */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <IconButton
                size="medium"
                sx={{ color: "primary.main" }}
                onClick={handleFilterClick}
              >
                <Filter size={24} strokeWidth={2} />
              </IconButton>
              <Chip
                label={currentFilterLabel}
                color={getStatusColor(currentFilterLabel)}
                size="small"
                onClick={handleFilterClick}
                sx={{ cursor: "pointer" }}
              />
            </Box>

            {/* Filter Menu */}
            <Menu
              anchorEl={filterAnchorEl}
              open={filterOpen}
              onClose={handleFilterClose}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            >
              {STATUS_OPTIONS.map((option) => (
                <MenuItem 
                  key={option.value ?? "all"} 
                  onClick={() => handleFilterSelect(option.value)}
                >
                  <ListItemIcon>
                    <Radio checked={selectedFilter === option.value} size="small" />
                  </ListItemIcon>
                  <ListItemText>
                    <Chip
                      label={option.label}
                      color={getStatusColor(option.label)}
                      size="small"
                    />
                  </ListItemText>
                </MenuItem>
              ))}
            </Menu>

            {/* New Document Button */}
            <IconButton 
              size="medium" 
              sx={{ color: "#1e88e5" }} 
              LinkComponent={Link}
              href="/messages/contract"
            >
              <Plus size={30} strokeWidth={2} />
            </IconButton>
          </Box>
        </Box>

        <Divider />

        {/* Table */}
        <Box sx={{ minHeight: 200, width: "100%" }}>
          {documents.length > 0 || isFetching ? (
          <>
            <TableContainer>
              <Table sx={{ tableLayout: "fixed", width: "100%" }}>
                <TableHead>
                  <TableRow>
                    <TableCell
                      align="center"
                      sx={{ 
                        fontWeight: 500, 
                        color: "rgba(0, 0, 0, 0.6)", 
                        fontSize: "0.875rem",
                        width: "30%",
                      }}
                    >
                      {t(locale, "documents-list.document-title")}
                    </TableCell>
                    <TableCell
                      align="center"
                      sx={{ 
                        fontWeight: 500, 
                        color: "rgba(0, 0, 0, 0.6)", 
                        fontSize: "0.875rem",
                        width: "40%",
                      }}
                    >
                      {t(locale, "documents-list.created-date")}
                    </TableCell>
                    <TableCell
                      align="center"
                      sx={{ 
                        fontWeight: 500, 
                        color: "rgba(0, 0, 0, 0.6)", 
                        fontSize: "0.875rem",
                        width: "30%",
                      }}
                    >
                      {t(locale, "documents-list.status")}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {/* Loading spinner - only covers table body */}
                  {isFetching && (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ border: 0, p: 0 }}>
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            py: 8,
                          }}
                        >
                          <CircularProgress size={40} />
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                  {!isFetching && paginatedDocuments.map((doc, index) => (
                    <TableRow
                      key={`${doc.doc_id}-${index}`}
                      hover
                      sx={{ "&:hover": { bgcolor: "rgba(0, 0, 0, 0.04)" } }}
                    >
                      <TableCell
                        align="center"
                        sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)" }}
                      >
                        {doc.customer_name}
                      </TableCell>
                      <TableCell
                        align="center"
                        sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)" }}
                      >
                        {formatDate(doc.created_date)}
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={doc.status}
                          color={getStatusColor(doc.status)}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Pagination - hidden during loading */}
            {!isFetching && (
              <TablePagination
                component="div"
                count={documents.length}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                rowsPerPageOptions={[]}
                labelRowsPerPage=""
                sx={{
                  "& .MuiTablePagination-selectLabel": { display: "none" },
                  "& .MuiTablePagination-select": { display: "none" },
                  "& .MuiTablePagination-spacer": { display: "none" },
                  "& .MuiTablePagination-displayedRows": { margin: 0 },
                }}
              />
            )}
          </>
        ) : (
          <Box sx={{ py: 3 }}>
            <Alert severity="info">문서가 없습니다</Alert>
          </Box>
          )}
        </Box>
      </Box>
    </ComponentContainer>
  );
}
