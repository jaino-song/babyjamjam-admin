/** 영수증은 서비스 종료일 다음 날부터 14일 동안, 한국 시간 마지막 날 자정 전까지 열람한다. */
export const RECEIPT_LINK_GRACE_DAYS = 14;
const DAY_MS = 86_400_000;

export function getReceiptLinkExpiresAt(serviceEndDate: Date): Date {
    if (!(serviceEndDate instanceof Date) || !Number.isFinite(serviceEndDate.getTime())) {
        throw new Error("Receipt service end date is required");
    }
    const cutoffDate = new Date(serviceEndDate.getTime() + (RECEIPT_LINK_GRACE_DAYS + 1) * DAY_MS);
    return new Date(`${cutoffDate.toISOString().slice(0, 10)}T00:00:00+09:00`);
}
