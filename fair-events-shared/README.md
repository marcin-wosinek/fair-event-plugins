# Fair Events Shared

Shared utilities for Fair Event plugins.

## Purpose

This package contains common utilities used across multiple Fair Event plugins:
- **fair-events**: Event post type and blocks
- **fair-calendar-button**: Calendar button block
- **fair-timetable**: Event timetable functionality
- Other Fair Event plugins that need shared utilities

## Usage

Install as a workspace dependency:

```json
{
  "dependencies": {
    "fair-events-shared": "*"
  }
}
```

Import in your code:

```javascript
import { /* utilities */ } from 'fair-events-shared';
```

## Available Utilities

Currently, this package is a scaffold ready for shared code. Utilities will be added as needed.

## Development

### Running Tests

```bash
npm test
```

The test suite uses Jest with Babel to support ES modules.
