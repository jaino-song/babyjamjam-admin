import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  IGeminiApiClient,
  ParsedVoucherPriceData,
} from "domain/ports/gemini-api.port";

@Injectable()
export class GeminiApiClient implements IGeminiApiClient {
  private readonly logger = new Logger(GeminiApiClient.name);
  private readonly model = "gemini-2.5-flash";
  private readonly baseUrl =
    "https://generativelanguage.googleapis.com/v1beta/openai";

  constructor(private readonly configService: ConfigService) {}

  /**
   * Lazy initialization - API 키는 실제 사용 시점에 검증
   */
  private getApiKey(): string {
    const apiKey = this.configService.get<string>("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    return apiKey;
  }

  async parseVoucherPriceImage(
    imageBase64: string,
    mimeType: string,
  ): Promise<ParsedVoucherPriceData[]> {
    const prompt = this.buildPrompt();

    try {
      const apiKey = this.getApiKey();
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 16384,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Gemini API error: ${response.status} - ${errorText}`);
        throw new Error(`Gemini API request failed: ${response.status}`);
      }

      const data = await response.json();
      return this.parseGeminiResponse(data);
    } catch (error) {
      this.logger.error(`Failed to parse voucher image: ${error}`);
      throw error;
    }
  }

  private buildPrompt(): string {
    return `이 이미지는 정부지원 바우처 요금표입니다.

테이블에서 다음 정보를 추출해주세요:
- type: 바우처 유형 (예: "A통합1형", "B통합2형" 등). 대시(-) 제거, ①②③ 같은 기호는 1,2,3 숫자로 변환
- duration: 서비스 기간 (일 수, 숫자만)
- fullPrice: 서비스 가격 (숫자만, 콤마 제거, 원 단위)
- grant: 정부지원금 (숫자만, 콤마 제거, 원 단위)
- actualPrice: 본인부담금 (숫자만, 콤마 제거, 원 단위)

만약 표의 단위가 "천원"이면 모든 금액에 1000을 곱해서 원 단위로 변환해주세요.

JSON 배열 형식으로만 응답해주세요 (설명이나 마크다운 없이):
[
  {
    "type": "A통합1형",
    "duration": 10,
    "fullPrice": "1234000",
    "grant": "1000000",
    "actualPrice": "234000"
  }
]

중요 규칙:
- 숫자에서 콤마(,)와 "원" 기호는 모두 제거
- type에서 하이픈(-) 제거: "A-통합-1형" → "A통합1형"
- 원형숫자 변환: ① → 1, ② → 2, ③ → 3
- duration은 정수
- 모든 가격은 문자열로 반환
- 표의 모든 행을 빠짐없이 추출
- 단축/표준/연장 각각 다른 duration으로 별도 행 생성`;
  }

  private parseGeminiResponse(response: any): ParsedVoucherPriceData[] {
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from Gemini API");
    }

    // JSON 배열 추출 (마크다운 코드 블록 처리)
    let jsonString = content;

    // ```json ... ``` 블록 제거
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1].trim();
    }

    // JSON 배열 찾기
    const jsonArrayMatch = jsonString.match(/\[[\s\S]*\]/);
    if (!jsonArrayMatch) {
      this.logger.error(`Failed to find JSON array in response: ${content}`);
      throw new Error("Failed to parse Gemini response: No JSON array found");
    }

    try {
      const parsed = JSON.parse(jsonArrayMatch[0]) as ParsedVoucherPriceData[];

      // 기본 검증
      if (!Array.isArray(parsed)) {
        throw new Error("Parsed result is not an array");
      }

      // 각 항목 정규화
      return parsed.map((item) => ({
        type: this.normalizeType(item.type),
        duration: Number(item.duration),
        fullPrice: this.normalizePrice(item.fullPrice),
        grant: this.normalizePrice(item.grant),
        actualPrice: this.normalizePrice(item.actualPrice),
      }));
    } catch (parseError) {
      this.logger.error(`JSON parse error: ${parseError}`);
      throw new Error("Failed to parse Gemini response as JSON");
    }
  }

  /**
   * type 정규화: 하이픈 제거, 원형숫자 변환
   */
  private normalizeType(type: string): string {
    return type
      .replace(/-/g, "")
      .replace(/①|➀/g, "1")
      .replace(/②|➁/g, "2")
      .replace(/③|➂/g, "3")
      .trim();
  }

  /**
   * 가격 정규화: 콤마, 원 기호 제거
   */
  private normalizePrice(price: string | number): string {
    const priceStr = String(price);
    return priceStr.replace(/[,원\s]/g, "");
  }
}
