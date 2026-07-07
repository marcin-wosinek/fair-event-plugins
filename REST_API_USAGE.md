# REST API Usage Across Fair Event Plugins

Frontend patterns for calling WordPress REST APIs from blocks and admin pages.

## Best Practices for WordPress REST API Calls

### 1. Always Use `apiFetch()` for WordPress REST APIs

**Required**: All WordPress REST API calls MUST use `apiFetch()` from `@wordpress/api-fetch`.

**Why?** WordPress's `apiFetch()` automatically handles:

-   ✅ Permalink format detection (pretty permalinks vs plain permalinks)
-   ✅ Nonce authentication
-   ✅ Proper error handling
-   ✅ Request/response interceptors

### 2. Hardcoded Paths Are Preferred

**Use hardcoded paths** - they are clear, explicit, and maintainable:

```javascript
// ✅ GOOD - Hardcoded path
await apiFetch({
	path: '/fair-payments-connector/v1/payments',
	method: 'POST',
	data: {
		amount: '10.00',
		currency: 'EUR',
	},
});
```

### 3. Implementation Pattern for ViewScripts

When adding `apiFetch()` to a viewScript (frontend JavaScript for blocks):

#### Step 1: Import apiFetch

```javascript
// src/blocks/my-block/view.js
import apiFetch from '@wordpress/api-fetch';
```

#### Step 2: Add to webpack config

```javascript
// webpack.config.cjs
const blockEntries = {
	'blocks/my-block/index': 'src/blocks/my-block/index.js',
	'blocks/my-block/view': 'src/blocks/my-block/view.js', // Add this line
};
```

#### Step 3: Register block from build directory

```php
// PHP block registration
register_block_type(
    PLUGIN_DIR . 'build/blocks/my-block'  // Point to build, not src
);
```

#### Step 4: Build

```bash
npm run build
```

The build process will automatically:

-   Bundle the JavaScript with ES6 imports
-   Create `view.asset.php` with `wp-api-fetch` dependency
-   WordPress will load dependencies before your script

### 4. Path Format Rules

**Always use absolute paths starting with `/`:**

```javascript
// ✅ GOOD
path: '/fair-payments-connector/v1/payments';

// ❌ BAD - Missing leading slash
path: 'fair-payments-connector/v1/payments';
```

**Format:** `/{plugin-namespace}/{version}/{endpoint}`

### 5. Error Handling Pattern

`apiFetch()` errors may have nested message properties:

```javascript
try {
	const data = await apiFetch({
		path: '/fair-payments-connector/v1/payments',
		method: 'POST',
		data: { amount: '10.00' },
	});
	// Handle success
} catch (error) {
	// apiFetch errors may have message in different places
	const errorMessage =
		error.message || (error.data && error.data.message) || 'Request failed';
	console.error('Payment error:', errorMessage);
}
```

### 6. Method and Data Parameters

```javascript
// GET request (default method)
await apiFetch({
	path: '/fair-events/v1/event-dates',
});

// POST request with data
await apiFetch({
	path: '/fair-payments-connector/v1/payments',
	method: 'POST',
	data: {
		amount: '10.00',
		currency: 'EUR',
	},
});

// DELETE request
await apiFetch({
	path: `/fair-events/v1/event-dates/${eventDateId}`,
	method: 'DELETE',
});
```

### 7. When NOT to Use apiFetch()

Only use raw `fetch()` for **non-WordPress REST APIs**:

```javascript
// External service (not WordPress REST API)
await fetch('https://api.external-service.com/endpoint', {
	method: 'POST',
	headers: { Authorization: 'Bearer token' },
});
```

---

## Important Notes

### About `apiFetch()`

WordPress's `apiFetch()` function automatically handles permalink format detection:

-   Uses `/wp-json/` for pretty permalinks
-   Uses `/?rest_route=/` for plain permalinks
-   No code changes needed across different WordPress configurations!

---

## Testing REST API Calls

REST endpoints are tested with **Playwright API specs** in
`src/API/__tests__/*.api.spec.js`, and user flows with Playwright E2E tests in
`e2e/` — see [TESTING.md](./TESTING.md). Do **not** set up PHPUnit +
wp-phpunit integration tests for REST endpoints; this repo deliberately avoids
the WordPress PHP test suite for API testing.

## Related Documentation

-   [REST_API_BACKEND.md](./REST_API_BACKEND.md) - Backend security standards and controller template
-   [TESTING.md](./TESTING.md) - Testing architecture
