#!/bin/bash

set -e

APP_NAME="my-store"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

GHCR_USERNAME="${GHCR_USERNAME:-hyunjoonkwak}"
GHCR_USERNAME=$(echo "$GHCR_USERNAME" | tr '[:upper:]' '[:lower:]')
IMAGE_TAG="${IMAGE_TAG:-latest}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_env() {
    if [ ! -f "$APP_DIR/.env" ]; then
        log_warning ".env 파일이 없습니다. .env.example을 복사합니다."
        if [ -f "$APP_DIR/.env.example" ]; then
            cp "$APP_DIR/.env.example" "$APP_DIR/.env"
            log_info ".env 파일을 생성했습니다. 설정을 확인해주세요."
        else
            log_error ".env.example 파일도 없습니다."
            exit 1
        fi
    fi
}

deploy() {
    local no_cache=$1
    log_info "$APP_NAME 로컬 배포 중..."
    check_env

    log_info "기존 컨테이너 중지 중..."
    docker-compose down || true

    log_info "Docker 이미지 빌드 중..."
    if [ "$no_cache" = "no-cache" ]; then
        log_warning "캐시 없이 빌드합니다..."
        docker-compose build --no-cache
    else
        docker-compose build
    fi

    log_info "컨테이너 실행 중..."
    docker-compose up -d

    if [ $? -eq 0 ]; then
        log_success "배포 완료!"
        echo ""
        status
        healthcheck 10 3
    else
        log_error "배포 실패"
        exit 1
    fi
}

start() {
    log_info "$APP_NAME 시작 중..."
    check_env

    docker-compose up -d

    if [ $? -eq 0 ]; then
        log_success "$APP_NAME이(가) 시작되었습니다."
        status
        healthcheck 10 3
    else
        log_error "시작에 실패했습니다."
        exit 1
    fi
}

stop() {
    log_info "$APP_NAME 중지 중..."
    docker-compose down

    if [ $? -eq 0 ]; then
        log_success "$APP_NAME이(가) 중지되었습니다."
    else
        log_error "중지에 실패했습니다."
        exit 1
    fi
}

restart() {
    log_info "$APP_NAME 재시작 중..."
    stop
    sleep 2
    start
}

status() {
    log_info "$APP_NAME 상태:"
    echo ""
    docker-compose ps 2>/dev/null || echo "컨테이너가 실행 중이지 않습니다."
    echo ""
}

healthcheck() {
    local max_attempts=${1:-10}
    local wait_seconds=${2:-3}

    if ! command -v curl &> /dev/null; then
        log_warning "curl이 설치되어 있지 않아 헬스체크를 건너뜁니다."
        return 0
    fi

    log_info "헬스체크 중... (최대 ${max_attempts}회 시도, ${wait_seconds}초 간격)"

    for i in $(seq 1 $max_attempts); do
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3300 2>/dev/null || echo "000")

        if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "302" ] || [ "$HTTP_STATUS" = "307" ]; then
            log_success "애플리케이션이 정상 응답합니다. (HTTP $HTTP_STATUS)"
            log_info "접속: http://localhost:3300"
            return 0
        fi

        if [ $i -lt $max_attempts ]; then
            echo -ne "\r  시도 $i/$max_attempts - 대기 중... (HTTP $HTTP_STATUS)"
            sleep $wait_seconds
        fi
    done

    echo ""
    log_warning "애플리케이션이 아직 준비되지 않았습니다. (HTTP $HTTP_STATUS)"
    log_info "잠시 후 다시 확인하거나 '$0 logs'로 로그를 확인하세요."
    return 1
}

logs() {
    local service=$1

    if [ -z "$service" ]; then
        log_info "$APP_NAME 로그:"
        docker-compose logs -f --tail=100
    else
        log_info "$APP_NAME $service 로그:"
        docker-compose logs -f --tail=100 "$service"
    fi
}

build() {
    local no_cache=$1
    log_info "$APP_NAME 빌드 중..."
    check_env

    if [ "$no_cache" = "no-cache" ]; then
        log_warning "캐시 없이 빌드합니다..."
        docker-compose build --no-cache
    else
        docker-compose build
    fi

    if [ $? -eq 0 ]; then
        log_success "빌드가 완료되었습니다."
    else
        log_error "빌드에 실패했습니다."
        exit 1
    fi
}

dev_update() {
    local no_cache=$1
    log_info "$APP_NAME 로컬 개발 업데이트 중..."

    build "$no_cache"
    restart

    log_success "로컬 개발 업데이트가 완료되었습니다."
}

shell() {
    log_info "컨테이너 셸에 접속합니다..."
    docker-compose exec my-store /bin/sh
}

cleanup() {
    log_info "Docker 리소스 정리 중..."

    docker system prune -f
    docker volume prune -f

    log_success "정리가 완료되었습니다."
}

clean() {
    log_info "컨테이너 및 이미지 정리 중..."

    log_warning "컨테이너 삭제 중..."
    docker-compose down -v || true

    log_warning "사용하지 않는 이미지 삭제 중..."
    docker image prune -f

    log_success "정리 완료!"
}

check_ghcr_login() {
    if grep -q "ghcr.io" ~/.docker/config.json 2>/dev/null; then
        return 0
    fi
    return 1
}

ghcr_login() {
    if check_ghcr_login; then
        log_success "GHCR 이미 로그인됨 (스킵)"
        return 0
    fi

    log_info "GHCR 로그인"
    echo ""
    echo -e "${YELLOW}GitHub Personal Access Token이 필요합니다.${NC}"
    echo ""

    read -p "GitHub 사용자명 [$GHCR_USERNAME]: " input_username
    GHCR_USERNAME="${input_username:-$GHCR_USERNAME}"

    echo -e "${YELLOW}토큰을 입력하세요 (write:packages 권한 필요):${NC}"
    read -s token
    echo ""

    if [ -z "$token" ]; then
        log_error "토큰이 입력되지 않았습니다."
        exit 1
    fi

    echo "$token" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

    if [ $? -eq 0 ]; then
        log_success "GHCR 로그인 성공"
    else
        log_error "GHCR 로그인 실패"
        exit 1
    fi
}

setup_buildx() {
    BUILDER_NAME="multiarch-builder"

    if ! docker buildx inspect "$BUILDER_NAME" &>/dev/null; then
        log_info "Docker Buildx 빌더 생성 중..."
        docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap
    fi

    docker buildx use "$BUILDER_NAME"
    log_success "Buildx 빌더 설정 완료: $BUILDER_NAME"
}

ghcr_build() {
    local tag="${1:-$IMAGE_TAG}"
    local username=$(echo "$GHCR_USERNAME" | tr '[:upper:]' '[:lower:]')
    local platform="${TARGET_PLATFORM:-linux/amd64}"

    log_info "GHCR NAS 전용 이미지 빌드 중..."
    log_info "태그: $tag"
    log_info "플랫폼: $platform"

    # .env.local에서 NEXT_PUBLIC 환경변수 로드
    if [ -f "$APP_DIR/.env.local" ]; then
        log_info ".env.local에서 빌드 환경변수 로드 중..."
        # while-read loop: safe for values with spaces, works on bash 3.2
        # (macOS default), where `source <(...)` fails silently
        while IFS= read -r line || [ -n "$line" ]; do
            case "$line" in
                NEXT_PUBLIC_*=*)
                    key="${line%%=*}"
                    value="${line#*=}"
                    value="${value%\"}"; value="${value#\"}"
                    export "$key=$value"
                    ;;
            esac
        done < "$APP_DIR/.env.local"
    fi

    if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ] || [ -z "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ]; then
        log_error "NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_ANON_KEY가 필요합니다."
        log_info ".env.local 파일에 Supabase 설정을 확인하세요."
        exit 1
    fi

    setup_buildx

    log_info "이미지 빌드 및 푸시 중..."
    docker buildx build \
        --platform "$platform" \
        --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
        --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
        -t "ghcr.io/${username}/my-store:${tag}" \
        --push \
        "$APP_DIR"

    if [ $? -eq 0 ]; then
        log_success "빌드 및 푸시 완료"
        log_info "이미지: ghcr.io/${username}/my-store:${tag}"
    else
        log_error "빌드 실패"
        exit 1
    fi
}

ghcr_push() {
    local tag="${1:-$IMAGE_TAG}"
    IMAGE_TAG="$tag"

    log_info "GHCR에 이미지 푸시 중..."
    log_info "태그: $IMAGE_TAG"

    ghcr_login
    ghcr_build "$tag"

    echo ""
    log_info "NAS에서 배포하려면:"
    echo "  IMAGE_TAG=${IMAGE_TAG} ./deploy.sh update"
}

show_help() {
    echo ""
    echo "=========================================="
    echo "  Store Manager 관리 스크립트"
    echo "=========================================="
    echo ""
    echo "사용법: $0 [명령어]"
    echo ""
    echo -e "${BLUE}=== 로컬 개발 (Docker) ===${NC}"
    echo "  deploy [no-cache]     - 전체 배포 (빌드 + 실행)"
    echo "  start                 - 애플리케이션 시작"
    echo "  stop                  - 애플리케이션 중지"
    echo "  restart               - 애플리케이션 재시작"
    echo "  status                - 상태 확인"
    echo "  logs                  - 로그 보기 (실시간)"
    echo "  build [no-cache]      - Docker 이미지 빌드"
    echo "  dev:update [no-cache] - 빌드 + 재시작 (로컬 수정 테스트용)"
    echo "  health                - 애플리케이션 헬스체크"
    echo ""
    echo -e "${BLUE}=== 유지보수 ===${NC}"
    echo "  shell                 - 컨테이너 셸 접속"
    echo "  cleanup               - Docker 리소스 정리 (볼륨 유지)"
    echo "  clean                 - 컨테이너 및 볼륨 정리"
    echo ""
    echo -e "${BLUE}=== GHCR 배포 (로컬 → NAS) ===${NC}"
    echo "  ghcr:login            - GHCR에 로그인"
    echo "  ghcr:push [tag]       - NAS 전용 이미지 빌드 및 GHCR에 푸시"
    echo ""
    echo -e "${YELLOW}환경 변수:${NC}"
    echo "  GHCR_USERNAME  - GitHub Username (기본: hyunjoonkwak)"
    echo "  IMAGE_TAG      - 이미지 태그 (기본: latest)"
    echo "  TARGET_PLATFORM - NAS 플랫폼 (기본: linux/amd64)"
    echo ""
    echo -e "${YELLOW}예시 (로컬 개발):${NC}"
    echo "  $0 deploy               # 처음 배포"
    echo "  $0 dev:update           # 로컬 수정 후 빌드 + 재시작"
    echo "  $0 dev:update no-cache  # 캐시 없이 빌드 + 재시작"
    echo "  $0 logs                 # 로그 확인"
    echo ""
    echo -e "${YELLOW}예시 (GHCR 배포):${NC}"
    echo "  $0 ghcr:push            # GHCR에 이미지 푸시 (latest)"
    echo "  $0 ghcr:push v1.0.0     # 특정 태그로 푸시"
    echo ""
}

case "$1" in
    deploy)
        deploy "$2"
        ;;
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs "$2"
        ;;
    build)
        build "$2"
        ;;
    dev:update)
        dev_update "$2"
        ;;
    healthcheck|health)
        healthcheck 10 3
        ;;
    shell)
        shell
        ;;
    cleanup)
        cleanup
        ;;
    clean)
        clean
        ;;
    ghcr:login)
        ghcr_login
        ;;
    ghcr:push)
        ghcr_push "$2"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "알 수 없는 명령어: $1"
        show_help
        exit 1
        ;;
esac
