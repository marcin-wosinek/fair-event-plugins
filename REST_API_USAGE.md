# REST API Usage Across Fair Event Plugins

This document lists all JavaScript files that make REST API calls and whether they use hardcoded paths or dynamic URLs.

## Summary

- ✅ **Using `apiFetch()` (automatically handles permalinks)**: 18 files
- ℹ️ **Non-WordPress REST APIs**: 1 file

## Best Practices for WordPress REST API Calls

### 1. Always Use `apiFetch()` for WordPress REST APIs

**Required**: All WordPress REST API calls MUST use `apiFetch()` from `@wordpress/api-fetch`.

**Why?** WordPress's `apiFetch()` automatically handles:
- ✅ Permalink format detection (pretty permalinks vs plain permalinks)
- ✅ Nonce authentication
- ✅ Proper error handling
- ✅ Request/response interceptors

### 2. Hardcoded Paths Are Preferred

**Use hardcoded paths** - they are clear, explicit, and maintainable:

```javascript
// ✅ GOOD - Hardcoded path
await apiFetch({
    path: '/fair-payment/v1/payments',
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
    'blocks/my-block/view': 'src/blocks/my-block/view.js',  // Add this line
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
- Bundle the JavaScript with ES6 imports
- Create `view.asset.php` with `wp-api-fetch` dependency
- WordPress will load dependencies before your script

### 4. Path Format Rules

**Always use absolute paths starting with `/`:**

```javascript
// ✅ GOOD
path: '/fair-payment/v1/payments'

// ❌ BAD - Missing leading slash
path: 'fair-payment/v1/payments'
```

**Format:** `/{plugin-namespace}/{version}/{endpoint}`

### 5. Error Handling Pattern

`apiFetch()` errors may have nested message properties:

```javascript
try {
    const data = await apiFetch({
        path: '/fair-payment/v1/payments',
        method: 'POST',
        data: { amount: '10.00' },
    });
    // Handle success
} catch (error) {
    // apiFetch errors may have message in different places
    const errorMessage =
        error.message ||
        (error.data && error.data.message) ||
        'Request failed';
    console.error('Payment error:', errorMessage);
}
```

### 6. Method and Data Parameters

```javascript
// GET request (default method)
await apiFetch({
    path: '/fair-rsvp/v1/events',
});

// POST request with data
await apiFetch({
    path: '/fair-payment/v1/payments',
    method: 'POST',
    data: {
        amount: '10.00',
        currency: 'EUR',
    },
});

// DELETE request
await apiFetch({
    path: `/fair-rsvp/v1/rsvps/${rsvpId}`,
    method: 'DELETE',
});
```

### 7. When NOT to Use apiFetch()

Only use raw `fetch()` for **non-WordPress REST APIs**:

```javascript
// External service (not WordPress REST API)
await fetch('https://api.external-service.com/endpoint', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer token' },
});
```

---

## Important Notes

### About `apiFetch()`

WordPress's `apiFetch()` function automatically handles permalink format detection:
- Uses `/wp-json/` for pretty permalinks
- Uses `/?rest_route=/` for plain permalinks
- No code changes needed across different WordPress configurations!

---

## Testing Strategy for REST API Calls

### Recommended Testing Approach

We recommend a **three-layer testing strategy** for REST API functionality:

### 1. PHP Integration Tests (Highest Priority) ⭐

**What to test**: REST endpoint handlers using WordPress test framework

**Why**: These tests verify your API endpoints work correctly with WordPress, handle authentication, validate data, and return proper responses.

**Location**: `__tests__/rest-api/` or `tests/rest-api/`

**Example Structure**:
```php
// __tests__/rest-api/PaymentEndpointTest.php
class PaymentEndpointTest extends WP_REST_TestCase {

    public function test_create_payment_requires_authentication() {
        $request = new WP_REST_Request('POST', '/fair-payment/v1/payments');
        $request->set_body_params([
            'amount' => '10.00',
            'currency' => 'EUR',
        ]);

        $response = rest_do_request($request);

        $this->assertEquals(401, $response->get_status());
    }

    public function test_create_payment_validates_amount() {
        wp_set_current_user($this->factory->user->create(['role' => 'subscriber']));

        $request = new WP_REST_Request('POST', '/fair-payment/v1/payments');
        $request->set_body_params([
            'amount' => 'invalid',
            'currency' => 'EUR',
        ]);

        $response = rest_do_request($request);

        $this->assertEquals(400, $response->get_status());
        $this->assertStringContainsString('amount', $response->get_data()['message']);
    }

    public function test_create_payment_success() {
        wp_set_current_user($this->factory->user->create(['role' => 'subscriber']));

        $request = new WP_REST_Request('POST', '/fair-payment/v1/payments');
        $request->set_body_params([
            'amount' => '10.00',
            'currency' => 'EUR',
            'description' => 'Test payment',
            'post_id' => 1,
        ]);

        $response = rest_do_request($request);

        $this->assertEquals(201, $response->get_status());
        $data = $response->get_data();
        $this->assertTrue($data['success']);
        $this->assertArrayHasKey('checkout_url', $data);
    }

    public function test_endpoint_handles_both_permalink_formats() {
        // WordPress automatically handles this, but verify both work
        wp_set_current_user($this->factory->user->create(['role' => 'subscriber']));

        // Test pretty permalinks
        update_option('permalink_structure', '/%postname%/');
        $this->assertTrue($this->endpoint_is_accessible());

        // Test plain permalinks
        update_option('permalink_structure', '');
        $this->assertTrue($this->endpoint_is_accessible());
    }

    private function endpoint_is_accessible() {
        $request = new WP_REST_Request('POST', '/fair-payment/v1/payments');
        $request->set_body_params([
            'amount' => '10.00',
            'currency' => 'EUR',
        ]);
        $response = rest_do_request($request);
        return $response->get_status() !== 404;
    }
}
```

**Run with**:
```bash
vendor/bin/phpunit __tests__/rest-api/
```

### 2. E2E Tests (Lower Priority, High Value) ⭐

**What to test**: Full user flows from browser interaction through API to database

**Why**: Verify the complete integration works in a real browser with real WordPress, catching issues unit tests miss.

**Tool**: Playwright (already configured in some plugins)

**Location**: `__tests__/e2e/`
