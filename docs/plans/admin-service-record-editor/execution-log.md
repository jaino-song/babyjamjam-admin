# 실행 기록

## 2026-09-07 시작

- 사용자 실행 승인: 각 작업 Luna gpt-5.6-luna/max.
- integration: admin-service-record-editor; origin/dev e72140413 fast-forward 후 계획 기록 commit18cd015c9. 최신 검토 중 PDF 조회 및 duration 확인 변경 포함.
- Task0.1 unit: ../admin-service-record-editor-units/task-0-1, branch unit/admin-service-record-0-1. 의존성 frozen/offline 설치 완료. env-bootstrap sibling 복사, env-check exit0(STALE GEMINI_EXTRACTION_MODEL 경고, secrets 출력 없음).
- Luna 조사자: 공식 save-only API/임베디드 경로 읽기 전용 조사.
- Luna 구현자: 정확히 허용된 테스트 문서만 읽는 live API/PDF 검증 harness 작성. 외부 수정은 검토된 요청 후 별도 지시, 광범위 live suite 실행 금지.
- main 독립 UI 검증: 새 is_preview=true 탭에서 영수증 양쪽 서비스 기간20260709~20270104, 수령일2026-07-09, 금액 유지 확인. PDF 저장 UI 클릭했으나 로컬 저장물은 아직 확인되지 않아 PDF 성공으로 기록하지 않음.
- Phase0 자동 저장/출력 통과 전 후속 제품 구현 착수하지 않음. 환경 브랜치 병합/배포는 별도 승인 대상.

### Phase0 중간 결과

- 통합 기준 회귀: mirror service/repository + client duration validation/entity 4suites/74tests 통과.
- 공식 임베딩 지원 경로: mode02 동일 document/template, actionCallback의 btn_draft 확인 후 sendAction(type01/code19), saveSuccess/-1/동일ID 확인. 기존 finalize gates는 전송을 클릭하므로 재사용 금지.
- Luna read-only live probe: 정확한 테스트 문서 detail/PDF 도달. status001, step05, 제공기관 확인; 저장 종료일2027-01-04, 수령일2026-07-09. PDF755118bytes/9pages. API 필드에는 서명 해시 추출 가능한 이미지가 없고 PDF 텍스트 날짜 검색도0이므로 아직 NOT_VERIFIED. 서명 component 조회와 PDF 시각 확인으로 추가 검증.
- 이 상태는 기존 auto-finalize의 단계 기대와 같다고 가정하지 않는다. Phase4.2는 실제 상태001/step05 임시저장 후에도 완료 정책을 정상 수행하는 회귀 사례를 포함해야 한다.
- 원본 서명 이미지 재사용과 벤더 감사 이력 복제는 다르다. 완료 계약 새 문서에는 기존 시각적 서명과 원본 이력 연결을 보존하며, 새로운 서명 동의를 만들어내지 않는다. 기본 new-from가 서명을 제외한다는 사실만으로 시각적 서명 재사용 불가능을 단정하지 않는다.

### Phase0 불일치 확인 — main 독립 PDF 검증

- Luna가 내려받은 `/tmp/contract-date-proof-d54-baseline.pdf`를 main이 Poppler로 렌더링했다. 3페이지 계약 종료일과 7페이지 양쪽 영수증 기간은 여전히2026-12-31이다. 4페이지 이용자 서명은 유지됐다.
- pypdf로 7페이지 텍스트를 다시 읽어 old20261231 존재/new20270104 부재를 확인했다. 따라서 image-only PDF라는 초기 추정은 철회한다. PDF 내용이 구버전인 것이 확인된 실패다.
- UI 임시저장/독립 미리보기/API detail의2027-01-04와 official download PDF의2026-12-31이 불일치한다. `exported_pdf_stale`로 Phase0 미통과. 강제로 전송/완료해서 PDF를 갱신하지 않았다.
- 공식 로컬 OpenAPI download_files에 선언된 매개변수는 file_type/file_name이며, draft/current 강제 재생성 옵션은 확인되지 않았다. 이를 지원 불가능 확정으로 확대하지 않고, 지원 경로 확인 전 제품 자동화는 차단한다.
- browser downloads 내부 페이지 조회는 브라우저 URL 보안 정책에 막혔으며 우회하지 않았다. 이후 증거는 허용된 공식 API 응답 PDF의 로컬 읽기/렌더링으로 확보했다.

### Phase0 결과 통합

- Luna/max Task0.1 읽기 전용 검증 코드를 통합했다: b9d79b5a6. 제품 동작 변경은 없다.
- main 독립 검증: helper 9/9 통과, LIVE_E2E 미설정 시 실제 원격 테스트 skip, 변경 테스트/헬퍼 4파일 ESLint 통과. 허용 문서 외 다운로드, 금액/기간 상충, 구/신 PDF 날짜 혼재를 거부하는 음성 대조 포함.
- 보안 검토: 고정 문서 허용 목록, 읽기 전용 원격 작업, 비밀/서명 원문 미출력, 동적 코드 평가 제거 확인. 원격 저장/전송/완료 및 실제 고객 변경 없음.
- 기존 관련 회귀 74개와 신규 가드 9개 통과는 공식 PDF 최신성 통과를 뜻하지 않는다. 라이브 검증은 exported_pdf_stale로 미통과이며 서명 값 전후 비교도 미검증이다.
- 깨끗한 unit worktree와 통합 완료 unit branch를 제거했다. 통합 작업 브랜치만 유지하고 dev 병합/배포는 수행하지 않았다.
- 전체 backend tsc는 기존 Prisma 생성물/스키마 불일치로 실패했다는 worker 결과를 별도 한계로 기록한다.
- 재현과 상세 관찰은 task-0-1-results.md에 기록했다. Phase1 이후는 지원되는 동일 문서 출력 갱신 경로 확인 전 차단 상태다.
