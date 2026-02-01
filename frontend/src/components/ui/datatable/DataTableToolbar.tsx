"use client";

import React, { useState } from "react";
import {
    Box,
    IconButton,
    TextField,
    InputAdornment,
    Divider,
} from "@mui/material";
import { Search, Plus } from "lucide-react";

interface DataTableToolbarProps {
    searchPlaceholder?: string;
    searchValue?: string;
    onSearchChange?: (value: string) => void;
    onSearchSubmit?: () => void;
    onAddClick?: () => void;
    addIconSize?: number;
    additionalActions?: React.ReactNode;
    dataComponent?: string;
    showSearchIconOnly?: boolean;
}

export function DataTableToolbar({
    searchPlaceholder,
    searchValue,
    onSearchChange,
    onSearchSubmit,
    onAddClick,
    addIconSize = 30,
    additionalActions,
    dataComponent,
    showSearchIconOnly = false,
}: DataTableToolbarProps) {
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && onSearchSubmit) {
            onSearchSubmit();
        }
    };

    const handleSearchIconClick = () => {
        if (showSearchIconOnly) {
            setIsSearchOpen(true);
        } else if (onSearchSubmit) {
            onSearchSubmit();
        }
    };

    const handleSearchBlur = () => {
        if (!searchValue?.trim() && showSearchIconOnly) {
            setIsSearchOpen(false);
        }
    };

    return (
        <Box data-component={dataComponent}>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    px: 1,
                    py: 0.5,
                }}
            >
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        flex: 1,
                    }}
                >
                    {showSearchIconOnly && !isSearchOpen ? (
                        <IconButton
                            size="medium"
                            sx={{ color: "grey.600" }}
                            onClick={handleSearchIconClick}
                        >
                            <Search size={24} strokeWidth={2} />
                        </IconButton>
                    ) : (
                        <TextField
                            size="small"
                            placeholder={searchPlaceholder}
                            value={searchValue}
                            onChange={(e) => onSearchChange?.(e.target.value)}
                            onKeyPress={handleKeyPress}
                            onBlur={handleSearchBlur}
                            autoFocus={isSearchOpen}
                            InputProps={{
                                startAdornment: !showSearchIconOnly ? (
                                    <InputAdornment position="start">
                                        <Search size={20} strokeWidth={2} color="grey" />
                                    </InputAdornment>
                                ) : null,
                                endAdornment: showSearchIconOnly ? (
                                    <InputAdornment position="end">
                                        <IconButton size="small" onClick={onSearchSubmit}>
                                            <Search size={20} strokeWidth={2} />
                                        </IconButton>
                                    </InputAdornment>
                                ) : null,
                            }}
                            sx={{
                                minWidth: showSearchIconOnly ? 150 : 250,
                                "& .MuiOutlinedInput-root": {
                                    backgroundColor: "transparent",
                                    "& fieldset": showSearchIconOnly ? { border: "none" } : {},
                                },
                            }}
                        />
                    )}
                </Box>

                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                    }}
                >
                    {additionalActions}
                    {onAddClick && (
                        <IconButton
                            size="medium"
                            sx={{ color: "#1e88e5" }}
                            onClick={onAddClick}
                        >
                            <Plus size={addIconSize} strokeWidth={2} />
                        </IconButton>
                    )}
                </Box>
            </Box>
            <Divider />
        </Box>
    );
}
