export const FILE_STORAGE_PORT = Symbol('FileStoragePort');

export interface FileStoragePort {
  /**
   * upload a file to storage
   * @param file - file buffer
   * @param path - storage path (e.g., "documents/uuid.pdf")
   * @param mimetype - mime type of the file
   * @returns public url of the uploaded file
   */
  upload(file: Buffer, path: string, mimetype: string): Promise<string>;

  /**
   * delete a file from storage
   * @param path - storage path of the file to delete
   */
  delete(path: string): Promise<void>;

  /**
   * get the public url for a file
   * @param path - storage path
   * @returns public url
   */
  getPublicUrl(path: string): string;

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
