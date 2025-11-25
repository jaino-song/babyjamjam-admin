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
        <Container sx={{ p: 0 }}>
            <AnimatedContainer minHeight="50vh">
                <MsgNav />
                {children}
            </AnimatedContainer>
        </Container>
    );
}


