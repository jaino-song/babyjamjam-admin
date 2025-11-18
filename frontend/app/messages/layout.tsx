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
    <Container sx={{ p: 0 }}>
        <MsgNav />
        {children}
    </Container>
  );
}


