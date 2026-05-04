# eformsign 알림톡(alimtalk) 문제 - 고객센터 문의 요약

## 상황 요약

iframe SDK를 통하지 않고 **OPA API만 사용해서 동일한 문서 발급 기능을 backend에서 직접 처리**하려고 시도했습니다. 하지만 알림톡 dispatch 기능에서 막혔습니다.

---

## 🔴 발견된 문제

### OPA API vs kr-service API의 기능 격차

| 엔드포인트 | 인증 | 지원 기능 | 알림톡 |
|-----------|------|---------|-------|
| **OPA `/v1.0/api/forms/{id}/documents`** | OPA tokens | `approval`, `outsider`, `accept`, `complete` | ❌ 미지원 |
| **kr-service `/v1.0/companies/{C}/forms/{id}/documents`** | OPA tokens | 전체 기능 (alimtalk 포함) | ✅ 지원 |

**결론:** OPA API로는 알림톡 dispatch가 본질적으로 불가능합니다.

### kr-service API의 숨겨진 의존성

kr-service가 alimtalk를 지원하려면 request body에 **OZP 형식의 binary 데이터** (`ozd_file_string`)가 필수입니다.

- OZP: eformsign의 자체 바이너리 형식 (gzip 압축됨)
- 변환 로직: OZ Viewer라는 **browser-side JavaScript 엔진**에서만 처리 가능
- Backend에서 재구현: **불가능** (FORCS 독점 바이너리 포맷)

---

## 🔧 우리가 시도한 것

1. ✅ **OPA 토큰으로 kr-service 접근 가능 확인**
   - OPA에서 받은 access_token + refresh_token으로 kr-service 내부 엔드포인트 호출 성공

2. ✅ **form 메타데이터 조회**
   - kr-service에서 form 정보와 file_id 획득

3. ✅ **binary 파일 다운로드**
   - `/files/{file_id}` 엔드포인트에서 OZW 형식(gzip 압축) 받음 (386KB)

4. ❌ **binary 형식 변환 시도**
   - OZW → OZP 변환 불가능 (OZ Viewer 엔진 필요)
   - 다양한 형식으로 재전송 시도해도 모두 **400 Bad Request (code: 4000070)**

---

## ❓ 고객센터에 필요한 질문/지원

### 질문 1: OPA API의 알림톡 지원 계획
```
OPA /v1.0/api/forms/{id}/documents 엔드포인트에 
alimtalk 등의 workflow feature 지원 계획이 있는지?
```

### 질문 2: backend에서 binary 변환이 가능한지
```
OZW (gzip 압축) → OZP 형식 변환을 
backend/server-side에서 처리할 수 있는 공개된 라이브러리나 
방법이 있는지?

혹은 이미 backend에서 처리하는 다른 integration 사례가 있는지?
```

### 질문 3: 임베드 경로의 공식성
```
현재 우리가 사용 중인 이 경로가 long-term 지원 가능한지:
- iframe SDK (eformsign.com의 지정 도메인에서만 작동)
- OPA tokens로 kr-service 직접 호출

또한 이 경로에서 이후 API 변경 시 공지 받을 수 있는 체계가 있는지?
```

---

## 📋 현재 상태

- **새 OPA 호환 템플릿 2개** 생성됨 (template_id: 1159de2d, 7a632a0c) → 미사용 상태
- **5개의 draft 문서** → 정리 대기 중
- **iframe SDK 경로** → 모든 기능 정상 작동 (alimtalk 포함)

---

## 🎯 임시 솔루션 (고객센터 답변 대기 중)

고객센터의 답변에 따라 다음 중 하나 진행:

1. **Option A (권장):** iframe 유지 + 종료일 게이팅만 구현
   - 사용자가 원하는 비즈니스 로직("종료일 1일 전 staff 입력 + 확정 게이팅")은 iframe 기반에서도 가능
   - 불필요한 OPA 마이그레이션 중단

2. **Option B:** AI chat 발급 경로도 검증 후 필요시 iframe로 회귀

3. **Option C:** backend에서 iframe 옵션만 정리해서 노출

---

## 문의 대상 및 첨부 정보

**eformsign Customer Support에 포함할 정보:**
- 이 문서 전체
- OPA tokens로 kr-service 호출 성공 스크린샷
- kr-service binary 요청에 대한 4000070 에러 응답 로그
