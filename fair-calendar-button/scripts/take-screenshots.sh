#!/bin/bash

# Script to take WordPress.org screenshots for Fair Calendar Button plugin
# This script sets up the environment and runs Playwright tests

set -e

echo "🚀 Taking WordPress.org screenshots for Fair Calendar Button..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Build the plugin first
echo "📦 Building plugin..."
npm run build

# Start WordPress if not already running
echo "🐳 Starting WordPress environment..."
docker compose up -d

# Wait for WordPress to be ready
echo "⏳ Waiting for WordPress to be ready..."
sleep 30

# Check if WordPress is accessible
max_attempts=30
attempt=1
while [ $attempt -le $max_attempts ]; do
    if curl -f -s http://localhost:8080 > /dev/null; then
        echo "✅ WordPress is ready!"
        break
    fi
    echo "Attempt $attempt/$max_attempts: WordPress not ready yet..."
    sleep 10
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "❌ WordPress failed to start after 5 minutes"
    exit 1
fi

# Install Playwright browsers if not already installed
echo "🌐 Installing Playwright browsers..."
npx playwright install chromium

# Set up WordPress admin user (if needed)
echo "👤 Setting up WordPress admin user..."
docker compose --profile cli run wpcli wp user create admin admin@example.com --role=administrator --user_pass=password || echo "Admin user already exists"

# Activate the plugin
echo "🔌 Activating Fair Calendar Button plugin..."
docker compose --profile cli run wpcli wp plugin activate fair-calendar-button || echo "Plugin activation failed or already active"

# Create assets directory if it doesn't exist
mkdir -p assets

# Run the screenshot tests
echo "📸 Taking screenshots..."
npm run test:screenshots

echo "✅ Screenshot completed! Check the assets/ directory for:"
echo "   - screenshot-1.png (Calendar Button block in Gutenberg editor)"

echo ""
echo "🎯 Next steps:"
echo "1. Review the screenshots in the assets/ directory"
echo "2. Optionally create banner images (banner-1544x500.png, banner-772x250.png)"
echo "3. Optionally create plugin icons (icon-128x128.png, icon-256x256.png)"
echo "4. Your plugin is ready for WordPress.org submission!"