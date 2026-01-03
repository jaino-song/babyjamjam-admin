---
name: shared-standards
description: |
  공통 코드 스타일, 테스트, DevOps 가이드 참조 스킬. 다른 스킬에서 필요할 때 참조하는 공유 표준입니다.
  
  트리거: "코드 스타일 가이드 보여줘", "테스트 전략 알려줘", "DevOps 가이드 필요해", "배포 설정 도와줘"
  
  이 스킬은 직접 코드를 생성하지 않고, 다른 스킬에서 참조하는 표준 문서를 제공합니다.
---

# Shared Standards

공통 코드 스타일, 테스트 전략, DevOps 가이드를 제공합니다.

## 참조 문서

| 문서 | 설명 | 로드 시점 |
|------|------|----------|
| `references/code-standards.md` | 코드 스타일 가이드 | 코드 리뷰 시 |
| `references/testing.md` | 테스트 전략 가이드 | 테스트 작성 시 |
| `references/devops.md` | DevOps 가이드 | 배포 설정 시 |

---

## 코드 스타일 (code-standards.md)

- 파일/디렉토리 명명 규칙
- Clean Architecture 디렉토리 구조
- TypeScript 코드 스타일
- Import 순서 규칙
- 주석 규칙 (한국어: 비즈니스 로직, 영어: 기술적 내용)
- 보안 규칙
- 금지 패키지/패턴
- 코드 리뷰 체크리스트

---

## 테스트 전략 (testing.md)

- TDD 사이클 (Red → Green → Refactor)
- 테스트 파일 구조
- 단위 테스트 (Jest)
- 통합 테스트
- E2E 테스트 (Playwright)
- 테스트 커버리지 기준 (비즈니스 로직 80% 이상)
- 테스트 유틸리티

---

## DevOps (devops.md)

- Docker 설정 (Backend/Frontend)
- Docker Compose (개발 환경)
- GitHub Actions CI/CD
- 환경 변수 관리
- 배포 전략 (Vercel, Railway)
- 모니터링 설정
- 보안 설정 (Helmet, Rate Limiting)
- 배포 체크리스트

---

## 다른 스킬에서 참조 방법

테스트 전략이 필요하면:
```
references/testing.md 참조
```

배포 설정이 필요하면:
```
references/devops.md 참조
```

코드 스타일 검토가 필요하면:
```
references/code-standards.md 참조
```

---

## 설계 원칙

1. **독립성**: 이 스킬 없이도 다른 스킬들이 동작
2. **선택적 로드**: 필요할 때만 참조하여 토큰 절약
3. **일관성**: 모든 프로젝트에서 동일한 표준 적용
4. **점진적 도입**: 기존 프로젝트에도 점진적으로 적용 가능

---

## 보호 스크립트

| 스크립트 | 용도 |
|----------|------|
| `scripts/validate-dependencies.py` | 의존성 검증 |
| `scripts/protect-core-files.py` | 핵심 파일 보호 |

---

## 관련 스킬

| 스킬 | 참조 항목 |
|------|----------|
| fullstack-orchestrator | 코드 표준 검증 시 |
| backend-generator | 테스트 전략 참조 |
| frontend-generator | 테스트 전략 참조 |
| mobile-generator | 테스트 전략 참조 |
| admin-generator | DevOps 참조 |
