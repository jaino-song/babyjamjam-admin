# File Storage Proxy Streaming Implementation Plan

## Context

### Original Request
Change from exposing signed URLs to a proxy-based approach where the backend streams files directly to the frontend, ensuring storage URLs never leave the server.

### Key Decisions from Interview
- Private bucket for confidential documents (contracts, etc.)
- URLs should never be exposed to the client
- Backend acts as proxy for all file access

### Research Findings
- **NestJS Best Practice**: Use `StreamableFile` class instead of raw `@Res()` to preserve interceptors
- **Memory**: 25MB buffer is acceptable for low-concurrency back-office app
- **Existing Pattern**: Codebase has SSE streaming in `ai-chat.controller.ts` using `@Res()`

---

## Objectives & Deliverables

### Core Objective
Implement secure file streaming where storage URLs never leave the backend.

### Concrete Deliverables
- Backend endpoint: `GET /file-storage/:id/download`
- Frontend API route: `GET /api/file-storage/:id/download`
- Remove `storageUrl` generation from upload flow
- Update all frontend components to use download endpoint

### Must Have
- Files streamed through backend (not direct Supabase URLs)
- Proper `Content-Type` and `Content-Disposition` headers
- Support for both inline preview and attachment download
- Backward compatibility (existing records with `storageUrl` still work)

### Must NOT Have
- Direct exposure of Supabase signed URLs to frontend
- Breaking changes to existing upload flow
- Memory issues (keep 25MB limit)

---

## Task Flow

```
Phase 1 (Backend Core)
    ├── Task 1: Add download() to IFileStoragePort
    ├── Task 2: Implement download() in SupabaseStorageAdapter
    ├── Task 3: Create DownloadDocumentUseCase
    ├── Task 4: Add download endpoint to controller (StreamableFile)
    └── Task 5: Update DocumentModule

Phase 2 (Remove URL Exposure)
    ├── Task 6: Remove storageUrl from upload flow
    ├── Task 7: Update Prisma schema (make storageUrl optional)
    ├── Task 8: Update DocumentEntity
    ├── Task 9: Update DocumentMapper
    └── Task 10: Update DocumentDTO (add downloadUrl)

Phase 3 (Frontend)
    ├── Task 11: Create download API route (streaming)
    ├── Task 12: Update hooks (types + helper)
    ├── Task 13: Update DocumentPreviewModal
    ├── Task 14: Update DocumentList
    └── Task 15: Update DocumentsPage

Phase 4 (Verification)
    ├── Task 16: Build verification
    └── Task 17: Integration testing
```

---

## Parallelization

| Group | Tasks | Can Run In Parallel |
|-------|-------|---------------------|
| A | 1, 2 | Yes (interface + implementation) |
| B | 7, 8, 9 | Yes (schema changes) |
| C | 13, 14, 15 | Yes (frontend components) |

---

## TODOs

### Phase 1: Backend Core

- [ ] 1. Add Download Method to File Storage Port
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/domain/ports/file-storage.port.ts`
  - Add new method to interface:
    ```typescript
    /**
     * Download file from storage as Buffer
     * @param path - File path in storage
     * @returns File content as Buffer
     */
    download(path: string): Promise<Buffer>;
    ```
  **Must NOT do**:
  - Do not remove existing methods
  - Do not change method signatures of existing methods
  **References**: `backend/domain/ports/file-storage.port.ts`
  **Verification Method**: `npx tsc --noEmit` passes
  **Definition of Done**:
  - [ ] Interface has `download(path: string): Promise<Buffer>` method
  - [ ] TypeScript compiles

- [ ] 2. Implement Download in Supabase Storage Adapter
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/infrastructure/api/supabase-storage.adapter.ts`
  - Implement the download method:
    ```typescript
    async download(path: string): Promise<Buffer> {
      const client = this.getClient();
      
      const { data, error } = await client.storage
        .from(this.bucketName)
        .download(path);
      
      if (error) {
        this.logger.error(`Failed to download file: ${error.message}`);
        throw new Error(`Failed to download file: ${error.message}`);
      }
      
      // Convert Blob to Buffer
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    ```
  **Must NOT do**:
  - Do not modify existing methods
  **References**: 
  - `backend/infrastructure/api/supabase-storage.adapter.ts`
  - Supabase Storage download API
  **Verification Method**: TypeScript compiles
  **Definition of Done**:
  - [ ] `download()` method implemented
  - [ ] Converts Blob to Buffer correctly
  - [ ] Error handling included

- [ ] 3. Create Download Document Use Case
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Create `backend/application/usecases/document/download-document.usecase.ts`:
    ```typescript
    import { Inject, Injectable, NotFoundException } from "@nestjs/common";
    import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";
    import { IFileStoragePort, FILE_STORAGE_PORT } from "domain/ports/file-storage.port";

    export interface DownloadDocumentResult {
      buffer: Buffer;
      mimeType: string;
      filename: string;
    }

    @Injectable()
    export class DownloadDocumentUseCase {
      constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
        @Inject(FILE_STORAGE_PORT)
        private readonly fileStorage: IFileStoragePort,
      ) {}

      async execute(id: string): Promise<DownloadDocumentResult> {
        const document = await this.documentRepository.findById(id);
        
        if (!document) {
          throw new NotFoundException(`Document not found: ${id}`);
        }
        
        const buffer = await this.fileStorage.download(document.storagePath);
        
        return {
          buffer,
          mimeType: document.mimeType,
          filename: document.name,
        };
      }
    }
    ```
  - Update `backend/application/usecases/document/index.ts` to export the new use case
  **Must NOT do**:
  - Do not add authentication logic (handled by guards)
  **References**: Existing use case patterns in same directory
  **Verification Method**: TypeScript compiles
  **Definition of Done**:
  - [ ] Use case created with proper DI
  - [ ] Returns buffer, mimeType, filename
  - [ ] Throws NotFoundException when document not found
  - [ ] Exported from index.ts

- [ ] 4. Add Download Endpoint to Controller
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/interface/controllers/document.controller.ts`
  - Import `StreamableFile` from `@nestjs/common`
  - Import `DownloadDocumentUseCase`
  - Add endpoint:
    ```typescript
    @Get(':id/download')
    async download(
      @Param('id') id: string,
      @Query('attachment') attachment?: string,
    ): Promise<StreamableFile> {
      const { buffer, mimeType, filename } = await this.downloadUseCase.execute(id);
      
      // inline for preview, attachment for download
      const dispositionType = attachment === 'true' ? 'attachment' : 'inline';
      const encodedFilename = encodeURIComponent(filename);
      
      return new StreamableFile(buffer, {
        type: mimeType,
        disposition: `${dispositionType}; filename="${encodedFilename}"`,
        length: buffer.length,
      });
    }
    ```
  - Inject `DownloadDocumentUseCase` in constructor
  **Must NOT do**:
  - Do not use raw `@Res()` without passthrough (breaks interceptors)
  - Do not use `res.send()` directly
  **References**: 
  - NestJS StreamableFile documentation
  - `backend/interface/controllers/document.controller.ts`
  **Verification Method**: Backend builds, endpoint returns file
  **Definition of Done**:
  - [ ] Uses `StreamableFile` class (not raw Response)
  - [ ] Supports `?attachment=true` query param
  - [ ] Sets correct Content-Type header
  - [ ] Sets correct Content-Disposition header
  - [ ] Includes Content-Length

- [ ] 5. Update Document Module
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/module/document.module.ts`
  - Import and add `DownloadDocumentUseCase` to providers array
  **Must NOT do**:
  - Do not remove existing providers
  **References**: `backend/module/document.module.ts`
  **Verification Method**: Backend builds
  **Definition of Done**:
  - [ ] DownloadDocumentUseCase registered in providers

### Phase 2: Remove URL Exposure

- [ ] 6. Remove storageUrl from Upload Use Case
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/application/usecases/document/upload-document.usecase.ts`
  - Remove the `getPublicUrl` call
  - Pass `null` or `undefined` for `storageUrl` when creating entity
  - Keep only `storagePath`
  **Must NOT do**:
  - Do not remove the `storagePath` - it's still needed
  **References**: `backend/application/usecases/document/upload-document.usecase.ts`
  **Verification Method**: TypeScript compiles
  **Definition of Done**:
  - [ ] No longer calls `getPublicUrl()`
  - [ ] `storageUrl` is null for new uploads
  - [ ] `storagePath` still saved correctly

- [ ] 7. Update Prisma Schema
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/prisma/schema.prisma`
  - Make `storageUrl` optional (for backward compatibility):
    ```prisma
    storageUrl  String?  @map("storage_url") // Deprecated: now using download endpoint
    ```
  **Must NOT do**:
  - Do not remove the field entirely (breaks existing data)
  **References**: `backend/prisma/schema.prisma` (document model around line 231)
  **Verification Method**: `npx prisma validate`
  **Definition of Done**:
  - [ ] `storageUrl` is optional (`String?`)
  - [ ] Prisma validates successfully

- [ ] 8. Update Document Entity
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/domain/entities/document.entity.ts`
  - Make `storageUrl` optional in the interface and class:
    ```typescript
    storageUrl?: string | null;
    ```
  - Update `create()` static method to accept optional storageUrl
  **Must NOT do**:
  - Do not remove the property
  **References**: `backend/domain/entities/document.entity.ts`
  **Verification Method**: TypeScript compiles
  **Definition of Done**:
  - [ ] `storageUrl` is optional
  - [ ] Entity still works with null/undefined storageUrl

- [ ] 9. Update Document Mapper
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/infrastructure/database/mapper/document.mapper.ts`
  - Handle null `storageUrl` in both directions (toDomain, toPersistence)
  **Must NOT do**:
  - Do not throw error on null storageUrl
  **References**: `backend/infrastructure/database/mapper/document.mapper.ts`
  **Verification Method**: TypeScript compiles
  **Definition of Done**:
  - [ ] Mapper handles null storageUrl gracefully

- [ ] 10. Update Document DTOs
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `backend/interface/dto/document.dto.ts`
  - Make `storageUrl` optional in response
  - Add computed `downloadUrl` field pattern (or document that frontend should construct it)
  - Update DocumentResponseDto:
    ```typescript
    export class DocumentResponseDto {
      id: string;
      name: string;
      // ... other fields
      storageUrl?: string; // Deprecated
      downloadUrl: string; // New: /file-storage/{id}/download
    }
    ```
  **Must NOT do**:
  - Do not remove storageUrl from DTO (backward compatibility)
  **References**: `backend/interface/dto/document.dto.ts`
  **Verification Method**: TypeScript compiles
  **Definition of Done**:
  - [ ] `storageUrl` is optional
  - [ ] `downloadUrl` field documented or added

### Phase 3: Frontend Changes

- [ ] 11. Create Download API Route (Streaming)
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Create `frontend/src/app/api/file-storage/[id]/download/route.ts`:
    ```typescript
    import { NextRequest, NextResponse } from "next/server";
    import { serverAPIClient } from "@/app/lib/axios/server";

    function getAuthToken(request: NextRequest): string | null {
      return request.cookies.get("auth_token")?.value || null;
    }

    export async function GET(
      request: NextRequest,
      { params }: { params: Promise<{ id: string }> }
    ) {
      try {
        const token = getAuthToken(request);
        if (!token) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const attachment = searchParams.get("attachment");
        
        const url = attachment 
          ? `/file-storage/${id}/download?attachment=true`
          : `/file-storage/${id}/download`;

        const response = await serverAPIClient.get(url, {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "arraybuffer",
        });

        return new NextResponse(response.data, {
          headers: {
            "Content-Type": response.headers["content-type"] || "application/octet-stream",
            "Content-Disposition": response.headers["content-disposition"] || "inline",
            "Content-Length": response.headers["content-length"] || String(response.data.byteLength),
          },
        });
      } catch (error) {
        if (error && typeof error === "object" && "response" in error) {
          const axiosError = error as { response?: { status: number } };
          if (axiosError.response?.status === 404) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
          }
        }
        return NextResponse.json({ error: "Download failed" }, { status: 500 });
      }
    }
    ```
  **Must NOT do**:
  - Do not buffer unnecessarily
  - Do not lose headers from backend response
  **References**: 
  - `frontend/src/app/api/file-storage/route.ts` for pattern
  - `frontend/src/app/api/ai/chat/stream/route.ts` for streaming pattern
  **Verification Method**: Route returns file with correct headers
  **Definition of Done**:
  - [ ] Route created at correct path
  - [ ] Forwards auth token to backend
  - [ ] Uses `responseType: "arraybuffer"`
  - [ ] Preserves Content-Type header
  - [ ] Preserves Content-Disposition header
  - [ ] Supports `?attachment=true` query param

- [ ] 12. Update Frontend Hooks
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `frontend/src/app/hooks/use-file-storage.ts`
  - Update `Document` interface:
    ```typescript
    export interface Document {
      // ... existing fields
      storageUrl?: string | null; // Deprecated, may be null
    }
    ```
  - Add helper function:
    ```typescript
    export function getDownloadUrl(id: string, attachment?: boolean): string {
      const base = `/api/file-storage/${id}/download`;
      return attachment ? `${base}?attachment=true` : base;
    }
    ```
  **Must NOT do**:
  - Do not remove storageUrl from interface (backward compatibility)
  **References**: `frontend/src/app/hooks/use-file-storage.ts`
  **Verification Method**: TypeScript compiles
  **Definition of Done**:
  - [ ] `storageUrl` is optional in Document type
  - [ ] `getDownloadUrl()` helper function added
  - [ ] Helper supports attachment parameter

- [ ] 13. Update Document Preview Modal
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `frontend/src/app/(components)/file-storage/document-preview-modal.tsx`
  - Import `getDownloadUrl` from hooks
  - Replace `document.storageUrl` with `getDownloadUrl(document.id)`:
    - For images: `<img src={getDownloadUrl(document.id)} />`
    - For PDFs: Pass `getDownloadUrl(document.id)` to react-pdf Document component
  - Update download button to use `getDownloadUrl(document.id, true)`
  - Update print handler to use download URL
  **Must NOT do**:
  - Do not reference `storageUrl` directly
  **References**: `frontend/src/app/(components)/file-storage/document-preview-modal.tsx`
  **Verification Method**: Preview displays images and PDFs correctly
  **Definition of Done**:
  - [ ] Images load via download endpoint
  - [ ] PDFs render via download endpoint
  - [ ] Download button uses attachment=true
  - [ ] No references to storageUrl

- [ ] 14. Update Document List Component
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `frontend/src/app/(components)/file-storage/document-list.tsx`
  - Import `getDownloadUrl` from hooks
  - Update `onDownload` handler call to pass document (not URL)
  - Ensure actions use document.id to construct download URL
  **Must NOT do**:
  - Do not reference `storageUrl` directly
  **References**: `frontend/src/app/(components)/file-storage/document-list.tsx`
  **Verification Method**: Download and print actions work
  **Definition of Done**:
  - [ ] Download action uses download endpoint
  - [ ] Print action uses download endpoint
  - [ ] No references to storageUrl

- [ ] 15. Update Documents Page
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Update `frontend/src/app/file-storage/page.tsx`
  - Import `getDownloadUrl` from hooks
  - Update `handleDownload`:
    ```typescript
    const handleDownload = (doc: Document) => {
      window.open(getDownloadUrl(doc.id, true), "_blank");
    };
    ```
  - Update `handlePrint` to use download URL
  - Ensure preview modal receives document (not URL)
  **Must NOT do**:
  - Do not reference `storageUrl` directly
  **References**: `frontend/src/app/file-storage/page.tsx`
  **Verification Method**: All file operations work through download endpoint
  **Definition of Done**:
  - [ ] handleDownload uses getDownloadUrl with attachment=true
  - [ ] handlePrint uses download endpoint
  - [ ] No references to storageUrl

### Phase 4: Verification

- [ ] 16. Build Verification
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Run `cd backend && bun run build`
  - Run `cd frontend && bun run build`
  - Fix any compilation errors
  **Verification Method**: Both commands succeed with no errors
  **Definition of Done**:
  - [ ] Backend builds successfully
  - [ ] Frontend builds successfully
  - [ ] No TypeScript errors

- [ ] 17. Integration Testing
  **Agent Hint**: Paul-Junior
  **What to do**:
  - Test scenarios:
    1. Upload new document (should have null storageUrl)
    2. Download via `/api/file-storage/:id/download` returns file
    3. Preview modal displays images correctly
    4. Preview modal displays PDFs correctly
    5. Download button triggers file download (attachment)
    6. Print functionality works
    7. Existing documents (with storageUrl) still work
  **Verification Method**: All scenarios pass
  **Definition of Done**:
  - [ ] New uploads work without storageUrl
  - [ ] Download endpoint streams files correctly
  - [ ] Image preview works
  - [ ] PDF preview works
  - [ ] Download (attachment) works
  - [ ] Print works
  - [ ] Backward compatible with existing records

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Memory pressure from 25MB files | Acceptable for back-office; can optimize later with streaming |
| Breaking existing records | Keep `storageUrl` optional, not removed |
| PDF rendering issues | Test with various PDF sizes |
| CORS issues | All requests go through Next.js API routes |

---

## Rollback Plan

If issues arise:
1. Revert frontend to check `storageUrl` first, fall back to download endpoint
2. Re-enable `storageUrl` generation in upload use case
3. No database migration needed (field is optional)

---

## Estimated Effort

| Phase | Time |
|-------|------|
| Phase 1: Backend Core | 45 min |
| Phase 2: Remove URL Exposure | 30 min |
| Phase 3: Frontend Changes | 30 min |
| Phase 4: Verification | 15 min |
| **Total** | **~2 hours** |
