import { Metadata } from "next";
import { Container } from "@mui/material";

export const metadata: Metadata = {
    title: "Incheon Imirae Back Office - 고객 관리",
    description: "고객 정보 관리 페이지",
};

export default function ClientsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <Container component="section" data-component="clients-content" sx={{ p: 2 }}>
            {children}
        </Container>
    );
}

