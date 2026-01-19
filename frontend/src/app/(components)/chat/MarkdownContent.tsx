"use client";

import { Box, styled } from "@mui/material";

export const MarkdownContent = styled(Box)(({ theme }) => ({
    userSelect: "text",
    WebkitUserSelect: "text",
    MozUserSelect: "text",
    cursor: "text",
    "& *": {
        userSelect: "text !important" as never,
        WebkitUserSelect: "text !important" as never,
    },
    "& p": {
        margin: "0 0 1em 0",
        lineHeight: 1.7,
        "&:last-child": {
            marginBottom: 0,
        },
    },
    "& h1, & h2, & h3, & h4, & h5, & h6": {
        marginTop: "1.5em",
        marginBottom: "0.5em",
        fontWeight: 600,
        lineHeight: 1.3,
        "&:first-child": {
            marginTop: 0,
        },
    },
    "& h1": { fontSize: "1.5rem" },
    "& h2": { fontSize: "1.25rem" },
    "& h3": { fontSize: "1.1rem" },
    "& ul, & ol": {
        margin: "0.75em 0",
        paddingLeft: "1.5em",
    },
    "& li": {
        marginBottom: "0.35em",
        lineHeight: 1.6,
    },
    "& code": {
        backgroundColor: theme.palette.mode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
        padding: "0.15em 0.4em",
        borderRadius: "4px",
        fontSize: "0.9em",
        fontFamily: "'Fira Code', 'Consolas', monospace",
    },
    "& pre": {
        margin: 0,
        "& code": {
            backgroundColor: "transparent",
            padding: 0,
        },
    },
    "& .table-wrapper": {
        overflowX: "auto",
        margin: "1em 0",
        maxWidth: "100%",
    },
    "& table": {
        borderCollapse: "collapse",
        fontSize: "0.875rem",
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: "8px",
        overflow: "hidden",
        width: "100%",
    },
    "& thead": {
        backgroundColor: theme.palette.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
    },
    "& th": {
        padding: "0.75em 1em",
        textAlign: "left",
        fontWeight: 600,
        borderBottom: `1px solid ${theme.palette.divider}`,
    },
    "& td": {
        padding: "0.6em 1em",
        borderBottom: `1px solid ${theme.palette.divider}`,
    },
    "& tr:last-child td": {
        borderBottom: "none",
    },
    "& tbody tr:hover": {
        backgroundColor: theme.palette.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)",
    },
    "& strong": {
        fontWeight: 600,
    },
    "& em": {
        fontStyle: "italic",
    },
    "& blockquote": {
        borderLeft: `3px solid ${theme.palette.primary.main}`,
        margin: "1em 0",
        paddingLeft: "1em",
        color: theme.palette.text.secondary,
        fontStyle: "italic",
    },
    "& hr": {
        border: "none",
        borderTop: `1px solid ${theme.palette.divider}`,
        margin: "1.5em 0",
    },
    "& a": {
        color: theme.palette.primary.main,
        textDecoration: "none",
        "&:hover": {
            textDecoration: "underline",
        },
    },
}));
