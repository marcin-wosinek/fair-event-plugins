# Fair Events

Event management plugin for WordPress.

## Description

Fair Events is a WordPress plugin that provides event management functionality. It integrates seamlessly with WordPress's block editor and Query Loop system.

## Features

- **Custom Post Type**: `fair_event` with event metadata (start date, end date, all-day flag)
- **Gutenberg Blocks**:
  - **Events List**: Display filtered event lists with time filters (upcoming, past, ongoing, all) and category filtering
  - **Event Dates**: Show formatted event dates
- **Block Patterns**: Pre-built event display patterns using WordPress Query Loop:
  - Event List - Simple (title + excerpt)
  - Event List - With Images (featured image + title + excerpt)
  - Event List - With Dates (title + event dates + excerpt)
  - Event Grid (3-column grid layout)
- **Pattern Support**: Works with both PHP-registered patterns and user-created reusable blocks
- **WordPress Integration**: Full integration with WordPress Query Loop, block context, and date/time formatting

## Installation

1. Upload the `fair-events` folder to the `/wp-content/plugins/` directory
2. Activate the plugin through the 'Plugins' menu in WordPress

## Usage

### Creating Events

1. Navigate to **Events** > **Add New** in WordPress admin
2. Add event title, content, and featured image
3. Set event metadata:
   - **Event Start**: Start date and time
   - **Event End**: End date and time
   - **All Day Event**: Toggle for all-day events
4. Publish the event

### Displaying Events

#### Events List Block

1. Add the **Events List** block to any post or page
2. Configure settings in the sidebar:
   - **Display Pattern**: Choose from pre-built patterns or custom reusable blocks
   - **Time Filter**: Filter by upcoming, past, ongoing, or all events
   - **Categories**: Filter by post categories

#### Custom Patterns

Create your own event display patterns using:
- WordPress Query Loop blocks (set post type to `fair_event`)
- Event Dates block (shows formatted event start/end times)
- Standard WordPress blocks (Post Title, Post Excerpt, Post Featured Image, etc.)

The Events List block will automatically apply your time filters and category selections to any Query Loop pattern you choose.

## Development

### Requirements

- PHP 7.4 or higher
- WordPress 6.7 or higher
- Node.js 18+ and npm
- Composer

### Setup

```bash
# Install PHP dependencies
composer install

# Install JavaScript dependencies
npm install

# Build assets
npm run build

# Watch for changes during development
npm run start
```

## License

GPLv3 or later - https://www.gnu.org/licenses/gpl-3.0.html
