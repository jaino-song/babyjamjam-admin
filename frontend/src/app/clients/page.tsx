import { Box } from "@mui/material";
import { ClientsTable } from "../(components)/clients/ClientsTable";

export default function ClientsPage() {
    return (
        <Box sx={{ bgcolor: "background.paper" }}>
            <Box
                component="section"
                data-component="clients"
                sx={{
                    px: { xs: 2, sm: 3, md: 6 },
                    py: { xs: 3, sm: 4 },
                    mx: "auto",
                }}
            >
                <ClientsTable />
            </Box>
        </Box>
    );
}

