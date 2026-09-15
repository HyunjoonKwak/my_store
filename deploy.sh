#!/bin/bash

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GHCR_USERNAME="${GHCR_USERNAME:-hyunjoonkwak}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
COMPOSE_FILE="docker-compose.prod.yml"

print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

ghcr_login() {
    print_header "🔐 GHCR 로그인"

    echo -e "${YELLOW}GitHub Personal Access Token이 필요합니다.${NC}"
    echo ""

    read -p "GitHub 사용자명 [$GHCR_USERNAME]: " input_username
    GHCR_USERNAME="${input_username:-$GHCR_USERNAME}"

    echo -e "${YELLOW}토큰을 입력하세요:${NC}"
    read -s token
    echo ""

    echo "$token" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

    if [ $? -eq 0 ]; then
        print_success "GHCR 로그인 성공!"
    else
        print_error "GHCR 로그인 실패"
        exit 1
    fi
}

pull_images() {
    print_header "📥 GHCR 이미지 풀"

    echo -e "${YELLOW}GHCR 사용자: ${GHCR_USERNAME}${NC}"
    echo -e "${YELLOW}이미지 태그: ${IMAGE_TAG}${NC}"
    echo ""

    echo -e "${BLUE}이미지 풀 중...${NC}"
    docker pull ghcr.io/${GHCR_USERNAME}/openstore_manager:${IMAGE_TAG}

    print_success "이미지 풀 완료!"
}

deploy() {
    print_header "🚀 Store Manager 배포"

    # NOTE: 의도적으로 `down`을 쓰지 않는다 — `up -d`가 변경분만 재생성한다.
    #  1) pull 실패 시에도 기존 컨테이너가 계속 서비스된다 (무중단).
    #  2) down의 네트워크 삭제/재생성이 Synology에서 간헐적으로 무관한
    #     컨테이너들의 광역 재시작을 유발한 사례가 있다 (2026-08-05, car_radio).

    echo -e "${YELLOW}컨테이너 시작 중...${NC}"
    GHCR_USERNAME=${GHCR_USERNAME} IMAGE_TAG=${IMAGE_TAG} docker-compose -f ${COMPOSE_FILE} up -d

    print_success "배포 완료!"
    echo ""
    status
}

# 배포 후 태그 없는(dangling) 이미지 정리 — 배포마다 이전 이미지가 남아 19GB까지 쌓인 사례(2026-09-15).
# 실행 중이거나 태그가 있는 이미지는 건드리지 않는다. 실패해도 배포 결과에는 영향 없음.
prune_dangling_images() {
    echo "🧹 태그 없는 이미지 정리 중..."
    docker image prune -f || true
}

update() {
    print_header "🔄 Store Manager 업데이트"

    pull_images
    echo ""
    deploy
    prune_dangling_images
}

start() {
    print_header "▶️  Store Manager 시작"

    GHCR_USERNAME=${GHCR_USERNAME} IMAGE_TAG=${IMAGE_TAG} docker-compose -f ${COMPOSE_FILE} up -d

    print_success "시작 완료!"
    status
}

stop() {
    print_header "⏹️  Store Manager 중지"

    GHCR_USERNAME=${GHCR_USERNAME} IMAGE_TAG=${IMAGE_TAG} docker-compose -f ${COMPOSE_FILE} stop

    print_success "중지 완료!"
}

restart() {
    print_header "🔄 Store Manager 재시작"

    GHCR_USERNAME=${GHCR_USERNAME} IMAGE_TAG=${IMAGE_TAG} docker-compose -f ${COMPOSE_FILE} restart

    print_success "재시작 완료!"
    status
}

status() {
    print_header "📊 Store Manager 상태"

    GHCR_USERNAME=${GHCR_USERNAME} IMAGE_TAG=${IMAGE_TAG} docker-compose -f ${COMPOSE_FILE} ps

    echo ""
    echo -e "${BLUE}🌐 접속 URL:${NC}"
    echo "  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):3300"
}

logs() {
    local service=$1

    if [ -z "$service" ]; then
        print_header "📝 전체 로그"
        GHCR_USERNAME=${GHCR_USERNAME} IMAGE_TAG=${IMAGE_TAG} docker-compose -f ${COMPOSE_FILE} logs -f --tail=100
    else
        print_header "📝 $service 로그"
        GHCR_USERNAME=${GHCR_USERNAME} IMAGE_TAG=${IMAGE_TAG} docker-compose -f ${COMPOSE_FILE} logs -f --tail=100 "$service"
    fi
}

clean() {
    print_header "🧹 Docker 정리"

    echo -e "${YELLOW}컨테이너 삭제 중...${NC}"
    GHCR_USERNAME=${GHCR_USERNAME} IMAGE_TAG=${IMAGE_TAG} docker-compose -f ${COMPOSE_FILE} down -v || true

    echo -e "${YELLOW}사용하지 않는 이미지 삭제 중...${NC}"
    docker image prune -f

    print_success "정리 완료!"
}

show_help() {
    echo -e "${GREEN}Store Manager NAS 배포 스크립트${NC}"
    echo ""
    echo -e "${YELLOW}사용법:${NC}"
    echo "  $0 <명령어> [옵션]"
    echo ""
    echo -e "${BLUE}=== 배포 ===${NC}"
    echo -e "  ${GREEN}login${NC}            GHCR 로그인 (최초 1회)"
    echo -e "  ${GREEN}pull${NC}             GHCR에서 최신 이미지 풀"
    echo -e "  ${GREEN}deploy${NC}           컨테이너 배포"
    echo -e "  ${GREEN}update${NC}           풀 + 배포 (추천)"
    echo ""
    echo -e "${BLUE}=== 관리 ===${NC}"
    echo -e "  ${GREEN}start${NC}            서비스 시작"
    echo -e "  ${GREEN}stop${NC}             서비스 중지"
    echo -e "  ${GREEN}restart${NC}          서비스 재시작"
    echo -e "  ${GREEN}status${NC}           서비스 상태"
    echo -e "  ${GREEN}logs${NC}             로그 확인"
    echo ""
    echo -e "${BLUE}=== 유지보수 ===${NC}"
    echo -e "  ${GREEN}clean${NC}            Docker 정리"
    echo ""
    echo -e "${YELLOW}환경변수:${NC}"
    echo "  GHCR_USERNAME    GitHub 사용자명 (기본: hyunjoonkwak)"
    echo "  IMAGE_TAG        이미지 태그 (기본: latest)"
    echo ""
    echo -e "${YELLOW}예시:${NC}"
    echo "  $0 login                    # GHCR 로그인"
    echo "  $0 update                   # 최신 이미지로 업데이트"
    echo "  IMAGE_TAG=v1.0.0 $0 update  # 특정 버전으로 업데이트"
}

case "${1:-help}" in
    login)
        ghcr_login
        ;;
    pull)
        pull_images
        ;;
    deploy)
        deploy
        ;;
    update)
        update
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
    clean)
        clean
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "알 수 없는 명령어: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
