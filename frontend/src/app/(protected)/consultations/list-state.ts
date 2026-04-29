import type { ConsultationInquiry } from "@/services/api";

export function getConsultationIdentityKey(inquiry: ConsultationInquiry): string {
  return `${inquiry.motherName.trim().toLowerCase()}::${inquiry.phone.replace(/\D/g, "")}`;
}

export function getLatestUniqueConsultationInquiries(
  inquiries: ConsultationInquiry[],
): ConsultationInquiry[] {
  return Array.from(
    inquiries.reduce((uniqueMap, inquiry) => {
      const key = getConsultationIdentityKey(inquiry);
      const current = uniqueMap.get(key);

      if (
        !current ||
        new Date(inquiry.createdAt).getTime() > new Date(current.createdAt).getTime()
      ) {
        uniqueMap.set(key, inquiry);
      }

      return uniqueMap;
    }, new Map<string, ConsultationInquiry>()).values(),
  );
}

export function getDisplayedConsultationInquiries({
  inquiries,
  selectedInquiry,
  activeReadState,
}: {
  inquiries: ConsultationInquiry[];
  selectedInquiry: ConsultationInquiry | null;
  activeReadState: string;
}): ConsultationInquiry[] {
  const visibleInquiries = getLatestUniqueConsultationInquiries(inquiries);

  if (activeReadState !== "unread" || !selectedInquiry) {
    return visibleInquiries;
  }

  if (visibleInquiries.some((inquiry) => inquiry.id === selectedInquiry.id)) {
    return visibleInquiries;
  }

  return [selectedInquiry, ...visibleInquiries];
}
