import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FileStoragePort } from '../../domain/ports/file-storage.port';

@Injectable()
export class SupabaseStorageAdapter implements FileStoragePort, OnModuleInit {
  private supabase: SupabaseClient | null = null;
  private readonly bucketName = 'documents';
  private readonly logger = new Logger(SupabaseStorageAdapter.name);

  constructor(private readonly configService: ConfigService) {
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

    await this.ensureBucketExists();
  }

  async ensureBucketExists(): Promise<void> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase.storage.getBucket(
      this.bucketName,
    );

    if (error && error.message.includes('not found')) {
      const { error: createError } = await supabase.storage.createBucket(
        this.bucketName,
        {
          public: true,
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
    const { data, error } = await supabase.storage
      .from(this.bucketName)
      .upload(path, file, {
        contentType: mimetype,
        upsert: false,
      });

    if (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }

    return this.getPublicUrl(path);
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

  getPublicUrl(path: string): string {
    const supabase = this.getSupabaseClient();
    const { data } = supabase.storage
      .from(this.bucketName)
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async download(path: string): Promise<Buffer> {
    const supabase = this.getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(this.bucketName)
      .download(path);
    if (error) throw new Error(`Failed to download: ${error.message}`);
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
}
