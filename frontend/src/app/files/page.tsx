"use client";

import { useMemo, useState } from "react";
import { FolderOpen, FileText, Image, File, Upload, Loader2, Calendar, Tag } from "lucide-react";
import { PageHeader, StatMini, SplitLayout, ListPanel, DetailPanel, InfoCard, InfoRow, SearchBox, FilterChips } from "@/app/(components)/v3";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useDocuments, useUploadDocument, useUpdateDocument, useDeleteDocument, Document } from "@/app/hooks/use-documents";
import { useDocumentCategories, useCreateDocumentCategory, DocumentCategory } from "@/app/hooks/use-document-categories";
import { DocumentDropzone } from "@/app/(components)/documents/document-dropzone";
import DocumentPreviewModal from "@/app/(components)/documents/document-preview-modal";
import { DocumentEditModal } from "@/app/(components)/documents/document-edit-modal";
import { AddCategoryModal } from "@/app/(components)/documents/add-category-modal";
import { formatDate } from "@/app/(components)/documents/document-list";
import { toast } from "@/app/hooks/use-toast";

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

  const filterCategory = activeFilter === "all" ? undefined : activeFilter;
  const { data: documents = [], isLoading, error } = useDocuments(filterCategory);
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
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    return docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [documents, searchQuery]);

  const stats = useMemo(() => {
    const total = documents.length;
    const recentCount = documents.filter(d => {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return new Date(d.createdAt).getTime() > weekAgo;
    }).length;
    return { total, categoryCount: categories.length, recentCount };
  }, [documents, categories]);

  const selectedDocument = useMemo(() => {
    if (!selectedDocId) return filteredDocs[0] ?? null;
    return filteredDocs.find(d => d.id === selectedDocId) ?? filteredDocs[0] ?? null;
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
        <div className="bg-v3-burgundy-light text-v3-burgundy rounded-[18px] p-6 text-center">
          문서를 불러오는데 실패했습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="파일 관리"
        subtitle="문서 및 파일을 관리합니다"
        icon={FolderOpen}
        actions={
          <button
            onClick={() => setIsUploadOpen(true)}
            className="inline-flex items-center gap-2 rounded-[14px] bg-v3-primary px-5 py-2.5 text-[0.85rem] font-semibold text-white shadow-v3 hover:shadow-v3-hover hover:-translate-y-0.5 transition-all duration-300"
          >
            <Upload className="h-4 w-4" />
            업로드
          </button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <SearchBox placeholder="문서명, 설명, 태그로 검색..." value={searchQuery} onChange={setSearchQuery} />
        </div>
        <FilterChips items={filterItems} activeValue={activeFilter} onChange={setActiveFilter} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatMini icon={FolderOpen} value={isLoading ? "–" : stats.total} label="전체 파일" colorIndex={0} />
        <StatMini icon={Tag} value={isLoading ? "–" : stats.categoryCount} label="카테고리" colorIndex={1} />
        <StatMini icon={Calendar} value={isLoading ? "–" : stats.recentCount} label="최근 7일" colorIndex={2} />
      </div>

      <SplitLayout>
        <ListPanel title="파일 목록">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 rounded-[14px] bg-v3-dim-white animate-pulse" />
              ))}
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="text-center py-12 text-v3-text-muted text-[0.85rem]">
              {searchQuery ? "검색 결과가 없습니다" : "등록된 문서가 없습니다"}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredDocs.map(doc => {
                const isActive = selectedDocument?.id === doc.id;
                return (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-[14px] text-left transition-all duration-200 ${
                      isActive ? "bg-v3-primary-light border-l-2 border-v3-primary" : "hover:bg-v3-dim-white"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-[10px] bg-v3-primary-light flex items-center justify-center shrink-0">
                      {getFileIcon(doc.mimeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.8rem] font-semibold text-v3-dark truncate">{doc.name}</p>
                      <p className="text-[0.7rem] text-v3-text-muted truncate">{getCategoryLabel(doc.categoryId)}</p>
                    </div>
                    <span className="text-[0.65rem] text-v3-text-muted whitespace-nowrap">{formatDate(doc.createdAt)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </ListPanel>

        {selectedDocument ? (
          <FileDetail
            document={selectedDocument}
            categories={categories}
            getCategoryLabel={getCategoryLabel}
            onPreview={() => setPreviewDoc(selectedDocument)}
            onEdit={() => setEditDoc(selectedDocument)}
            onDelete={() => setDeleteDoc(selectedDocument)}
          />
        ) : (
          <div className="bg-white rounded-[28px] shadow-v3 flex items-center justify-center min-h-[400px]">
            <div className="text-center text-v3-text-muted">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-[0.85rem]">파일을 선택해주세요</p>
            </div>
          </div>
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
    </div>
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
  const header = (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-v3-dark truncate">{doc.name}</h2>
          <p className="text-[0.75rem] text-v3-text-muted mt-1">
            등록일: {formatDate(doc.createdAt)}
          </p>
        </div>
        <span className="inline-flex items-center rounded-[50px] px-3 py-1 text-[0.65rem] font-semibold bg-v3-primary-light text-v3-primary">
          {getCategoryLabel(doc.categoryId)}
        </span>
      </div>
      <div className="flex gap-2">
        <button onClick={onPreview} className="rounded-[10px] bg-v3-primary px-3 py-1.5 text-[0.75rem] font-semibold text-white hover:bg-v3-primary-hover transition-colors">미리보기</button>
        <button onClick={onEdit} className="rounded-[10px] bg-v3-dim-white px-3 py-1.5 text-[0.75rem] font-semibold text-v3-text hover:bg-v3-border transition-colors">수정</button>
        <button onClick={onDelete} className="rounded-[10px] bg-v3-burgundy-light px-3 py-1.5 text-[0.75rem] font-semibold text-v3-burgundy hover:bg-v3-burgundy/10 transition-colors">삭제</button>
      </div>
    </div>
  );

  return (
    <DetailPanel header={header}>
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
