import { Box } from "@mui/material";
import { redirect } from "next/navigation";
import { ClientsTable } from "../(components)/clients/ClientsTable";

interface ClientsPageProps {
    searchParams: Promise<{ filter?: string; id?: string }>;
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
    const params = await searchParams;

    // Redirect old notification URLs to new filtered page
    // Old: /clients?filter=xxx → New: /clients/filtered?filter=xxx
    if (params.filter) {
        redirect(`/clients/filtered?filter=${params.filter}`);
    }

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

