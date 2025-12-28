# Block Creation Guide

## Directory Structure

```
src/blocks/block-name/
├── block.json          # Block metadata
├── editor.js           # Editor component (registerBlockType)
├── render.php          # Server-side rendering
├── frontend.js         # Frontend JavaScript (optional)
└── editor.css          # Editor styles (optional)
```

## Required block.json Fields

**CRITICAL**: Must include `editorScript` for block to appear in editor.

```json
{
  "name": "plugin-name/block-name",
  "editorScript": "file:./editor.js",
  "render": "file:./render.php",
  "viewScript": "file:./frontend.js"
}
```

- `editorScript` - Loads editor component (REQUIRED)
- `render` - Server-side PHP rendering (REQUIRED)
- `viewScript` - Frontend JavaScript for interactivity

## Block Registration

Register from `build/` directory in PHP:

```php
register_block_type(PLUGIN_DIR . 'build/blocks/block-name');
```

## Examples

- `fair-membership/src/blocks/my-fees/`
- `fair-events/src/blocks/events-calendar`
