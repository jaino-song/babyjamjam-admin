"use client";

import { useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import {
  Box,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Radio,
  TextField,
} from "@mui/material";
import { Filter, Plus, Search } from "lucide-react";
import type { DataTableToolbarProps } from "./types";

export function DataTableToolbar({
  searchEnabled = true,
  searchPlaceholder = "검색",
  searchQuery,
  onSearchChange,
  filterOptions,
  filterValue,
  onFilterChange,
  filterAddAction,
  actions,
}: DataTableToolbarProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearchIconClick = () => {
    setIsSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const handleSearchBlur = () => {
    if (!searchQuery.trim()) {
      setIsSearchOpen(false);
    }
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value);
  };

  const handleFilterClick = (event: MouseEvent<HTMLElement>) => {
    setFilterAnchorEl(event.currentTarget);
  };

  const handleFilterClose = () => {
    setFilterAnchorEl(null);
  };

  const handleFilterSelect = (value: string | null) => {
    onFilterChange?.(value);
    handleFilterClose();
  };

  const currentFilterOption = filterOptions?.find((option) => option.value === filterValue);
  const currentFilterLabel = currentFilterOption?.label ?? "전체";
  const currentFilterColor = currentFilterOption?.color ?? "default";
  const currentFilterChipSx = currentFilterOption?.chipSx;

  return (
    <Box
      data-component="data-table-toolbar"
      sx={{ display: "flex", alignItems: "center", width: "100%" }}
    >
      {/* Left section: Search */}
      <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
        {searchEnabled &&
          (isSearchOpen ? (
            <TextField
              inputRef={searchInputRef}
              size="small"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={handleSearchChange}
              onBlur={handleSearchBlur}
              autoFocus
              sx={{
                width: 60,
                "& .MuiOutlinedInput-root": {
                  backgroundColor: "transparent",
                },
                "& .MuiOutlinedInput-notchedOutline": {
                  border: "none",
                },
                "& .MuiInputBase-input": {
                  padding: "8px 0",
                },
              }}
            />
          ) : (
            <IconButton
              size="medium"
              sx={{ color: "grey.600", width: 60 }}
              onClick={handleSearchIconClick}
              aria-label="search"
            >
              <Search size={24} strokeWidth={2} />
            </IconButton>
          ))}
      </Box>

      {/* Center section: Filter */}
      <Box sx={{ flex: 1, display: "flex", justifyContent: "center" }}>
        {filterOptions && filterOptions.length > 0 && (
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
              color={currentFilterColor}
              size="small"
              onClick={handleFilterClick}
              sx={currentFilterChipSx ?? {}}
            />
          </Box>
        )}
      </Box>

      <Menu
        anchorEl={filterAnchorEl}
        open={Boolean(filterAnchorEl)}
        onClose={handleFilterClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        {filterOptions?.map((option) => (
          <MenuItem
            key={option.value ?? "all"}
            onClick={() => handleFilterSelect(option.value)}
          >
            <ListItemIcon>
              <Radio checked={filterValue === option.value} size="small" />
            </ListItemIcon>
            <ListItemText>
              <Chip
                label={option.label}
                color={option.color || "default"}
                size="small"
                sx={option.chipSx ?? {}}
              />
            </ListItemText>
          </MenuItem>
        ))}
        {filterAddAction && <Divider />}
        {filterAddAction && (
          <MenuItem
            onClick={() => {
              handleFilterClose();
              filterAddAction.onClick();
            }}
            sx={{ color: "primary.main" }}
          >
            <ListItemIcon>
              <Plus size={20} color="currentColor" />
            </ListItemIcon>
            <ListItemText>{filterAddAction.label}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Right section: Actions */}
      <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        {actions}
      </Box>
    </Box>
  );
}