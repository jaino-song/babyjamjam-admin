"use client";

import { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  TablePagination,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Checkbox,
} from "@mui/material";
import { Search, Filter, Plus } from "lucide-react";
import { useEformsignDocuments } from "@/app/hooks";
import { eformsignApi } from "@/services/api";
import { EformsignDocumentView } from "@/app/lib/eformsign/types";
import { ComponentContainer } from "../root/ComponentContainer";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "../LocaleProvider";
import Link from "next/link";

type DocumentStatus = "대기" | "거부" | "완료";

const STATUS_OPTIONS: DocumentStatus[] = ["대기", "거부", "완료"];

const documents: EformsignDocumentView[] = [
  {
    doc_id: '1',
    customer_name: '송진호',
    sent_date: '2023-10-24',
    status: '대기',
  },
  {
    doc_id: '2',
    customer_name: '김동현',
    sent_date: '2023-10-25',
    status: '대기',
  },
  {
    doc_id: '3',
    customer_name: '이민우',
    sent_date: '2023-10-26',
    status: '거부',
  },
  {
    doc_id: '4',
    customer_name: '이민서',
    sent_date: '2023-10-22',
    status: '완료',
  },
  {
    doc_id: '5',
    customer_name: '김민지',
    sent_date: '2023-10-27',
    status: '완료',
  },
  {
    doc_id: '6',
    customer_name: '이민우',
    sent_date: '2023-10-28',
    status: '완료',
  },
];

export function DocumentsList() {
  const locale = useLocale();
  const [accessToken, setAccessToken] = useState<string>("");
  const [isLoadingToken, setIsLoadingToken] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<DocumentStatus[]>([]);

  const { data, isLoading, error } = useEformsignDocuments(accessToken);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        setIsLoadingToken(true);
        const executionTime = Date.now();
        const tokenResponse = await eformsignApi.getAccessToken(executionTime);
        setAccessToken(tokenResponse.oauth_token.access_token);
      } catch (err) {
        console.error("Failed to fetch access token:", err);
      } finally {
        setIsLoadingToken(false);
      }
    };

    fetchToken();
  }, []);

  const getStatusColor = (
    statusName: string
  ): "success" | "warning" | "error" | "info" => {
    const lowerStatusName = statusName.toLowerCase();
    if (lowerStatusName.includes("완료") || lowerStatusName.includes("complete") || lowerStatusName.includes("signed")) {
      return "success";
    }
    if (lowerStatusName.includes("대기") || lowerStatusName.includes("pending") || lowerStatusName.includes("진행")) {
      return "warning";
    }
    if (lowerStatusName.includes("거부") || lowerStatusName.includes("reject")) {
      return "error";
    }
    return "info";
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  // const handleChangeRowsPerPage = (
  //   event: React.ChangeEvent<HTMLInputElement>
  // ) => {
  //   setRowsPerPage(parseInt(event.target.value, 10));
  //   setPage(0);
  // };

  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    setFilterAnchorEl(event.currentTarget);
  };

  const handleFilterClose = () => {
    setFilterAnchorEl(null);
  };

  const handleStatusToggle = (status: DocumentStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
    setPage(0);
  };

  const filterOpen = Boolean(filterAnchorEl);

  const filteredDocuments = selectedStatuses.length === 0
    ? documents
    : documents.filter((doc) => selectedStatuses.includes(doc.status as DocumentStatus));

  if (isLoadingToken || isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="400px"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error">
          Failed to load documents:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      </Box>
    );
  }

  // const documents = data?.documents || [];
  const paginatedDocuments = filteredDocuments.slice(
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
          {/* Toolbar Buttons */}
          <Box data-component="documents-list-toolbar-buttons" sx={{ display: "flex", justifyContent: "space-around", alignItems: "center", gap: 1, width: "100%" }}>
            {/* Search Button */}
            <IconButton size="medium" sx={{ color: "grey.600" }}>
              <Search size={24} strokeWidth={2} />
            </IconButton>
            {/* Filter Button */}
            <IconButton
              size="medium"
              sx={{ color: selectedStatuses.length > 0 ? "primary.main" : "grey.600" }}
              onClick={handleFilterClick}
            >
              <Filter size={24} strokeWidth={2} />
            </IconButton>
            {/* Filter Menu */}
            <Menu
              anchorEl={filterAnchorEl}
              open={filterOpen}
              onClose={handleFilterClose}
              anchorOrigin={{
                vertical: "bottom",
                horizontal: "left",
              }}
            >
              {STATUS_OPTIONS.map((status) => (
                <MenuItem key={status} onClick={() => handleStatusToggle(status)}>
                  <ListItemIcon>
                    <Checkbox
                      checked={selectedStatuses.includes(status)}
                      size="small"
                    />
                  </ListItemIcon>
                  <ListItemText>
                    <Chip
                      label={status}
                      color={getStatusColor(status)}
                      size="small"
                    />
                  </ListItemText>
                </MenuItem>
              ))}
            </Menu>
            {/* New Document Button */}
            <IconButton size="medium" sx={{ color: "grey.600" }} LinkComponent={Link} href="/messages/contract">
              <Plus size={30} strokeWidth={2} />
            </IconButton>
          </Box>
        </Box>

        <Divider />

        {/* Table */}
        {filteredDocuments.length > 0 ? (
          <>
            <TableContainer>
              <Table>
                {/* Table Header */}
                <TableHead>
                  <TableRow>
                    {/* Document Title */}
                    <TableCell
                      align="center"
                      sx={{
                        fontWeight: 500,
                        color: "rgba(0, 0, 0, 0.6)",
                        fontSize: "0.875rem",
                      }}
                    >
                      {t(locale, "documents-list.document-title")}
                    </TableCell>
                    {/* Created Date */}
                    <TableCell
                      align="center"
                      sx={{
                        fontWeight: 500,
                        color: "rgba(0, 0, 0, 0.6)",
                        fontSize: "0.875rem",
                      }}
                    >
                      {t(locale, "documents-list.created-date")}
                    </TableCell>
                    {/* Status */}
                    <TableCell
                      align="center"
                      sx={{
                        fontWeight: 500,
                        color: "rgba(0, 0, 0, 0.6)",
                        fontSize: "0.875rem",
                        pr: 3,
                      }}
                    >
                      {t(locale, "documents-list.status")}
                    </TableCell>
                  </TableRow>
                </TableHead>
                {/* Table Body */}
                <TableBody>
                  {paginatedDocuments.map((doc: EformsignDocumentView) => (
                    <TableRow
                      key={doc.doc_id}
                      hover
                      sx={{
                        "&:hover": {
                          bgcolor: "rgba(0, 0, 0, 0.04)",
                        },
                      }}
                    >
                      <TableCell
                        align="center"
                        sx={{
                          fontSize: "0.875rem",
                          color: "rgba(0, 0, 0, 0.87)",
                        }}
                      >
                        {doc.customer_name}
                      </TableCell>
                      <TableCell
                        align="center"
                        sx={{
                          fontSize: "0.875rem",
                          color: "rgba(0, 0, 0, 0.87)",
                        }}
                      >
                        {formatDate(new Date(doc.sent_date).getTime())}
                      </TableCell>
                      <TableCell align="center" sx={{ pr: 3 }}>
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

            {/* Pagination */}
            <TablePagination
              // rowsPerPageOptions={[5, 10, 25]}
              component="div"
              count={filteredDocuments.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={handleChangePage}
              rowsPerPageOptions={[]}
              labelRowsPerPage=""
              sx={{
                '& .MuiTablePagination-selectLabel': {
                  display: 'none',
                },
                '& .MuiTablePagination-select': {
                  display: 'none',
                },
                '& .MuiTablePagination-spacer': {
                  display: 'none', // spacer 제거
                },
                '& .MuiTablePagination-displayedRows': {
                  margin: 0,
                },
              }}
            // onRowsPerPageChange={handleChangeRowsPerPage}
            />
          </>
        ) : (
          <Box sx={{ py: 3 }}>
            <Alert severity="info">No documents found</Alert>
          </Box>
        )}
      </Box>
    </ComponentContainer>
  );
}
