"use client";

import { MoonLoader } from "react-spinners";
import { Box } from "@mui/material";
import { ContentPaper } from "@/app/(components)/root/content-paper";

export default function Loading() {
    return (
        <ContentPaper sx={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", width: "100%", height: "100%" }}>
            <Box>
                <MoonLoader color="#1e88e5" size={100} />
            </Box>
        </ContentPaper>
    );
}
