"use client";

import { useMemo, useState } from "react";
import { FolderOpen, FileText, Image, File, Upload, Loader2, Calendar, Tag } from "lucide-react";
import { StatsBar, SplitLayout, ListPanel, DetailPanel, InfoCard, InfoRow, HeaderActionButton, AnimatedSlotList, EmptyState, PageSection, DetailSkeleton, ListEmptyState, DetailActions } from "@/components/app/v3";
import type { DetailAction } from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useDocuments, useUploadDocument, useUpdateDocument, useDeleteDocument, Document } from "@/hooks/use-documents";
import { useDocumentCategories, useCreateDocumentCategory, DocumentCategory } from "@/hooks/use-document-categories";
import { DocumentDropzone } from "@/components/app/documents/document-dropzone";
import DocumentPreviewModal from "@/components/app/documents/document-preview-modal";
import { DocumentEditModal } from "@/components/app/documents/document-edit-modal";
import { AddCategoryModal } from "@/components/app/documents/add-category-modal";
import { formatDate } from "@/components/app/documents/document-list";
import { toast } from "@/hooks/use-toast";

const RECENT_WINDOW_START = Date.now() - 7 * 24 * 60 * 60 * 1000;

export default function FilesPage() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [editDoc, setEditDoc] = useState<Document | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<Document | null>(null);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const { data: documents = [], isLoading, error } = useDocuments();
  const { data: categories = [] } = useDocumentCategories();
  const uploadMutation = useUploadDocument();
  const updateMutation = useUpdateDocument();
  const deleteMutation = useDeleteDocument();
  const createCategoryMutation = useCreateDocumentCategory();

  const filterItems = useMemo(() => [
    { label: "전체", value: "all" },
    ...categories.map(c => ({ label: c.label, value: c.id })),
  ], [categories]);

  const filteredDocs = useMemo(() => {
    let docs = [...documents];
    if (activeFilter !== "all") {
      docs = docs.filter(d => d.categoryId === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim();
      docs = docs.filter(d =>
        matchesKoreanSearch(d.name, q) ||
        (d.description && matchesKoreanSearch(d.description, q)) ||
        d.tags?.some(t => matchesKoreanSearch(t, q))
      );
    }
    return docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [documents, activeFilter, searchQuery]);

  const stats = useMemo(() => {
    const total = documents.length;
    const recentCount = documents.filter(d => {
      return new Date(d.createdAt).getTime() > RECENT_WINDOW_START;
    }).length;
    return { total, categoryCount: categories.length, recentCount };
  }, [documents, categories]);

  const selectedDocument = useMemo(() => {
    if (!selectedDocId) return null;
    return filteredDocs.find(d => d.id === selectedDocId) ?? null;
  }, [selectedDocId, filteredDocs]);

  function getFileIcon(mimeType: string) {
    if (mimeType.includes("pdf")) return <FileText className="w-4 h-4 text-v3-burgundy" />;
    if (mimeType.includes("image")) return <Image className="w-4 h-4 text-v3-primary" />;
    return <File className="w-4 h-4 text-v3-text-muted" />;
  }

  function getCategoryLabel(categoryId: string): string {
    return categories.find(c => c.id === categoryId)?.label ?? "미분류";
  }

  const handleUpload = async (params: { file: File; name: string; description?: string; categoryId: string; tags: string[] }) => {
    try {
      setUploadProgress(0);
      await uploadMutation.mutateAsync({ ...params, onProgress: (p: number) => setUploadProgress(p) });
      setIsUploadOpen(false);
      toast({ title: "성공", description: "문서가 업로드되었습니다.", variant: "default" });
    } catch {
      toast({ title: "오류", description: "문서 업로드에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleUpdate = async (id: string, params: { name?: string; description?: string; categoryId?: string; tags?: string[] }) => {
    try {
      await updateMutation.mutateAsync({ id, ...params });
      setEditDoc(null);
      toast({ title: "성공", description: "문서가 수정되었습니다.", variant: "default" });
    } catch {
      toast({ title: "오류", description: "문서 수정에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    try {
      await deleteMutation.mutateAsync(deleteDoc.id);
      setDeleteDoc(null);
      toast({ title: "성공", description: "문서가 삭제되었습니다.", variant: "default" });
    } catch {
      toast({ title: "오류", description: "문서 삭제에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleAddCategory = async (category: { value: string; label: string; color: string }) => {
    try {
      await createCategoryMutation.mutateAsync(category);
      setIsAddCategoryOpen(false);
      toast({ title: "성공", description: "카테고리가 추가되었습니다.", variant: "default" });
    } catch {
      toast({ title: "오류", description: "카테고리 추가에 실패했습니다.", variant: "destructive" });
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <div data-component="files-error" className="bg-v3-burgundy-light text-v3-burgundy rounded-[18px] p-6 text-center">
          문서를 불러오는데 실패했습니다.
        </div>
      </div>
    );
  }

  return (
    <PageSection name="files">
      <StatsBar
        name="files"
        isLoading={isLoading}
        items={[
          { icon: FolderOpen, value: stats.total, label: "전체 파일", counter: "건" },
          { icon: Tag, value: stats.categoryCount, label: "카테고리", counter: "개", colorIndex: 1 },
          { icon: Calendar, value: stats.recentCount, label: "최근 7일", counter: "건", colorIndex: 2 },
        ]}
      />

      <SplitLayout>
        <ListPanel
          title="파일 목록"
          tabs={filterItems}
          activeTab={activeFilter}
          onTabChange={setActiveFilter}
          tabsVariant="dropdown"
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="문서명, 설명, 태그 검색..."
          headerActions={
            <HeaderActionButton
              icon={Upload}
              label="업로드"
              onClick={() => setIsUploadOpen(true)}
              data-component="files-upload-btn"
            />
          }
        >
          {!isLoading && filteredDocs.length === 0 ? (
            <ListEmptyState message={searchQuery ? "검색 결과가 없습니다" : "등록된 문서가 없습니다"} />
          ) : (
            <AnimatedSlotList<Document>
              items={filteredDocs}
              isLoading={isLoading}
              loadingCount={4}
              className="space-y-2"
              slotClassName={({ item, isLoading: slotLoading }) => {
                const isActive = !slotLoading && item && selectedDocument?.id === item.id;
                return cn(
                  "flex items-center gap-3 p-3 rounded-[14px] transition-all duration-200 bg-white border-2 border-transparent",
                  !slotLoading && "cursor-pointer",
                  isActive
                    ? "bg-v3-primary-light border-2 border-v3-primary"
                    : !slotLoading && "hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                );
              }}
              onSlotClick={(doc) => setSelectedDocId(doc.id)}
              render={({ item: doc, isLoading: slotLoading }) => {
                if (slotLoading) {
                  return (
                    <>
                      <div className="w-9 h-9 rounded-[10px] shrink-0 bg-v3-dim-white flex items-center justify-center">
                        <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-32 bg-v3-dim-white" />
                      </div>
                      <Skeleton className="h-3 w-12 bg-v3-dim-white shrink-0" />
                    </>
                  );
                }
                if (!doc) return null;
                return (
                  <>
                    <div className="w-9 h-9 rounded-[10px] bg-v3-primary-light flex items-center justify-center shrink-0">
                      {getFileIcon(doc.mimeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.8rem] font-semibold text-v3-dark truncate">{doc.name}</p>
                      <p className="text-[0.7rem] text-v3-text-muted truncate">{getCategoryLabel(doc.categoryId)}</p>
                    </div>
                    <span className="text-[0.65rem] text-v3-text-muted whitespace-nowrap">{formatDate(doc.createdAt)}</span>
                  </>
                );
              }}
            />
          )}
        </ListPanel>

        {isLoading ? (
          <DetailSkeleton
            name="files-detail-skeleton"
            headerActions={3}
            sections={[
              { titleWidth: "w-16", rows: ["w-1/2", "w-2/3", "w-1/3", "w-1/2", "w-1/2"] },
              { titleWidth: "w-10", rows: ["w-3/4"] },
            ]}
          />
        ) : selectedDocument ? (
          <FileDetail
            document={selectedDocument}
            categories={categories}
            getCategoryLabel={getCategoryLabel}
            onPreview={() => setPreviewDoc(selectedDocument)}
            onEdit={() => setEditDoc(selectedDocument)}
            onDelete={() => setDeleteDoc(selectedDocument)}
          />
        ) : (
          <EmptyState name="files-empty" icon={FolderOpen} message="파일을 선택하면 상세 정보가 표시됩니다" />
        )}
      </SplitLayout>

      <Dialog open={isUploadOpen} onOpenChange={(open: boolean) => !uploadMutation.isPending && setIsUploadOpen(open)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              문서 업로드
            </DialogTitle>
            <DialogDescription className="sr-only">파일을 업로드합니다</DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <DocumentDropzone onUpload={handleUpload} isLoading={uploadMutation.isPending} uploadProgress={uploadProgress} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadOpen(false)} disabled={uploadMutation.isPending}>취소</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentPreviewModal
        open={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        doc={previewDoc}
        categories={categories}
        onEdit={(doc: Document) => setEditDoc(doc)}
        onDelete={(doc: Document) => { setPreviewDoc(null); setDeleteDoc(doc); }}
      />

      <DocumentEditModal open={!!editDoc} onClose={() => setEditDoc(null)} doc={editDoc} onSave={handleUpdate} isLoading={updateMutation.isPending} />

      <AddCategoryModal
        open={isAddCategoryOpen}
        onClose={() => setIsAddCategoryOpen(false)}
        onAdd={handleAddCategory}
        existingColors={categories.filter(c => c.isCustom).map(c => c.color)}
        isLoading={createCategoryMutation.isPending}
      />

      <Dialog open={!!deleteDoc} onOpenChange={(open: boolean) => !open && setDeleteDoc(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>문서 삭제</DialogTitle>
            <DialogDescription>이 문서를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteDoc(null)} disabled={deleteMutation.isPending}>취소</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />삭제 중...</> : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}

function FileDetail({ document: doc, categories, getCategoryLabel, onPreview, onEdit, onDelete }: {
  document: Document;
  categories: DocumentCategory[];
  getCategoryLabel: (id: string) => string;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DetailPanel
      title={doc.name}
      badges={
        <span className="inline-flex items-center rounded-[50px] px-3 py-1 text-[0.65rem] font-semibold bg-v3-primary-light text-v3-primary">
          {getCategoryLabel(doc.categoryId)}
        </span>
      }
      subtitle={<>등록일: {formatDate(doc.createdAt)}</>}
      trailing={
        <DetailActions
          name="files-detail-actions"
          actions={[
            { label: "미리보기", onClick: onPreview, variant: "primary" },
            { label: "수정", onClick: onEdit, variant: "default" },
            { label: "삭제", onClick: onDelete, variant: "danger" },
          ]}
        />
      }
    >
      <div className="space-y-5">
        <InfoCard title="파일 정보">
          <InfoRow label="파일명" value={doc.name} />
          <InfoRow label="형식" value={doc.mimeType} />
          <InfoRow label="카테고리" value={getCategoryLabel(doc.categoryId)} />
          <InfoRow label="등록일" value={formatDate(doc.createdAt)} />
          <InfoRow label="수정일" value={formatDate(doc.updatedAt)} />
        </InfoCard>

        {doc.description && (
          <InfoCard title="설명">
            <p className="text-[0.8rem] text-v3-text">{doc.description}</p>
          </InfoCard>
        )}

        {doc.tags && doc.tags.length > 0 && (
          <InfoCard title="태그">
            <div className="flex flex-wrap gap-2">
              {doc.tags.map(tag => (
                <span key={tag} className="inline-flex items-center rounded-[50px] px-3 py-1 text-[0.65rem] font-semibold bg-v3-primary-light text-v3-primary">
                  {tag}
                </span>
              ))}
            </div>
          </InfoCard>
        )}
      </div>
    </DetailPanel>
  );
}
