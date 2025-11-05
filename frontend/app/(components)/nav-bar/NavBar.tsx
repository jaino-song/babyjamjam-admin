import { Box, Button, Typography, Stack } from "@mui/material";

export const NavBar = () => {
    return (
        <Box>
            <Stack spacing={2}>
                <Button>
                    <Typography></Typography>
                </Button>
                <Button>
                    <Typography>NavBar</Typography>
                </Button>
                <Button>
                    <Typography>NavBar</Typography>
                </Button>
            </Stack>
        </Box>
    );
}