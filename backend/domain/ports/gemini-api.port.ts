// Gemini API Port Interface
// Port: 도메인 계층에서 외부 API와의 계약 정의

export interface ParsedVoucherPriceData {
  type: string;
  duration: number;
  fullPrice: string;
  grant: string;
  actualPrice: string;
}

export interface ParseImageResult {
  parsedData: ParsedVoucherPriceData[];
  hasValidationWarnings: boolean;
  warnings: string[];
}

export interface IGeminiApiClient {
  /**
   * 바우처 요금표 이미지를 파싱하여 가격 정보 추출
   * @param imageBase64 - Base64 인코딩된 이미지
   * @param mimeType - 이미지 MIME 타입 (image/png, image/jpeg, application/pdf)
   * @returns 파싱된 바우처 가격 정보 배열
   */
  parseVoucherPriceImage(
    imageBase64: string,
    mimeType: string,
  ): Promise<ParsedVoucherPriceData[]>;
}

export const GEMINI_API_CLIENT = "GEMINI_API_CLIENT";
