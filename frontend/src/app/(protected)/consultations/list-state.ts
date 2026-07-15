import type { ConsultationInquiry } from "@/services/api";
import { matchesSearchQuery } from "@/lib/search/korean-search";

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
  search = "",
}: {
  inquiries: ConsultationInquiry[];
  selectedInquiry: ConsultationInquiry | null;
  activeReadState: string;
  search?: string;
}): ConsultationInquiry[] {
  const matchesSearch = (inquiry: ConsultationInquiry) =>
    matchesSearchQuery(search, [inquiry.motherName, inquiry.phone, inquiry.address]);
  const visibleInquiries = getLatestUniqueConsultationInquiries(
    inquiries.filter(matchesSearch),
  );

  if (
    activeReadState !== "unread" ||
    !selectedInquiry ||
    !matchesSearch(selectedInquiry)
  ) {
    return visibleInquiries;
  }

  if (visibleInquiries.some((inquiry) => inquiry.id === selectedInquiry.id)) {
    return visibleInquiries;
  }

  return [selectedInquiry, ...visibleInquiries];
}
