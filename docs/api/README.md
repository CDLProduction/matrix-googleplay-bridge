# API Documentation

This comprehensive API documentation provides detailed information for developers who want to extend, integrate with, or contribute to the Matrix Google Play Bridge.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Components](#core-components)
- [Bridge API Endpoints](#bridge-api-endpoints)
- [Administrative Commands](#administrative-commands)
- [Database Schema](#database-schema)
- [Event System](#event-system)
- [Plugin Development](#plugin-development)
- [Integration Examples](#integration-examples)
- [TypeScript Interfaces](#typescript-interfaces)

## Architecture Overview

The Matrix Google Play Bridge follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Bridge Core                              │
├─────────────────────────────────────────────────────────────────┤
│  GooglePlayBridge (Main Orchestrator)                          │
│  ├── MatrixHandler (Matrix Event Processing)                   │
│  ├── BridgeCommands (Administrative Interface)                 │
│  └── AppManager (Multi-App Management)                         │
├─────────────────────────────────────────────────────────────────┤
│                      Service Layer                             │
├─────────────────────────────────────────────────────────────────┤
│  GooglePlayClient │ ReviewManager │ MessageManager             │
│  (API Access)     │ (Processing)  │ (Formatting)               │
├─────────────────────────────────────────────────────────────────┤
│                     Feature Layer                              │
├─────────────────────────────────────────────────────────────────┤
│  Categorization │ Suggestions │ Templates │ Threading          │
├─────────────────────────────────────────────────────────────────┤
│                   Infrastructure                               │
├─────────────────────────────────────────────────────────────────┤
│  Database │ Logging │ Health │ Circuit │ Rate │ HTTP │ Audit   │
│           │         │ Check  │ Breaker │ Limit│ Server│ Logger │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### GooglePlayBridge (Main Orchestrator)

**File**: `src/bridge/GooglePlayBridge.ts`  
**Purpose**: Main bridge orchestration and lifecycle management

```typescript
export class GooglePlayBridge {
  constructor(config: BridgeConfig)
  
  // Lifecycle methods
  async start(): Promise<void>
  async stop(): Promise<void>
  isRunningStatus(): boolean
  
  // Statistics and monitoring
  getBridgeStats(): BridgeStats
  getReviewStats(): Map<string, ReviewStats>
  getHealthMonitor(): HealthMonitor
  getHttpServer(): HttpServer | undefined
  
  // Review management
  async queueReplyToReview(
    packageName: string,
    reviewId: string,
    replyText: string,
    matrixEventId: string,
    roomId: string,
    senderId: string
  ): Promise<void>
}

interface BridgeStats {
  isRunning: boolean
  uptime: number
  version: string
  matrix: {
    connectedRooms: number
    virtualUsers: number
    messagesProcessed: number
  }
  reviews: {
    totalProcessed: number
    pendingReplies: number
    lastPollTime: Date | null
  }
  circuitBreakers: CircuitBreakerStats
  rateLimiting: RateLimitingStats
}
```

### MatrixHandler (Matrix Integration)

**File**: `src/bridge/MatrixHandler.ts`  
**Purpose**: Matrix event processing and user management

```typescript
export class MatrixHandler {
  constructor(bridge: Bridge, config: BridgeConfig)
  
  // Event handling
  async onEvent(request: Request<MatrixEvent>): Promise<void>
  async handleMessage(roomId: string, event: MatrixEvent): Promise<void>
  
  // User management
  async getOrCreateMatrixUser(reviewId: string, authorName: string, domain: string): Promise<MatrixUser>
  async cleanupInactiveUsers(): Promise<void>
  
  // Room management
  async ensureRoomJoined(roomId: string, userId: string): Promise<void>
  async sendFormattedMessage(roomId: string, userId: string, content: MessageContent): Promise<string>
  
  // Statistics
  getStats(): MatrixHandlerStats
}

interface MatrixUser {
  userId: string
  displayName: string
  reviewId: string
  createdAt: Date
  lastActive: Date
}

interface MessageContent {
  msgtype: string
  body: string
  formatted_body?: string
  format?: string
  [key: string]: any
}
```

### GooglePlayClient (Google Play API)

**File**: `src/api/GooglePlayClient.ts`  
**Purpose**: Google Play Console API integration

```typescript
export class GooglePlayClient {
  constructor(config: GooglePlayConfig)
  
  // Authentication
  async initialize(): Promise<void>
  async testConnection(packageName?: string): Promise<boolean>
  
  // Review operations
  async getRecentReviews(
    packageName: string, 
    since: Date, 
    maxResults: number
  ): Promise<Review[]>
  
  async replyToReview(
    packageName: string, 
    reviewId: string, 
    replyText: string
  ): Promise<ReplyResult>
  
  // Utility methods
  isReady(): boolean
  async shutdown(): Promise<void>
}

interface Review {
  reviewId: string
  packageName: string
  authorName: string
  text?: string
  starRating: number
  languageCode?: string
  device?: string
  androidOsVersion?: string
  appVersionCode?: number
  appVersionName?: string
  createdAt: Date
  lastModifiedAt: Date
  hasReply: boolean
  developerReply?: {
    text: string
    lastModified: Date
  }
}

interface ReplyResult {
  success: boolean
  reviewId: string
  replyText: string
  error?: string
}
```

### BridgeCommands (Administrative Interface)

**File**: `src/bridge/BridgeCommands.ts`  
**Purpose**: Administrative command system

```typescript
export class BridgeCommands {
  constructor(
    bridge: Bridge,
    appManager: AppManager,
    googlePlayBridge: GooglePlayBridge,
    adminUsers: string[]
  )
  
  // Command handling
  async handleMessage(roomId: string, userId: string, message: string): Promise<string | null>
  
  // Permission management
  isAdmin(userId: string): boolean
  
  // Available commands (25+ total)
  private async handleHelp(): Promise<string>
  private async handlePing(): Promise<string>
  private async handleStatus(): Promise<string>
  private async handleStats(): Promise<string>
  private async handleApps(): Promise<string>
  private async handleAddApp(packageName: string, roomId: string, appName?: string): Promise<string>
  private async handleReloadConfig(): Promise<string>
  private async handleMaintenance(action: string): Promise<string>
  // ... and 18+ more commands
}
```

## Bridge API Endpoints

The bridge exposes several HTTP endpoints for monitoring and integration:

### Health Check Endpoint

```http
GET /health
Host: localhost:9090
```

**Response:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "uptime": 123456,
  "version": "0.1.0",
  "timestamp": "2023-12-01T12:00:00Z",
  "components": {
    "database": "healthy",
    "googleplay": "healthy", 
    "matrix": "healthy"
  },
  "checks": {
    "database": {
      "status": "healthy",
      "responseTime": 15,
      "lastCheck": "2023-12-01T12:00:00Z"
    },
    "googleplay": {
      "status": "healthy",
      "responseTime": 234,
      "lastCheck": "2023-12-01T12:00:00Z"
    },
    "matrix": {
      "status": "healthy",
      "responseTime": 89,
      "lastCheck": "2023-12-01T12:00:00Z"
    }
  }
}
```

### Metrics Endpoint (Prometheus)

```http
GET /metrics
Host: localhost:9090
```

**Response:** Prometheus-formatted metrics including:
- `matrix_googleplay_bridge_reviews_processed_total`
- `matrix_googleplay_bridge_messages_sent_total`
- `matrix_googleplay_bridge_api_requests_duration_seconds`
- `matrix_googleplay_bridge_circuit_breaker_state`
- `matrix_googleplay_bridge_rate_limit_requests_total`

### Statistics Endpoint

```http
GET /stats
Host: localhost:9090
Authorization: Bearer hs-token-here
```

**Response:**
```json
{
  "bridge": {
    "isRunning": true,
    "uptime": 123456,
    "version": "0.1.0"
  },
  "matrix": {
    "connectedRooms": 5,
    "virtualUsers": 23,
    "messagesProcessed": 456
  },
  "reviews": {
    "totalProcessed": 789,
    "pendingReplies": 2,
    "lastPollTime": "2023-12-01T12:00:00Z",
    "byApp": {
      "com.example.app1": {
        "processed": 234,
        "pending": 1
      },
      "com.example.app2": {
        "processed": 555,
        "pending": 1
      }
    }
  }
}
```

### Application Management Endpoint

```http
POST /apps
Host: localhost:9090
Authorization: Bearer hs-token-here
Content-Type: application/json

{
  "action": "add|remove|enable|disable",
  "packageName": "com.example.newapp",
  "matrixRoom": "!newroom:example.com",
  "appName": "New App"
}
```

### Test Endpoints

```http
POST /test/googleplay
Host: localhost:9090
Authorization: Bearer hs-token-here
Content-Type: application/json

{
  "packageName": "com.example.app"
}
```

```http
POST /test/matrix
Host: localhost:9090
Authorization: Bearer hs-token-here
Content-Type: application/json

{
  "roomId": "!test:example.com",
  "message": "Test message"
}
```

## Administrative Commands

The bridge supports 25+ administrative commands accessible via Matrix chat:

### Core Commands
- `!help` - Show available commands and usage
- `!ping` - Test bridge connectivity  
- `!status` - Display bridge status and health
- `!stats` - Show detailed statistics and metrics
- `!version` - Display bridge version information

### Application Management
- `!apps` - List all configured applications
- `!addapp <package> <room> [name]` - Add new application
- `!removeapp <package>` - Remove application
- `!enableapp <package>` - Enable application polling
- `!disableapp <package>` - Disable application polling

### System Administration
- `!reloadconfig` - Reload configuration without restart
- `!maintenance on|off|status` - Control maintenance mode
- `!rooms` - List active bridge rooms  
- `!users` - Show virtual user statistics
- `!logs [level] [count]` - View recent log entries

### Advanced Features
- `!categorize <text>` - Test review categorization
- `!suggest <text>` - Get response suggestions
- `!templates [category]` - View message templates
- `!threads` - Show threading statistics

### Monitoring Commands
- `!health` - Show health check results
- `!metrics` - Display key metrics
- `!circuit` - Show circuit breaker status
- `!ratelimit` - Display rate limiting status

### Security Commands
- `!audit [count]` - View audit log entries
- `!permissions` - Show user permissions
- `!security` - Display security status

## Database Schema

### Core Tables

```sql
-- User mapping table
CREATE TABLE bridge_users (
  id SERIAL PRIMARY KEY,
  matrix_user_id VARCHAR(255) UNIQUE NOT NULL,
  review_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  package_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_matrix_user_id (matrix_user_id),
  INDEX idx_review_id (review_id),
  INDEX idx_package_name (package_name)
);

-- Room mapping table  
CREATE TABLE bridge_rooms (
  id SERIAL PRIMARY KEY,
  matrix_room_id VARCHAR(255) UNIQUE NOT NULL,
  package_name VARCHAR(255) NOT NULL,
  app_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_matrix_room_id (matrix_room_id),
  INDEX idx_package_name (package_name)
);

-- Message mapping table
CREATE TABLE bridge_messages (
  id SERIAL PRIMARY KEY,
  matrix_event_id VARCHAR(255) UNIQUE NOT NULL,
  review_id VARCHAR(255),
  package_name VARCHAR(255) NOT NULL,
  room_id VARCHAR(255) NOT NULL,
  sender_id VARCHAR(255) NOT NULL,
  message_type VARCHAR(50) NOT NULL, -- 'review', 'reply', 'system'
  content TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reply_status VARCHAR(50), -- 'pending', 'sent', 'failed', 'cancelled'
  INDEX idx_matrix_event_id (matrix_event_id),
  INDEX idx_review_id (review_id),
  INDEX idx_package_name (package_name),
  INDEX idx_timestamp (timestamp)
);

-- Audit log table
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(255),
  details JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_action (action),
  INDEX idx_timestamp (timestamp)
);

-- Configuration table
CREATE TABLE bridge_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(255) UNIQUE NOT NULL,
  config_value TEXT,
  config_type VARCHAR(50) DEFAULT 'string',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255),
  INDEX idx_config_key (config_key)
);
```

## Event System

The bridge uses an internal event system for loose coupling between components:

```typescript
interface BridgeEvent {
  type: string
  data: any
  timestamp: Date
  source: string
}

// Event types
enum BridgeEventType {
  // Review events
  REVIEW_RECEIVED = 'review.received',
  REVIEW_UPDATED = 'review.updated',
  REVIEW_REPLIED = 'review.replied',
  
  // Matrix events  
  MATRIX_MESSAGE = 'matrix.message',
  MATRIX_USER_JOINED = 'matrix.user.joined',
  MATRIX_USER_LEFT = 'matrix.user.left',
  
  // System events
  CONFIG_RELOADED = 'system.config.reloaded',
  MAINTENANCE_MODE = 'system.maintenance',
  HEALTH_STATUS_CHANGED = 'system.health.changed',
  
  // Error events
  ERROR_GOOGLEPLAY_API = 'error.googleplay.api',
  ERROR_MATRIX_API = 'error.matrix.api',
  ERROR_DATABASE = 'error.database'
}

// Event emitter interface
export interface BridgeEventEmitter {
  emit(event: BridgeEventType, data: any): void
  on(event: BridgeEventType, listener: (data: any) => void): void
  off(event: BridgeEventType, listener: (data: any) => void): void
}
```

## Plugin Development

The bridge supports plugins for extending functionality:

### Plugin Interface

```typescript
export interface BridgePlugin {
  name: string
  version: string
  description: string
  
  // Lifecycle methods
  initialize(bridge: GooglePlayBridge, config: PluginConfig): Promise<void>
  shutdown(): Promise<void>
  
  // Event handlers (optional)
  onReviewReceived?(review: Review): Promise<void>
  onMessageSent?(message: MessageContent): Promise<void>
  onConfigReloaded?(config: BridgeConfig): Promise<void>
  
  // Command handlers (optional)
  getCommands?(): PluginCommand[]
  
  // Health check (optional)
  healthCheck?(): Promise<HealthStatus>
}

interface PluginCommand {
  command: string
  description: string
  adminOnly: boolean
  handler: (args: string[], context: CommandContext) => Promise<string>
}

interface CommandContext {
  userId: string
  roomId: string
  bridge: GooglePlayBridge
}
```

### Example Plugin

```typescript
export class NotificationPlugin implements BridgePlugin {
  name = 'notification-plugin'
  version = '1.0.0'
  description = 'Send notifications for important reviews'
  
  private webhookUrl: string
  
  async initialize(bridge: GooglePlayBridge, config: PluginConfig): Promise<void> {
    this.webhookUrl = config.webhookUrl
    bridge.on(BridgeEventType.REVIEW_RECEIVED, this.handleReview.bind(this))
  }
  
  async shutdown(): Promise<void> {
    // Cleanup resources
  }
  
  private async handleReview(review: Review): Promise<void> {
    if (review.starRating <= 2) {
      await this.sendNotification({
        title: 'Low Rating Received',
        app: review.packageName,
        rating: review.starRating,
        text: review.text
      })
    }
  }
  
  private async sendNotification(data: any): Promise<void> {
    // Implementation to send webhook notification
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
  }
  
  getCommands(): PluginCommand[] {
    return [{
      command: 'notify',
      description: 'Send test notification',
      adminOnly: true,
      handler: async (args, context) => {
        await this.sendNotification({ test: true })
        return 'Test notification sent'
      }
    }]
  }
}
```

## Integration Examples

### Webhook Integration

```typescript
// Custom webhook handler for external systems
import express from 'express'

const app = express()

app.post('/webhook/review', async (req, res) => {
  const { review, app, type } = req.body
  
  switch (type) {
    case 'new_review':
      await handleNewReview(review, app)
      break
    case 'review_reply':
      await handleReviewReply(review, app)
      break
  }
  
  res.status(200).json({ success: true })
})

async function handleNewReview(review: Review, app: string) {
  // Custom business logic
  if (review.starRating <= 2) {
    await alertSupportTeam(review, app)
  }
  
  if (containsUrgentKeywords(review.text)) {
    await escalateReview(review, app)
  }
}
```

### External Analytics Integration

```typescript
// Google Analytics integration example
import { GoogleAnalytics } from 'analytics-google'

class AnalyticsIntegration {
  private ga: GoogleAnalytics
  
  constructor(trackingId: string) {
    this.ga = new GoogleAnalytics(trackingId)
  }
  
  async trackReview(review: Review): Promise<void> {
    await this.ga.event({
      category: 'review',
      action: 'received',
      label: review.packageName,
      value: review.starRating,
      customDimensions: {
        device: review.device,
        version: review.appVersionName
      }
    })
  }
  
  async trackReply(reply: ReplyResult): Promise<void> {
    await this.ga.event({
      category: 'review',
      action: 'replied',
      label: reply.success ? 'success' : 'failed'
    })
  }
}
```

### Custom Review Processing

```typescript
// Custom review processor with ML integration
class MLReviewProcessor {
  private sentimentApi: SentimentAPI
  
  constructor() {
    this.sentimentApi = new SentimentAPI()
  }
  
  async processReview(review: Review): Promise<ProcessedReview> {
    const sentiment = await this.sentimentApi.analyze(review.text || '')
    const category = await this.categorizeReview(review)
    const urgency = this.calculateUrgency(review, sentiment)
    const suggestedResponse = await this.generateResponse(review, sentiment, category)
    
    return {
      ...review,
      sentiment,
      category,
      urgency,
      suggestedResponse
    }
  }
  
  private async categorizeReview(review: Review): Promise<string> {
    // Custom categorization logic
    return 'bug_report'  // or 'feature_request', 'praise', etc.
  }
  
  private calculateUrgency(review: Review, sentiment: any): number {
    let urgency = 0
    
    if (review.starRating <= 2) urgency += 30
    if (sentiment.negative > 0.8) urgency += 20
    if (this.containsUrgentKeywords(review.text)) urgency += 50
    
    return Math.min(urgency, 100)
  }
  
  private containsUrgentKeywords(text?: string): boolean {
    const urgentKeywords = ['crash', 'broken', 'urgent', 'critical', 'emergency']
    return urgentKeywords.some(keyword => 
      text?.toLowerCase().includes(keyword) || false
    )
  }
}
```

## TypeScript Interfaces

### Complete Type Definitions

```typescript
// Core configuration types
export interface BridgeConfig {
  homeserver: {
    url: string
    domain: string
  }
  appservice: {
    port: number
    bind: string
    token: string
    id: string
    botUsername: string
  }
  googleplay: GooglePlayConfig
  database: DatabaseConfig
  monitoring?: MonitoringConfig
  logging?: LoggingConfig
  bridge?: {
    admins: string[]
    security?: SecurityConfig
  }
  features?: FeaturesConfig
  version: string
}

export interface GooglePlayConfig {
  auth: {
    keyFile?: string
    clientEmail?: string
    privateKey?: string
    projectId?: string
    scopes: string[]
  }
  pollIntervalMs?: number
  maxReviewsPerPoll?: number
  lookbackDays?: number
  retryConfig?: RetryConfig
  applications: ApplicationConfig[]
}

export interface ApplicationConfig {
  packageName: string
  matrixRoom: string
  appName?: string
  pollIntervalMs?: number
  maxReviewsPerPoll?: number
  lookbackDays?: number
  enabled?: boolean
}

export interface DatabaseConfig {
  type: 'sqlite' | 'postgresql'
  path?: string  // SQLite only
  host?: string  // PostgreSQL only
  port?: number  // PostgreSQL only
  database?: string
  username?: string
  password?: string
  ssl?: boolean | SSLConfig
  poolMin?: number
  poolMax?: number
  connectionTimeout?: number
  idleTimeout?: number
  migrationsTable?: string
  migrationsPath?: string
}

export interface MonitoringConfig {
  enabled: boolean
  port: number
  host: string
  enableMetrics: boolean
  enableHealthCheck: boolean
  requestLogging: boolean
  healthChecks?: {
    [component: string]: {
      enabled: boolean
      timeout: number
      interval: number
    }
  }
  metrics?: {
    prefix: string
    collectDefaultMetrics: boolean
    histogram?: {
      buckets: number[]
    }
  }
}

export interface SecurityConfig {
  enableAuditLogging: boolean
  requireSecureCommands: boolean
  maxCommandHistory: number
  sessionTimeout: number
  commandRateLimit: {
    window: number
    max: number
  }
  inputValidation: {
    maxPackageNameLength: number
    maxAppNameLength: number
    maxReviewTextLength: number
    maxUserDisplayNameLength: number
    maxRoomNameLength: number
    enableContentFiltering: boolean
    blockedPatterns: string[]
    enableSqlProtection: boolean
    allowedSqlChars: string
  }
  api: {
    rateLimiting: {
      enabled: boolean
      googleplay: RateLimitConfig
      matrix: RateLimitConfig
    }
    circuitBreaker: {
      enabled: boolean
      failureThreshold: number
      resetTimeout: number
      monitoringPeriod: number
    }
    timeouts: {
      googleplay: number
      matrix: number
      database: number
    }
  }
}

export interface FeaturesConfig {
  categorization: {
    enabled: boolean
    confidence_threshold: number
  }
  responseSuggestions: {
    enabled: boolean
    maxSuggestions: number
    confidence_threshold: number
  }
  messageTemplates: {
    enabled: boolean
    maxTemplates: number
  }
  messageThreading: {
    enabled: boolean
    maxThreadDepth: number
  }
  auditLogging: {
    enabled: boolean
    retentionDays: number
    logLevel: string
  }
}

// Statistics and monitoring types
export interface BridgeStats {
  isRunning: boolean
  uptime: number
  version: string
  matrix: MatrixStats
  reviews: ReviewStats
  circuitBreakers: CircuitBreakerStats
  rateLimiting: RateLimitingStats
}

export interface MatrixStats {
  connectedRooms: number
  virtualUsers: number
  messagesProcessed: number
  lastEventTime?: Date
}

export interface ReviewStats {
  totalProcessed: number
  pendingReplies: number
  lastPollTime?: Date
  byApp: Map<string, AppReviewStats>
}

export interface AppReviewStats {
  totalReviewsProcessed: number
  newReviewsFound: number
  updatedReviewsFound: number
  repliesSent: number
  errors: number
  lastPollTime?: Date
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  components: { [key: string]: ComponentHealth }
  uptime: number
  version: string
  timestamp: Date
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  responseTime?: number
  lastCheck?: Date
  error?: string
}
```

---

This API documentation provides comprehensive information for developers working with the Matrix Google Play Bridge. For additional examples and advanced usage patterns, see the source code in the `src/` directory and the test files in `tests/`.