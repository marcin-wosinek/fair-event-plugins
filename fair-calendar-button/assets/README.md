# Assets for WordPress.org

This directory contains assets for the WordPress.org plugin directory.

## Required Files for WordPress.org

### Screenshots
- `screenshot-1.png` (1200x900px) - Calendar button block in the Gutenberg editor
- `screenshot-2.png` (1200x900px) - Dropdown menu showing all calendar provider options

### Plugin Banners
- `banner-1544x500.png` - High-res banner for plugin directory
- `banner-772x250.png` - Standard banner for plugin directory

### Plugin Icon
- `icon-128x128.png` - Plugin icon for the directory
- `icon-256x256.png` - High-res plugin icon

## Creating Screenshots

Screenshots can be generated automatically using the included Playwright test script:

### Automated Screenshot Generation

The plugin includes an automated screenshot generation script using Playwright
that creates the required WordPress.org screenshots.

#### Prerequisites
1. Docker Compose WordPress environment running on `localhost:8080`
2. Node.js and npm installed
3. Playwright dependencies installed

#### Usage
```bash
# Install dependencies (if not already done)
npm install

# Set up environment variables (copy from .env.example)
cp .env.example .env

# Edit .env with your WordPress admin credentials:
# WP_ADMIN_USER=admin
# WP_ADMIN_PASS=your-password
# WP_BASE_URL=http://localhost:8080

# Run the screenshot generation
npx playwright test

# Screenshots will be generated in the assets/ directory:
# - assets/screenshot-1.png - Editor view with settings panel
# - assets/screenshot-2.png - Frontend view with dropdown menu
```
