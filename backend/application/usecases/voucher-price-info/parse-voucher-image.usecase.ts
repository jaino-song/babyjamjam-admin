import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import {
  GEMINI_API_CLIENT,
  IGeminiApiClient,
  ParsedVoucherPriceData,
  ParseImageResult,
} from "domain/ports/gemini-api.port";

interface ValidationResult {
  warnings: string[];
}

@Injectable()
export class ParseVoucherImageUsecase {
  private readonly logger = new Logger(ParseVoucherImageUsecase.name);

  // 허용되는 파일 MIME 타입
  private readonly allowedMimeTypes = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "application/pdf",
  ];

  // 최대 파일 크기 (10MB)
  private readonly maxFileSize = 10 * 1024 * 1024;

  constructor(
    @Inject(GEMINI_API_CLIENT)
    private readonly geminiClient: IGeminiApiClient,
  ) {}

  async execute(file: Express.Multer.File): Promise<ParseImageResult> {
    // 파일 검증
    this.validateFile(file);

    // Base64 변환
    const base64 = file.buffer.toString("base64");

    // Gemini API 호출
    this.logger.log(`Parsing voucher image: ${file.originalname}`);
    const parsedData = await this.geminiClient.parseVoucherPriceImage(
      base64,
      file.mimetype,
    );

    // 파싱 결과 검증
    const validationResult = this.validateParsedData(parsedData);

    this.logger.log(
      `Parsed ${parsedData.length} items with ${validationResult.warnings.length} warnings`,
    );

    return {
      parsedData,
      hasValidationWarnings: validationResult.warnings.length > 0,
      warnings: validationResult.warnings,
    };
  }

  /**
   * 업로드된 파일 검증
   */
  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException("파일이 제공되지 않았습니다.");
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `허용되지 않는 파일 형식입니다. 허용 형식: PNG, JPG, JPEG, PDF`,
      );
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `파일 크기가 10MB를 초과합니다. 현재 크기: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
      );
    }
  }

  /**
   * 파싱된 데이터 검증
   * - 수학적 정합성: fullPrice = grant + actualPrice
   * - 이상값 탐지
   */
  private validateParsedData(data: ParsedVoucherPriceData[]): ValidationResult {
    const warnings: string[] = [];

    if (data.length === 0) {
      warnings.push("파싱된 데이터가 없습니다. 이미지를 확인해주세요.");
      return { warnings };
    }

    data.forEach((item, index) => {
      const rowNum = index + 1;
      const fullPrice = this.parsePrice(item.fullPrice);
      const grant = this.parsePrice(item.grant);
      const actualPrice = this.parsePrice(item.actualPrice);

      // 수학적 정합성 검증: fullPrice = grant + actualPrice
      const expectedSum = grant + actualPrice;
      if (fullPrice !== expectedSum) {
        warnings.push(
          `행 ${rowNum} (${item.type}, ${item.duration}일): ` +
            `가격 계산 불일치 - 서비스가격(${fullPrice.toLocaleString()}) ≠ ` +
            `정부지원금(${grant.toLocaleString()}) + 본인부담금(${actualPrice.toLocaleString()}) = ${expectedSum.toLocaleString()}`,
        );
      }

      // 이상값 탐지: 금액이 0 이하
      if (fullPrice <= 0) {
        warnings.push(
          `행 ${rowNum} (${item.type}): 서비스가격이 0 이하입니다 (${fullPrice})`,
        );
      }

      if (grant < 0) {
        warnings.push(
          `행 ${rowNum} (${item.type}): 정부지원금이 음수입니다 (${grant})`,
        );
      }

      if (actualPrice < 0) {
        warnings.push(
          `행 ${rowNum} (${item.type}): 본인부담금이 음수입니다 (${actualPrice})`,
        );
      }

      // duration 검증
      if (item.duration <= 0) {
        warnings.push(
          `행 ${rowNum} (${item.type}): 서비스 기간이 유효하지 않습니다 (${item.duration}일)`,
        );
      }

      // type 형식 검증 (선택적 - 경고만)
      const typePattern = /^[ABCD](가|통합|라)[123]형$/;
      if (!typePattern.test(item.type)) {
        warnings.push(
          `행 ${rowNum}: type 형식이 예상과 다릅니다 (${item.type}). ` +
            `예상 형식: A통합1형, B가2형 등`,
        );
      }
    });

    return { warnings };
  }

  /**
   * 문자열 가격을 숫자로 변환
   */
  private parsePrice(price: string | number): number {
    const priceStr = String(price).replace(/[,원\s]/g, "");
    const parsed = parseInt(priceStr, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
}
