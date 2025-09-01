# syntax=docker/dockerfile:1
# Matrix Google Play Bridge - Enhanced Multi-Stage Dockerfile
# Optimized based on Context7 Docker best practices

ARG NODE_VERSION=18.20.4
ARG ALPINE_VERSION=3.19

# =============================================================================
# Base stage: Common setup for all stages
# =============================================================================
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

# Set environment variables
ENV NODE_ENV=production
ENV NPM_CONFIG_CACHE=/root/.npm

# Install system dependencies and create user
RUN apk add --no-cache \
    tini \
    curl \
    ca-certificates \
    && addgroup -g 1001 -S bridge \
    && adduser -S bridge -u 1001 -G bridge

WORKDIR /app

# =============================================================================
# Dependencies stage: Install and cache dependencies
# =============================================================================
FROM base AS deps

# Copy package files for dependency installation
COPY package*.json ./

# Install dependencies with cache mount and npm ci
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production && npm cache clean --force

# =============================================================================  
# Development dependencies stage
# =============================================================================
FROM base AS dev-deps

# Copy package files
COPY package*.json ./

# Install all dependencies including dev dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci && npm cache clean --force

# =============================================================================
# Build stage: Compile TypeScript and build application
# =============================================================================
FROM dev-deps AS builder

# Install build tools
RUN apk add --no-cache python3 make g++

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove dev dependencies after build
RUN npm ci --only=production && npm cache clean --force

# =============================================================================
# Test stage: Run tests (can be targeted separately)
# =============================================================================
FROM dev-deps AS test

# Set test environment
ENV NODE_ENV=test

# Copy source code and run tests
COPY . .
RUN npm test

# =============================================================================
# Development stage: For local development with hot reload
# =============================================================================
FROM dev-deps AS development

# Set development environment
ENV NODE_ENV=development

# Switch to non-root user early
USER bridge

# Copy source code
COPY --chown=bridge:bridge . .

# Create necessary directories
RUN mkdir -p /var/log/googleplay-bridge

# Expose ports
EXPOSE 8080 9090

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start development server with hot reload
CMD ["npm", "run", "dev"]

# =============================================================================
# Production stage: Minimal runtime image
# =============================================================================
FROM base AS production

# Copy production dependencies from deps stage
COPY --from=deps --chown=bridge:bridge /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder --chown=bridge:bridge /app/dist ./dist

# Copy necessary configuration files
COPY --chown=bridge:bridge package*.json ./
COPY --chown=bridge:bridge config/ ./config/

# Create necessary directories with proper permissions
RUN mkdir -p /var/log/googleplay-bridge \
    && chown -R bridge:bridge /var/log/googleplay-bridge \
    && chown -R bridge:bridge /app

# Switch to non-root user
USER bridge

# Health check using the bridge's health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:9090/health || exit 1

# Expose ports  
EXPOSE 8080 9090

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/app.js"]

# =============================================================================
# Default target: Production
# =============================================================================
FROM production AS final