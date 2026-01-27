import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { IFileStoragePort } from "domain/ports/file-storage.port";

@Injectable()
export class SupabaseStorageAdapter implements IFileStoragePort {
  private readonly logger = new Logger(SupabaseStorageAdapter.name);
  private readonly bucketName = "documents";
  private supabase: SupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getClient(): SupabaseClient {
    if (!this.supabase) {
      const url = this.configService.get<string>("SUPABASE_URL");
      const key = this.configService.get<string>("SUPABASE_SERVICE_KEY");

      if (!url || !key) {
        throw new Error("Supabase credentials not configured");
      }

      this.supabase = createClient(url, key);
    }
    return this.supabase;
  }

  async ensureBucketExists(): Promise<void> {
    const client = this.getClient();

    try {
      const { data: buckets, error: listError } =
        await client.storage.listBuckets();

      if (listError) {
        this.logger.error(`Failed to list buckets: ${listError.message}`);
        throw new Error(`Failed to list buckets: ${listError.message}`);
      }

      const bucketExists = buckets?.some(
        (bucket) => bucket.name === this.bucketName,
      );

      if (!bucketExists) {
        this.logger.log(`Creating bucket: ${this.bucketName}`);
        const { error: createError } = await client.storage.createBucket(
          this.bucketName,
          {
            public: false,
            fileSizeLimit: 26214400,
          },
        );

        if (createError) {
          this.logger.error(`Failed to create bucket: ${createError.message}`);
          throw new Error(`Failed to create bucket: ${createError.message}`);
        }

        this.logger.log(`Bucket created successfully: ${this.bucketName}`);
      }
    } catch (error) {
      this.logger.error(`Error ensuring bucket exists: ${error}`);
      throw error;
    }
  }

  async upload(
    file: Buffer,
    path: string,
    mimeType: string,
  ): Promise<string> {
    const client = this.getClient();

    try {
      await this.ensureBucketExists();

      const { data, error } = await client.storage
        .from(this.bucketName)
        .upload(path, file, {
          contentType: mimeType,
          upsert: true,
        });

      if (error) {
        this.logger.error(`Failed to upload file: ${error.message}`);
        throw new Error(`Failed to upload file: ${error.message}`);
      }

      this.logger.log(`File uploaded successfully: ${path}`);
      return data.path;
    } catch (error) {
      this.logger.error(`Error uploading file: ${error}`);
      throw error;
    }
  }

  async delete(path: string): Promise<void> {
    const client = this.getClient();

    try {
      const { error } = await client.storage
        .from(this.bucketName)
        .remove([path]);

      if (error) {
        this.logger.error(`Failed to delete file: ${error.message}`);
        throw new Error(`Failed to delete file: ${error.message}`);
      }

      this.logger.log(`File deleted successfully: ${path}`);
    } catch (error) {
      this.logger.error(`Error deleting file: ${error}`);
      throw error;
    }
  }

  async getPublicUrl(path: string): Promise<string> {
    const client = this.getClient();

    const { data, error } = await client.storage
      .from(this.bucketName)
      .createSignedUrl(path, 604800); // 7 days expiration

    if (error) {
      this.logger.error(`Failed to create signed URL: ${error.message}`);
      throw new Error(`Failed to create signed URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  async download(path: string): Promise<Buffer> {
    const client = this.getClient();

    const { data, error } = await client.storage
      .from(this.bucketName)
      .download(path);

    if (error) {
      this.logger.error(`Failed to download file: ${error.message}`);
      throw new Error(`Failed to download file: ${error.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
