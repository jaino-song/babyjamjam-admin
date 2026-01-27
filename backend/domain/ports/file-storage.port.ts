// File Storage Port Interface
// Port: 도메인 계층에서 파일 저장소와의 계약 정의

export interface IFileStoragePort {
  /**
   * 파일을 저장소에 업로드
   * @param file - 업로드할 파일 버퍼
   * @param path - 저장 경로
   * @param mimeType - 파일 MIME 타입
   * @returns 저장된 파일의 경로
   */
  upload(file: Buffer, path: string, mimeType: string): Promise<string>;

  /**
   * 저장소에서 파일 삭제
   * @param path - 삭제할 파일 경로
   */
  delete(path: string): Promise<void>;

  /**
   * 파일의 서명된 URL 반환 (7일 유효)
   * @param path - 파일 경로
   * @returns 서명된 접근 URL
   */
  getPublicUrl(path: string): Promise<string>;

  /**
   * 저장소에서 파일 다운로드
   * @param path - 파일 경로
   * @returns 파일 내용 버퍼
   */
  download(path: string): Promise<Buffer>;
}

export const FILE_STORAGE_PORT = 'FILE_STORAGE_PORT';
