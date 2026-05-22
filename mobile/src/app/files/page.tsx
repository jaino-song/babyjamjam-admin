"use client";

import { useMemo, useState } from "react";
import { FileImage, FileSpreadsheet, FileText, Image as ImageIcon } from "lucide-react";

import { matchesKoreanSearch } from "@/lib/search/korean-search";
import {
  useDocuments,
  getDownloadUrl,
  type Document,
} from "@/hooks/use-documents";
import { useDocumentCategories } from "@/hooks/use-document-categories";
import { ListCard } from "@/components/app/mobile-redesign/primitives";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailSheet,
  MobileSearchBar,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

type FileKind = "pdf" | "img" | "doc" | "xls" | "misc";
type DetailTabId = "preview" | "info" | "description" | "tags";

const ALL_FILTER = "전체";

function fileKindFromMime(mime: string): FileKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "img";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.endsWith("csv")) return "xls";
  if (mime.includes("word") || mime.includes("document") || mime.endsWith("text/plain")) return "doc";
  return "misc";
}

function fileExtensionLabel(name: string, mime: string): string {
  const dot = name.lastIndexOf(".");
  if (dot !== -1 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return mime.replace("image/", "").toUpperCase();
  return mime.split("/").pop()?.toUpperCase() ?? "FILE";
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativeUploadLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const isSameYear = d.getFullYear() === new Date().getFullYear();
  if (isSameYear) return `${d.getMonth() + 1}/${d.getDate()}`;
  return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function FileKindIcon({ kind }: { kind: FileKind }) {
  const Icon =
    kind === "img" ? ImageIcon
    : kind === "xls" ? FileSpreadsheet
    : kind === "doc" ? FileText
    : kind === "pdf" ? FileText
    : FileImage;
  return (
    <div className={`file-icon ${kind}`}>
      <Icon size={18} strokeWidth={2.5} />
    </div>
  );
}

function FilePreview({ doc }: { doc: Document }) {
  const kind = fileKindFromMime(doc.mimeType);
  const url = getDownloadUrl(doc.id);

  if (kind === "pdf") {
    return (
      <div className="info-card pdf-preview-card pop-up" data-component="mobile-files-preview-pdf">
        <span className="zoom-hint">스크롤하여 확인</span>
        <iframe
          title={doc.name}
          src={url}
          style={{
            width: "100%",
            height: 460,
            borderRadius: 8,
            border: 0,
            background: "white",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        />
      </div>
    );
  }
  if (kind === "img") {
    return (
      <div className="info-card pdf-preview-card pop-up" data-component="mobile-files-preview-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={doc.name}
          style={{
            width: "100%",
            borderRadius: 8,
            background: "white",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            display: "block",
          }}
        />
      </div>
    );
  }
  return (
    <InfoCard title="미리보기" padded>
      <p
        style={{
          fontSize: "0.82rem",
          color: "hsl(var(--v3-text-muted))",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        이 파일 형식은 브라우저에서 직접 미리볼 수 없습니다.
        <br />
        다운로드 후 확인해주세요.
      </p>
    </InfoCard>
  );
}

function FileDetailContent({
  doc,
  categoryLabel,
  uploaderLabel,
  activeTab,
  onTabChange,
}: {
  doc: Document;
  categoryLabel: string;
  uploaderLabel: string;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
}) {
  const [actionStatus, setActionStatus] = useState("");
  const kind = fileKindFromMime(doc.mimeType);
  const extLabel = fileExtensionLabel(doc.name, doc.mimeType);
  const sizeLabel = fileSizeLabel(doc.fileSize);

  const badgeToneByKind: Record<FileKind, string> = {
    pdf: "badge-mini burgundy",
    img: "badge-mini green",
    doc: "badge-mini primary",
    xls: "badge-mini green",
    misc: "badge-mini muted",
  };

  const handleDownload = () => {
    window.open(getDownloadUrl(doc.id, true), "_blank");
    setActionStatus(`${doc.name} 다운로드를 시작했습니다.`);
  };
  const handleShare = async () => {
    const url = `${window.location.origin}${getDownloadUrl(doc.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setActionStatus("공유 링크를 복사했습니다.");
    } catch {
      setActionStatus("공유 링크 복사에 실패했습니다.");
    }
  };

  return (
    <div className="detail-body detail-column" data-component="mobile-files-detail">
      <div className="client-detail-header pop-up">
        <div className={`client-detail-avatar-lg file-detail-avatar`}>
          <FileKindIconLarge kind={kind} />
        </div>
        <div className="client-detail-title">
          <div className="client-detail-name" style={{ fontSize: "0.95rem" }}>
            {doc.name}
          </div>
          <div className="client-detail-badges">
            <span className={badgeToneByKind[kind]}>{extLabel}</span>
            <span className="badge-mini muted">{categoryLabel}</span>
            <span className="badge-mini muted">{sizeLabel}</span>
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={handleShare}
          data-component="mobile-files-share"
        >
          공유
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={handleDownload}
          data-component="mobile-files-download"
        >
          다운로드
        </button>
      </div>
      {actionStatus && (
        <div className="action-feedback" role="status">
          {actionStatus}
        </div>
      )}

      <DetailTabPills
        tabs={[
          { id: "preview", label: "미리보기" },
          { id: "info", label: "파일 정보" },
          { id: "description", label: "설명" },
          { id: "tags", label: "태그" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <div className={`tab-content ${activeTab === "preview" ? "active" : ""}`} data-tab-content="preview">
        <FilePreview doc={doc} />
      </div>

      <div className={`tab-content ${activeTab === "info" ? "active" : ""}`} data-tab-content="info">
        <InfoCard title="파일 정보">
          <InfoRow label="파일명" value={<span style={{ fontSize: "0.72rem" }}>{doc.name}</span>} />
          <InfoRow label="형식" value={doc.mimeType} />
          <InfoRow label="카테고리" value={categoryLabel} />
          <InfoRow label="크기" value={sizeLabel} />
        </InfoCard>
        <InfoCard title="관련 정보" delay={60}>
          <InfoRow label="업로더" value={uploaderLabel} />
        </InfoCard>
        <InfoCard title="날짜" delay={120}>
          <InfoRow label="등록일" value={formatDateTime(doc.createdAt)} />
          <InfoRow label="수정일" value={formatDateTime(doc.updatedAt)} />
        </InfoCard>
      </div>

      <div className={`tab-content ${activeTab === "description" ? "active" : ""}`} data-tab-content="description">
        <InfoCard title="설명" padded>
          {doc.description?.trim() ? (
            <div
              style={{
                fontSize: "0.84rem",
                lineHeight: 1.55,
                color: "hsl(var(--v3-dark))",
                whiteSpace: "pre-wrap",
              }}
            >
              {doc.description}
            </div>
          ) : (
            <div
              style={{
                fontSize: "0.82rem",
                color: "hsl(var(--v3-text-muted))",
                lineHeight: 1.55,
              }}
            >
              설명이 없습니다.
            </div>
          )}
        </InfoCard>
      </div>

      <div className={`tab-content ${activeTab === "tags" ? "active" : ""}`} data-tab-content="tags">
        <InfoCard title={`태그 · ${doc.tags.length}개`}>
          {doc.tags.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
              {doc.tags.map((tag) => (
                <span key={tag} className="badge-mini muted">
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <div
              style={{
                fontSize: "0.82rem",
                color: "hsl(var(--v3-text-muted))",
                lineHeight: 1.55,
              }}
            >
              태그가 없습니다.
            </div>
          )}
        </InfoCard>
      </div>
    </div>
  );
}

function FileKindIconLarge({ kind }: { kind: FileKind }) {
  const Icon =
    kind === "img" ? ImageIcon
    : kind === "xls" ? FileSpreadsheet
    : kind === "doc" ? FileText
    : kind === "pdf" ? FileText
    : FileImage;
  return <Icon size={24} strokeWidth={2.5} />;
}

export default function FilesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>("preview");

  const { data: documents = [] } = useDocuments();
  const { data: categories = [] } = useDocumentCategories();

  const categoryLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.label);
    return map;
  }, [categories]);

  const searchFilteredDocs = useMemo<Document[]>(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.trim();
    return documents.filter(
      (d) =>
        matchesKoreanSearch(d.name, q) ||
        (d.description && matchesKoreanSearch(d.description, q)) ||
        d.tags?.some((t) => matchesKoreanSearch(t, q)),
    );
  }, [documents, searchQuery]);

  const groupedAll = useMemo(() => {
    const map = new Map<string, Document[]>();
    for (const doc of searchFilteredDocs) {
      const key = doc.categoryId || "uncategorized";
      const bucket = map.get(key) ?? [];
      bucket.push(doc);
      map.set(key, bucket);
    }
    return map;
  }, [searchFilteredDocs]);

  const filterItems = useMemo(() => {
    const items: Array<{ label: string; count: string }> = [
      { label: ALL_FILTER, count: String(searchFilteredDocs.length) },
    ];
    for (const [categoryId, docs] of groupedAll.entries()) {
      const label = categoryLookup.get(categoryId) ?? "기타";
      items.push({ label, count: String(docs.length) });
    }
    return items;
  }, [groupedAll, searchFilteredDocs.length, categoryLookup]);

  const visibleSections = useMemo(() => {
    const sections: Array<{ title: string; categoryId: string; docs: Document[] }> = [];
    for (const [categoryId, docs] of groupedAll.entries()) {
      const label = categoryLookup.get(categoryId) ?? "기타";
      if (activeFilter !== ALL_FILTER && label !== activeFilter) continue;
      sections.push({
        title: `${label} · ${docs.length}건`,
        categoryId,
        docs: [...docs].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      });
    }
    sections.sort((a, b) => a.title.localeCompare(b.title));
    return sections;
  }, [groupedAll, categoryLookup, activeFilter]);

  const selectedCategoryLabel = selectedDoc
    ? categoryLookup.get(selectedDoc.categoryId) ?? "기타"
    : "";

  return (
    <MobileDetailSheet
      name="files"
      isOpen={Boolean(selectedDoc)}
      onClose={() => setSelectedDoc(null)}
      list={
        <div className="shell-content" data-component="mobile-files-content">
          <ListCard
            title="파일"
            count={`${documents.length}개`}
            actionLabel="업로드"
            actionHref="/files/upload"
            filters={filterItems}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            beforeFilters={
              <MobileSearchBar
                placeholder="파일명, 고객명 검색"
                label="files"
                value={searchQuery}
                onChange={setSearchQuery}
              />
            }
          >
            {visibleSections.length === 0 ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-text-muted))",
                }}
                data-component="mobile-files-empty"
              >
                {searchQuery.trim() || activeFilter !== ALL_FILTER
                  ? "검색 결과가 없습니다."
                  : "등록된 파일이 없습니다."}
              </div>
            ) : (
              visibleSections.map((section) => (
                <div className="section-block" key={section.categoryId}>
                  <div className="section-header">{section.title}</div>
                  {section.docs.map((doc) => {
                    const kind = fileKindFromMime(doc.mimeType);
                    const extLabel = fileExtensionLabel(doc.name, doc.mimeType);
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        className="list-item"
                        data-component="mobile-files-row"
                        onClick={() => {
                          setSelectedDoc(doc);
                          setActiveTab("preview");
                        }}
                      >
                        <FileKindIcon kind={kind} />
                        <div className="list-info">
                          <div className="list-name">{doc.name}</div>
                          <div className="file-meta">
                            {fileSizeLabel(doc.fileSize)}
                            <span className="sep">·</span>
                            {extLabel}
                          </div>
                        </div>
                        <div className="list-right">
                          <span className="dday-sub">{relativeUploadLabel(doc.createdAt)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </ListCard>
        </div>
      }
      detail={
        selectedDoc ? (
          <FileDetailContent
            doc={selectedDoc}
            categoryLabel={selectedCategoryLabel}
            uploaderLabel={selectedDoc.uploadedBy || "-"}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        ) : (
          <div className="detail-body" />
        )
      }
    />
  );
}
