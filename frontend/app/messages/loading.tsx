"use client";

import { MoonLoader } from "react-spinners";
import { Paper } from "@mui/material";
import { Box } from "@mui/material";

export default function Loading() {
    return (
        <Paper elevation={2} sx={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, p: 3, flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", width: "100%", height: "100%" }}>
            <Box>
                <MoonLoader color="#1e88e5" size={100} />
            </Box>
        </Paper>
    );
}
