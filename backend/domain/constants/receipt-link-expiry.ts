/** 영수증 링크는 발송(발급) 시점부터 30일간 열람한다. */
export const RECEIPT_LINK_VALIDITY_DAYS = 30;
const DAY_MS = 86_400_000;

export function getReceiptLinkExpiresAt(issuedAt: Date): Date {
    if (!(issuedAt instanceof Date) || !Number.isFinite(issuedAt.getTime())) {
        throw new Error("Receipt link issue time is required");
    }
    return new Date(issuedAt.getTime() + RECEIPT_LINK_VALIDITY_DAYS * DAY_MS);
}
