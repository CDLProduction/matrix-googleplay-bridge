#!/bin/bash

# Production Setup Script for Matrix Google Play Bridge
# This script sets up the bridge with all production-ready features

set -e

echo "🚀 Setting up Matrix Google Play Bridge for Production"

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "❌ This script should not be run as root for security reasons"
   exit 1
fi

# Check dependencies
echo "📋 Checking dependencies..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed"
    exit 1
fi

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is required but not installed"
    exit 1
fi

echo "✅ Dependencies check passed"

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p secrets
mkdir -p logs
mkdir -p monitoring/grafana/dashboards
mkdir -p monitoring/grafana/datasources
mkdir -p monitoring/rules
mkdir -p nginx

# Generate secrets
echo "🔐 Setting up secrets..."

# Database password
if [ ! -f .env ]; then
    echo "Creating .env file with generated secrets..."
    cat > .env << EOF
# Database Configuration
DB_PASSWORD=$(openssl rand -base64 32)

# Redis Configuration  
REDIS_PASSWORD=$(openssl rand -base64 32)

# Grafana Configuration
GRAFANA_PASSWORD=$(openssl rand -base64 16)
EOF
fi

# Check for Google Service Account key
if [ ! -f secrets/service-account-key.json ]; then
    echo "⚠️  Warning: Google Service Account key not found at secrets/service-account-key.json"
    echo "   Please place your Google Play service account key file there before starting the bridge"
fi

# Create production config if it doesn't exist
if [ ! -f config/production.yaml ]; then
    echo "📝 Creating production configuration template..."
    cp config/production.yaml.template config/production.yaml 2>/dev/null || \
    echo "   Please copy and customize config/production.yaml from the provided template"
fi

# Set up monitoring configurations
echo "📊 Setting up monitoring..."

# Create Grafana datasource config
cat > monitoring/grafana/datasources/prometheus.yaml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
EOF

# Create basic Grafana dashboard
cat > monitoring/grafana/dashboards/dashboard.yaml << EOF
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
EOF

# Create nginx configuration
cat > nginx/nginx.conf << EOF
events {
    worker_connections 1024;
}

http {
    upstream bridge {
        server bridge:8080;
    }
    
    upstream grafana {
        server grafana:3000;
    }

    server {
        listen 80;
        server_name _;

        # Bridge API
        location / {
            proxy_pass http://bridge;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        }

        # Health checks
        location /health {
            access_log off;
            proxy_pass http://bridge:9090;
        }

        # Metrics (restrict access in production)
        location /metrics {
            # allow 127.0.0.1;
            # deny all;
            proxy_pass http://bridge:9090;
        }

        # Grafana dashboards
        location /grafana {
            proxy_pass http://grafana;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            rewrite ^/grafana/(.*) /\$1 break;
        }
    }
}
EOF

# Create initialization script for database
cat > scripts/init-db.sql << EOF
-- Initialize Matrix Google Play Bridge Database

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create user if not exists (for completeness)
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bridge_user') THEN
        CREATE ROLE bridge_user LOGIN PASSWORD 'secure_password';
    END IF;
END
\$\$;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE googleplay_bridge TO bridge_user;

-- The actual tables will be created by the migration system
EOF

# Build and start services
echo "🔧 Building and starting services..."

# Build the production image
docker-compose -f docker-compose.production.yml build

echo "✅ Setup completed successfully!"
echo ""
echo "🎯 Next steps:"
echo "1. Review and customize config/production.yaml"
echo "2. Place your Google Service Account key in secrets/service-account-key.json"
echo "3. Start the services: docker-compose -f docker-compose.production.yml up -d"
echo "4. Check health: curl http://localhost:9090/health"
echo "5. View metrics: http://localhost:9091 (Prometheus)"
echo "6. View dashboards: http://localhost:3000 (Grafana, admin/[generated password])"
echo ""
echo "📝 Generated passwords are in the .env file"
echo "🔐 Make sure to secure your secrets directory and .env file!"
echo ""
echo "For more information, see the documentation in docs/"