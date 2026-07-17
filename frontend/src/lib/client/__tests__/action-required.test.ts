import type { Client } from "@/lib/client/types";
import {
  ACTION_REQUIRED_SEND_THRESHOLD_DAYS,
  ACTION_REQUIRED_SIGNATURE_THRESHOLD_DAYS,
  getActionRequiredStatus,
} from "@/lib/client/action-required";

function createClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 1,
    name: "테스트 고객",
    birthday: null,
    dueDate: null,
    address: null,
    phone: null,
    primaryEmployee: null,
    secondaryEmployee: null,
    type: "A통합2형",
    duration: 15,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: "2026-03-20",
    endDate: "2026-04-04",
    careCenter: false,
    voucherClient: true,
    breastPump: false,
    serviceStatus: "active",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
  };
}

describe("getActionRequiredStatus", () => {
  it("returns no action for a pre-booking client even if a start date is present", () => {
    const result = getActionRequiredStatus(createClient({
      serviceStatus: "pre_booking",
      startDate: "2026-07-15",
    }));

    expect(result).toBeNull();
  });

  const referenceDate = new Date("2026-03-17T09:00:00.000Z");

  it("returns replacement requested with highest priority", () => {
    const status = getActionRequiredStatus(
      createClient({
        serviceStatus: "replacement_requested",
        startDate: "2026-03-30",
        eDocId: "doc-1",
        documentStatus: "created",
      }),
      referenceDate,
    );

    expect(status).toEqual({ reason: "교체 요청", priority: 1 });
  });

  it("returns send required when start date is within 6 days and document is not sent", () => {
    const status = getActionRequiredStatus(
      createClient({
        startDate: "2026-03-23",
        eDocId: null,
        documentStatus: null,
      }),
      referenceDate,
    );

    expect(status).toEqual({ reason: "발송 필요", priority: 3 });
    expect(ACTION_REQUIRED_SEND_THRESHOLD_DAYS).toBe(6);
  });

  it("keeps send required even when service starts in 2 days if document is not sent", () => {
    const status = getActionRequiredStatus(
      createClient({
        startDate: "2026-03-19",
        eDocId: null,
        documentStatus: null,
      }),
      referenceDate,
    );

    expect(status).toEqual({ reason: "발송 필요", priority: 3 });
  });

  it("returns signature required when document is sent and start date is within 2 days", () => {
    const status = getActionRequiredStatus(
      createClient({
        startDate: "2026-03-19",
        eDocId: "doc-1",
        documentStatus: "created",
      }),
      referenceDate,
    );

    expect(status).toEqual({ reason: "이용자 완료 필요", priority: 2 });
    expect(ACTION_REQUIRED_SIGNATURE_THRESHOLD_DAYS).toBe(2);
  });

  it("does not return signature required before the 2-day threshold", () => {
    const status = getActionRequiredStatus(
      createClient({
        startDate: "2026-03-22",
        eDocId: "doc-1",
        documentStatus: "created",
      }),
      referenceDate,
    );

    expect(status).toBeNull();
  });

  it("does not return action required for completed documents", () => {
    const status = getActionRequiredStatus(
      createClient({
        startDate: "2026-03-18",
        eDocId: "doc-1",
        documentStatus: "completed",
      }),
      referenceDate,
    );

    expect(status).toBeNull();
  });
});
