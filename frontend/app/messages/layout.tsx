import { Metadata } from "next";
import { Container } from "@mui/material";
import { MsgNav } from "../(components)/messages/MsgNav";
import AnimatedContainer from "../(components)/root/AnimatedContainer";

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
        <Container component="section" sx={{ p: 2, bgcolor: "background.paper" }}>
            <AnimatedContainer minHeight="50vh">
                <MsgNav />
                {children}
            </AnimatedContainer>
        </Container>
    );
}


