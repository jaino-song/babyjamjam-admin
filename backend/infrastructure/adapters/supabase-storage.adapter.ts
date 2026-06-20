import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  FileStorageObjectNotFoundError,
  FileStoragePort,
} from '../../domain/ports/file-storage.port';

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

type StorageErrorLike = {
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function isStorageObjectNotFoundError(error: StorageErrorLike): boolean {
  const message =
    typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const status = error.status ?? error.statusCode;

  return (
    message.includes('object not found') ||
    (message.includes('not found') && String(status) === '404')
  );
}

export class StorageSignedUrlError extends Error {
  constructor(path: string, message: string) {
    super(`Failed to create signed URL for "${path}": ${message}`);
    this.name = 'StorageSignedUrlError';
  }
}

@Injectable()
export class SupabaseStorageAdapter implements FileStoragePort, OnModuleInit {
  private supabase: SupabaseClient | null = null;
  private readonly bucketName = 'documents';
  private readonly logger = new Logger(SupabaseStorageAdapter.name);
  private readonly signedUrlTtlSeconds: number;
  private readonly storageBootstrapDisabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.signedUrlTtlSeconds = this.parseSignedUrlTtlSeconds();
    this.storageBootstrapDisabled =
      this.configService.get<string>('STORAGE_BOOTSTRAP_DISABLED') === '1';

    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>(
      'SUPABASE_SERVICE_KEY',
    );

    if (!supabaseUrl || !supabaseServiceKey) {
      this.logger.warn(
        'SUPABASE_URL and SUPABASE_SERVICE_KEY not configured. File storage will be disabled.',
      );
      return;
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  async onModuleInit(): Promise<void> {
    if (!this.supabase) {
      return;
    }

    if (this.storageBootstrapDisabled) {
      this.logger.warn(
        'STORAGE_BOOTSTRAP_DISABLED=1. Skipping Supabase bucket bootstrap.',
      );
      return;
    }

    await this.ensureBucketExists();
  }

  async ensureBucketExists(): Promise<void> {
    const supabase = this.getSupabaseClient();
    const { error } = await supabase.storage.getBucket(this.bucketName);

    if (error && error.message.includes('not found')) {
      const { error: createError } = await supabase.storage.createBucket(
        this.bucketName,
        {
          public: false,
          fileSizeLimit: 25 * 1024 * 1024, // 25MB
        },
      );

      if (createError) {
        throw new Error(`Failed to create bucket: ${createError.message}`);
      }
    } else if (error) {
      throw new Error(`Failed to check bucket: ${error.message}`);
    }
  }

  async upload(
    file: Buffer,
    path: string,
    mimetype: string,
  ): Promise<string> {
    const supabase = this.getSupabaseClient();
    const { error } = await supabase.storage
      .from(this.bucketName)
      .upload(path, file, {
        contentType: mimetype,
        upsert: false,
      });

    if (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }

    return this.createSignedUrl(path);
  }

  async delete(path: string): Promise<void> {
    const supabase = this.getSupabaseClient();
    const { error } = await supabase.storage
      .from(this.bucketName)
      .remove([path]);

    if (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  async createSignedUrl(
    path: string,
    ttlSeconds = this.signedUrlTtlSeconds,
  ): Promise<string> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(this.bucketName)
      .createSignedUrl(path, ttlSeconds);

    if (error) {
      if (isStorageObjectNotFoundError(error)) {
        throw new FileStorageObjectNotFoundError(path, 'signed-url');
      }

      throw new StorageSignedUrlError(path, error.message);
    }

    if (!data?.signedUrl) {
      throw new StorageSignedUrlError(
        path,
        'Supabase did not return a signed URL.',
      );
    }

    return data.signedUrl;
  }

  async download(path: string): Promise<Buffer> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(this.bucketName)
      .download(path);

    if (error) {
      if (isStorageObjectNotFoundError(error)) {
        throw new FileStorageObjectNotFoundError(path, 'download');
      }

      throw new Error(`Failed to download: ${error.message}`);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  private getSupabaseClient(): SupabaseClient {
    if (!this.supabase) {
      throw new Error(
        'File storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable storage operations.',
      );
    }

    return this.supabase;
  }

  private parseSignedUrlTtlSeconds(): number {
    const rawTtl = this.configService.get<string>(
      'STORAGE_SIGNED_URL_TTL_SECONDS',
    );

    if (!rawTtl) {
      return DEFAULT_SIGNED_URL_TTL_SECONDS;
    }

    const parsedTtl = Number(rawTtl);
    if (!Number.isInteger(parsedTtl) || parsedTtl <= 0) {
      this.logger.warn(
        `Invalid STORAGE_SIGNED_URL_TTL_SECONDS="${rawTtl}". Falling back to ${DEFAULT_SIGNED_URL_TTL_SECONDS} seconds.`,
      );
      return DEFAULT_SIGNED_URL_TTL_SECONDS;
    }

    return parsedTtl;
  }
}
