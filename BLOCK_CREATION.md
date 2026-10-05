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

-   `editorScript` - Loads editor component (REQUIRED)
-   `render` - Server-side PHP rendering (REQUIRED)
-   `viewScript` - Frontend JavaScript for interactivity

## Frontend state model

For an interactive block, create one state model per block or form instance.
Keep business values and lifecycle state there: current selections, calculated
amounts, validation or eligibility, loading, and submission. Input events and
API responses update the model; one render path derives and applies all related
UI states. For example, derive `canSubmit` once and use it for both the submit
button and a checkout total that is visible only when submission is available.
Avoid separate handlers that independently toggle those elements.

The DOM is an input and output boundary. Read a control's value when handling
its event, but do not treat another element's `disabled` property, text,
visibility class, or `data-*` attribute as the authoritative form state. PHP
may render initial `data-*` configuration; read it once to initialize the
model. If external integrations need a documented `data-*` value, update it
from the model alongside the visible text, including while that text is hidden.
Keep each instance's state separate when multiple copies of the block appear
on one page. Plain JavaScript can use a closure or `WeakMap`; a React block can
use component state. Add focused transition tests for every related control.

## Public script dependencies

Keep `viewScript` imports limited to what the visitor-facing control uses.
The `fair-events-shared` root entry also exports editor controls; importing
it from a public script can enqueue `wp-components`, React, and other editor
dependencies on every page containing the block. Import the specific browser
utility module instead:

```javascript
import { showMessage, onDomReady } from 'fair-events-shared/src/form-utils.js';
```

For questionnaire and payment helpers, use
`fair-events-shared/src/questionnaire.js` and
`fair-events-shared/src/payment-flow.js`. Keep REST calls on `apiFetch()` with
hardcoded paths as described in [REST_API_USAGE.md](./REST_API_USAGE.md).
After building, inspect the public script's `build/blocks/<block-name>/*.asset.php`
dependencies and measure the requests on a page containing the block. See
[WEBPACK_CONFIG.md](./WEBPACK_CONFIG.md#public-viewscript-dependency-check).

## Block Registration

Register from `build/` directory in PHP:

```php
register_block_type(PLUGIN_DIR . 'build/blocks/block-name');
```

## Examples

-   `fair-events/src/blocks/events-calendar/`
-   `fair-events/src/blocks/calendar-button/` (canonical `viewScript` DOM-ready pattern)
-   `fair-events/src/blocks/event-signup/`
