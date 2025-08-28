# Configuration Guide

This guide explains how to configure the Matrix Google Play Bridge.

## Configuration Files

The bridge uses two main configuration files:

1. **config.yaml** - Main bridge configuration
2. **registration.yaml** - Matrix Application Service registration

## Setup Steps

### 1. Copy Configuration Templates

```bash
cp config/config.yaml.example config/config.yaml
cp config/registration.yaml.example config/registration.yaml
```

### 2. Generate Tokens

Generate secure random tokens for the bridge:

```bash
# Generate tokens (Linux/Mac)
openssl rand -hex 32

# Or using Python
python -c "import secrets; print(secrets.token_hex(32))"
```

You need two tokens:
- One for `config.yaml` → `appservice.token`
- Another for `registration.yaml` → `hs_token` and `as_token` (use same value)

### 3. Configure Google Play API

1. Create a service account in Google Cloud Console
2. Enable the Google Play Developer API  
3. Download the service account JSON key file
4. Set the path in `config.yaml` → `googleplay.serviceAccountKeyPath`

### 4. Configure Matrix Integration

Update `config.yaml` with your Matrix homeserver details:

```yaml
homeserver:
  url: "https://your-matrix-server.com"
  domain: "your-matrix-server.com"

appservice:
  port: 9000
  bind: "127.0.0.1"
  token: "your-generated-token"
  id: "googleplay_bridge"
  botUsername: "googleplaybot"
```

Update `registration.yaml` with matching values:

```yaml
id: googleplay_bridge
url: http://localhost:9000
as_token: "your-generated-token"
hs_token: "your-other-generated-token"
sender_localpart: googleplaybot
```

### 5. Configure Applications

Add your Google Play applications to monitor:

```yaml
googleplay:
  applications:
    - packageName: "com.your.app"
      matrixRoom: "!roomid:your-matrix-server.com"
      appName: "Your App Name"
```

### 6. Database Configuration

Choose between SQLite (development) or PostgreSQL (production):

**SQLite (default):**
```yaml
database:
  type: "sqlite"
  path: "./data/bridge.db"
```

**PostgreSQL:**
```yaml
database:
  type: "postgresql"
  host: "localhost"
  port: 5432
  username: "bridge_user"
  password: "secure_password"
  database: "matrix_googleplay_bridge"
  ssl: false
```

### 7. Register with Matrix Homeserver

Add the registration file to your Matrix homeserver configuration:

**Synapse (homeserver.yaml):**
```yaml
app_service_config_files:
  - /path/to/registration.yaml
```

Restart your Matrix homeserver after adding the registration.

## Environment Variables

You can override any configuration value using environment variables:

| Environment Variable | Configuration Path |
|---------------------|-------------------|
| `HOMESERVER_URL` | `homeserver.url` |
| `HOMESERVER_DOMAIN` | `homeserver.domain` |
| `AS_PORT` | `appservice.port` |
| `AS_TOKEN` | `appservice.token` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | `googleplay.serviceAccountKeyPath` |
| `DB_TYPE` | `database.type` |
| `DB_PATH` | `database.path` |
| `LOG_LEVEL` | `logging.level` |

Example:
```bash
export HOMESERVER_URL="https://matrix.example.com"
export AS_PORT=9001
export LOG_LEVEL=debug
npm start
```

## Configuration Validation

The bridge automatically validates your configuration on startup. Common validation errors:

- **Missing required fields**: Ensure all required configuration sections are present
- **Invalid URLs**: Check homeserver URL format
- **Invalid ports**: Use ports between 1-65535
- **Missing files**: Verify Google Play service account key file exists
- **Database configuration**: Ensure required database fields match the database type

## Testing Configuration

Test your configuration without starting the full bridge:

```bash
# This will load and validate configuration
npm run typecheck
```

## Security Best Practices

1. **Protect tokens**: Never commit tokens to version control
2. **File permissions**: Restrict access to configuration files
3. **Service account**: Use minimal required permissions for Google Play API
4. **Network security**: Use HTTPS for homeserver connections
5. **Environment variables**: Use environment variables in production for sensitive values

## Troubleshooting

### Configuration not found
```
Error: Configuration file not found: ./config/config.yaml
```
**Solution**: Copy `config.yaml.example` to `config.yaml`

### Google Play service account not found
```
Error: Google Play service account key file not found: /path/to/key.json
```
**Solution**: Verify the service account JSON file exists at the specified path

### Invalid homeserver URL
```
Error: Invalid URL for field: homeserver.url
```
**Solution**: Ensure the URL includes protocol (https://) and is properly formatted

### Database connection issues
For PostgreSQL, verify:
- Database server is running
- Credentials are correct
- Database exists
- Network connectivity