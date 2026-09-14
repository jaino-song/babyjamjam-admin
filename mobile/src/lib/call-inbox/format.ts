// Call-inbox screens share the app-wide formatter; the name stays for local readers.
export { formatKoreanPhoneNumber as formatPhoneNumber } from "@/lib/phone";

export const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0] ?? "";
};

export const formatCallTime = (iso: string | null): string => {
    if (!iso) return "";
    const date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleString("ko-KR", {
        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: "Asia/Seoul",
    });
};
