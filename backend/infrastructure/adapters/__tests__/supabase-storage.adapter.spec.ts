import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";

import {
    StorageSignedUrlError,
    SupabaseStorageAdapter,
} from "../supabase-storage.adapter";

jest.mock("@supabase/supabase-js", () => ({
    createClient: jest.fn(),
}));

type MockSupabaseStorageBucket = {
    createSignedUrl: jest.Mock;
    download: jest.Mock;
    remove: jest.Mock;
    upload: jest.Mock;
};

type MockSupabaseClient = {
    storage: {
        createBucket: jest.Mock;
        from: jest.Mock;
        getBucket: jest.Mock;
    };
};

function createConfigService(overrides: Record<string, string | undefined> = {}): ConfigService {
    return {
        get: jest.fn((key: string) => {
            const values: Record<string, string | undefined> = {
                SUPABASE_SERVICE_KEY: "service-key",
                SUPABASE_URL: "https://example.supabase.co",
                ...overrides,
            };

            return values[key];
        }),
    } as unknown as ConfigService;
}

function createSupabaseMock() {
    const bucket: MockSupabaseStorageBucket = {
        createSignedUrl: jest.fn(),
        download: jest.fn(),
        remove: jest.fn(),
        upload: jest.fn(),
    };

    const client: MockSupabaseClient = {
        storage: {
            createBucket: jest.fn(),
            from: jest.fn(() => bucket),
            getBucket: jest.fn(),
        },
    };

    return { bucket, client };
}

describe("SupabaseStorageAdapter", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("should create a private bucket when the documents bucket is missing", async () => {
        const { client } = createSupabaseMock();
        client.storage.getBucket.mockResolvedValue({
            data: null,
            error: { message: "bucket not found" },
        });
        client.storage.createBucket.mockResolvedValue({
            data: { name: "documents" },
            error: null,
        });
        jest.mocked(createClient).mockReturnValue(client as never);

        const adapter = new SupabaseStorageAdapter(createConfigService());

        await adapter.ensureBucketExists();

        expect(client.storage.createBucket).toHaveBeenCalledWith(
            "documents",
            expect.objectContaining({
                fileSizeLimit: 25 * 1024 * 1024,
                public: false,
            }),
        );
    });

    it("should return a signed URL from upload with the default ttl", async () => {
        const { bucket, client } = createSupabaseMock();
        bucket.upload.mockResolvedValue({
            data: { path: "documents/contract.pdf" },
            error: null,
        });
        bucket.createSignedUrl.mockResolvedValue({
            data: { signedUrl: "https://example.test/signed-contract.pdf" },
            error: null,
        });
        jest.mocked(createClient).mockReturnValue(client as never);

        const adapter = new SupabaseStorageAdapter(
            createConfigService({ STORAGE_SIGNED_URL_TTL_SECONDS: "invalid" }),
        );

        await expect(
            adapter.upload(
                Buffer.from("contract"),
                "documents/contract.pdf",
                "application/pdf",
            ),
        ).resolves.toBe("https://example.test/signed-contract.pdf");

        expect(bucket.createSignedUrl).toHaveBeenCalledWith(
            "documents/contract.pdf",
            300,
        );
    });

    it("should honor the configured signed URL ttl override", async () => {
        const { bucket, client } = createSupabaseMock();
        bucket.createSignedUrl.mockResolvedValue({
            data: { signedUrl: "https://example.test/custom-ttl.pdf" },
            error: null,
        });
        jest.mocked(createClient).mockReturnValue(client as never);

        const adapter = new SupabaseStorageAdapter(
            createConfigService({ STORAGE_SIGNED_URL_TTL_SECONDS: "900" }),
        );

        await expect(
            adapter.createSignedUrl("documents/contract.pdf"),
        ).resolves.toBe("https://example.test/custom-ttl.pdf");

        expect(bucket.createSignedUrl).toHaveBeenCalledWith(
            "documents/contract.pdf",
            900,
        );
    });

    it("should throw a typed error when signed URL creation fails", async () => {
        const { bucket, client } = createSupabaseMock();
        bucket.createSignedUrl.mockResolvedValue({
            data: null,
            error: { message: "permission denied" },
        });
        jest.mocked(createClient).mockReturnValue(client as never);

        const adapter = new SupabaseStorageAdapter(createConfigService());

        await expect(
            adapter.createSignedUrl("documents/contract.pdf"),
        ).rejects.toThrow(StorageSignedUrlError);
        await expect(
            adapter.createSignedUrl("documents/contract.pdf"),
        ).rejects.toThrow(
            'Failed to create signed URL for "documents/contract.pdf": permission denied',
        );
    });
});
