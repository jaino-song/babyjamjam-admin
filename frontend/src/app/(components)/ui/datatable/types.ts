import { ReactNode } from "react";
import { SxProps, Theme } from "@mui/material";

export interface DataTableColumn<T> {
  key: keyof T | string;
  header: string;
  align?: "left" | "center" | "right";
  width?: string;
  render?: (row: T, index: number) => ReactNode;
}

export interface FilterOption {
  label: string;
  value: string | null;
  color?: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning";
  chipSx?: SxProps<Theme>;
}

export type PaginationMode = "client" | "server" | "none";

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  isLoading?: boolean;
  error?: Error | null;
  getRowKey: (row: T, index: number) => string | number;
  // search
  searchEnabled?: boolean;
  searchPlaceholder?: string;
  searchFields?: (keyof T)[];
  onSearch?: (query: string) => void;
  searchQuery?: string;
  // filter
  filterOptions?: FilterOption[];
  onFilterChange?: (value: string | null) => void;
  filterValue?: string | null;
  filterAddAction?: FilterAddAction;
  // pagination
  pagination?: PaginationMode;
  totalCount?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  page?: number;
  // row interaction
  onRowClick?: (row: T, index: number) => void;
  // toolbar
  toolbarActions?: ReactNode;
  hideToolbar?: boolean;
  // empty state
  emptyMessage?: string;
  // styling
  sx?: SxProps<Theme>;
  skeletonRowCount?: number;
}

export interface FilterAddAction {
  label: string;
  onClick: () => void;
}

export interface DataTableToolbarProps {
  searchEnabled?: boolean;
  searchPlaceholder?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterOptions?: FilterOption[];
  filterValue: string | null;
  onFilterChange?: (value: string | null) => void;
  filterAddAction?: FilterAddAction;
  actions?: ReactNode;
}

export interface DataTablePaginationProps {
  count: number;
  page: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}
