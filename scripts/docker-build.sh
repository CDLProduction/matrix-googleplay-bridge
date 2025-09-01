#!/bin/bash
# Matrix Google Play Bridge - Docker Image Build Script
# Comprehensive Docker image building with versioning and optimization

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="matrix-googleplay-bridge"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"
DEFAULT_TAG="${DEFAULT_TAG:-latest}"
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
VERSION=$(grep '"version"' package.json | sed 's/.*"version": "\(.*\)".*/\1/' || echo "0.1.0")

# Build targets
AVAILABLE_TARGETS=("production" "development" "test")
BUILD_TARGET="${1:-production}"

# Logging functions
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

log_step() {
    echo -e "${PURPLE}[STEP]${NC} $1"
}

# Show usage information
show_usage() {
    cat <<EOF
Matrix Google Play Bridge Docker Build Script

Usage: $0 [target] [options]

Build Targets:
  production      Build optimized production image (default)
  development     Build development image with hot reload
  test           Build test image for CI/CD
  all            Build all targets

Options:
  --tag TAG              Tag for the image (default: latest)
  --registry REGISTRY    Docker registry prefix
  --push                 Push image to registry after build
  --no-cache            Build without using cache
  --platform PLATFORMS  Target platforms (e.g., linux/amd64,linux/arm64)
  --version VERSION      Override version from package.json
  --help                Show this help message

Environment Variables:
  DOCKER_REGISTRY       Docker registry prefix
  DEFAULT_TAG           Default tag to use
  DOCKER_BUILDKIT       Enable BuildKit (recommended: 1)

Examples:
  $0                                    # Build production image
  $0 development                        # Build development image
  $0 production --tag v1.0.0           # Build with specific tag
  $0 all --push --registry myregistry  # Build all and push to registry
  $0 production --platform linux/amd64,linux/arm64  # Multi-platform build

Image Tags Created:
  Production: $PROJECT_NAME:latest, $PROJECT_NAME:v$VERSION, $PROJECT_NAME:$GIT_COMMIT
  Development: $PROJECT_NAME:dev, $PROJECT_NAME:dev-$GIT_COMMIT
  Test: $PROJECT_NAME:test, $PROJECT_NAME:test-$GIT_COMMIT
EOF
}

# Check if Docker is available
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running or not accessible"
        exit 1
    fi
    
    log_info "Docker version: $(docker --version)"
    
    # Enable BuildKit for better performance
    export DOCKER_BUILDKIT=1
    log_info "Docker BuildKit enabled"
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --tag)
                DEFAULT_TAG="$2"
                shift 2
                ;;
            --registry)
                DOCKER_REGISTRY="$2"
                shift 2
                ;;
            --push)
                PUSH_IMAGE=true
                shift
                ;;
            --no-cache)
                NO_CACHE="--no-cache"
                shift
                ;;
            --platform)
                PLATFORM="--platform $2"
                shift 2
                ;;
            --version)
                VERSION="$2"
                shift 2
                ;;
            --help)
                show_usage
                exit 0
                ;;
            production|development|test|all)
                BUILD_TARGET="$1"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
}

# Validate build target
validate_target() {
    if [[ "$BUILD_TARGET" != "all" ]] && [[ ! " ${AVAILABLE_TARGETS[@]} " =~ " ${BUILD_TARGET} " ]]; then
        log_error "Invalid build target: $BUILD_TARGET"
        log_error "Available targets: ${AVAILABLE_TARGETS[*]} all"
        exit 1
    fi
}

# Generate image tags
generate_tags() {
    local target="$1"
    local base_name="${DOCKER_REGISTRY:+$DOCKER_REGISTRY/}$PROJECT_NAME"
    
    case "$target" in
        production)
            TAGS=(
                "$base_name:$DEFAULT_TAG"
                "$base_name:v$VERSION"
                "$base_name:$GIT_COMMIT"
            )
            ;;
        development)
            TAGS=(
                "$base_name:dev"
                "$base_name:dev-$GIT_COMMIT"
            )
            ;;
        test)
            TAGS=(
                "$base_name:test"
                "$base_name:test-$GIT_COMMIT"
            )
            ;;
    esac
}

# Build Docker image
build_image() {
    local target="$1"
    log_step "Building $target image..."
    
    generate_tags "$target"
    
    # Prepare build arguments
    local build_args=(
        --target "$target"
        $NO_CACHE
        $PLATFORM
        --build-arg "BUILD_DATE=$BUILD_DATE"
        --build-arg "GIT_COMMIT=$GIT_COMMIT"
        --build-arg "VERSION=$VERSION"
        --label "org.opencontainers.image.created=$BUILD_DATE"
        --label "org.opencontainers.image.version=$VERSION"
        --label "org.opencontainers.image.revision=$GIT_COMMIT"
        --label "org.opencontainers.image.title=$PROJECT_NAME"
        --label "org.opencontainers.image.description=Matrix Google Play Bridge"
        --label "org.opencontainers.image.source=https://github.com/CDLProduction/matrix-googleplay-bridge"
    )
    
    # Add tags to build command
    for tag in "${TAGS[@]}"; do
        build_args+=(--tag "$tag")
    done
    
    # Build the image
    log_info "Building with tags: ${TAGS[*]}"
    if docker build "${build_args[@]}" --file docker/Dockerfile .; then
        log_success "$target image built successfully"
        
        # Show image information
        local primary_tag="${TAGS[0]}"
        local image_size=$(docker images "$primary_tag" --format "table {{.Size}}" | tail -1)
        log_info "Image size: $image_size"
        log_info "Primary tag: $primary_tag"
        
        # Push if requested
        if [[ "$PUSH_IMAGE" == "true" ]]; then
            push_image "$target"
        fi
    else
        log_error "Failed to build $target image"
        return 1
    fi
}

# Push Docker image to registry
push_image() {
    local target="$1"
    
    if [[ -z "$DOCKER_REGISTRY" ]]; then
        log_warning "No registry specified, skipping push for $target"
        return 0
    fi
    
    log_step "Pushing $target image to registry..."
    
    generate_tags "$target"
    
    for tag in "${TAGS[@]}"; do
        log_info "Pushing $tag..."
        if docker push "$tag"; then
            log_success "Successfully pushed $tag"
        else
            log_error "Failed to push $tag"
            return 1
        fi
    done
}

# Test the built image
test_image() {
    local target="$1"
    generate_tags "$target"
    local primary_tag="${TAGS[0]}"
    
    log_step "Testing $target image..."
    
    # Basic container run test
    if docker run --rm "$primary_tag" node --version >/dev/null 2>&1; then
        log_success "$target image test passed"
    else
        log_error "$target image test failed"
        return 1
    fi
    
    # Security scan (if tools available)
    if command -v trivy >/dev/null 2>&1; then
        log_info "Running security scan with Trivy..."
        trivy image --severity HIGH,CRITICAL "$primary_tag" || log_warning "Security scan found issues"
    fi
}

# Clean up old images
cleanup_images() {
    log_step "Cleaning up old images..."
    
    # Remove dangling images
    local dangling=$(docker images -qf "dangling=true" 2>/dev/null || true)
    if [[ -n "$dangling" ]]; then
        docker rmi $dangling >/dev/null 2>&1 || true
        log_info "Removed dangling images"
    fi
    
    # Clean build cache
    docker builder prune -f >/dev/null 2>&1 || true
    log_info "Cleaned build cache"
}

# Display build summary
show_summary() {
    log_step "Build Summary:"
    echo ""
    log_info "Project: $PROJECT_NAME"
    log_info "Version: $VERSION"
    log_info "Git Commit: $GIT_COMMIT"
    log_info "Build Date: $BUILD_DATE"
    log_info "Target(s): $BUILD_TARGET"
    
    if [[ -n "$DOCKER_REGISTRY" ]]; then
        log_info "Registry: $DOCKER_REGISTRY"
    fi
    
    echo ""
    log_info "Built Images:"
    docker images "$PROJECT_NAME" --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" | head -10
}

# Main build function
main() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Matrix Google Play Bridge Docker Build${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    
    # Parse arguments
    parse_arguments "$@"
    
    # Validate environment
    check_docker
    validate_target
    
    # Show build configuration
    log_info "Build configuration:"
    log_info "  Target: $BUILD_TARGET"
    log_info "  Version: $VERSION"
    log_info "  Commit: $GIT_COMMIT"
    log_info "  Registry: ${DOCKER_REGISTRY:-none}"
    log_info "  Push: ${PUSH_IMAGE:-false}"
    echo ""
    
    # Build images
    if [[ "$BUILD_TARGET" == "all" ]]; then
        log_step "Building all targets..."
        for target in "${AVAILABLE_TARGETS[@]}"; do
            if build_image "$target"; then
                test_image "$target" || true
            else
                log_error "Failed to build $target, stopping"
                exit 1
            fi
        done
    else
        if build_image "$BUILD_TARGET"; then
            test_image "$BUILD_TARGET" || true
        else
            exit 1
        fi
    fi
    
    # Cleanup
    cleanup_images
    
    # Show summary
    show_summary
    
    log_success "Docker build completed successfully!"
}

# Handle script interruption
trap 'echo -e "\n${RED}Build interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"