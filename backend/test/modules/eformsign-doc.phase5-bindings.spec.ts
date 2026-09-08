import "reflect-metadata";

import { Test } from "@nestjs/testing";
import { MODULE_METADATA } from "@nestjs/common/constants";

import { EformsignDocModule } from "module/eformsign-doc.module";
import {
    SERVICE_RECORD_CONTRACT_REVISION_DISPATCH,
    SERVICE_RECORD_CONTRACT_REVISION_PROVIDER,
    ServiceRecordContractRevisionService,
} from "application/services/service-record-contract-revision.service";
import {
    RECEIPT_LINK_REVISION_PDF_SOURCE,
    RECEIPT_LINK_REVISION_PDF_VERIFIER,
    RECEIPT_LINK_REVISION_RASTERIZER,
    ReceiptLinkRevisionRefreshService,
} from "application/services/receipt-link-revision-refresh.service";
import {
    SERVICE_RECORD_REVISION_OPERATION_COORDINATOR,
    ServiceRecordRevisionDocumentCoordinator,
} from "application/services/service-record-revision-document-coordinator.service";
import {
    REVISION_OPERATION_CAPABILITY_UNVERIFIED,
    UnverifiedReceiptLinkRevisionPdfSource,
    UnverifiedServiceRecordContractRevisionDispatch,
    UnverifiedServiceRecordContractRevisionProvider,
} from "application/services/service-record-revision-unverified-adapters.service";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { RECEIPT_LINK_TOKEN_REPOSITORY } from "domain/repositories/receipt-link-token.repository.interface";
import { SERVICE_RECORD_EDIT_REPOSITORY } from "domain/repositories/service-record-edit.repository.interface";
import { PdfPageRasterizerService } from "infrastructure/pdf/pdf-page-rasterizer.service";
import { ReceiptPdfVerifierService } from "infrastructure/pdf/receipt-pdf-verifier.service";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";

interface Binding {
    provide: unknown;
    useClass?: unknown;
    useExisting?: unknown;
}

function moduleProviders(): unknown[] {
    return Reflect.getMetadata(MODULE_METADATA.PROVIDERS, EformsignDocModule) as unknown[];
}

function moduleImports(): unknown[] {
    return Reflect.getMetadata(MODULE_METADATA.IMPORTS, EformsignDocModule) as unknown[];
}

function bindingFor(token: unknown): Binding | undefined {
    return moduleProviders().find((provider): provider is Binding => (
        typeof provider === "object"
        && provider !== null
        && "provide" in provider
        && (provider as Binding).provide === token
    ));
}

function classProviderPresent(providerClass: unknown): boolean {
    return moduleProviders().some((provider) => provider === providerClass);
}

describe("EformsignDocModule Phase5 revision bindings", () => {
    it("registers the coordinator and all fail-closed/real narrow-port bindings", () => {
        expect(classProviderPresent(ServiceRecordContractRevisionService)).toBe(true);
        expect(classProviderPresent(ReceiptLinkRevisionRefreshService)).toBe(true);
        expect(classProviderPresent(ServiceRecordRevisionDocumentCoordinator)).toBe(true);
        expect(classProviderPresent(UnverifiedServiceRecordContractRevisionProvider)).toBe(true);
        expect(classProviderPresent(UnverifiedServiceRecordContractRevisionDispatch)).toBe(true);
        expect(classProviderPresent(UnverifiedReceiptLinkRevisionPdfSource)).toBe(true);
        expect(classProviderPresent(PdfPageRasterizerService)).toBe(true);
        expect(classProviderPresent(ReceiptPdfVerifierService)).toBe(true);
        expect(classProviderPresent(SupabaseStorageAdapter)).toBe(true);

        expect(bindingFor(SERVICE_RECORD_REVISION_OPERATION_COORDINATOR)).toMatchObject({
            useExisting: ServiceRecordRevisionDocumentCoordinator,
        });
        expect(bindingFor(SERVICE_RECORD_CONTRACT_REVISION_PROVIDER)).toMatchObject({
            useExisting: UnverifiedServiceRecordContractRevisionProvider,
        });
        expect(bindingFor(SERVICE_RECORD_CONTRACT_REVISION_DISPATCH)).toMatchObject({
            useExisting: UnverifiedServiceRecordContractRevisionDispatch,
        });
        expect(bindingFor(RECEIPT_LINK_REVISION_PDF_SOURCE)).toMatchObject({
            useExisting: UnverifiedReceiptLinkRevisionPdfSource,
        });
        expect(bindingFor(RECEIPT_LINK_REVISION_RASTERIZER)).toMatchObject({
            useExisting: PdfPageRasterizerService,
        });
        expect(bindingFor(RECEIPT_LINK_REVISION_PDF_VERIFIER)).toMatchObject({
            useExisting: ReceiptPdfVerifierService,
        });
        expect(bindingFor(FILE_STORAGE_PORT)).toMatchObject({
            useExisting: SupabaseStorageAdapter,
        });
        expect(bindingFor(RECEIPT_LINK_TOKEN_REPOSITORY)).toMatchObject({
            useClass: SbReceiptLinkTokenRepository,
        });

        expect(moduleImports().some((entry) => (
            typeof entry === "function" && entry.name === "ReceiptLinkModule"
        ))).toBe(false);
    });

    it("keeps placeholder adapters incapable of vendor/PDF calls", async () => {
        const provider = new UnverifiedServiceRecordContractRevisionProvider();
        const dispatch = new UnverifiedServiceRecordContractRevisionDispatch();
        const pdfSource = new UnverifiedReceiptLinkRevisionPdfSource();

        await expect(provider.inspectDocument({
            documentId: "doc",
            branchId: "branch",
            clientId: 1,
            revisionId: "revision",
        })).rejects.toThrow(REVISION_OPERATION_CAPABILITY_UNVERIFIED);
        await expect(dispatch.claim({
            branchId: "branch",
            clientId: 1,
            serviceRecordCaseId: "case",
            revisionId: "revision",
            generation: "generation",
            operation: "contract_period",
            step: "prepared",
            inputFingerprint: "fingerprint",
        })).rejects.toThrow(REVISION_OPERATION_CAPABILITY_UNVERIFIED);
        await expect(pdfSource.download({
            branchId: "branch",
            clientId: 1,
            serviceRecordCaseId: "case",
            revisionId: "revision",
            documentStateId: "state",
            generation: "generation",
            documentId: "doc",
            documentVersion: null,
            templateId: "template",
            templateVersion: "v1",
            mirrorGeneration: "mirror",
            eformsignDocId: 1,
        })).rejects.toThrow(REVISION_OPERATION_CAPABILITY_UNVERIFIED);
    });

    it("resolves the token graph with injectable local fakes and without constructing external adapters", async () => {
        const repository = {
            findRevisionDocumentState: jest.fn(),
            createRevisionDocumentState: jest.fn(),
            advanceRevisionDocumentState: jest.fn(),
            retryRevisionDocumentState: jest.fn(),
        };
        const storage = {
            upload: jest.fn(),
            delete: jest.fn(),
            createSignedUrl: jest.fn(),
            ensureBucketExists: jest.fn(),
            download: jest.fn(),
        };
        const rasterizer = { renderPageToPng: jest.fn() };
        const verifier = { verify: jest.fn() };
        const tokenRepository = { promoteReceiptRevisionArtifact: jest.fn() };

        const module = await Test.createTestingModule({
            providers: [
                { provide: SERVICE_RECORD_EDIT_REPOSITORY, useValue: repository },
                { provide: SERVICE_RECORD_CONTRACT_REVISION_PROVIDER, useClass: UnverifiedServiceRecordContractRevisionProvider },
                { provide: SERVICE_RECORD_CONTRACT_REVISION_DISPATCH, useClass: UnverifiedServiceRecordContractRevisionDispatch },
                { provide: RECEIPT_LINK_REVISION_PDF_SOURCE, useClass: UnverifiedReceiptLinkRevisionPdfSource },
                { provide: RECEIPT_LINK_REVISION_RASTERIZER, useValue: rasterizer },
                { provide: RECEIPT_LINK_REVISION_PDF_VERIFIER, useValue: verifier },
                { provide: FILE_STORAGE_PORT, useValue: storage },
                { provide: RECEIPT_LINK_TOKEN_REPOSITORY, useValue: tokenRepository },
                ServiceRecordContractRevisionService,
                ReceiptLinkRevisionRefreshService,
                ServiceRecordRevisionDocumentCoordinator,
                {
                    provide: SERVICE_RECORD_REVISION_OPERATION_COORDINATOR,
                    useExisting: ServiceRecordRevisionDocumentCoordinator,
                },
            ],
        }).compile();

        expect(module.get(SERVICE_RECORD_REVISION_OPERATION_COORDINATOR)).toBe(
            module.get(ServiceRecordRevisionDocumentCoordinator),
        );
        expect(module.get(ServiceRecordContractRevisionService)).toBeInstanceOf(ServiceRecordContractRevisionService);
        expect(module.get(ReceiptLinkRevisionRefreshService)).toBeInstanceOf(ReceiptLinkRevisionRefreshService);
        expect(module.get(RECEIPT_LINK_REVISION_PDF_SOURCE)).toBeInstanceOf(UnverifiedReceiptLinkRevisionPdfSource);
        expect(module.get(FILE_STORAGE_PORT)).toBe(storage);
        expect(module.get(RECEIPT_LINK_REVISION_RASTERIZER)).toBe(rasterizer);
        expect(module.get(RECEIPT_LINK_REVISION_PDF_VERIFIER)).toBe(verifier);
        expect(module.get(RECEIPT_LINK_TOKEN_REPOSITORY)).toBe(tokenRepository);

        await module.close();
    });
});
