"use client";

import { useMemo, useState } from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Skeleton,
  Divider,
} from "@mui/material";
import { DataTableToolbar } from "./DataTableToolbar";
import { DataTablePagination } from "./DataTablePagination";
import { matchesKoreanSearch } from "@/app/lib/utils/korean-search";
import type { DataTableProps } from "./types";

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  isLoading = false,
  error = null,
  getRowKey,
  searchEnabled = true,
  searchPlaceholder = "검색",
  searchFields = [],
  onSearch,
  searchQuery: controlledSearchQuery,
  filterOptions,
  onFilterChange,
  filterValue: controlledFilterValue,
  filterAddAction,
  pagination = "client",
  totalCount,
  pageSize = 10,
  onPageChange,
  page: controlledPage,
  onRowClick,
  toolbarActions,
  hideToolbar = false,
  emptyMessage = "데이터가 없습니다",
  sx,
  skeletonRowCount = 5,
}: DataTableProps<T>) {
  const [internalPage, setInternalPage] = useState(0);
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalFilterValue, setInternalFilterValue] = useState<string | null>(null);

  const currentPage = controlledPage ?? internalPage;
  const currentSearchQuery = controlledSearchQuery ?? internalSearchQuery;
  const currentFilterValue = controlledFilterValue ?? internalFilterValue;

  const filteredData = useMemo(() => {
    if (pagination === "server" || !searchEnabled || !currentSearchQuery.trim()) {
      return data;
    }

    const searchTerm = currentSearchQuery.trim().toLowerCase();

    return data.filter((row) => {
      const fieldsToSearch = searchFields.length > 0
        ? searchFields
        : (Object.keys(row) as (keyof T)[]);

      return fieldsToSearch.some((field) => {
        const value = row[field];
        if (typeof value === "string") {
          return matchesKoreanSearch(value, searchTerm);
        }
        return false;
      });
    });
  }, [data, currentSearchQuery, searchEnabled, searchFields, pagination]);

  const paginatedData = useMemo(() => {
    if (pagination !== "client") {
      return filteredData;
    }

    const startIndex = currentPage * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredData.slice(startIndex, endIndex);
  }, [filteredData, currentPage, pageSize, pagination]);

  const handleSearchChange = (query: string) => {
    if (onSearch) {
      onSearch(query);
    } else {
      setInternalSearchQuery(query);
    }

    if (onPageChange) {
      onPageChange(0);
    } else {
      setInternalPage(0);
    }
  };

  const handleFilterChange = (value: string | null) => {
    if (onFilterChange) {
      onFilterChange(value);
    } else {
      setInternalFilterValue(value);
    }

    if (onPageChange) {
      onPageChange(0);
    } else {
      setInternalPage(0);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (onPageChange) {
      onPageChange(newPage);
    } else {
      setInternalPage(newPage);
    }
  };

  const paginationCount = useMemo(() => {
    if (pagination === "server") {
      return totalCount ?? 0;
    }
    return filteredData.length;
  }, [pagination, totalCount, filteredData.length]);

  if (error) {
    return (
      <Box sx={{ p: 3, ...sx }}>
        <Alert severity="error">
          {error.message || "데이터를 불러오는데 실패했습니다"}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={sx}>
      {!hideToolbar && (
        <>
          <DataTableToolbar
            searchEnabled={searchEnabled}
            searchPlaceholder={searchPlaceholder}
            searchQuery={currentSearchQuery}
            onSearchChange={handleSearchChange}
            filterOptions={filterOptions}
            filterValue={currentFilterValue}
            onFilterChange={handleFilterChange}
            filterAddAction={filterAddAction}
            actions={toolbarActions}
          />
          <Divider />
        </>
      )}

      <Box sx={{ minHeight: 200, width: "100%" }}>
        {paginatedData.length > 0 || isLoading ? (
          <>
            <TableContainer>
              <Table sx={{ tableLayout: "fixed", width: "100%" }}>
                <TableHead>
                  <TableRow>
                    {columns.map((column, index) => (
                      <TableCell
                        key={`header-${column.key as string}-${index}`}
                        align={column.align || "center"}
                        sx={{
                          fontWeight: 500,
                          color: "rgba(0, 0, 0, 0.6)",
                          fontSize: "0.875rem",
                          width: column.width,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {column.header}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {isLoading &&
                    Array.from({ length: skeletonRowCount }).map((_, rowIndex) => (
                      <TableRow key={`skeleton-${rowIndex}`}>
                        {columns.map((column, colIndex) => (
                          <TableCell
                            key={`skeleton-cell-${rowIndex}-${colIndex}`}
                            align={column.align || "center"}
                            sx={{ px: 1 }}
                          >
                            <Skeleton
                              variant="text"
                              width="60%"
                              sx={{ mx: column.align === "center" ? "auto" : 0 }}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}

                  {!isLoading &&
                    paginatedData.map((row, rowIndex) => (
                      <TableRow
                        key={getRowKey(row, rowIndex)}
                        hover={!!onRowClick}
                        onClick={() => onRowClick?.(row, rowIndex)}
                        sx={{
                          cursor: onRowClick ? "pointer" : "default",
                          "&:hover": onRowClick ? { bgcolor: "rgba(0, 0, 0, 0.04)" } : {},
                        }}
                      >
                        {columns.map((column, colIndex) => (
                          <TableCell
                            key={`cell-${getRowKey(row, rowIndex)}-${colIndex}`}
                            align={column.align || "center"}
                            sx={{
                              fontSize: "0.875rem",
                              color: "rgba(0, 0, 0, 0.87)",
                              whiteSpace: "nowrap",
                              px: 1,
                            }}
                          >
                            {column.render
                              ? column.render(row, rowIndex)
                              : String(row[column.key as keyof T] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>

            {pagination !== "none" && (
              <DataTablePagination
                count={paginationCount}
                page={currentPage}
                rowsPerPage={pageSize}
                onPageChange={handlePageChange}
                disabled={isLoading}
              />
            )}
          </>
        ) : (
          <Box sx={{ py: 3 }}>
            <Alert severity="info">{emptyMessage}</Alert>
          </Box>
        )}
      </Box>
    </Box>
  );
}
