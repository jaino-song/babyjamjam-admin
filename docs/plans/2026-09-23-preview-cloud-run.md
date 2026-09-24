# Preview 백엔드 Cloud Run 전환 runbook (2026-09-23)

운영자용. Linear **BJJ-341**. preview 백엔드를 AWS Lightsail에서 Google Cloud Run으로 옮기는
결정 기록과 1회성 부트스트랩 → 전환 → 운영 → 롤백 절차 전부다. 순서대로 진행한다.

**관련 파일:** `backend/deploy/cloudrun/service.preview.yaml` · `backend/deploy/cloudrun/sync-secrets.sh` · `.github/workflows/backend-ci.yml` (잡 `deploy-cloudrun`) · `backend/deploy/cloudrun/excluded-keys.txt`

---

## 1. 요약 / 결정 기록 (2026-09-23, BJJ-341)

| 결정 | 내용 | 이유 |
|---|---|---|
| preview 백엔드 → Cloud Run | `babyjamjam-api-preview`, region `asia-northeast3` (서울), min 0 / max 1 인스턴스, concurrency 8, timeout 300s, 1 vCPU / 2Gi | 2026-08-30부터 preview 배포(`preview` push → `deploy-lightsail`)가 AWS OIDC 오류(`PreviewDeployRole` not assumable)로 실패. `preview.api.babyjamjam.com`(54.116.205.74)은 타임아웃 |
| 커스텀 도메인 없음 | 백엔드는 `*.run.app` URL만 사용. `preview.api.babyjamjam.com` **은퇴** | Cloud Run domain mapping은 asia-northeast3 미지원(+ preview stage). global LB 대안은 유휴 ~$18/월 |
| 데이터 호출 경로 | 같은 오리진 Vercel `/api` 경유. Next.js 서버가 `NEXT_PUBLIC_API_BASE_URL`로 백엔드 호출 (`frontend/src/lib/api/client.ts`) | 브라우저가 백엔드 도메인을 몰라도 되는 기존 구조 유지 |
| 카카오 로그인 예외 | preview Vercel의 `NEXT_PUBLIC_API_BASE_URL`을 run.app URL로 직접 지정. `KAKAO_CALLBACK_URL` = `<run.app URL>/auth/kakao/callback` | `frontend/src/app/api/auth/kakao/route.ts`는 브라우저를 백엔드 호스트로 navigate하고, 백엔드가 host-only `kakao_oauth_nonce` 쿠키를 심며(`backend/interface/controllers/auth.controller.ts`), 카카오가 **같은 백엔드 호스트**로 콜백해야 함. 프록시 도메인을 섞으면 nonce 쿠키가 유실됨 |
| maxScale=1 안전 불변식 | Valkey가 없는 첫 버전에서 **절대 1 초과 금지** | `VALKEY_URL` 미설정 시 eformsign operation lock이 in-process만 존재 → 인스턴스가 정확히 하나여야 안전 |
| 스케줄러 OFF | `SCHEDULERS_ENABLED=false`를 매니페스트에 하드코딩(백엔드 기본값은 true — 누락 금지), scheduler lease는 standby(`SCHEDULER_LEASE_MODE=off`), `EFORMSIGN_RECONCILE_ALLOW_UNLOCKED=false`로 reconcile sweep은 preview에서 미실행 | preview에서 발송·잡 중복 방지 (devops 규칙 §5) |
| Aligo SMS 비활성 | `ALIGO_API_KEY`/`ALIGO_USER_ID`/`ALIGO_SENDER_PHONE`을 매니페스트에 빈 값으로 하드코딩 (fallback host `backend/deploy/fallback-server/compose.yml`와 동일 패턴) | Cloud Run은 Aligo에 등록된 고정 발신 IP가 없음 (운영자 결정 2026-09-23). **귀결: Phase 10 SMS 발송 시나리오는 preview에서 실행 불가.** reject된 대안: Direct VPC egress + Cloud NAT 고정 IP를 Aligo에 등록(유휴 ~$4-5/월) — preview에 SMS가 필요해지면 이 경로 |
| 기타 매니페스트 값 | `PRODUCTION_FRONTEND_URL=https://preview.admin.babyjamjam.com` 하드코딩(`NODE_ENV=production`에서 백엔드가 auth redirect를 이 값으로 만듦), `SENTRY_ENVIRONMENT=preview` | 제외 키 목록은 `backend/deploy/cloudrun/excluded-keys.txt`. `SENTRY_DSN`, `AUTH_EMAIL_TOKEN_HMAC_SECRET`은 의도적으로 미배포 — 프로덕션 백엔드 env에도 없고, preview는 프로덕션을 따른다 (§3.7) |
| 프로덕션 무변경 | main → Lightsail / LightNode fallback 경로 그대로 | 이 결정은 preview에만 적용 |

## 2. 아키텍처

```
브라우저 ──▶ Vercel preview (preview.admin.babyjamjam.com / preview.m.admin.babyjamjam.com)
              │  일반 API: 같은 오리진 /api/* → Next.js 서버가 백엔드 호출
              │  (NEXT_PUBLIC_API_BASE_URL = <SERVICE_URL>, frontend/src/lib/api/client.ts)
              ▼
   Cloud Run babyjamjam-api-preview  <SERVICE_URL>  (asia-northeast3)
     min 0 / max 1 · concurrency 8 · timeout 300s · 1 vCPU / 2Gi
              │  Prisma → Supabase pooler (ap-northeast-2, 같은 광역권)
              ▼
   Supabase 공유 DB (preview = prod 데이터, devops-deployment-rules.md §1-4)

예외 — 카카오 로그인 (브라우저가 백엔드 호스트로 직접 이동):
  브라우저 → GET /api/auth/kakao (302) → <SERVICE_URL>/auth/kakao
    → 카카오 동의 → <SERVICE_URL>/auth/kakao/callback  (같은 호스트: host-only nonce 쿠키)
```

## 3. 1회성 부트스트랩

아래 명령은 순서대로 한 번만 실행한다. 모든 블록은 같은 셸 세션에서 이어 실행한다고 가정한다.

```bash
# 공통 변수 (값은 운영자가 채운다 — 실제 프로젝트 번호·billing id를 문서·채팅에 붙이지 않는다)
PROJECT_ID="<gcp-project-id>"
REGION="asia-northeast3"
REPO_OWNER="jaino-song"
REPO="babyjamjam-admin"
```

**순서가 중요한 이유:** 6(서비스 선생성)이 7(시크릿)과 9(첫 CI 배포)보다 앞선다. (a) 카카오
리다이렉트 URI와 `KAKAO_CALLBACK_URL` 시크릿이 서비스의 확정 URL을 필요로 하고, (b) 첫 CI
배포의 `/health/ready` 검증이 공개된 서비스를 때려야 성공하기 때문. 서비스를 먼저 만들어 두면
CI 잡은 `gcloud run services replace`로 같은 서비스를 갱신만 한다.

### 3.1 프로젝트 생성 + billing 연결

```bash
gcloud projects create "$PROJECT_ID"

# billing account id는 운영자가 제공 (플레이스홀더로만 기록)
gcloud billing projects link "$PROJECT_ID" --billing-account="<BILLING_ACCOUNT_ID>"
```

### 3.2 API 활성화

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  iam.googleapis.com \
  --project="$PROJECT_ID"
```

### 3.3 Artifact Registry 저장소 + cleanup policy

preview push마다 이미지가 하나씩 쌓이므로 cleanup policy로 30일(2592000s) 경과 이미지를 삭제하고
최근 10개는 유지한다. **DELETE 규칙이 없는 KEEP-only 정책은 아무것도 지우지 않는다** — 삭제 규칙이
반드시 함께 있어야 한다.

```bash
gcloud artifacts repositories create babyjamjam \
  --repository-format=docker \
  --location="$REGION" \
  --description="babyjamjam backend preview images" \
  --project="$PROJECT_ID"

cat > /tmp/ar-cleanup-policy.json <<'EOF'
[{"name":"delete-old","action":{"type":"Delete"},"condition":{"tagState":"any","olderThan":"2592000s"}},{"name":"keep-recent-10","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":10}}]
EOF

gcloud artifacts repositories set-cleanup-policies babyjamjam \
  --location="$REGION" \
  --policy=/tmp/ar-cleanup-policy.json \
  --project="$PROJECT_ID" \
  --no-dry-run
```

### 3.4 서비스 계정

```bash
# 런타임 SA: Cloud Run 서비스가 쓴다
gcloud iam service-accounts create babyjamjam-preview-runtime \
  --display-name="babyjamjam preview runtime" \
  --project="$PROJECT_ID"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:babyjamjam-preview-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 배포 SA: GitHub Actions가 가장한다
gcloud iam service-accounts create babyjamjam-preview-deployer \
  --display-name="babyjamjam preview deployer (GitHub Actions)" \
  --project="$PROJECT_ID"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:babyjamjam-preview-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.developer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:babyjamjam-preview-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

# 서비스계정 사용자 권한은 프로젝트 전체가 아니라 런타임 SA에만 (최소권한)
gcloud iam service-accounts add-iam-policy-binding \
  babyjamjam-preview-runtime@${PROJECT_ID}.iam.gserviceaccount.com \
  --member="serviceAccount:babyjamjam-preview-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### 3.5 Workload Identity Federation (키 파일 없음)

서비스계정 키 파일은 **어떤 형태로도 만들지 않는다.**

```bash
gcloud iam workload-identity-pools create github \
  --location=global \
  --display-name="GitHub Actions pool" \
  --project="$PROJECT_ID"

gcloud iam workload-identity-pools providers create-oidc babyjamjam-gh \
  --location=global \
  --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='${REPO_OWNER}/${REPO}' && assertion.ref=='refs/heads/preview' && assertion.event_name=='push' && assertion.job_workflow_ref=='${REPO_OWNER}/${REPO}/.github/workflows/backend-ci.yml@refs/heads/preview'" \
  --project="$PROJECT_ID"
```

- `event_name`·`job_workflow_ref` 조건은 2026-09-24 사후 리뷰로 추가됐다: repository+ref만 검사하면
  `preview`에 push할 수 있는 누구나 `id-token: write` 워크플로를 새로 추가해 프로덕션 시크릿을 읽을 수 있다.
  이미 만든 provider는 같은 `--attribute-condition`으로 `gcloud iam workload-identity-pools providers update-oidc babyjamjam-gh --location=global --workload-identity-pool=github --project="$PROJECT_ID"`를 실행해 갱신한다.

- `google.subject` 매핑은 필수다. `attribute.repository`/`attribute.ref`는 attribute condition과
  아래 바인딩에서 쓰인다.
- attribute condition이 이 저장소의 `preview` ref 토큰만 수락한다 (다른 repo/브랜치 토큰 거부).

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud iam service-accounts add-iam-policy-binding \
  babyjamjam-preview-deployer@${PROJECT_ID}.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO_OWNER}/${REPO}"
```

### 3.6 서비스 선생성 (시크릿·첫 CI 배포보다 먼저)

hello 이미지로 서비스를 만들어 두면 CI의 첫 배포는 `replace`가 된다.

```bash
gcloud run deploy babyjamjam-api-preview \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --region="$REGION" \
  --service-account=babyjamjam-preview-runtime@${PROJECT_ID}.iam.gserviceaccount.com \
  --min-instances=0 \
  --max-instances=1 \
  --no-allow-unauthenticated \
  --project="$PROJECT_ID"

# 앱이 자체 JWT 인증을 하므로(unauthenticated 진입은 401) ingress는 공개로 연다 — 오늘과 동일
gcloud run services add-iam-policy-binding babyjamjam-api-preview \
  --region="$REGION" \
  --member=allUsers \
  --role=roles/run.invoker \
  --project="$PROJECT_ID"

SERVICE_URL=$(gcloud run services describe babyjamjam-api-preview \
  --region="$REGION" --format='value(status.url)')
echo "$SERVICE_URL"
```

⚠️ **호스트명 형식을 하나로 고정한다.** Cloud Run은 `https://babyjamjam-api-preview-<hash>.a.run.app`과
`https://babyjamjam-api-preview-<PROJECT_NUMBER>.asia-northeast3.run.app` 두 형태를 모두 내보낼 수
있다. 이 runbook의 이후 단계 전부에서 `SERVICE_URL`(describe 결과) **하나의 값**만 쓴다. 두 형태를
섞으면 카카오 nonce 쿠키가 host-only라 로그인이 깨진다.

### 3.7 시크릿 동기화

먼저 preview env 파일을 만든다. preview는 프로덕션 자격증명을 그대로 쓴다(운영자 결정 2026-09-23):
프로덕션이 LightNode fallback에서 운영되는 동안 프로덕션 호스트의
`/opt/babyjamjam-fallback-server/backend.env`를 기준으로 preview env 파일을 만든다. 값은 절대
문서·채팅에 붙이지 않는다.

**동기화 전 체크리스트:**

- [ ] env 파일은 프로덕션 백엔드 env(프로덕션 호스트 `/opt/babyjamjam-fallback-server/backend.env`,
      프로덕션이 LightNode fallback에서 운영되는 동안)에서 만든다 — preview는 프로덕션과 같은 값
- [ ] preview 전용 오버라이드는 `KAKAO_CALLBACK_URL` 하나만 env 파일에서 바꾼다:
      `${SERVICE_URL}/auth/kakao/callback` (§3.6의 `SERVICE_URL` 그대로). `sync-secrets.sh`는
      `https://<service>.run.app/auth/kakao/callback` 형태가 아니면 exit 1로 거부한다.
      `PRODUCTION_MOBILE_FRONTEND_URL`은 시크릿이 아니라 `service.preview.yaml`의 평문 값
      `https://preview.m.admin.babyjamjam.com`으로 고정되어 있다 (`NODE_ENV=production`에서 모바일 카카오
      로그인이 여기로 redirect하고 CORS도 이 값을 허용하므로, 프로덕션 값이 그대로 복사돼도 preview에 적용되지 않게 함).
      예전 Secret Manager의 `PRODUCTION_MOBILE_FRONTEND_URL` 시크릿은 더 이상 참조되지 않으므로
      이 manifest가 배포된 뒤 `gcloud secrets delete PRODUCTION_MOBILE_FRONTEND_URL --project=$PROJECT_ID`로 지운다.
- [ ] 카카오 디벨로퍼스(Kakao Developers) → 앱 설정에 같은 URI를 Redirect URI로 등록
- [ ] `SENTRY_DSN`과 `AUTH_EMAIL_TOKEN_HMAC_SECRET`는 **일부러 배포하지 않는다** — 프로덕션 백엔드 env에도
      둘 다 없다(프로덕션 호스트 키 목록 확인). `SENTRY_DSN` unset → 프로덕션 백엔드는 Sentry가 꺼져 있고
      preview도 그것을 따른다. `AUTH_EMAIL_TOKEN_HMAC_SECRET` unset →
      `backend/application/services/auth-email-token.service.ts`가 `JWT_SECRET`로 폴백하고, preview는
      프로덕션의 `JWT_SECRET`을 쓰므로 email-token HMAC이 프로덕션과 동일하게 유지된다 — 같은 DB를 공유하므로
      프로덕션의 outbox worker가 자기 시크릿으로 이메일 토큰을 재구성하기 때문에 필수다. 두 키가 env 파일에
      들어 있으면 sync가 exit 3(not-deployed)으로 멈춰 판단을 요구한다 — env 파일에서 빼면 된다
- [ ] `JWT_SECRET` 공유의 귀결: preview가 발급한 JWT도 프로덕션에 유효하다 (같은 DB, 같은 사용자) —
      운영자가 수용함 (2026-09-23)
- [ ] `DATABASE_URL` = Supabase pooler (preview = prod 공유 DB, devops-deployment-rules.md §1-4)
- [ ] Supabase 네트워크 제한(Network Restrictions)이 이 프로젝트에 활성화돼 있는지 확인 — Cloud Run의
      egress IP는 고정되지 않으므로 제한이 켜져 있으면 DB 연결이 막혀 `/health/ready` 검증이 실패한다

```bash
# 드라이런: 시크릿 생성/버전 추가 없이 계획과 누락 키만 검토
backend/deploy/cloudrun/sync-secrets.sh <preview-env-file> "$PROJECT_ID" --dry-run

# 누락(missing/empty) 키와 not-deployed(exit 3) 목록을 전부 해소한 뒤 실동기화
backend/deploy/cloudrun/sync-secrets.sh <preview-env-file> "$PROJECT_ID"
```

- 스크립트는 매니페스트(`service.preview.yaml`)에서 시크릿 이름을 읽고, env 파일을 source하지 않고
  파싱하며, 바뀐 버전만 추가하고, 값을 절대 출력하지 않는다.
- exit 3 = env 파일에 있는데 매니페스트가 배포도 제외(excluded-keys.txt)도 하지 않는 키 목록
  (`not-deployed: KEY`). **키마다 판단한다** — 백엔드가 읽는 키면 매니페스트에 secretKeyRef를
  추가(코드 변경 + PR), 읽지 않는 키면 excluded-keys.txt에 사유와 함께 추가한다. 그 판단 이후에만
  `--allow-undeployed`를 쓴다.

### 3.8 GitHub Repository Variables

GitHub → Settings → Secrets and variables → Actions → **Variables** 탭에 **repository variables**(환경
변수 아님)로 세 개를 만든다. 누락 시 `deploy-cloudrun` 잡이 `GCP bootstrap not done`으로 실패한다.

```bash
# provider 리소스 이름 출력 방법:
gcloud iam workload-identity-pools providers describe babyjamjam-gh \
  --location=global --workload-identity-pool=github \
  --format='value(name)'
# → projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/babyjamjam-gh

gh variable set GCP_PROJECT_ID          --body "$PROJECT_ID"
gh variable set GCP_WIF_PROVIDER        --body "$(gcloud iam workload-identity-pools providers describe babyjamjam-gh --location=global --workload-identity-pool=github --format='value(name)')"
gh variable set GCP_PREVIEW_DEPLOYER_SA --body "babyjamjam-preview-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 3.9 첫 실배포

`deploy-cloudrun`은 부트스트랩만으로는 실행되지 않는다. **BJJ-341이 dev → preview로 승격된 그
push**가 트리거다 (이전 커밋의 CI 런을 재실행하면 그 커밋 시점의 옛 워크플로 파일이 돌아간다).

잡 체인(push to `preview`): `build-lightsail-image` → `wait-database-patches`(같은 커밋의
`apply-preview` DB 패치 게이트) → `resolve-backend-deploy-target`(preview → `cloudrun`으로 해석) →
`deploy-cloudrun`. 잡은 GHCR 이미지를 `docker buildx imagetools create`로
`asia-northeast3-docker.pkg.dev/<project>/babyjamjam/backend:<sha>`에 복사하고, 매니페스트
(`service.preview.yaml`)를 `envsubst '${IMAGE} ${PROJECT_ID}'`로 렌더링해 Artifact Registry
digest로 `gcloud run services replace` 배포한 뒤 다음을 검증한다:

- ready revision과 배포 digest 일치
- maxScale 1 / minScale 0 / concurrency 8 / runtime SA 일치
- `SCHEDULERS_ENABLED=false`, `SCHEDULER_LEASE_MODE=off`
- run.app URL의 `/health/ready` 200 (cold start 감안 ≈90초 재시도)

## 4. 전환 & 수용 검증

```bash
curl -s -o /dev/null -w '%{http_code}\n' "${SERVICE_URL}/health"
curl -s -o /dev/null -w '%{http_code}\n' "${SERVICE_URL}/health/ready"
curl -s -o /dev/null -w '%{http_code}\n' "${SERVICE_URL}/health/lease"
```

Vercel: `preview` 브랜치를 빌드하는 **양쪽 프로젝트**(desktop frontend와 mobile — `mobile/src`도
`NEXT_PUBLIC_API_BASE_URL`을 읽는다)의 **Preview** 환경 env에

```
NEXT_PUBLIC_API_BASE_URL = <SERVICE_URL>
```

을 설정하고 preview를 재배포한다.

수용 기준:

1. `https://preview.admin.babyjamjam.com/api/...` 요청이 Cloud Run에 도착한다 — Cloud Run 요청 로그에서
   해당 요청 확인 (`gcloud run services logs read babyjamjam-api-preview --region="$REGION"`).
2. preview 로그인이 동작한다 — JWT 로그인과 카카오 로그인 둘 다 (카카오는
   `${SERVICE_URL}/auth/kakao/callback`으로 되돌아와 nonce 쿠키가 유실되지 않아야 한다).
3. 두 기준 통과 후 `preview.api.babyjamjam.com` DNS 레코드를 삭제한다 (은퇴).

## 5. 운영

- **QA 중 cold start 제거:** `gcloud run services update babyjamjam-api-preview --region="$REGION" --min-instances=1` — QA가 끝나면 반드시 `--min-instances=0`으로 되돌린다.
- **Phase 10 발송 시나리오**를 preview에서 돌릴 때는 문서의 상한을 준수한다 —
  `docs/error-management-live-verification.md`. 단 Aligo가 비활성이라 SMS 시나리오 자체는 preview에서 실행 불가 (§1).
- **maxScale은 Valkey 도입 전까지 절대 1을 넘지 않는다.** `VALKEY_URL`이 없으면 eformsign
  operation lock이 in-process라 다중 인스턴스는 잠금 위반이다.

## 6. 롤백

코드 롤백 — 이전 리비전으로 트래픽 되돌리기:

```bash
gcloud run revisions list --service=babyjamjam-api-preview --region="$REGION"
gcloud run services update-traffic babyjamjam-api-preview \
  --region="$REGION" \
  --to-revisions <prev-revision>=100
```

⚠️ 다음 preview push가 트래픽을 다시 최신 리비전으로 보내므로 이 되돌림은 그때까지만 유지된다.

전면 철수 (Cloud Run 경로를 포기):

1. 양쪽 Vercel 프로젝트 Preview env의 `NEXT_PUBLIC_API_BASE_URL`을 이전 값으로 복원 + 재배포
2. `gcloud run services delete babyjamjam-api-preview --region="$REGION" --project="$PROJECT_ID"`
3. WIF provider·pool 삭제 (`gcloud iam workload-identity-pools providers delete babyjamjam-gh ...`, `gcloud iam workload-identity-pools delete github ...`)
4. SA 삭제 (`babyjamjam-preview-deployer`, `babyjamjam-preview-runtime`)

## 7. 비용

- **컴퓨팅 유휴 비용 0** — min 0이므로 요청이 없으면 인스턴스가 없고, 과금은 요청 처리 시
  vCPU·메모리 사용 시간과 요청 수·egress로만 발생한다.
- 남는 소액 고정 비용:
  - **Secret Manager** — 무료 활성 버전 6개를 넘는 시크릿마다 ~$0.06/시크릿/월. ~40개 시크릿이므로 월 수천 원 수준.
  - **Artifact Registry** 저장소 요금 — cleanup policy(30일 경과 이미지 삭제 + 최근 10개 유지)로
    상한이 묶여 있다.
- **min=1 상시 가동을 권하지 않는 이유:** 항상 1 vCPU/2Gi 인스턴스가 떠 있어 월 수만 원대 과금이
  새로 생긴다. preview는 QA 세션 외 시간에 트래픽이 없으므로 min=0 + cold start(≈수 초~십 수 초)가
  충분하고, 부족한 기간만 §5의 임시 min=1로 운영한다.

## 8. Secret 버전 정책 (`latest`)

매니페스트의 모든 시크릿은 `latest` 버전을 참조한다. 이것은 preview 한정 절충이다:

- **단순함** — 리비전마다 시크릿 버전을 찔러 넣는 배선이 없다.
- **반영 시점** — 새 시크릿 버전은 다음 cold start(새 리비전 없이도) 또는 다음 배포 리비전부터
  적용된다. min=0이므로 QA 전 `sync-secrets.sh`만 돌리고 인스턴스를 껐다 켜면 값이 바뀐다.
- **주의** — 코드 롤백(`--to-revisions`)은 시크릿을 롤백하지 않는다. 코드와 시크릿이 쌍으로 바뀌는
  변경에서는 시크릿도 이전 값으로 되돌린 뒤 검증한다.

프로덕션(Lightsail)의 env 규칙은 이 문서의 대상이 아니다 — `docs/devops-deployment-rules.md`가 기준이다.
