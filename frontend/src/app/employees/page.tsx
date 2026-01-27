import { Box } from "@mui/material";
import { EmployeesTable } from "../(components)/employees/EmployeesTable";

export default function EmployeesPage() {
    return (
        <Box sx={{ bgcolor: "background.paper" }}>
            <Box
                component="section"
                data-component="employees"
                sx={{
                    px: { xs: 2, sm: 3, md: 6 },
                    py: { xs: 3, sm: 4 },
                    mx: "auto",
                }}
            >
                <EmployeesTable />
            </Box>
        </Box>
    );
}
