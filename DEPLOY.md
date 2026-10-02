# Synology NAS Docker 배포 가이드

실제 배포 경로는 **로컬 빌드 → GHCR 푸시 → NAS 동기화 → `deploy.sh update`** 이다.
GitHub Actions 워크플로는 없다(`.github/`가 존재하지 않음) — `main`에 push해도 이미지는
자동으로 만들어지지 않으므로 아래 절차를 로컬에서 실행한다.

## 구성 요소

| 항목 | 값 |
|------|-----|
| 이미지 | `ghcr.io/hyunjoonkwak/my_store:latest` (로컬 `manage.sh ghcr:push`가 빌드) |
| NAS 경로 | `/volume1/code_work/my_store` (root 소유, git 아님 — compose·deploy.sh·.env만 둔다) |
| 컨테이너 | `my-store` (포트 `3300→3000`) + `my-store-cron` (5분 간격 `/api/cron/sync` 호출 사이드카) |
| compose | `docker-compose.prod.yml` |
| 외부 접근 | `https://store.specialrisk.me` — Nginx Proxy Manager(host #19) → `192.168.1.113:3300` |
| DB | Supabase 호스티드 프로젝트. CLI 링크 안 됨 → **마이그레이션은 대시보드 SQL Editor에서 수동 적용** |

## 배포 (한 번에)

```bash
# 저장소 루트에서 — ship 스킬이 아래 4단계를 순서대로 실행한다
bash ~/.claude/skills/ship/ship.sh            # 태그 생략 시 latest
bash ~/.claude/skills/ship/ship.sh v1.2.0     # 특정 태그
```

1. `./manage.sh ghcr:push [tag]` — 로컬 buildx로 NAS용 이미지 빌드 + GHCR 푸시
2. `docker-compose.prod.yml`, `deploy.sh`를 NAS로 동기화 (`sudo tee`)
3. NAS에서 `sudo ./deploy.sh update` — 새 이미지 pull → 컨테이너 재생성
4. `docker ps`로 상태 확인

수동으로 나눠서 할 때:

```bash
./manage.sh ghcr:login            # 최초 1회 (GitHub PAT, write:packages)
./manage.sh ghcr:push             # 빌드 + 푸시
scp docker-compose.prod.yml deploy.sh nas:/tmp/ && \
  ssh nas 'sudo mv /tmp/docker-compose.prod.yml /tmp/deploy.sh /volume1/code_work/my_store/'
ssh nas 'cd /volume1/code_work/my_store && sudo ./deploy.sh update'
```

`deploy.sh` 명령: `login` `pull` `deploy` `update` `start` `stop` `restart` `status` `logs [svc]` `clean`

> NAS 비대화형 SSH에는 docker가 PATH에 없다. 직접 실행할 때는 `sudo /usr/local/bin/docker ...` 전체 경로를 쓴다.

## 환경변수 (`/volume1/code_work/my_store/.env`)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=            # cron 라우트가 사용
CRON_SECRET=                          # 사이드카 ↔ /api/cron/sync 인증
SECRETS_ENCRYPTION_KEY=               # 필수. 없으면 compose가 기동을 거부한다 (:?)
ANTHROPIC_API_KEY=                    # 선택. 설정 > AI 탭의 사용자 키가 없을 때 폴백
SCHEDULER_SECRET=                     # 선택
SCRAPER_ALLOWED_HOSTS=                # 선택
COOLSMS_API_KEY= COOLSMS_API_SECRET= COOLSMS_SENDER_ID=                       # 선택(문자)
KAKAO_ALIMTALK_API_KEY= KAKAO_ALIMTALK_SENDER_ID= KAKAO_ALIMTALK_TEMPLATE_ID=  # 선택(알림톡)
```

COOLSMS_*/KAKAO_* 미설정 경고는 무해하다(선택 기능). `.env`를 바꾸면 `sudo ./deploy.sh restart`.

## 마이그레이션

`supabase/migrations/*.sql`은 Supabase 대시보드 → SQL Editor에서 번호 순서대로 수동 적용한다.
새 마이그레이션이 포함된 배포는 **코드 배포 전에** SQL을 먼저 적용한다(코드가 새 컬럼·인덱스를
전제하므로). 적용 여부는 `docs/9_Redesign_Status.md`에 기록한다.

## 자동 동기화 (cron)

- `my-store-cron` 사이드카가 5분마다 `http://my-store:3000/api/cron/sync`를
  `Authorization: Bearer $CRON_SECRET`으로 호출한다. 라우트가 계정별 스케줄의 due 여부를 판단한다.
- 설정 > 자동화 탭에서 계정별 주기·대상을 관리하고 최근 실행 기록(자동/수동 구분)을 본다.
- 실행 기록(`sync_runs`)은 90일 지난 행을 매 tick마다 정리한다(`lib/sync/retention.ts`).
- 강제 실행: `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3300/api/cron/sync?force=1"` (NAS에서)

## 역방향 프록시 (Nginx Proxy Manager)

DSM 내장 역방향 프록시가 아니라 NAS의 `nginx-proxy-manager` 컨테이너(관리 UI `:81`)를 쓴다.

- 프록시 호스트 `store.specialrisk.me` → `http://192.168.1.113:3300`, Force SSL, HTTP/2, Block Exploits
- 인증서: Let's Encrypt `*.specialrisk.me` 와일드카드 (NPM이 자동 갱신)
- `/data/nginx/custom/server_proxy.conf`에 `proxy_buffer_size 16k; proxy_buffers 4 32k;
  proxy_busy_buffers_size 64k;`를 두어 Supabase 세션 쿠키가 큰 응답에서 나던
  `upstream sent too big header` 502를 막는다. NPM UI에서 호스트를 수정해도 이 파일은 유지된다.
- 공인 IP 갱신은 `cloudflare-ddns` 컨테이너(restart: unless-stopped)가 담당한다.

## 문제 해결

```bash
# NAS에서
sudo /usr/local/bin/docker ps --filter name=my-store
sudo /usr/local/bin/docker logs -f my-store --tail 100
sudo /usr/local/bin/docker logs my-store-cron --tail 20
sudo /usr/local/bin/docker exec my-store env | grep -E 'SUPABASE|CRON|SECRETS'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3300/        # 307(로그인 리다이렉트)이면 정상

# NPM 쪽
sudo /usr/local/bin/docker exec nginx-proxy-manager tail -20 /data/logs/proxy-host-19_error.log
```

| 증상 | 원인 / 조치 |
|------|-------------|
| 컨테이너가 바로 종료 | `SECRETS_ENCRYPTION_KEY` 누락 — compose `:?` 가드. `.env` 확인 |
| 로그인 직후 502 한 번 | NPM 버퍼 설정 누락 — 위 `server_proxy.conf` 확인 |
| 자동 동기화가 돌지 않음 | `my-store-cron` 상태, `CRON_SECRET` 일치 여부, 설정 > 자동화 탭 활성화 여부 |
| AI 기능이 `no_key` | 설정 > AI 탭에 키 입력 또는 `.env`의 `ANTHROPIC_API_KEY` |
| 설정 저장 시 "암호화 키" 오류 | `SECRETS_ENCRYPTION_KEY` 확인 |
