"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useUploadDocument } from "@/hooks/use-documents";
import { DocumentDropzone } from "@/components/app/documents/document-dropzone";
import { ContentPaper } from "@/components/app/root/content-paper";
import { useToast } from "@/hooks/use-toast";

export default function FileUploadPage() {
  const router = useRouter();
  const { toast } = useToast();
  const uploadMutation = useUploadDocument();
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleUpload = async (params: {
    file: File;
    name: string;
    description?: string;
    categoryId: string;
    tags: string[];
  }) => {
    try {
      setUploadProgress(0);
      await uploadMutation.mutateAsync({
        ...params,
        onProgress: (p: number) => setUploadProgress(p),
      });
      toast({ title: "성공", description: "문서가 업로드되었습니다.", variant: "default" });
      router.push("/files");
    } catch {
      toast({ title: "오류", description: "문서 업로드에 실패했습니다.", variant: "destructive" });
    }
  };

  return (
    <section data-component="files-upload-page" className="space-y-4 p-4">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push("/files")}
          aria-label="파일 목록으로"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-v3-border/60 bg-white hover:bg-v3-dim-white"
        >
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-v3-dark">파일 업로드</h1>
          <p className="text-[0.78rem] text-v3-text-muted">
            PDF, PNG, JPG 파일을 업로드하고 카테고리·태그를 지정합니다.
          </p>
        </div>
      </header>

      <ContentPaper variant="v3">
        <DocumentDropzone
          onUpload={handleUpload}
          isLoading={uploadMutation.isPending}
          uploadProgress={uploadProgress}
        />
      </ContentPaper>
    </section>
  );
}
