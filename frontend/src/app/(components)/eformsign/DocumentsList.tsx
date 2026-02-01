"use client";

import { useState, useMemo } from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  IconButton,
  TablePagination,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Radio,
  Skeleton,
  TextField,
  InputAdornment,
  CircularProgress,
} from "@mui/material";
import { Search, Filter, Plus } from "lucide-react";
import { DataTableToolbar } from "@/components/ui/datatable/DataTableToolbar";
import { useEformsignDocumentsByType } from "@/app/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/app/hooks/useEformsignAuth";
import { EformsignDocument, EformsignDocumentView } from "@/app/lib/eformsign/types";
import {
  DocumentFilterType,
  mapStatusToLabel,
  getStatusColor,
} from "@/app/lib/eformsign/status-codes";
import { ContentPaper } from "../root/content-paper";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "../LocaleProvider";
import Link from "next/link";
import { DataTable, type DataTableColumn, type FilterOption } from "@/app/(components)/ui/datatable";

type DocumentRow = EformsignDocumentView & Record<string, unknown>;

const STATUS_OPTIONS: FilterOption[] = [
  { label: "전체", value: null, color: getStatusColor("전체") },
  { label: "대기", value: "in-progress", color: getStatusColor("대기") },
  { label: "완료", value: "completed", color: getStatusColor("완료") },
  { label: "거부", value: "rejected", color: getStatusColor("거부") },
];

// Customer names to filter out (internal/test accounts)
const EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"];

// Transform API document to view model
const transformDocument = (doc: EformsignDocument): EformsignDocumentView | null => {
  const stepRecipients = doc.current_status?.step_recipients;

  // Get customer name from multiple possible sources:
  // 1. step_recipients[0].name (when document is in-progress)
  // 2. last_editor.name (when document is completed/rejected)
  // 3. creator.name (fallback)
  let customerName: string | null = null;

  if (stepRecipients && stepRecipients.length > 0 && stepRecipients[0]?.name) {
    customerName = stepRecipients[0].name;
  } else if (doc.last_editor?.name) {
    customerName = doc.last_editor.name;
  } else if (doc.creator?.name) {
    customerName = doc.creator.name;
  }

  // Skip documents without a customer name
  if (!customerName) {
    return null;
  }

  // Skip internal/test accounts
  if (EXCLUDED_CUSTOMER_NAMES.includes(customerName)) {
    return null;
  }

  return {
    doc_id: doc.id,
    customer_name: customerName,
    created_date: doc.created_date,
    status: mapStatusToLabel(doc.current_status?.status_type),
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
  const [selectedFilter, setSelectedFilter] = useState<DocumentFilterType>(null);
  const [searchInput, setSearchInput] = useState("");

  // Auth hook - checks existing token before making API call
  const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth();

  // Documents hook
  const { data, isLoading, error } = useEformsignDocumentsByType(
    isAuthenticated,
    selectedFilter
  );

  const isInitialLoading = isLoadingAuth || isLoading;

  const handleFilterSelect = (filterType: DocumentFilterType) => {
    setSelectedFilter(filterType);
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    setPage(0);
  };

  const filterOpen = Boolean(filterAnchorEl);
  const currentFilterLabel = STATUS_OPTIONS.find(opt => opt.value === selectedFilter)?.label || "전체";

  // Error state
  if (authError || error) {
    const errorMessage = authError?.message || (error instanceof Error ? error.message : "Unknown error");
    return (
      <Box p={3}>
        <Alert severity="error">
          {authError
            ? "인증에 실패했습니다. 페이지를 새로고침 해주세요."
            : `문서를 불러오는데 실패했습니다: ${errorMessage}`}
        </Alert>
      </Box>
    );
  }

  const documents = useMemo<DocumentRow[]>(() => {
    return (data?.documents || [])
      .map(transformDocument)
      .filter((doc): doc is EformsignDocumentView => doc !== null)
      .map((doc) => doc as DocumentRow);
  }, [data?.documents]);

  return (
    <ContentPaper
      title={t(locale, "documents-list.title")}
      subtitle={t(locale, "documents-list.subtitle")}
      sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
    >
      <Box data-component="documents-list-container">
        <DataTableToolbar
          searchPlaceholder="이름 검색"
          searchValue={searchInput}
          onSearchChange={handleSearchChange}
          showSearchIconOnly={true}
          dataComponent="documents-list-toolbar"
          additionalActions={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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

              {/* New Document Button */}
              <IconButton
                size="medium"
                sx={{ color: "#1e88e5" }}
                LinkComponent={Link}
                href="/contracts/creation"
              >
                <Plus size={30} strokeWidth={2} />
              </IconButton>
            </Box>
          }
        />

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

        <Box sx={{ mt: 1 }}>
          {/* Table */}
          <Box sx={{ minHeight: 200, width: "100%" }}>
            {filteredDocuments.length > 0 || isInitialLoading ? (
              <>
                <TableContainer data-component="documents-list-table-container">
                  <Table sx={{ tableLayout: "fixed", width: "100%" }}>
                    <TableHead>
                      <TableRow>
                        <TableCell
                          align="center"
                          sx={{
                            fontWeight: 500,
                            color: "rgba(0, 0, 0, 0.6)",
                            fontSize: "0.875rem",
                            width: "35%",
                            whiteSpace: "nowrap",
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
                            whiteSpace: "nowrap",
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
                            width: "25%",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t(locale, "documents-list.status")}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {/* Skeleton rows during initial loading */}
                      {isInitialLoading && Array.from({ length: rowsPerPage }).map((_, index) => (
                        <TableRow key={`skeleton-${index}`}>
                          <TableCell align="center" sx={{ px: 1 }}>
                            <Skeleton variant="text" width="60%" sx={{ mx: "auto" }} />
                          </TableCell>
                          <TableCell align="center" sx={{ px: 1 }}>
                            <Skeleton variant="text" width="70%" sx={{ mx: "auto" }} />
                          </TableCell>
                          <TableCell align="center" sx={{ px: 1 }}>
                            <Skeleton variant="rounded" width={50} height={24} sx={{ mx: "auto" }} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {!isInitialLoading && paginatedDocuments.map((doc, index) => (
                        <TableRow
                          key={`${doc.doc_id}-${index}`}
                          hover
                          sx={{ "&:hover": { bgcolor: "rgba(0, 0, 0, 0.04)" } }}
                        >
                          <TableCell
                            align="center"
                            sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)", whiteSpace: "nowrap", px: 1 }}
                          >
                            {doc.customer_name}
                          </TableCell>
                          <TableCell
                            align="center"
                            sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)", whiteSpace: "nowrap", px: 1 }}
                          >
                            {formatDate(doc.created_date)}
                          </TableCell>
                          <TableCell align="center" sx={{ px: 1 }}>
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

                <TablePagination
                  component="div"
                  count={isInitialLoading ? 0 : filteredDocuments.length}
                  rowsPerPage={rowsPerPage}
                  page={page}
                  onPageChange={handleChangePage}
                  rowsPerPageOptions={[]}
                  labelRowsPerPage=""
                  slotProps={{
                    actions: {
                      previousButton: { disabled: isInitialLoading },
                      nextButton: { disabled: isInitialLoading },
                    },
                  }}
                  sx={{
                    "& .MuiTablePagination-selectLabel": { display: "none" },
                    "& .MuiTablePagination-select": { display: "none" },
                    "& .MuiTablePagination-spacer": { display: "none" },
                    "& .MuiTablePagination-displayedRows": { margin: 0 },
                  }}
                />
              </>
            ) : (
              <Box sx={{ py: 3 }}>
                <Alert severity="info">문서가 없습니다</Alert>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </ContentPaper>
  );
}
