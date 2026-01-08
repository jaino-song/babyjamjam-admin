import { ContractCreationForm } from "@/app/(components)/messages/forms/ContractCreationForm";
import { Box } from "@mui/material";

export default async function ContractCreationPage() {
    return (
        <Box sx={{ bgcolor: "background.paper" }}>
            <Box
                component="section"
                data-component="contract-creation"
                sx={{
                    px: { xs: 2, sm: 3, md: 6 },
                    py: { xs: 3, sm: 4 },
                }}
            >
                <ContractCreationForm />
            </Box>
        </Box>
    );
}
