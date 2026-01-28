import { Box } from "@mui/material";
import { DocumentsTable } from "../(components)/documents/DocumentsTable";

export default function DocumentsPage() {
    return (
        <Box sx={{ bgcolor: "background.paper" }}>
            <Box
                component="section"
                data-component="documents"
                sx={{
                    px: { xs: 2, sm: 3, md: 6 },
                    py: { xs: 3, sm: 4 },
                    mx: "auto",
                }}
            >
                <DocumentsTable />
            </Box>
        </Box>
    );
}
