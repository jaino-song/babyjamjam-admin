# Aligo 알림톡 API 준비 가이드

이 문서는 Aligo 알림톡 API 연동을 위한 사전 준비 사항을 정리합니다.

---

## 1. Aligo 계정 생성

### 1.1 회원가입
1. [Aligo 스마트문자](https://smartsms.aligo.in/) 접속
2. 회원가입 진행
3. 사업자 인증 완료 (사업자등록증 필요)

### 1.2 API 키 발급
1. 로그인 후 [마이페이지] → [API 연동 설정]
2. API Key 발급 신청
3. 발급된 정보 기록:

```env
# .env에 추가할 값들
ALIGO_API_KEY=발급받은_API_KEY
ALIGO_USER_ID=Aligo_사용자_ID
```

---

## 2. 카카오 비즈니스 채널 설정

### 2.1 카카오톡 채널 생성
1. [카카오 비즈니스](https://business.kakao.com/) 접속
2. [카카오톡 채널] → [새 채널 만들기]
3. 채널 정보 입력 및 개설

### 2.2 채널 검수 및 승인
1. 채널 프로필 완성
2. 비즈니스 채널 전환 신청
3. 카카오 검수 대기 (1-3 영업일)

### 2.3 발신 프로필 등록
1. Aligo 관리자 페이지 접속
2. [알림톡] → [발신프로필 관리]
3. 카카오톡 채널 연동
4. 발급된 발신 프로필 키 기록:

```env
# .env에 추가
ALIGO_SENDER_KEY=발급받은_SENDER_KEY
ALIGO_SENDER_PHONE=발신자_전화번호  # 예: 01012345678
```

---

## 3. 알림톡 템플릿 등록

### 3.1 템플릿 등록 절차
1. Aligo 관리자 → [알림톡] → [템플릿 관리]
2. [템플릿 등록] 클릭
3. 템플릿 내용 작성
4. 카카오 검수 신청 (1-3 영업일)

### 3.2 필요한 템플릿 목록

아래 7개의 템플릿을 등록해야 합니다. 각 템플릿의 `tpl_code`를 기록해두세요.

#### 템플릿 1: 고객 등록 완료 (client_created)
```
[아이미래 인천]
#{고객명}님, 등록이 완료되었습니다.

등록일: #{등록일}
서비스: #{서비스타입}

문의사항은 채널톡으로 연락주세요.
```
- **템플릿 코드**: `TPL_CLIENT_CREATED` (예시, 실제 발급 코드로 교체)
- **변수**: 고객명, 등록일, 서비스타입

#### 템플릿 2: 계약 완료 (contract_signed)
```
[아이미래 인천]
#{고객명}님, 계약이 완료되었습니다.

계약 유형: #{계약유형}
계약일: #{계약일}
서비스 시작일: #{서비스시작일}
담당자: #{담당자명}

감사합니다.
```
- **템플릿 코드**: `TPL_CONTRACT_SIGNED`
- **변수**: 고객명, 계약유형, 계약일, 서비스시작일, 담당자명

#### 템플릿 3: 서비스 시작 D-3 알림 (contract_reminder_3days)
```
[아이미래 인천]
#{고객명}님, 서비스 시작 3일 전입니다.

서비스 시작일: #{서비스시작일}

준비사항이나 문의사항이 있으시면 연락주세요.
```
- **템플릿 코드**: `TPL_REMINDER_3DAYS`
- **변수**: 고객명, 서비스시작일

#### 템플릿 4: 서비스 시작 D-1 알림 (contract_reminder_1day)
```
[아이미래 인천]
#{고객명}님, 내일 서비스가 시작됩니다.

서비스 시작일: #{서비스시작일}

담당자가 방문 예정입니다.
```
- **템플릿 코드**: `TPL_REMINDER_1DAY`
- **변수**: 고객명, 서비스시작일

#### 템플릿 5: 결제 확인 (payment_confirmed)
```
[아이미래 인천]
#{고객명}님, 결제가 확인되었습니다.

결제 금액: #{결제금액}
결제일: #{결제일}
결제 방법: #{결제방법}
서비스 월: #{서비스월}

감사합니다.
```
- **템플릿 코드**: `TPL_PAYMENT_CONFIRMED`
- **변수**: 고객명, 결제금액, 결제일, 결제방법, 서비스월

#### 템플릿 6: 설문조사 요청 (survey_request)
```
[아이미래 인천]
#{고객명}님, 서비스는 만족스러우셨나요?

서비스 종료일: #{서비스종료일}
담당자: #{담당자명}

소중한 의견을 남겨주세요:
#{설문링크}
```
- **템플릿 코드**: `TPL_SURVEY_REQUEST`
- **변수**: 고객명, 서비스종료일, 담당자명, 설문링크
- **버튼**: 웹 링크 버튼 (설문 페이지로 이동)

#### 템플릿 7: 결제 안내 (payment_reminder)
```
[아이미래 인천]
#{고객명}님, 결제 안내드립니다.

등록일: #{등록일}
예상 결제금액: #{예상금액}
결제 기한: #{결제기한}

문의사항은 연락주세요.
```
- **템플릿 코드**: `TPL_PAYMENT_REMINDER`
- **변수**: 고객명, 등록일, 예상금액, 결제기한

### 3.3 템플릿 코드 기록

모든 템플릿이 승인되면, 각 템플릿 코드를 환경변수에 추가합니다:

```env
# 알림톡 템플릿 코드 (카카오 승인 후 발급된 코드로 교체)
ALIGO_TPL_CLIENT_CREATED=TXXXXXX
ALIGO_TPL_CONTRACT_SIGNED=TXXXXXX
ALIGO_TPL_REMINDER_3DAYS=TXXXXXX
ALIGO_TPL_REMINDER_1DAY=TXXXXXX
ALIGO_TPL_PAYMENT_CONFIRMED=TXXXXXX
ALIGO_TPL_SURVEY_REQUEST=TXXXXXX
ALIGO_TPL_PAYMENT_REMINDER=TXXXXXX
```

---

## 4. 환경변수 전체 목록

최종적으로 `.env` 파일에 추가해야 할 모든 환경변수:

```env
# ============================================
# Aligo 알림톡 API 설정
# ============================================

# API 인증 정보
ALIGO_API_URL=https://kakaoapi.aligo.in
ALIGO_API_KEY=발급받은_API_KEY
ALIGO_USER_ID=Aligo_사용자_ID
ALIGO_SENDER_KEY=카카오_발신프로필_키
ALIGO_SENDER_PHONE=발신자_전화번호

# 알림톡 템플릿 코드 (카카오 승인 후 발급)
ALIGO_TPL_CLIENT_CREATED=TXXXXXX
ALIGO_TPL_CONTRACT_SIGNED=TXXXXXX
ALIGO_TPL_REMINDER_3DAYS=TXXXXXX
ALIGO_TPL_REMINDER_1DAY=TXXXXXX
ALIGO_TPL_PAYMENT_CONFIRMED=TXXXXXX
ALIGO_TPL_SURVEY_REQUEST=TXXXXXX
ALIGO_TPL_PAYMENT_REMINDER=TXXXXXX
```

---

## 5. API 테스트

### 5.1 토큰 발급 테스트
```bash
curl -X POST https://kakaoapi.aligo.in/akv10/token/create/30/s/ \
  -d "apikey=YOUR_API_KEY" \
  -d "userid=YOUR_USER_ID"
```

### 5.2 알림톡 발송 테스트
```bash
curl -X POST https://kakaoapi.aligo.in/akv10/alimtalk/send/ \
  -d "apikey=YOUR_API_KEY" \
  -d "userid=YOUR_USER_ID" \
  -d "senderkey=YOUR_SENDER_KEY" \
  -d "tpl_code=YOUR_TEMPLATE_CODE" \
  -d "sender=발신번호" \
  -d "receiver_1=수신번호" \
  -d "subject_1=테스트" \
  -d "message_1=테스트 메시지"
```

### 5.3 예상 응답
```json
{
  "code": 0,
  "message": "성공적으로 전송요청 하였습니다.",
  "info": {
    "type": "AT",
    "mid": 123456789,
    "current": "2025-01-14 01:50:00",
    "unit": 1,
    "total": 1,
    "scnt": 1,
    "fcnt": 0
  }
}
```

---

## 6. 체크리스트

준비 완료 여부를 확인하세요:

- [ ] Aligo 계정 생성 및 사업자 인증
- [ ] API Key 발급
- [ ] 카카오톡 채널 생성
- [ ] 카카오 비즈니스 채널 승인
- [ ] Aligo에서 발신 프로필 연동
- [ ] 템플릿 7개 등록
- [ ] 템플릿 7개 카카오 검수 승인
- [ ] 환경변수 설정 완료
- [ ] API 테스트 성공

---

## 7. 문제 해결

### 7.1 템플릿 검수 반려
- 변수명 형식 확인: `#{변수명}` 형식 사용
- 광고성 문구 제거
- 발신자 정보 명시

### 7.2 발송 실패
- 수신자 번호 형식 확인 (하이픈 없이: 01012345678)
- 발신 프로필 상태 확인
- 템플릿 코드 정확성 확인

### 7.3 인증 오류
- API Key, User ID 확인
- Sender Key 유효성 확인
- IP 화이트리스트 확인 (필요시)

---

## 8. 참고 자료

- [Aligo 알림톡 API 문서](https://smartsms.aligo.in/alimapi.html)
- [카카오 비즈니스 가이드](https://business.kakao.com/)
- [알림톡 템플릿 가이드](https://kakaobusiness.gitbook.io/main/ad/alimtalk/template)

---

**준비가 완료되면 이 문서에 체크리스트를 업데이트하고, 환경변수 파일을 설정해주세요.**
