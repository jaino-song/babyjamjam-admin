"use client";

import { useMemo, useState } from "react";

import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useEformsignDocumentsByType } from "@/hooks/useEformsignDocuments";
import { useInfiniteContracts } from "@/hooks/useInfiniteContracts";
import { EformsignDocument } from "@/lib/eformsign/types";
import {
  getStatusCategory,
  mapStatusToLabel,
  normalizeStatusCode,
} from "@/lib/eformsign/status-codes";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { ContractsRedesign } from "@/components/app/mobile-redesign/ContractsRedesign";
import type {
  ContractsRedesignFilter,
} from "@/components/app/mobile-redesign/ContractsRedesign";
import type { ContractRow } from "@/components/app/mobile-redesign/mockup-data";

const EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"];

function customerName(doc: EformsignDocument): string {
  const recipients = doc.current_status?.step_recipients;
  if (recipients && recipients.length > 0 && recipients[0]?.name) return recipients[0].name;
  if (doc.last_editor?.name) return doc.last_editor.name;
  if (doc.creator?.name) return doc.creator.name;
  return "고객 미지정";
}

function categoryTones(category: "completed" | "rejected" | "in-progress" | "drafting"): {
  badge: string;
  badgeTone: ContractRow["badgeTone"];
  iconTone: ContractRow["iconTone"];
} {
  switch (category) {
    case "completed":
      return { badge: "완료", badgeTone: "green", iconTone: "green" };
    case "rejected":
      return { badge: "만료", badgeTone: "muted", iconTone: "muted" };
    case "drafting":
      return { badge: "작성 중", badgeTone: "muted", iconTone: "muted" };
    default:
      return { badge: "검토 필요", badgeTone: "primary", iconTone: "primary" };
  }
}

function categorize(
  doc: EformsignDocument,
): "completed" | "rejected" | "in-progress" | "drafting" {
  const cat = getStatusCategory(doc.current_status?.status_type);
  if (cat === "completed" || cat === "rejected") return cat;
  const normalized = normalizeStatusCode(doc.current_status?.status_type);
  if (normalized === "001") return "drafting";
  return "in-progress";
}

export default function ContractsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const { isAuthenticated } = useEformsignAuth();
  const { data: allData } = useEformsignDocumentsByType(isAuthenticated, null);
  const { documents: infiniteDocuments } = useInfiniteContracts({
    enabled: isAuthenticated,
    filterType: null,
    excludedNames: EXCLUDED_CUSTOMER_NAMES,
  });

  const documents = useMemo(() => {
    if (!searchQuery.trim()) return infiniteDocuments;
    return infiniteDocuments.filter((doc) => {
      const name = customerName(doc);
      const q = searchQuery.trim();
      if (matchesKoreanSearch(name, q)) return true;
      if (doc.document_name?.toLowerCase().includes(q.toLowerCase())) return true;
      return false;
    });
  }, [infiniteDocuments, searchQuery]);

  const totalDocs = useMemo(
    () =>
      (allData?.documents ?? []).filter((doc) => {
        const name = customerName(doc);
        return !EXCLUDED_CUSTOMER_NAMES.includes(name);
      }).length,
    [allData?.documents],
  );

  const { sections, filters } = useMemo(() => {
    const groups: Record<
      "in-progress" | "drafting" | "completed" | "rejected",
      EformsignDocument[]
    > = {
      "in-progress": [],
      drafting: [],
      completed: [],
      rejected: [],
    };

    for (const doc of documents) {
      groups[categorize(doc)].push(doc);
    }

    const order: Array<{
      key: keyof typeof groups;
      title: string;
      countLabel: string;
    }> = [
      { key: "in-progress", title: "검토 필요", countLabel: "건" },
      { key: "drafting", title: "작성 중", countLabel: "건" },
      { key: "completed", title: "완료", countLabel: "건" },
      { key: "rejected", title: "만료/반려", countLabel: "건" },
    ];

    const builtSections = order
      .filter((g) => groups[g.key].length > 0)
      .map((g) => {
        const tones = categoryTones(g.key);
        return {
          title: `${g.title} · ${groups[g.key].length}${g.countLabel}`,
          rows: groups[g.key].map<ContractRow>((doc) => ({
            id: doc.id,
            name: doc.document_name || customerName(doc),
            meta: `${customerName(doc)} · ${mapStatusToLabel(doc.current_status?.status_type) ?? g.title}`,
            badge: tones.badge,
            badgeTone: tones.badgeTone,
            iconTone: tones.iconTone,
          })),
        };
      });

    const filterPills: ContractsRedesignFilter[] = [
      { label: "전체", count: String(documents.length), active: true },
      ...order
        .filter((g) => groups[g.key].length > 0)
        .map((g) => ({
          label: g.title,
          count: String(groups[g.key].length),
        })),
    ];

    return { sections: builtSections, filters: filterPills };
  }, [documents]);

  return (
    <ContractsRedesign
      sections={sections}
      filters={filters}
      total={totalDocs}
      actionHref="/contracts/creation"
    />
  );
}
