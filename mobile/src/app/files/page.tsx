"use client";

import { useMemo, useState } from "react";

import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { useDocuments, type Document } from "@/hooks/use-documents";
import { useDocumentCategories } from "@/hooks/use-document-categories";
import DocumentPreviewModal from "@/components/app/documents/document-preview-modal";
import { FilesRedesign } from "@/components/app/mobile-redesign/FilesRedesign";
import type { FilesRedesignFilter } from "@/components/app/mobile-redesign/FilesRedesign";
import type { ContractRow } from "@/components/app/mobile-redesign/mockup-data";

function categoryFromMime(mime: string): "primary" | "green" | "muted" {
  if (mime.startsWith("image/")) return "green";
  if (mime === "application/pdf" || mime.includes("document")) return "primary";
  return "muted";
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function FilesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

  const { data: documents = [] } = useDocuments();
  const { data: categories = [] } = useDocumentCategories();

  const categoryLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.label);
    return map;
  }, [categories]);

  const filteredDocs = useMemo<Document[]>(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.trim();
    return documents.filter(
      (d) =>
        matchesKoreanSearch(d.name, q) ||
        (d.description && matchesKoreanSearch(d.description, q)) ||
        d.tags?.some((t) => matchesKoreanSearch(t, q)),
    );
  }, [documents, searchQuery]);

  const { sections, filters } = useMemo(() => {
    const grouped = new Map<string, Document[]>();
    for (const doc of filteredDocs) {
      const key = doc.categoryId || "uncategorized";
      const bucket = grouped.get(key) ?? [];
      bucket.push(doc);
      grouped.set(key, bucket);
    }

    const builtSections = Array.from(grouped.entries())
      .map(([categoryId, docs]) => {
        const label = categoryLookup.get(categoryId) ?? "기타";
        return {
          title: `${label} · ${docs.length}건`,
          rows: docs.map<ContractRow>((doc) => ({
            id: doc.id,
            name: doc.name,
            meta: `${fileSizeLabel(doc.fileSize)} · ${formatDate(doc.createdAt)}`,
            badge: label,
            badgeTone: "muted",
            iconTone: categoryFromMime(doc.mimeType),
            onClick: () => setPreviewDoc(doc),
          })),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    const allCount = filteredDocs.length;
    const builtFilters: FilesRedesignFilter[] = [
      { label: "전체", count: String(allCount), active: true },
      ...Array.from(grouped.entries())
        .filter(([, docs]) => docs.length > 0)
        .map(([categoryId, docs]) => ({
          label: categoryLookup.get(categoryId) ?? "기타",
          count: String(docs.length),
        })),
    ];

    return { sections: builtSections, filters: builtFilters };
  }, [filteredDocs, categoryLookup]);

  return (
    <>
      <FilesRedesign
        sections={sections}
        filters={filters}
        total={documents.length}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <DocumentPreviewModal
        open={previewDoc != null}
        doc={previewDoc}
        categories={categories}
        onClose={() => setPreviewDoc(null)}
      />
    </>
  );
}
