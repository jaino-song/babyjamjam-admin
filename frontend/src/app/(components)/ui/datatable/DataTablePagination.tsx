"use client";

import { Box, TablePagination } from "@mui/material";
import type { DataTablePaginationProps } from "./types";

export function DataTablePagination({
  count,
  page,
  rowsPerPage,
  onPageChange,
  disabled = false,
}: DataTablePaginationProps) {
  return (
    <Box sx={{ display: "flex", justifyContent: "flex-end", py: 1 }}>
      <TablePagination
        component="div"
        count={count}
        page={page}
        onPageChange={(_event, newPage) => onPageChange(newPage)}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[rowsPerPage]}
        labelRowsPerPage=""
        disabled={disabled}
      />
    </Box>
  );
}
