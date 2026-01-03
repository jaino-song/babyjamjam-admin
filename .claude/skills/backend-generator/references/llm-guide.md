# LLM Integration Guide

> **역할**: AI/LLM API 통합 전문가
> **담당**: OpenAI, Claude, Gemini API 연동, 스트리밍, 프롬프트 관리

---

## 🎯 사용 시점 (Trigger)

이 문서를 참조하는 경우:
- "AI 기능 추가해줘"
- "LLM 연동해줘"
- "챗봇 만들어줘"
- implementation-plan.md에 AI Features 포함 시

---

## 📥 Input (필수 정보)

```
□ implementation-plan.md의 AI Features 섹션
  └─ 사용할 Provider (OpenAI, Claude, Gemini)
  └─ 기능 유형 (챗봇, 생성, 분류 등)
  └─ 스트리밍 필요 여부

□ 환경 변수
  └─ OPENAI_API_KEY (OpenAI 선택 시)
  └─ ANTHROPIC_API_KEY (Claude 선택 시)
  └─ GOOGLE_AI_API_KEY (Gemini 선택 시)
```

---

## 📤 Output (생성해야 할 파일)

```
src/modules/ai/
├── domain/
│   ├── types/
│   │   ├── llm-request.type.ts
│   │   └── llm-response.type.ts
│   └── constants/
│       └── prompts.constant.ts
├── application/
│   ├── services/
│   │   └── ai.service.ts
│   └── dtos/
│       ├── chat.dto.ts
│       └── generate.dto.ts
├── infrastructure/
│   └── gateways/
│       ├── openai.gateway.ts      # OpenAI 선택 시
│       ├── claude.gateway.ts      # Claude 선택 시
│       └── gemini.gateway.ts      # Gemini 선택 시
└── presentation/
    └── controllers/
        └── ai.controller.ts
```

---

## 🔧 Provider별 설정

> **공식 문서에서 최신 모델과 가격을 확인하세요.**

### OpenAI

📖 **공식 문서**: https://platform.openai.com/docs/overview

```bash
pnpm add openai
```

### Anthropic (Claude)

📖 **공식 문서**: https://docs.anthropic.com/en/api/getting-started

```bash
pnpm add @anthropic-ai/sdk
```

### Google (Gemini)

📖 **공식 문서**: https://aistudio.google.com/

```bash
pnpm add @google/generative-ai
```

---

## 🔢 구현 순서

### Step 1: 타입 정의

```typescript
// domain/types/llm-request.type.ts
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;     // 0.0 ~ 2.0 (창의성)
  maxTokens?: number;       // 최대 응답 길이
  stream?: boolean;         // 스트리밍 여부
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'content_filter';
}
```

### Step 2: OpenAI Gateway

```typescript
// infrastructure/gateways/openai.gateway.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { LLMRequest, LLMResponse, LLMMessage } from '../../domain/types';

@Injectable()
export class OpenAIGateway {
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(private configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow('OPENAI_API_KEY'),
    });
    this.defaultModel = this.configService.getOrThrow('OPENAI_MODEL');
  }

  /**
   * 일반 응답 (Non-streaming)
   */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 1000,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content ?? '',
      model: response.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: choice.finish_reason as LLMResponse['finishReason'],
    };
  }

  /**
   * 스트리밍 응답
   */
  async *chatStream(request: LLMRequest): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 1000,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}
```

### Step 3: Claude Gateway

```typescript
// infrastructure/gateways/claude.gateway.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { LLMRequest, LLMResponse } from '../../domain/types';

@Injectable()
export class ClaudeGateway {
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(private configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.getOrThrow('ANTHROPIC_API_KEY'),
    });
    this.defaultModel = this.configService.getOrThrow('ANTHROPIC_MODEL');
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    // system 메시지 분리 (Claude는 별도 파라미터)
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    const response = await this.client.messages.create({
      model: request.model ?? this.defaultModel,
      max_tokens: request.maxTokens ?? 1000,
      system: systemMessage?.content,
      messages: otherMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const textBlock = response.content.find((c) => c.type === 'text');

    return {
      content: textBlock?.type === 'text' ? textBlock.text : '',
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<string> {
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    const stream = this.client.messages.stream({
      model: request.model ?? this.defaultModel,
      max_tokens: request.maxTokens ?? 1000,
      system: systemMessage?.content,
      messages: otherMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}
```

### Step 4: Gemini Gateway

```typescript
// infrastructure/gateways/gemini.gateway.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMRequest, LLMResponse } from '../../domain/types';

@Injectable()
export class GeminiGateway {
  private readonly client: GoogleGenerativeAI;
  private readonly defaultModel: string;

  constructor(private configService: ConfigService) {
    this.client = new GoogleGenerativeAI(
      this.configService.getOrThrow('GOOGLE_AI_API_KEY'),
    );
    this.defaultModel = this.configService.getOrThrow('GOOGLE_MODEL');
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = this.client.getGenerativeModel({
      model: request.model ?? this.defaultModel,
    });

    // Gemini 형식으로 변환
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const history = request.messages
      .filter((m) => m.role !== 'system')
      .slice(0, -1)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const lastMessage = request.messages[request.messages.length - 1];

    const chat = model.startChat({
      history,
      systemInstruction: systemMessage?.content,
    });

    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    return {
      content: response.text(),
      model: request.model ?? this.defaultModel,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
      },
      finishReason: 'stop',
    };
  }

  async *chatStream(request: LLMRequest): AsyncGenerator<string> {
    const model = this.client.getGenerativeModel({
      model: request.model ?? this.defaultModel,
    });

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const lastMessage = request.messages[request.messages.length - 1];

    const chat = model.startChat({
      systemInstruction: systemMessage?.content,
    });

    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }
}
```

### Step 5: AI Service

```typescript
// application/services/ai.service.ts
import { Injectable } from '@nestjs/common';
import { OpenAIGateway } from '../../infrastructure/gateways/openai.gateway';
// 또는 ClaudeGateway, GeminiGateway
import type { LLMRequest, LLMResponse } from '../../domain/types';
import { PROMPTS } from '../../domain/constants/prompts.constant';

@Injectable()
export class AIService {
  constructor(private readonly llmGateway: OpenAIGateway) {}

  /**
   * 일반 채팅
   */
  async chat(userMessage: string, history: LLMMessage[] = []): Promise<string> {
    const response = await this.llmGateway.chat({
      messages: [
        { role: 'system', content: PROMPTS.CHAT_SYSTEM },
        ...history,
        { role: 'user', content: userMessage },
      ],
    });

    return response.content;
  }

  /**
   * 텍스트 요약
   */
  async summarize(text: string): Promise<string> {
    const response = await this.llmGateway.chat({
      messages: [
        { role: 'system', content: PROMPTS.SUMMARIZE_SYSTEM },
        { role: 'user', content: text },
      ],
      temperature: 0.3, // 낮은 창의성 = 일관된 요약
    });

    return response.content;
  }

  /**
   * 감정 분류
   */
  async classifySentiment(text: string): Promise<'positive' | 'negative' | 'neutral'> {
    const response = await this.llmGateway.chat({
      messages: [
        { role: 'system', content: PROMPTS.SENTIMENT_SYSTEM },
        { role: 'user', content: text },
      ],
      temperature: 0, // 결정적 응답
    });

    const result = response.content.toLowerCase().trim();
    if (result.includes('positive')) return 'positive';
    if (result.includes('negative')) return 'negative';
    return 'neutral';
  }

  /**
   * 스트리밍 채팅 (Generator)
   */
  async *chatStream(userMessage: string, history: LLMMessage[] = []): AsyncGenerator<string> {
    yield* this.llmGateway.chatStream({
      messages: [
        { role: 'system', content: PROMPTS.CHAT_SYSTEM },
        ...history,
        { role: 'user', content: userMessage },
      ],
    });
  }
}
```

### Step 6: 프롬프트 상수

```typescript
// domain/constants/prompts.constant.ts
export const PROMPTS = {
  CHAT_SYSTEM: `당신은 친절하고 도움이 되는 AI 어시스턴트입니다.
- 명확하고 간결하게 답변하세요.
- 모르는 것은 모른다고 말하세요.
- 한국어로 답변하세요.`,

  SUMMARIZE_SYSTEM: `당신은 텍스트 요약 전문가입니다.
- 핵심 내용만 추출하세요.
- 원문의 의미를 왜곡하지 마세요.
- 3-5문장으로 요약하세요.`,

  SENTIMENT_SYSTEM: `텍스트의 감정을 분류하세요.
반드시 다음 중 하나만 응답하세요: positive, negative, neutral
다른 설명 없이 단어 하나만 응답하세요.`,

  CONTENT_GENERATOR_SYSTEM: `당신은 콘텐츠 작성 전문가입니다.
- SEO에 최적화된 콘텐츠를 작성하세요.
- 읽기 쉽고 매력적인 문체를 사용하세요.`,
} as const;
```

### Step 7: Controller (스트리밍 지원)

```typescript
// presentation/controllers/ai.controller.ts
import {
  Controller,
  Post,
  Body,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { AIService } from '../../application/services/ai.service';
import { ChatDto, SummarizeDto } from '../../application/dtos';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AIController {
  constructor(private readonly aiService: AIService) {}

  /**
   * 일반 채팅 (Non-streaming)
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(@Body() dto: ChatDto) {
    const response = await this.aiService.chat(dto.message, dto.history);
    return { response };
  }

  /**
   * 스트리밍 채팅 (SSE)
   */
  @Post('chat/stream')
  async chatStream(@Body() dto: ChatDto, @Res() res: Response) {
    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const chunk of this.aiService.chatStream(dto.message, dto.history)) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    } finally {
      res.end();
    }
  }

  /**
   * 텍스트 요약
   */
  @Post('summarize')
  @HttpCode(HttpStatus.OK)
  async summarize(@Body() dto: SummarizeDto) {
    const summary = await this.aiService.summarize(dto.text);
    return { summary };
  }

  /**
   * 감정 분류
   */
  @Post('sentiment')
  @HttpCode(HttpStatus.OK)
  async sentiment(@Body() dto: { text: string }) {
    const sentiment = await this.aiService.classifySentiment(dto.text);
    return { sentiment };
  }
}
```

### Step 8: DTO 정의

```typescript
// application/dtos/chat.dto.ts
import { IsString, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class MessageDto {
  @IsString()
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class ChatDto {
  @IsString()
  message: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  @IsOptional()
  history?: MessageDto[];
}

export class SummarizeDto {
  @IsString()
  text: string;
}
```

---

## 🌐 Frontend 스트리밍 연동

### React Hook (SSE)

```typescript
// features/ai/hooks/use-chat-stream.ts
import { useState, useCallback } from 'react';

export function useChatStream() {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const sendMessage = useCallback(async (message: string) => {
    // 유저 메시지 추가
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setIsStreaming(true);

    // 빈 assistant 메시지 추가 (스트리밍용)
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const response = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: messages }),
        credentials: 'include',
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.content) {
              // 마지막 메시지에 content 추가
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: updated[lastIdx].content + data.content,
                };
                return updated;
              });
            }

            if (data.done) {
              setIsStreaming(false);
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error);
      setIsStreaming(false);
    }
  }, [messages]);

  return { messages, sendMessage, isStreaming };
}
```

---

## ❌ Anti-Patterns (절대 금지!)

### 1. API Key 클라이언트 노출

```typescript
// ❌ BAD - 클라이언트에서 직접 호출
const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY, // ❌ 노출!
});
```

**왜 안 되는가:**
- API Key가 브라우저에 노출
- 누구나 무제한 사용 가능 → 요금 폭탄

```typescript
// ✅ GOOD - 백엔드에서만 API 호출
// Frontend → Backend → OpenAI
await fetch('/api/ai/chat', { body: JSON.stringify({ message }) });
```

---

### 2. 에러 처리 누락

```typescript
// ❌ BAD - try-catch 없음
async chat(message: string) {
  const response = await this.openai.chat.completions.create({ ... });
  return response.choices[0].message.content;
}
```

**왜 안 되는가:**
- Rate limit, timeout 등 에러 발생 가능
- 서버 크래시 위험

```typescript
// ✅ GOOD - 에러 처리 + 재시도
async chat(message: string, retries = 3): Promise<string> {
  try {
    const response = await this.openai.chat.completions.create({ ... });
    return response.choices[0].message.content ?? '';
  } catch (error) {
    if (error.status === 429 && retries > 0) {
      // Rate limit: 잠시 후 재시도
      await this.delay(1000);
      return this.chat(message, retries - 1);
    }
    throw new LLMException(error.message);
  }
}
```

---

### 3. 토큰 한도 무시

```typescript
// ❌ BAD - 긴 텍스트 그대로 전송
async summarize(text: string) {
  return this.llmGateway.chat({
    messages: [{ role: 'user', content: text }], // 10만 자 텍스트?
  });
}
```

**왜 안 되는가:**
- 모델별 컨텍스트 한도 초과
- 비용 급증

```typescript
// ✅ GOOD - 텍스트 분할 또는 제한
async summarize(text: string) {
  const MAX_CHARS = 10000;
  const truncated = text.slice(0, MAX_CHARS);

  return this.llmGateway.chat({
    messages: [{ role: 'user', content: truncated }],
  });
}
```

---

### 4. 프롬프트 하드코딩

```typescript
// ❌ BAD - 서비스 코드에 프롬프트 산재
async chat(message: string) {
  return this.llmGateway.chat({
    messages: [
      { role: 'system', content: '당신은 친절한 AI입니다...' }, // ❌
      { role: 'user', content: message },
    ],
  });
}
```

**왜 안 되는가:**
- 프롬프트 수정 시 코드 전체 검색 필요
- 버전 관리 어려움

```typescript
// ✅ GOOD - 상수 파일로 분리
import { PROMPTS } from '../../domain/constants/prompts.constant';

async chat(message: string) {
  return this.llmGateway.chat({
    messages: [
      { role: 'system', content: PROMPTS.CHAT_SYSTEM },
      { role: 'user', content: message },
    ],
  });
}
```

---

### 5. 사용량 제한 없음

```typescript
// ❌ BAD - 무제한 호출 허용
@Post('chat')
async chat(@Body() dto: ChatDto) {
  return this.aiService.chat(dto.message); // 누구나 무제한!
}
```

```typescript
// ✅ GOOD - Rate Limiting 적용
@Post('chat')
@UseGuards(JwtAuthGuard, ThrottlerGuard)  // IP/User별 제한
@Throttle({ default: { limit: 20, ttl: 60000 } }) // 분당 20회
async chat(@Body() dto: ChatDto, @CurrentUser() user: UserPayload) {
  // 추가: 일일 한도 체크
  const dailyUsage = await this.usageService.getDailyUsage(user.id);
  if (dailyUsage >= 100) {
    throw new TooManyRequestsException('Daily limit exceeded');
  }

  return this.aiService.chat(dto.message);
}
```

---

## 📝 환경 변수

```bash
# .env.example

# OpenAI (https://platform.openai.com/docs/overview)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=               # 공식 문서에서 모델명 확인

# Anthropic (https://docs.anthropic.com/en/api/getting-started)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=            # 공식 문서에서 모델명 확인

# Google (https://aistudio.google.com/)
GOOGLE_AI_API_KEY=...
GOOGLE_MODEL=               # 공식 문서에서 모델명 확인

# 공통 설정
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=1000
```

---

## ✅ 검증 체크리스트

### API 보안

- [ ] API Key 환경 변수로 관리
- [ ] 클라이언트에서 직접 호출 금지
- [ ] Rate Limiting 적용

### 에러 처리

- [ ] try-catch로 에러 처리
- [ ] Rate limit 시 재시도 로직
- [ ] 타임아웃 설정

### 비용 관리

- [ ] 토큰 카운팅/로깅
- [ ] 사용량 제한 (일일/월간)
- [ ] 긴 텍스트 분할/제한

### 코드 품질

- [ ] 프롬프트 상수 파일 분리
- [ ] 타입 정의 완료
- [ ] Gateway 패턴 적용

---

## 🔗 다른 문서와의 관계

### 함께 사용
- **backend/nestjs-guide.md** → 모듈 구조
- **backend/security.md** → 인증, Rate Limiting
- **frontend/api-state.md** → 프론트엔드 연동
