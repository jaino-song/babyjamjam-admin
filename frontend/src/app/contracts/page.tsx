import { Box } from "@mui/material";
import { DocumentsList } from "@/app/(components)/eformsign/DocumentsList";

export default async function ContractsPage() {
    return (
        <Box sx={{ bgcolor: "background.paper" }}>
            <Box
                component="section"
                data-component="contracts"
                sx={{
                    px: { xs: 2, sm: 3, md: 6 },
                    py: { xs: 3, sm: 4 },
                    mx: "auto",
                }}
            >
                <DocumentsList />
            </Box>
        </Box>
    );
}
