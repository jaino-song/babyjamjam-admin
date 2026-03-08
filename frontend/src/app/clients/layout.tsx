import { Metadata } from "next";

export const metadata: Metadata = {
    title: "고객 - 아가잼잼 관리자",
    description: "고객 정보 관리 페이지",
};

export default function ClientsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}

