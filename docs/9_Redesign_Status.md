# 재설계 이행 상태 — 마켓 중립 아키텍처

> **Date:** 2026-08-14 (당일 이관·배포 완료)
> **Branch:** main 병합·배포 완료
> **계획 문서:** 8_Architecture_and_Benchmark.md(결정 배경) + 승인된 재설계 계획

## 완료된 것

| Phase | 내용 | 비고 |
|---|---|---|
| 0 | legacy 마이그레이션 17개 → `supabase/migrations/legacy/` 보존, backup 스크립트(`scripts/backup-db.mjs`) | DB 백업 실행은 Supabase 복원 대기 |
| 1 | 새 스키마 `100_core_schema.sql`(코어 12테이블) + `110_studio_schema.sql`(스튜디오 3테이블) + `111_seed_studio_templates.sql`(템플릿 8종) | postgres:15에서 legacy 001-017 전체 체인 위 적용·멱등성 검증 완료. **충돌 legacy 테이블은 `legacy_*`로 리네임 보존** |
| 2 | 마켓 어댑터 레이어 `src/lib/markets/` — 인터페이스 + 네이버 구현 + 쿠팡 스텁(WING 검증 규칙만 실제) | `validateListing`은 순수 함수(준비 안 됨 뱃지) |
| 3 | 서버 액션 재구성 — market-accounts / master-products / listings / bulk(2단계) / market-orders / market-dispatch | `resolveCurrentStoreId` 제거, 마켓은 명시 파라미터 |
| 4 | 재동기화 파이프라인 `market-sync.ts` — 상품(initial=이관)/주문/정산 pull + 재고 push, supplier 재연결은 `legacy_products` SKU·originProductNo 매칭 | **실행·검증은 DB 복원 후** |
| 5 | IA 교체 — 2단계 사이드바, 마켓 필터 칩, 모바일 4탭(주문/발송/재고/더보기) | |
| 6 | 화면 재구성 — /products(마켓 컬럼·마스터-디테일·키보드), /products/[id]/listings(멀티마켓 편집·대조), /products/stock, /orders(클레임), /orders/dispatch(2단계), /orders/purchase(발주), /settlements, /dashboard, 설정 마켓 계정 탭 | |
| 7 | detailpage_maker 이식(/studio/interview·templates) + withus 흡수(placeOrderStatusType 구분, 30건 배치 발송) | |
| 8 | 구 코드 삭제(inventory·구 주문/발송/대시보드 화면, 구 액션 6종, StoreContext), E2E 갱신 | |

## ~~DB 복원 후 해야 하는 것~~ → 2026-08-14 전부 완료

복원이 **새 프로젝트**(`efvooqeffcnuhhaubvjk`)로 이루어져 URL·API 키가 전부 교체됐다.
로컬 `.env.local`·NAS `.env` 갱신 완료(NAS는 `.env.bak-20260814` 백업).
네이버 커머스 API 앱도 새 앱(`1YczNCuXVOy1LJHQrP8aXT`)으로 키 교체.
백업 → 마이그레이션 → 시드 → 계정 이관 → initial 동기화(상품 9, supplier 1) →
E2E 14/14 → main 병합 → ship 배포(healthy)까지 완료. 원래 체크리스트:

1. Supabase 대시보드에서 프로젝트 **Restore** (pause 상태 — DNS NXDOMAIN 확인됨)
2. `node scripts/backup-db.mjs` — 전 테이블 JSON 백업
3. SQL Editor에서 `100_core_schema.sql` → `110_studio_schema.sql` → `111_seed_studio_templates.sql` 순서 적용
4. 설정 > 마켓 계정에서 스마트스토어 계정 생성 + API 키 입력 (legacy stores.api_config 값 재입력)
5. 원본상품 화면에서 "마켓에서 동기화" 실행 (initial 모드 — 마스터 생성 + supplier 재연결)
6. 주문 화면에서 "주문 동기화" 실행, 데이터 검증
7. `npm run test:e2e` — 갱신된 여정 검증
8. 검증 후 `redesign` → `main` 병합, ship 배포
9. Supabase typegen으로 `src/types/redesign.types.ts` 대체, `199_drop_legacy.sql` 작성(legacy_* 테이블 제거) ← **유일하게 남은 항목 (충분히 운영 후)**

## 알려진 잔여 (이번 재설계 범위 밖)

- ~~**스케줄러/cron 자동화**~~ → **2026-08-20 복구 완료**. in-process node-cron은 standalone 빌드에서 아예 기동하지 않았고 legacy 테이블을 참조했다. 이제:
  `lib/sync/engine.ts`(세션 무관 코어) + `lib/sync/due.ts`(순수 due 규칙, 유닛 8개) +
  `/api/cron/sync`(service role, CRON_SECRET 인증, 계정별 due 평가) 구조이고,
  tick은 compose의 `my-store-cron` 사이드카가 5분 간격으로 내부망에서 호출한다
  (DSM 크론은 업데이트 시 초기화되므로 사용하지 않음). 설정 > 자동화 탭에서 계정별
  주기·대상을 관리하고 최근 실행 기록을 본다. 운영에서 자동 실행 검증 완료.
- ~~**AI 기능(OpenAI 키 의존)**~~ → **2026-08-20 Claude 전환 완료**. 프로바이더를 Anthropic
  Claude Haiku 4.5로 바꾸고 키 보관 위치를 legacy `stores.api_config`에서 `user_settings`
  (마이그레이션 120, 사용자당 1행)로 옮겼다. 구조:
  `lib/ai/pricing.ts`(모델·단가·원화 환산, 구 OpenAI 단가는 과거 로그 조회용으로 보존) +
  `lib/ai/claude.ts`(단일 진입점 `callClaude`. 키 없음 → `no_key`, 한도 0 또는 당월 소진 →
  `limit_exceeded` 순으로 **호출 전에** 게이트) + `lib/actions/ai-settings.ts`(설정 CRUD).
  사용량은 기존 `ai_usage_logs`에 그대로 적재하고 당월 합계를 상한과 비교한다(기본 3,000원/월,
  0원이면 AI 전체 비활성). 설정 > AI 탭에서 키 입력·연결 테스트·한도 조정·사용량 확인.
  전환 대상 7곳: `/api/ai/generate`, `/api/ai/analyze`, `/api/ai/test-connection`,
  `/api/analyze/{structure,style,image,extension}`, `lib/actions/interview.ts`.
  이미지 라우트는 `toImageBlock()`으로 data URL·http URL을 Claude 이미지 블록으로 변환한다.
  저장소에 `openai` 패키지 import는 0건이고 의존성도 제거했다.
  Claude에는 `response_format: json_object`가 없으므로 `lib/ai/json.ts`의
  `parseJsonReply()`가 코드펜스·서두 문장을 걷어내고 실패 시 502로 떨어뜨린다
  (구조/스타일 분석은 `temperature: 0.3`, 생성계는 `0.7`로 복원).
  키는 `SECRETS_ENCRYPTION_KEY`가 없으면 **저장을 거부**하고, compose도 그 키 없이는
  기동하지 않는다(`:?`). 상한은 서버 액션과 DB CHECK 양쪽에서 0~100,000원으로 막는다 —
  RLS가 브라우저의 직접 UPDATE를 허용하기 때문. 2026-08-20 마이그레이션 120 적용 및
  NAS 배포 완료(healthy).
- ~~**설정 legacy 탭**~~ → **2026-10-21 이전 완료**. 서비스 연동·알림 탭이 대표 네이버 마켓 계정
  (`lib/markets/primary-account.ts`)을 읽고 쓴다. 아래 2026-10-21 절 참고.
- **네이버 상세편집기(11탭)**: 구 inventory 상세편집기 삭제됨. 옵션·이미지·SEO 등 심화 편집은 새 리스팅 편집기 미지원 — 필요 시 remote_ref 기준으로 이식(네이버 판매자센터로 대체 가능)
- **엑셀 상품 업로드**: excel-upload 액션 삭제. master_products 기준 재구현 필요 시 별도 작업
- ~~**tracking / benchmarking**~~ → **2026-10-21 이전 완료**. 둘 다 실제로는 legacy 테이블을
  참조해 깨져 있었다(아래 절). analysis는 독립 테이블이라 영향 없음.
- **쿠팡 WING API**: 어댑터 스텁 상태. publishListing 등 구현 시 `src/lib/markets/coupang/adapter.ts`만 수정하면 됨

## 2026-09-14 운영 점검 후 개선

리뷰에서 나온 항목을 한 번에 정리했다.

- **cron 실행 기록에 schedule_id 부여**: `runProductSync/runOrderSync/runSettlementSync`에
  `options.scheduleId`를 추가하고 cron 라우트가 스케줄 id를 넘긴다. 행 매핑은 `lib/sync/run-row.ts`
  (`buildSyncRunRow`, 순수 함수·유닛 5개)로 분리. 자동화 탭의 실행 기록에 **자동/수동** 배지 표시.
  배지는 `schedule_id` 유무로 추론하므로 이 변경 이전의 cron 기록과 삭제된 스케줄(FK `ON DELETE SET NULL`)의
  기록은 "수동"으로 보인다 — 90일 보존 정리로 자연히 사라진다.
- **sync_runs 보존 정리**: `lib/sync/retention.ts`(90일, 유닛 3개). cron 라우트가 매 tick 끝에
  `started_at < cutoff` 행을 삭제하고 응답에 `prunedRuns`를 싣는다. 마이그레이션
  `130_sync_runs_retention.sql`이 `started_at` 인덱스를 추가 —
  **대시보드에서 수동 적용 필요**.
- **AI 잔재 제거**: `actions/ai-usage.ts`의 OpenAI 단가표·`calculateCost`·`recordAiUsage`·
  `getTodayUsage`(전부 미사용) 삭제. `market_accounts.api_config`에 남아 있던 `openaiApiKey`를
  DB에서 제거(legacy_stores는 199 drop 때 함께 사라짐).
- **저장소 정리**: 추적되던 `chrome-extension.zip`(1월 빌드, 소스보다 오래됨) 삭제 + ignore.
  `DEPLOY.md`를 실제 경로(ship 스킬 → GHCR → NAS `deploy.sh update`, NPM 프록시, 수동 마이그레이션)로
  다시 씀 — 존재하지 않던 GitHub Actions 절차 삭제.
- **인프라(NAS)**: NPM `custom/server_proxy.conf`에 proxy buffer 상향(로그인 직후 502 원인),
  `cloudflare-ddns` 재기동 + `unless-stopped`.
- **미해결**: 운영 컨테이너 `ANTHROPIC_API_KEY`가 비어 있고 `user_settings`도 0행이라 AI 기능은
  현재 `no_key` 상태. 설정 > AI 탭에서 키를 넣어야 동작한다.

## 2026-10-21 상태 점검 후 개선

점검에서 **DB에 없는 테이블(`stores`·`products`·`delivery_trackings`)을 조회하는 코드**가 남아
운영에서 깨져 있던 것을 확인했다. 마이그레이션 100이 이 셋을 `legacy_*`로 리네임했기 때문.

- **설정·커머스 API**: "스토어"를 사용자의 대표 네이버 마켓 계정(활성 우선, 가장 오래된 것)으로
  해석한다(`getPrimaryNaverAccount`). 기본 정보·커머스 키·NAVER API HUB 키·Discord 웹훅이 모두
  `market_accounts`에 저장된다. `/api/commerce/*`·`/api/trends/*`도 같은 경로로 키를 읽는다.
  **API HUB 키는 legacy에도 없었으므로 쓰려면 설정 > 서비스 연동에서 새로 입력해야 한다.**
- **택배 추적(/tracking)**: 사용자 단위 `delivery_trackings` 테이블을 새로 만들고 legacy 4건을
  이관(마이그레이션 140).
- **벤치마킹 상품 선택**: `master_products` + 네이버 리스팅(`remote_ref` = channelProductNo) 기준.
  `benchmark_sessions.my_product_id` FK를 `master_products`로 옮기고 기존 값을 리스팅으로 매핑.
- **공급업체 상품 수**: `master_products.supplier_id` 기준.
- **죽은 코드 삭제**: `actions/naver-sync.ts`(1,968줄, `testNaverConnection`만 settings로 이동),
  `actions/inquiries.ts`, `/api/cron/check-delivery`(Vercel cron 전용, NAS 미사용),
  `/api/logistics/register`, `lib/logistics/hanjin.ts`, `lib/stores/current-store.ts`,
  `lib/scraper/puppeteer-scraper.ts`(+ puppeteer 패키지 3종).
- **listing_snapshots 보존**: 상품 동기화마다 리스팅당 1행이 쌓여 월 ~6,400행. cron tick이
  `prune_listing_snapshots(cutoff)`(마이그레이션 140, service_role 전용)로 30일 지난 행을 지우되
  리스팅별 최신 1건은 남긴다(앱은 최신만 읽음). 응답에 `prunedSnapshots`.
- **네이버 429 재시도**: `lib/naver/retry.ts` — 429만 최대 2회, Retry-After 또는 지수 백오프+지터,
  최대 5초. 이번 달 `GW.RATE_LIMIT` 실패 2건 대응.
- **Discord 신규 주문 알림 복구**: 웹훅 발송은 삭제된 legacy 주문 동기화에만 있었다. 이제 주문
  동기화 엔진이 새로 저장된 주문 수를 세어(`lib/sync/new-orders.ts`) 계정 알림이 켜져 있으면 보낸다.
- **의존성**: next 16.4.2, `npm audit fix` → 프로덕션 취약점 0건. 남은 high 5건은 eslint 개발
  의존성 전용. `eslint-plugin-react-hooks`는 7.0.1 고정 — 7.1.1의 React Compiler 규칙이 기존
  컴포넌트 15곳(AIGeneratorStudio·settings·tracking 등)을 오류로 잡으므로 별도 리팩터링 후 해제.
- **주문 0건 확인**: 주문 동기화는 매 실행 최근 7일 결제 주문을 상태 필터 없이 가져온다.
  30일간 0건은 실제 주문이 없었던 것(legacy 시절 누적 주문도 1건).
- 마이그레이션 140은 postgres:15에서 legacy 001-017 → 100~130 체인 위 적용·2회 재적용(멱등)·
  데이터 이관 결과를 검증했다. **운영 적용은 코드 배포 전에 대시보드에서.**

## 저장소 정리 (사용자 확인 후 실행)

- `detailpage_maker` — 이식 완료, archive 대상
- `withus_manager` — 선별 흡수 완료, archive 대상
