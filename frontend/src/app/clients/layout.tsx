import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Incheon Imirae Back Office - 고객 관리",
    description: "고객 정보 관리 페이지",
};

export default function ClientsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}

