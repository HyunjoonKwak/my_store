# My Store (my_store)

> 2026-10-02 리브랜딩: 옛 이름 Store Manager · store_manager · 저장소 openstore_manager. NAS 폴더·이미지·컨테이너를 my_store / my-store로 바꿨다. 크롬 확장·아이콘 파일·브라우저 저장 키 이름은 그대로다.

> **목표 · 스마트스토어 운영** — 스마트스토어의 주문·재고를 관리하고 AI 상세페이지 생성과 경쟁사 벤치마킹을 한다.  
> **하지 않는 일** — 농장 영농·자금 관리(retirefarm_manager).

스마트스토어 통합 관리 솔루션 - 주문 관리, 재고 관리, AI 상세페이지 생성, 경쟁사 벤치마킹 분석을 한 곳에서.

## 생업·가족 앱의 목표와 경계

| 앱 | 어디서 | 목표 | 하지 않는 일 |
|---|---|---|---|
| **my_store** (이것) | NAS 웹 | **스마트스토어 운영** — 스마트스토어의 주문·재고를 관리하고 AI 상세페이지 생성과 경쟁사 벤치마킹을 한다 | 농장 영농·자금 관리(retirefarm_manager) |
| **[retirefarm_manager](https://github.com/HyunjoonKwak/retirefarm_manager)** | NAS 웹 | **귀농·스마트팜 경영** — 평택 스마트팜(대추방울토마토)의 귀농 준비·자금·영농 기록과 주간 시장 브리핑(가락시장 도매가·경쟁점 판매가)을 관리한다 | 스마트스토어 주문·재고 운영(my_store) |
| **[goe_recruit](https://github.com/HyunjoonKwak/goe_recruit)** | NAS 웹 | **가족 구직** — 아내의 학교 구인구직 검색 — 경기도교육청 채용공고를 모아 보여 주고 새 공고를 텔레그램으로 알린다 | 다른 지역·직군 채용, 지원서 작성 |

도매시장 시세 플랫폼 nongsise_platform은 쓰지 않아 2026-10-01에 보관했다(도매가는 retirefarm_manager가 직접 수집).

## 주요 기능

- **대시보드**: 오늘의 주문, 매출, 재고 현황을 한눈에 확인
- **주문 관리**: 주문 목록 조회, 상태 관리, 배송 처리, 공급업체 발주
- **재고 관리**: 상품별 재고 현황, 입/출고 관리, 저재고 알림
- **공급업체 관리**: 공급업체 정보 관리, 발주 메시지 생성
- **AI 상세페이지 생성**: OpenAI 기반 상품 설명 자동 생성
- **벤치마킹 분석**: 경쟁사 상세페이지 비교, 메모/체크리스트/자료함
- **자동 동기화**: 네이버 스마트스토어 API 연동 (주문/상품 자동 동기화)
- **배송 추적**: 한진/롯데택배 실시간 배송 상태 조회

## 기술 스택

- **Framework**: Next.js 16 (App Router, Server Actions)
- **Language**: TypeScript
- **Styling**: Tailwind CSS, Shadcn/UI
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **AI**: OpenAI GPT-4o
- **Deployment**: Docker (Synology NAS) / GHCR

## 시작하기

### 요구사항

- Node.js 20.9 이상
- npm, yarn, pnpm 중 하나
- Supabase 프로젝트

### 설치

```bash
# 1. 저장소 클론
git clone https://github.com/your-username/my-store.git
cd my-store

# 2. 의존성 설치
npm install

# 3. 환경 변수 설정
cp .env.example .env.local
# .env.local 파일을 열고 값을 채우세요

# 4. 개발 서버 실행
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 확인하세요.

### 환경 변수

`.env.example` 파일을 참고하여 `.env.local`에 아래 값들을 설정하세요:

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase Anonymous Key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase Service Role Key (CRON용) |
| `ANTHROPIC_API_KEY` | ❌ | Claude API Key (개인 키 미설정 시 서버 폴백) |
| `CRON_SECRET` | ✅ | 자동 동기화 및 배송 점검 API 인증 키 |
| `SCHEDULER_SECRET` | ❌ | 스케줄러 관리 API 전용 인증 키 (미설정 시 `CRON_SECRET` 사용) |
| `SCRAPER_ALLOWED_HOSTS` | ❌ | 추가로 허용할 HTTPS 상품 호스트 목록 (쉼표 구분) |
| `COOLSMS_API_KEY` | ❌ | CoolSMS API Key (SMS 알림용) |
| `COOLSMS_API_SECRET` | ❌ | CoolSMS API Secret |
| `COOLSMS_SENDER_ID` | ❌ | 발신번호 |
| `KAKAO_ALIMTALK_API_KEY` | ❌ | 카카오 알림톡 API Key |
| `KAKAO_ALIMTALK_SENDER_ID` | ❌ | 카카오 채널 ID |
| `KAKAO_ALIMTALK_TEMPLATE_ID` | ❌ | 알림톡 템플릿 ID |

## 데이터베이스 설정

Supabase 프로젝트에서 다음 테이블들을 생성해야 합니다:

- `users` - 사용자 정보
- `stores` - 스토어 정보 및 API 설정
- `orders` - 주문 정보
- `products` - 상품 정보
- `suppliers` - 공급업체 정보
- `supplier_order_items` - 발주 내역
- `couriers` - 택배사 정보
- `sync_schedules` - 동기화 스케줄
- `detail_pages` - AI 생성 상세페이지
- `analysis_logs` - 벤치마킹 분석 로그

자세한 스키마는 `docs/4_Database_Design.md`를 참고하세요.

## 프로젝트 구조

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # 인증 관련 페이지 (로그인, 회원가입)
│   ├── (dashboard)/       # 대시보드 페이지들
│   │   ├── dashboard/     # 메인 대시보드
│   │   ├── orders/        # 주문 관리
│   │   ├── inventory/     # 재고 관리
│   │   ├── suppliers/     # 공급업체 관리
│   │   ├── ai-generator/  # AI 상세페이지 생성
│   │   ├── benchmarking/  # 벤치마킹 분석
│   │   ├── analysis/      # 분석 결과
│   │   └── settings/      # 설정
│   └── api/               # API Routes
├── components/            # React 컴포넌트
│   ├── ui/               # Shadcn/UI 컴포넌트
│   ├── layouts/          # 레이아웃 컴포넌트
│   └── dashboard/        # 대시보드 전용 컴포넌트
├── lib/                   # 유틸리티 및 라이브러리
│   ├── actions/          # Server Actions
│   ├── supabase/         # Supabase 클라이언트
│   ├── notifications/    # 알림 (SMS, 카카오)
│   └── logistics/        # 물류 API (한진)
├── contexts/             # React Context
└── types/                # TypeScript 타입 정의
```

## 배포

### Docker 배포 (Synology NAS)

GHCR(GitHub Container Registry)를 사용한 Docker 배포를 지원합니다.

#### 로컬에서 이미지 빌드 및 푸시

```bash
./manage.sh ghcr:login    # GHCR 로그인 (최초 1회)
./manage.sh ghcr:push     # Synology NAS용 linux/amd64 이미지 빌드 및 푸시
```

#### NAS에서 배포

```bash
./deploy.sh login         # GHCR 로그인 (최초 1회)
./deploy.sh update        # 이미지 풀 + 배포
```

#### 관리 명령어

```bash
# 로컬 (Mac)
./manage.sh deploy        # 로컬 Docker 배포
./manage.sh ghcr:push     # GHCR에 이미지 푸시
./manage.sh logs          # 로그 확인
./manage.sh status        # 상태 확인

# NAS
./deploy.sh update        # 최신 이미지로 업데이트
./deploy.sh restart       # 재시작
./deploy.sh logs          # 로그 확인
./deploy.sh status        # 상태 확인
```

자세한 배포 가이드는 [DEPLOY.md](DEPLOY.md)를 참고하세요.

## 스크립트

```bash
npm run dev      # 개발 서버 실행
npm run build    # 프로덕션 빌드
npm run start    # 프로덕션 서버 실행
npm run lint     # ESLint 검사
npm test         # 보안 정책 단위 테스트
```

## 문서

자세한 문서는 `docs/` 폴더를 참고하세요:

- `1_PRD.md` - 제품 요구사항 정의
- `2_TRD.md` - 기술 요구사항 정의
- `3_User_Flow.md` - 사용자 플로우
- `4_Database_Design.md` - 데이터베이스 설계
- `5_Design_System.md` - 디자인 시스템
- `6_TASKS.md` - 구현 태스크
- `7_Coding_Guide.md` - 코딩 가이드
- `DEPLOY.md` - Docker/NAS 배포 가이드

## 라이선스

MIT License
