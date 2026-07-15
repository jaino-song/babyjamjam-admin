export const FILE_STORAGE_PORT = Symbol('FileStoragePort');

export class FileStorageObjectNotFoundError extends Error {
  constructor(
    public readonly path: string,
    public readonly operation: 'download' | 'signed-url',
  ) {
    super(`File storage object not found during ${operation}: ${path}`);
    this.name = 'FileStorageObjectNotFoundError';
  }
}

export interface FileStoragePort {
  /**
   * upload a file to storage
   * @param file - file buffer
   * @param path - storage path (e.g., "documents/uuid.pdf")
   * @param mimetype - mime type of the file
   * @returns signed url of the uploaded file
   */
  upload(file: Buffer, path: string, mimetype: string): Promise<string>;

  /**
   * delete a file from storage
   * @param path - storage path of the file to delete
   */
  delete(path: string): Promise<void>;

  /**
   * create a signed url for a file
   * @param path - storage path
   * @param ttlSeconds - optional signed url ttl in seconds
   * @returns signed url
   */
  createSignedUrl(path: string, ttlSeconds?: number): Promise<string>;

  /**
   * ensure the storage bucket exists, create if not
   */
  ensureBucketExists(): Promise<void>;

  /**
   * download a file from storage
   * @param path - storage path of the file to download
   * @returns file buffer
   */
  download(path: string): Promise<Buffer>;
}
