import { Metadata } from "next";
import { Container } from "@mui/material";
import { MsgNav } from "../(components)/messages/MsgNav";

export const metadata: Metadata = {
    title: "Incheon Imirae Back Office - Messages",
    description: "Incheon Imirae Back Office - Messages",
};

export default function MessagesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <Container component="section" data-component="messages-content" sx={{ p: 2 }}>
                <MsgNav />
                {children}
        </Container>
    );
}


