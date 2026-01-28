import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FileStoragePort } from '../../domain/ports/file-storage.port';

@Injectable()
export class SupabaseStorageAdapter implements FileStoragePort, OnModuleInit {
  private supabase: SupabaseClient;
  private readonly bucketName = 'documents';

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>(
      'SUPABASE_SERVICE_KEY',
    );

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured',
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  async ensureBucketExists(): Promise<void> {
    const { data, error } = await this.supabase.storage.getBucket(
      this.bucketName,
    );

    if (error && error.message.includes('not found')) {
      const { error: createError } = await this.supabase.storage.createBucket(
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
    const { data, error } = await this.supabase.storage
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
    const { error } = await this.supabase.storage
      .from(this.bucketName)
      .remove([path]);

    if (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  getPublicUrl(path: string): string {
    const { data } = this.supabase.storage
      .from(this.bucketName)
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async download(path: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .download(path);
    if (error) throw new Error(`Failed to download: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
}
