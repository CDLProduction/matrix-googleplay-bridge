# Troubleshooting Guide

This comprehensive troubleshooting guide helps you diagnose and resolve common issues with the Matrix Google Play Bridge. Issues are organized by category with step-by-step solutions.

## Table of Contents

- [Quick Diagnostic Commands](#quick-diagnostic-commands)
- [Installation Issues](#installation-issues)
- [Configuration Issues](#configuration-issues)
- [Google Play API Issues](#google-play-api-issues)
- [Matrix Integration Issues](#matrix-integration-issues)
- [Database Issues](#database-issues)
- [Performance Issues](#performance-issues)
- [Security and Authentication Issues](#security-and-authentication-issues)
- [Bridge Command Issues](#bridge-command-issues)
- [Logging and Monitoring Issues](#logging-and-monitoring-issues)
- [Docker and Container Issues](#docker-and-container-issues)
- [Advanced Troubleshooting](#advanced-troubleshooting)

## Quick Diagnostic Commands

Before diving into specific issues, run these commands to get a quick overview of system health:

```bash
# Check bridge health
curl -s http://localhost:9090/health | jq '.'

# Check service status (systemd)
sudo systemctl status matrix-googleplay-bridge

# Check recent logs
tail -50 /var/log/matrix-googleplay-bridge/bridge.log

# Check configuration syntax
node -c dist/utils/Config.js

# Test database connectivity
node -e "const db = require('./dist/storage/DatabaseFactory'); db.testConnection().then(() => console.log('DB: OK')).catch(e => console.error('DB:', e.message))"

# Test Google Play API
node -e "const gp = require('./dist/api/GooglePlayClient'); new gp.GooglePlayClient(require('./config/config.yaml')).testConnection().then(() => console.log('GP: OK')).catch(e => console.error('GP:', e.message))"
```

## Installation Issues

### Node.js Version Errors

**Error:**
```
Error: Requires Node.js 18.0.0 or higher, but found v16.14.0
```

**Solution:**
```bash
# Update Node.js using NodeSource repository (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Update Node.js using package manager (macOS)
brew install node@18

# Update Node.js using NVM
nvm install 18
nvm use 18
nvm alias default 18

# Verify version
node --version  # Should show v18.x.x or higher
```

### npm Installation Failures

**Error:**
```
npm ERR! code EACCES
npm ERR! errno -13
npm ERR! Error: EACCES: permission denied
```

**Solution:**
```bash
# Fix npm permissions (Linux/macOS)
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules

# Or use npm prefix to avoid sudo
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Build Errors

**Error:**
```
TypeScript compilation failed with errors
```

**Solution:**
```bash
# Clean and rebuild
npm run clean
npm install
npm run build

# Check for TypeScript errors
npm run typecheck

# If specific file errors, check import paths
# Common fix: ensure all imports use correct relative paths
```

### Permission Denied Errors

**Error:**
```
EACCES: permission denied, open '/opt/matrix-googleplay-bridge/config/config.yaml'
```

**Solution:**
```bash
# Fix file ownership
sudo chown -R matrix-bridge:matrix-bridge /opt/matrix-googleplay-bridge

# Fix file permissions
sudo chmod 750 /opt/matrix-googleplay-bridge
sudo chmod 640 /opt/matrix-googleplay-bridge/config/*
sudo chmod 755 /opt/matrix-googleplay-bridge/dist
sudo chmod 644 /opt/matrix-googleplay-bridge/dist/*

# For development environment
chmod 644 config/config.yaml
chmod 600 config/googleplay-service-account-key.json
```

## Configuration Issues

### Configuration File Not Found

**Error:**
```
Error: Configuration file not found: ./config/config.yaml
```

**Solution:**
```bash
# Copy template and edit
cp config/config.yaml.example config/config.yaml
nano config/config.yaml

# Verify file exists and is readable
ls -la config/config.yaml
cat config/config.yaml | head -10
```

### YAML Syntax Errors

**Error:**
```
YAMLException: bad indentation of a mapping entry at line 15, column 3
```

**Solution:**
```bash
# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('config/config.yaml'))" && echo "YAML is valid" || echo "YAML has syntax errors"

# Online YAML validator
echo "Check your YAML at: https://yamlchecker.com/"

# Common YAML issues:
# 1. Use spaces, not tabs for indentation
# 2. Ensure consistent indentation levels
# 3. Quote strings with special characters
# 4. Don't use tab characters anywhere
```

### Environment Variable Substitution

**Error:**
```
Error: Environment variable not found: ${MISSING_VAR}
```

**Solution:**
```bash
# Check which environment variables are expected
grep -r '\${' config/config.yaml

# Set missing environment variables
export MISSING_VAR="appropriate_value"

# Or provide defaults in config.yaml
# Example: ${MISSING_VAR:-default_value}

# Create .env file for development
cat > .env << EOF
HOMESERVER_URL=https://matrix.your-domain.com
AS_TOKEN=your-token-here
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/path/to/key.json
EOF

# Load environment from .env (if using dotenv)
source .env
```

### Invalid URLs and Ports

**Error:**
```
Error: Invalid URL for field: homeserver.url
```

**Solution:**
```bash
# Verify URL format (must include protocol)
# ❌ Wrong: matrix.example.com
# ✅ Correct: https://matrix.example.com

# Check port availability
netstat -tlnp | grep :8080  # Check if port is in use
lsof -i :8080               # Alternative port check

# Test URL connectivity
curl -I https://matrix.your-domain.com
ping matrix.your-domain.com

# DNS resolution check
nslookup matrix.your-domain.com
```

## Google Play API Issues

### Service Account Authentication

**Error:**
```
Error: Failed to authenticate with Google Play API: invalid_grant
```

**Solution:**
```bash
# Check service account key file
ls -la /path/to/service-account-key.json
head -5 /path/to/service-account-key.json  # Should start with {"type": "service_account"

# Verify file permissions
chmod 600 /path/to/service-account-key.json

# Check system time (JWT tokens are time-sensitive)
timedatectl status
# If time is wrong: sudo timedatectl set-ntp true

# Test manual authentication
python3 << EOF
import json, jwt, time, requests

with open('/path/to/service-account-key.json', 'r') as f:
    key_data = json.load(f)

payload = {
    'iss': key_data['client_email'],
    'scope': 'https://www.googleapis.com/auth/androidpublisher',
    'aud': 'https://oauth2.googleapis.com/token',
    'exp': int(time.time()) + 3600,
    'iat': int(time.time())
}

token = jwt.encode(payload, key_data['private_key'], algorithm='RS256')
print(f"JWT Token generated successfully: {len(token)} chars")

# Test token exchange
response = requests.post('https://oauth2.googleapis.com/token', {
    'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'assertion': token
})
print(f"Token exchange status: {response.status_code}")
if response.status_code == 200:
    print("Authentication successful!")
else:
    print(f"Error: {response.text}")
EOF
```

### Insufficient Permissions

**Error:**
```
Error: The current user does not have sufficient permissions for application: com.your.app
```

**Solution:**
1. **Verify Google Play Console Permissions:**
   ```bash
   # Check these in Google Play Console:
   echo "1. Go to Settings → Developer account → API access"
   echo "2. Find your service account email"
   echo "3. Ensure it has 'View app information and download bulk reports' permission"
   echo "4. Verify it's granted access to your specific app"
   ```

2. **Check App Publication Status:**
   ```bash
   # The API only works with published apps
   echo "Verify your app is published (not draft) in Google Play Console"
   ```

3. **Test with Different App:**
   ```bash
   # Try with a known working app package name
   curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
        "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.android.chrome/reviews"
   ```

### API Quota Exceeded

**Error:**
```
Error: Quota exceeded for quota metric 'Queries per day'
```

**Solution:**
```bash
# Check current quotas in Google Cloud Console
echo "1. Go to Google Cloud Console → APIs & Services → Quotas"
echo "2. Filter by 'Google Play Android Developer API'"
echo "3. Check current usage vs. limits"

# Reduce polling frequency
# Edit config/config.yaml:
# googleplay:
#   pollIntervalMs: 600000  # 10 minutes instead of 5
#   maxReviewsPerPoll: 50   # Reduce batch size

# Request quota increases if needed
echo "4. Click 'Edit Quotas' to request increases"
```

### No Reviews Found

**Error/Warning:**
```
Warning: No reviews found for application com.your.app in the last 7 days
```

**Possible causes and solutions:**
```bash
# 1. App has no reviews with text (API excludes rating-only reviews)
echo "Check Google Play Console for reviews with text comments"

# 2. All reviews are older than 7 days
echo "API has 7-day limitation - check for recent reviews"

# 3. Wrong package name
echo "Verify package name exactly matches published app"

# 4. Test with a different app that has recent reviews
echo "Try testing with an app known to have recent text reviews"

# Manual API test
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/YOUR_PACKAGE_NAME/reviews" | jq '.'
```

## Matrix Integration Issues

### Bridge Registration Errors

**Error:**
```
Error: Application service not found
```

**Solution:**
```bash
# 1. Verify registration.yaml is in homeserver config
sudo ls -la /etc/matrix-synapse/appservices/registration.yaml

# 2. Check Synapse configuration
grep -A5 -B5 "app_service_config_files" /etc/matrix-synapse/homeserver.yaml

# 3. Verify registration.yaml syntax
python3 -c "import yaml; print(yaml.safe_load(open('/etc/matrix-synapse/appservices/registration.yaml')))"

# 4. Check token matching
echo "Verify as_token in registration.yaml matches appservice.token in config.yaml"

# 5. Restart Synapse
sudo systemctl restart matrix-synapse
sudo systemctl status matrix-synapse
```

### Token Mismatch Errors

**Error:**
```
Error: Invalid access token
```

**Solution:**
```bash
# Extract tokens from configuration files
echo "=== Config.yaml token ==="
grep -A1 -B1 "token:" config/config.yaml

echo "=== Registration.yaml tokens ==="
grep -E "(as_token|hs_token):" /path/to/registration.yaml

# Generate new tokens if needed
openssl rand -hex 32  # Generate new AS token
openssl rand -hex 32  # Generate new HS token

# Update both files with matching tokens
echo "Ensure as_token in registration.yaml = appservice.token in config.yaml"
```

### Matrix Connectivity Issues

**Error:**
```
Error: connect ECONNREFUSED matrix.your-domain.com:443
```

**Solution:**
```bash
# Test Matrix homeserver connectivity
curl -I https://matrix.your-domain.com

# Check DNS resolution
nslookup matrix.your-domain.com

# Test Matrix API endpoints
curl https://matrix.your-domain.com/_matrix/client/versions

# Check firewall/network
telnet matrix.your-domain.com 443
nc -zv matrix.your-domain.com 443

# Verify SSL/TLS certificates
openssl s_client -connect matrix.your-domain.com:443 -servername matrix.your-domain.com

# Check bridge can reach homeserver from its network
# (important if running in Docker/different network)
```

### Room Creation/Invitation Issues

**Error:**
```
Error: Failed to create room or invite bot
```

**Solution:**
```bash
# 1. Check bot user permissions
echo "Verify bot user @googleplay:your-domain.com exists"

# 2. Test manual room creation
# In Matrix client: /createroom #test-googleplay:your-domain.com

# 3. Test bot invitation
# In Matrix client: /invite @googleplay:your-domain.com

# 4. Check application service namespaces
echo "Verify namespaces in registration.yaml allow bot user creation"

# 5. Check bridge logs for detailed errors
tail -f logs/bridge.log | grep -i "room\|invite\|join"
```

## Database Issues

### SQLite Issues

**Error:**
```
SQLITE_CANTOPEN: unable to open database file
```

**Solution:**
```bash
# Check database directory permissions
ls -la data/
mkdir -p data/ && chmod 755 data/

# Check disk space
df -h .

# Test SQLite database access
sqlite3 data/bridge.db ".tables" 2>/dev/null && echo "DB accessible" || echo "DB issues"

# Reset database if corrupted
mv data/bridge.db data/bridge.db.backup
npm run db:migrate

# Check database integrity
sqlite3 data/bridge.db "PRAGMA integrity_check;"
```

### PostgreSQL Connection Issues

**Error:**
```
Error: connect ECONNREFUSED postgresql://localhost:5432
```

**Solution:**
```bash
# Check PostgreSQL service status
sudo systemctl status postgresql

# Test PostgreSQL connectivity
pg_isready -h localhost -p 5432

# Test database connection with credentials
psql -h localhost -p 5432 -U bridge_user -d matrix_googleplay_bridge -c "\\l"

# Check PostgreSQL configuration
sudo cat /etc/postgresql/*/main/postgresql.conf | grep -E "(listen_addresses|port)"
sudo cat /etc/postgresql/*/main/pg_hba.conf | grep -E "(bridge_user|matrix_googleplay_bridge)"

# Reset database password if needed
sudo -u postgres psql << EOF
ALTER USER bridge_user PASSWORD 'new_secure_password';
\\q
EOF

# Test connection with new password
PGPASSWORD=new_secure_password psql -h localhost -U bridge_user -d matrix_googleplay_bridge -c "SELECT version();"
```

### Database Migration Issues

**Error:**
```
Error: relation "bridge_users" does not exist
```

**Solution:**
```bash
# Run database migrations manually
npm run db:migrate

# Check migration status
node -e "const db = require('./dist/storage/DatabaseFactory'); db.getMigrationStatus().then(console.log).catch(console.error)"

# Reset and recreate database schema
# WARNING: This will delete all data
dropdb -h localhost -U bridge_user matrix_googleplay_bridge
createdb -h localhost -U bridge_user matrix_googleplay_bridge
npm run db:migrate

# Check tables exist
psql -h localhost -U bridge_user -d matrix_googleplay_bridge -c "\\dt"
```

## Performance Issues

### High Memory Usage

**Symptoms:**
```bash
# Check memory usage
ps aux | grep node
free -h
```

**Solutions:**
```bash
# 1. Optimize Node.js memory settings
export NODE_OPTIONS="--max-old-space-size=1024"  # Limit to 1GB

# 2. Reduce polling frequency
# Edit config.yaml:
# googleplay:
#   pollIntervalMs: 600000  # 10 minutes instead of 5

# 3. Reduce batch sizes
# googleplay:
#   maxReviewsPerPoll: 50   # Reduce from default 100

# 4. Enable garbage collection monitoring
export NODE_OPTIONS="--max-old-space-size=1024 --trace-gc"

# 5. Check for memory leaks
node --inspect dist/app.js
# Then use Chrome DevTools to profile memory
```

### High CPU Usage

**Symptoms:**
```bash
top -p $(pgrep -f "matrix-googleplay-bridge")
```

**Solutions:**
```bash
# 1. Check for infinite loops in logs
tail -f logs/bridge.log | grep -E "(ERROR|WARN|loop|infinite)"

# 2. Increase polling intervals
# Edit config.yaml to reduce CPU-intensive operations

# 3. Profile CPU usage
node --prof dist/app.js
# After running for a while, generate report:
node --prof-process isolate-*.log > cpu-profile.txt

# 4. Check database query performance
echo "Enable slow query logging in your database"
```

### Slow Response Times

**Solutions:**
```bash
# 1. Check network latency
ping matrix.your-domain.com
curl -w "@curl-format.txt" -o /dev/null -s "https://matrix.your-domain.com/_matrix/client/versions"

# Create curl-format.txt:
cat > curl-format.txt << EOF
     time_namelookup:  %{time_namelookup}\n
        time_connect:  %{time_connect}\n
     time_appconnect:  %{time_appconnect}\n
    time_pretransfer:  %{time_pretransfer}\n
       time_redirect:  %{time_redirect}\n
  time_starttransfer:  %{time_starttransfer}\n
                     ----------\n
          time_total:  %{time_total}\n
EOF

# 2. Optimize database queries
echo "Add database indexes for frequently queried columns"

# 3. Enable response caching
# Add to config.yaml:
# caching:
#   enabled: true
#   ttl: 300000  # 5 minutes
```

## Security and Authentication Issues

### SSL/TLS Certificate Issues

**Error:**
```
Error: unable to verify the first certificate
```

**Solution:**
```bash
# Check certificate validity
openssl s_client -connect matrix.your-domain.com:443 -servername matrix.your-domain.com

# Check certificate chain
curl -vI https://matrix.your-domain.com 2>&1 | grep -E "(certificate|SSL|TLS)"

# For self-signed certificates (development only)
export NODE_TLS_REJECT_UNAUTHORIZED=0  # NOT for production!

# Add CA certificate to system trust store
sudo cp ca-certificate.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates

# Node.js specific CA bundle
export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem
```

### Authentication Token Issues

**Error:**
```
Error: JWT token expired or invalid
```

**Solution:**
```bash
# Check system time (critical for JWT)
timedatectl status
sudo timedatectl set-ntp true

# Verify token generation
node -e "
const jwt = require('jsonwebtoken');
const payload = { test: true, iat: Math.floor(Date.now() / 1000) };
const token = jwt.sign(payload, 'secret');
console.log('Token generation: OK');
console.log('Payload:', jwt.decode(token));
"

# Check token expiration in logs
grep -E "(expired|invalid|JWT)" logs/bridge.log | tail -10
```

### Permission Denied Issues

**Error:**
```
Error: Permission denied accessing configuration files
```

**Solution:**
```bash
# Check file ownership and permissions
ls -la config/
ls -la logs/
ls -la data/

# Fix ownership (adjust user/group as needed)
sudo chown -R matrix-bridge:matrix-bridge /opt/matrix-googleplay-bridge
sudo chmod 750 /opt/matrix-googleplay-bridge
sudo chmod 640 config/*.yaml
sudo chmod 600 config/*.json

# For development environment
chmod 644 config/config.yaml
chmod 600 config/*-key.json
```

## Bridge Command Issues

### Commands Not Responding

**Error:**
```
Bridge bot not responding to !help command
```

**Solution:**
```bash
# 1. Check bot is in the room and active
echo "Verify @googleplay:your-domain.com is in your room"

# 2. Check admin permissions
grep -A10 "admins:" config/config.yaml
echo "Ensure your Matrix user ID is in the admin list"

# 3. Check command prefix
echo "Commands must start with ! (exclamation mark)"

# 4. Check bridge logs
tail -f logs/bridge.log | grep -i "command"

# 5. Test with simple command first
echo "Try: !ping"

# 6. Check Matrix room permissions
echo "Verify the room allows the bot to send messages"
```

### Permission Denied for Commands

**Error:**
```
Error: You don't have permission to use this command
```

**Solution:**
```bash
# Check admin configuration
echo "=== Current admin users ==="
grep -A5 "admins:" config/config.yaml

# Add your Matrix user ID to admin list
# config.yaml:
# bridge:
#   admins:
#     - '@yourusername:your-domain.com'

# Reload configuration
# In Matrix room: !reloadconfig

# Verify admin status
# In Matrix room: !status
```

### Command Execution Errors

**Error:**
```
Error executing command: Internal error
```

**Solution:**
```bash
# Enable debug logging
# Edit config.yaml:
# logging:
#   level: 'debug'

# Restart bridge and check detailed logs
tail -f logs/bridge.log | grep -E "(command|error|debug)"

# Test individual command components
node -e "
const BridgeCommands = require('./dist/bridge/BridgeCommands');
console.log('BridgeCommands module loaded successfully');
"

# Check for missing dependencies
npm ls --depth=0
```

## Logging and Monitoring Issues

### Log Files Not Created

**Error:**
```
Log file not found: ./logs/bridge.log
```

**Solution:**
```bash
# Create log directory
mkdir -p logs
chmod 755 logs

# Check log configuration
grep -A5 "logging:" config/config.yaml

# Test log file creation
touch logs/bridge.log
echo "Test log entry" >> logs/bridge.log

# Check permissions
ls -la logs/bridge.log

# For systemd, check journal logs instead
journalctl -u matrix-googleplay-bridge -f
```

### Monitoring Endpoints Not Accessible

**Error:**
```
curl: (7) Failed to connect to localhost port 9090: Connection refused
```

**Solution:**
```bash
# Check monitoring configuration
grep -A5 "monitoring:" config/config.yaml

# Verify monitoring is enabled
# config.yaml should have:
# monitoring:
#   enabled: true
#   port: 9090

# Check if port is in use
netstat -tlnp | grep 9090
lsof -i :9090

# Test from different interface
curl http://127.0.0.1:9090/health
curl http://0.0.0.0:9090/health

# Check firewall rules
sudo ufw status
sudo iptables -L | grep 9090
```

### Metrics Not Available

**Error:**
```
/metrics endpoint returns 404
```

**Solution:**
```bash
# Check Prometheus metrics are enabled
# config.yaml:
# monitoring:
#   enableMetrics: true

# Test metrics endpoint
curl http://localhost:9090/metrics | head -20

# Check for metrics collection errors
grep -i "metric" logs/bridge.log

# Verify Prometheus client dependency
npm ls prometheus-client prom-client
```

## Docker and Container Issues

### Container Won't Start

**Error:**
```
docker: Error response from daemon: container failed to start
```

**Solution:**
```bash
# Check container logs
docker logs matrix-googleplay-bridge

# Check for port conflicts
docker ps -a
netstat -tlnp | grep -E "(8080|9090)"

# Verify image exists
docker images | grep matrix-googleplay-bridge

# Check volume mounts
docker inspect matrix-googleplay-bridge | jq '.[0].Mounts'

# Rebuild image
docker build -t matrix-googleplay-bridge .
```

### Volume Mount Issues

**Error:**
```
Error: ENOENT: no such file or directory, open '/app/config/config.yaml'
```

**Solution:**
```bash
# Check host directory exists
ls -la ./config/
ls -la ./data/

# Verify Docker volume syntax
# Correct: -v /host/path:/container/path
# Wrong: -v /host/path/:/container/path/

# Test volume mount
docker run -it --rm -v $(pwd)/config:/app/config alpine ls -la /app/config

# Check file permissions inside container
docker run -it --rm -v $(pwd)/config:/app/config matrix-googleplay-bridge ls -la /app/config
```

### Network Connectivity in Docker

**Error:**
```
Error: getaddrinfo ENOTFOUND matrix.your-domain.com
```

**Solution:**
```bash
# Test DNS resolution inside container
docker run -it --rm matrix-googleplay-bridge nslookup matrix.your-domain.com

# Check Docker network configuration
docker network ls
docker network inspect bridge

# Use host networking for testing
docker run --net=host matrix-googleplay-bridge

# Add custom DNS
docker run --dns=8.8.8.8 matrix-googleplay-bridge

# Check Docker daemon DNS configuration
sudo cat /etc/docker/daemon.json
```

## Advanced Troubleshooting

### Memory Leaks

**Detection:**
```bash
# Monitor memory usage over time
while true; do
  ps -p $(pgrep -f "matrix-googleplay-bridge") -o pid,vsz,rss,pcpu,etime,comm
  sleep 60
done > memory-usage.log

# Use Node.js memory profiling
node --inspect dist/app.js
# Connect Chrome DevTools to localhost:9229

# Generate heap dumps
node --heap-prof dist/app.js
# Analyze with node --prof-process isolate-*.heapprofile
```

**Solutions:**
```bash
# Enable garbage collection monitoring
export NODE_OPTIONS="--trace-gc --trace-gc-verbose"

# Limit memory usage
export NODE_OPTIONS="--max-old-space-size=1024"

# Use memory-efficient JSON parsing
# For large JSON responses, consider streaming parsers
```

### Database Deadlocks

**Detection:**
```bash
# PostgreSQL deadlock detection
psql -c "SELECT * FROM pg_locks WHERE NOT granted;"

# SQLite locking issues
sqlite3 data/bridge.db ".timeout 1000"

# Monitor long-running queries
psql -c "SELECT pid, query, state, query_start FROM pg_stat_activity WHERE query != '<IDLE>' ORDER BY query_start;"
```

**Solutions:**
```bash
# Increase database timeouts
# config.yaml:
# database:
#   connectionTimeout: 30000
#   idleTimeout: 60000

# Optimize database indexes
psql -c "CREATE INDEX CONCURRENTLY idx_bridge_messages_timestamp ON bridge_messages(timestamp);"

# Use connection pooling
# config.yaml:
# database:
#   poolMin: 2
#   poolMax: 10
```

### API Rate Limiting Analysis

**Monitor API usage:**
```bash
# Google Play API usage
gcloud logging read 'resource.type="consumed_api" AND resource.labels.service="androidpublisher.googleapis.com"' --limit=50 --format=json

# Track bridge API calls
grep -E "(GooglePlay|API)" logs/bridge.log | grep -E "(request|response)" | tail -20

# Monitor rate limiting
grep -i "rate" logs/bridge.log | tail -10
```

### Network Debugging

**Deep network analysis:**
```bash
# Trace network calls
strace -e trace=network -p $(pgrep -f "matrix-googleplay-bridge")

# Monitor network connections
netstat -tupln | grep -E "(8080|9090|5432|443)"

# Packet capture
sudo tcpdump -i any -w bridge-traffic.pcap host matrix.your-domain.com
# Analyze with: wireshark bridge-traffic.pcap

# Test SSL/TLS handshake
openssl s_client -connect matrix.your-domain.com:443 -debug -msg
```

## Getting Help

### Information to Collect Before Seeking Help

```bash
# Create a diagnostic report
cat > diagnostic-report.txt << EOF
=== System Information ===
$(uname -a)
$(node --version)
$(npm --version)

=== Bridge Version ===
$(grep version package.json)

=== Configuration (sanitized) ===
$(grep -E "(homeserver|appservice|database|logging)" config/config.yaml | sed 's/password:.*/password: [REDACTED]/' | sed 's/token:.*/token: [REDACTED]/')

=== Service Status ===
$(systemctl is-active matrix-googleplay-bridge 2>/dev/null || echo "not systemd")

=== Health Check ===
$(curl -s http://localhost:9090/health 2>/dev/null || echo "health endpoint not accessible")

=== Recent Logs ===
$(tail -20 logs/bridge.log 2>/dev/null || journalctl -u matrix-googleplay-bridge --lines=20 2>/dev/null || echo "no logs found")

=== Network Connectivity ===
$(curl -I -s https://matrix.your-domain.com 2>&1 | head -5)

=== Database Status ===
$(node -e "const db = require('./dist/storage/DatabaseFactory'); db.testConnection().then(() => console.log('DB: Connected')).catch(e => console.error('DB Error:', e.message))" 2>/dev/null || echo "DB test failed")
EOF

echo "Diagnostic report saved to diagnostic-report.txt"
```

### Support Channels

1. **GitHub Issues**: [https://github.com/CDLProduction/matrix-googleplay-bridge/issues](https://github.com/CDLProduction/matrix-googleplay-bridge/issues)
2. **Matrix Room**: `#matrix-googleplay-bridge:your-domain.com`
3. **Documentation**: [docs/](../docs/)
4. **Community Forums**: Matrix.org community forums

### When Creating Issues

Include:
- Diagnostic report (sanitized of sensitive data)
- Steps to reproduce the issue
- Expected vs. actual behavior
- Bridge version and configuration details
- Relevant log excerpts
- System information (OS, Node.js version, etc.)

---

This troubleshooting guide covers the most common issues encountered with the Matrix Google Play Bridge. If your specific issue isn't covered, please create a GitHub issue with detailed information, and we'll help you resolve it.