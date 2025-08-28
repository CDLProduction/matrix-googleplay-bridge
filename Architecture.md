# Matrix Google Play Bridge Architecture

## Overview

The Matrix Google Play Bridge is a bidirectional bridge that connects Google Play Console review/comment systems with Matrix chat rooms, enabling customer support teams to respond to app reviews directly from Matrix clients.

## Architecture Components

### Core Bridge System

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Google Play API │◄──►│ Bridge Core      │◄──►│ Matrix Server   │
│                 │    │                  │    │                 │
│ - Reviews API   │    │ - Event Handler  │    │ - Homeserver    │
│ - Reply API     │    │ - Message Relay  │    │ - App Service   │
│ - Webhooks      │    │ - User Mapping   │    │ - Client SDK    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### System Architecture

#### 1. Bridge Core (Node.js Application)

**Main Components:**
- **Application Service**: Matrix integration using matrix-appservice-bridge
- **Google Play Client**: API integration for reviews and replies
- **Event Processor**: Handles bidirectional message flow
- **User/Room Manager**: Manages virtual users and room mappings
- **Storage Layer**: Persistent data storage for mappings and state

#### 2. Google Play Integration Layer

**Features:**
- **Review Polling**: Periodic fetching of new reviews (API limitation: last 7 days only)
- **Reply Handler**: Send responses back to Google Play
- **App Monitoring**: Support for multiple apps per bridge instance
- **Authentication**: Service account or OAuth2 integration

**API Limitations:**
- Only reviews with comments are accessible
- Reviews from last 7 days only
- Production app reviews only (no alpha/beta)
- Rate limiting: 10-100 reviews per page

#### 3. Matrix Integration Layer

**Components:**
- **Application Service**: Registered with homeserver
- **Intent System**: Smart Matrix operations (auto-join, etc.)
- **Virtual Users**: Ghost users representing Google Play reviewers
- **Room Management**: Automatic room creation and mapping

### Data Models

#### User Mapping
```typescript
interface MatrixUser {
  userId: string;        // @googleplay_<reviewId>:domain.com
  displayName: string;   // Google Play reviewer name
  avatarUrl?: string;
}

interface GooglePlayUser {
  reviewId: string;      // Unique review identifier
  authorName: string;    // Reviewer name from Google Play
  lastActive: Date;
}
```

#### Room Mapping
```typescript
interface RoomMapping {
  matrixRoomId: string;     // !room:domain.com
  appPackageName: string;   // com.example.app
  appName: string;          // Human-readable app name
  reviewId?: string;        // For dedicated review rooms
}
```

#### Message Mapping
```typescript
interface MessageMapping {
  matrixEventId: string;
  googlePlayCommentId: string;
  messageType: 'review' | 'reply';
  timestamp: Date;
}
```

### Project Structure

```
matrix-googleplay-bridge/
├── src/
│   ├── bridge/
│   │   ├── GooglePlayBridge.ts      # Main bridge class
│   │   ├── MatrixHandler.ts         # Matrix event handling
│   │   └── GooglePlayHandler.ts     # Google Play API handling
│   ├── api/
│   │   ├── GooglePlayClient.ts      # Google Play API wrapper
│   │   └── ReviewManager.ts         # Review processing logic
│   ├── models/
│   │   ├── User.ts                  # User data models
│   │   ├── Room.ts                  # Room data models
│   │   └── Message.ts               # Message data models
│   ├── storage/
│   │   ├── Database.ts              # Database abstraction
│   │   └── FileStorage.ts           # Configuration storage
│   ├── utils/
│   │   ├── Logger.ts                # Logging utilities
│   │   ├── Config.ts                # Configuration management
│   │   └── Validator.ts             # Input validation
│   └── app.ts                       # Application entry point
├── config/
│   ├── config.yaml.example          # Configuration template
│   ├── registration.yaml.example    # AS registration template
│   └── docker-compose.yml           # Docker setup
├── scripts/
│   ├── install.sh                   # Installation script
│   ├── setup.sh                     # Initial setup script
│   └── docker-setup.sh              # Docker setup script
├── docs/
│   ├── setup/
│   │   ├── installation.md          # Installation guide
│   │   ├── configuration.md         # Configuration guide
│   │   └── docker.md                # Docker deployment
│   ├── api/
│   │   └── google-play-setup.md     # Google Play API setup
│   └── troubleshooting.md           # Common issues
├── tests/
│   ├── unit/                        # Unit tests
│   ├── integration/                 # Integration tests
│   └── fixtures/                    # Test data
├── docker/
│   ├── Dockerfile                   # Production container
│   ├── Dockerfile.dev               # Development container
│   └── docker-entrypoint.sh         # Container startup script
├── .github/
│   └── workflows/
│       ├── ci.yml                   # Continuous integration
│       └── docker.yml               # Docker image builds
├── package.json
├── tsconfig.json
├── README.md
├── Architecture.md                  # This file
└── TASKS.md                        # Development tasks
```

## Message Flow

### Google Play → Matrix

1. **Review Detection**: Periodic polling of Google Play Reviews API
2. **New Review Processing**: 
   - Create virtual Matrix user for reviewer
   - Find or create appropriate Matrix room
   - Send formatted review as Matrix message
3. **Review Updates**: Handle modified reviews and replies from other sources

### Matrix → Google Play

1. **Matrix Event**: User sends message in bridged room
2. **Intent Processing**: Validate user permissions and message format
3. **API Call**: Send reply via Google Play Developer API
4. **Confirmation**: Update Matrix with success/failure status

## Security Considerations

### Authentication
- Google Play: Service Account with limited permissions
- Matrix: Application Service token-based auth
- Secure credential storage (environment variables)

### Data Privacy
- No persistent storage of review content
- Minimal user data retention
- Configurable data retention policies
- GDPR compliance considerations

### Access Control
- Room-level permissions for bridge management
- Admin commands for configuration
- Audit logging for all bridge operations

## Deployment Options

### Standalone Installation
- Direct Node.js installation
- systemd service configuration
- Local SQLite database
- File-based configuration

### Docker Container
- Multi-stage build for optimization
- Health checks and monitoring
- Volume mounts for persistence
- Environment-based configuration

### Docker Compose Stack
- Bridge + Matrix server + database
- Reverse proxy integration
- Backup and monitoring setup
- Development environment support

## Configuration Management

### Bridge Configuration
```yaml
homeserver:
  url: "https://matrix.example.com"
  domain: "example.com"
  
appservice:
  port: 9000
  bind: "127.0.0.1"
  
googleplay:
  service_account_key: "/path/to/key.json"
  applications:
    - package_name: "com.example.app1"
      matrix_room: "!room1:example.com"
    - package_name: "com.example.app2"
      matrix_room: "!room2:example.com"

database:
  type: "sqlite"  # or "postgresql"
  path: "./bridge.db"  # for sqlite
  
logging:
  level: "info"
  file: "./logs/bridge.log"
```

## Scalability Considerations

### Performance
- Connection pooling for database
- Efficient API polling strategies
- Message queue for high-volume scenarios
- Horizontal scaling support

### Monitoring
- Health check endpoints
- Metrics collection (Prometheus)
- Error tracking and alerting
- Performance monitoring

### Maintenance
- Automated updates via Docker
- Database migration system
- Configuration validation
- Backup and restore procedures

## Integration Points

### Matrix Widget Integration
- Embed bridge management UI in matrix-chat-support widget
- Unified configuration interface
- Cross-bridge message routing
- Shared authentication system

### Multi-Bridge Architecture
- Consistent bridge discovery
- Shared room management
- Unified user experience across bridges
- Common administrative interface