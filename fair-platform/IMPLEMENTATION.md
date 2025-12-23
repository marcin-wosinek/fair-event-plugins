# Fair Platform - Mollie OAuth Integration

## Overview

This plugin provides a minimal OAuth proxy for Mollie Connect integration. It enables WordPress sites using Fair Event Plugins to connect their Mollie accounts while allowing fair-event-plugins.com to collect platform fees.

**Deployment**: This plugin runs on `fair-event-plugins.com` only.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ WordPress Site (Customer)                               │
│ - fair-payment plugin installed                         │
│ - Stores OAuth access/refresh tokens                    │
│ - Makes direct API calls to Mollie                      │
└────────────┬────────────────────────────────────────────┘
             │ 1. "Connect Mollie" clicked
             ↓
┌─────────────────────────────────────────────────────────┐
│ fair-event-plugins.com/oauth/authorize                  │
│ - Creates OAuth state                                    │
│ - Redirects to Mollie authorization page                │
└────────────┬────────────────────────────────────────────┘
             │ 2. User authorizes
             ↓
┌─────────────────────────────────────────────────────────┐
│ Mollie OAuth                                             │
│ - User logs in/signs up                                 │
│ - Grants permissions                                     │
│ - Redirects back with auth code                         │
└────────────┬────────────────────────────────────────────┘
             │ 3. Authorization code
             ↓
┌─────────────────────────────────────────────────────────┐
│ fair-event-plugins.com/oauth/callback                   │
│ - Exchanges code for tokens                             │
│ - Gets organization ID                                   │
│ - Returns tokens to WordPress site (one-time)           │
└────────────┬────────────────────────────────────────────┘
             │ 4. Tokens returned
             ↓
┌─────────────────────────────────────────────────────────┐
│ WordPress Site (Customer)                               │
│ - Stores tokens in database                             │
│ - Creates payments using OAuth token                    │
│ - Platform fee automatically deducted by Mollie         │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

### 1. Mollie Partner Account Setup

1. Create Mollie Partner account at https://www.mollie.com/partners
2. Verify business information
3. Contact `partners@mollie.com` to enable platform fees
4. Configure platform fee in dashboard:
   - Partners → Settings → Platform Fees
   - Example: 2% + €0.10 per transaction

### 2. OAuth Application

1. Go to Mollie Dashboard → Developers → Your Apps
2. Create new OAuth app
3. Configure:
   - **Name**: Fair Event Plugins
   - **Description**: Payment integration for event management
   - **Redirect URI**: `https://fair-event-plugins.com/oauth/callback`
   - **Scopes**:
     - `payments.read`
     - `payments.write`
     - `refunds.read`
     - `refunds.write`
     - `organizations.read`
   - **Co-branding**:
     - Upload Fair Event Plugins logo
     - Set brand color
     - Set back URL to `https://fair-event-plugins.com`
4. Save `client_id` and `client_secret`

### 3. Environment Variables

Store in `wp-config.php` or environment:

```php
define('MOLLIE_CLIENT_ID', 'app_xxxxxxxxxxxxx');
define('MOLLIE_CLIENT_SECRET', 'xxxxxxxxxxxxx'); // Keep secret!
define('MOLLIE_PLATFORM_FEE_PERCENTAGE', 2.0);
define('MOLLIE_PLATFORM_FEE_FIXED', 0.10);
```

## Plugin Structure

```
fair-platform/
├── fair-platform.php              # Main plugin file
├── IMPLEMENTATION.md              # This file
├── README.md                      # Plugin documentation
├── includes/
│   ├── class-oauth-handler.php    # OAuth flow handler
│   ├── class-state-manager.php    # State storage/verification
│   └── helpers.php                # Utility functions
└── endpoints/
    ├── authorize.php              # GET /oauth/authorize
    ├── callback.php               # GET /oauth/callback
    └── refresh.php                # POST /oauth/refresh
```

## Endpoints

### 1. `/oauth/authorize`

**Method**: GET
**Purpose**: Initiates OAuth flow

**Query Parameters**:
- `site_id` (required) - Unique identifier for WordPress site
- `return_url` (required) - WordPress callback URL
- `site_name` (optional) - Site name for logging
- `site_url` (optional) - Site URL for logging

**Flow**:
1. Generate secure state token
2. Store state + return_url in transient (10 min expiry)
3. Redirect to Mollie OAuth authorization page

**Example Request**:
```
GET https://fair-event-plugins.com/oauth/authorize?
    site_id=abc123&
    return_url=https://example.com/wp-admin/admin.php?page=mollie&
    site_name=Example%20Events&
    site_url=https://example.com
```

**Implementation**:
```php
// State format: sha256(site_id + random_bytes)
$state = hash('sha256', $site_id . bin2hex(random_bytes(32)));

// Store in WordPress transient (10 minutes)
set_transient("mollie_oauth_{$state}", [
    'site_id' => $site_id,
    'return_url' => $return_url,
    'site_name' => $site_name,
    'site_url' => $site_url,
    'timestamp' => time(),
], 600);

// Redirect to Mollie
$authorize_url = 'https://www.mollie.com/oauth2/authorize?' . http_build_query([
    'client_id' => MOLLIE_CLIENT_ID,
    'state' => $state,
    'scope' => 'payments.read payments.write refunds.read refunds.write organizations.read',
    'response_type' => 'code',
    'approval_prompt' => 'auto',
    'redirect_uri' => 'https://fair-event-plugins.com/oauth/callback',
]);

wp_redirect($authorize_url);
exit;
```

### 2. `/oauth/callback`

**Method**: GET
**Purpose**: Handles Mollie OAuth callback, exchanges code for tokens

**Query Parameters**:
- `code` (required) - Authorization code from Mollie
- `state` (required) - State token for CSRF protection
- `error` (optional) - Error code if authorization failed

**Flow**:
1. Verify state token
2. Exchange authorization code for tokens
3. Get organization ID
4. Log connection (optional)
5. Redirect to WordPress with tokens (one-time URL)
6. Clean up state

**Implementation**:
```php
// Verify state
$data = get_transient("mollie_oauth_{$state}");
if (!$data) {
    wp_die('Invalid or expired state token');
}

// Exchange code for tokens
$mollie = new \Mollie\Api\MollieApiClient();
$mollie->setApiKey(MOLLIE_CLIENT_SECRET);

$tokens = $mollie->oauthTokens->create([
    'grant_type' => 'authorization_code',
    'code' => $code,
    'redirect_uri' => 'https://fair-event-plugins.com/oauth/callback',
]);

// Get organization details
$mollie->setAccessToken($tokens->accessToken);
$organization = $mollie->organizations->current();

// Optional: Log connection
do_action('fair_platform_mollie_connected', [
    'site_id' => $data['site_id'],
    'organization_id' => $organization->id,
    'organization_name' => $organization->name,
    'site_url' => $data['site_url'],
]);

// Redirect to WordPress with tokens (one-time use)
$return_url = add_query_arg([
    'mollie_access_token' => $tokens->accessToken,
    'mollie_refresh_token' => $tokens->refreshToken,
    'mollie_expires_in' => $tokens->expiresIn,
    'mollie_organization_id' => $organization->id,
    'mollie_test_mode' => $organization->testMode ? '1' : '0',
], $data['return_url']);

// Clean up
delete_transient("mollie_oauth_{$state}");

wp_redirect($return_url);
exit;
```

### 3. `/oauth/refresh`

**Method**: POST
**Purpose**: Refreshes expired access tokens

**Request Body** (JSON):
```json
{
    "refresh_token": "refresh_xxxxxxxxxxxxx"
}
```

**Response** (JSON):
```json
{
    "access_token": "access_xxxxxxxxxxxxx",
    "expires_in": 3600
}
```

**Implementation**:
```php
// Verify request
$refresh_token = $_POST['refresh_token'] ?? '';
if (empty($refresh_token)) {
    wp_send_json_error(['message' => 'Missing refresh_token'], 400);
}

// Exchange refresh token for new access token
$mollie = new \Mollie\Api\MollieApiClient();
$mollie->setApiKey(MOLLIE_CLIENT_SECRET);

try {
    $tokens = $mollie->oauthTokens->create([
        'grant_type' => 'refresh_token',
        'refresh_token' => $refresh_token,
    ]);

    wp_send_json_success([
        'access_token' => $tokens->accessToken,
        'expires_in' => $tokens->expiresIn,
    ]);
} catch (Exception $e) {
    wp_send_json_error(['message' => $e->getMessage()], 401);
}
```

## Security Considerations

### 1. Client Secret Protection

- **Store in environment**: Never commit to Git
- **wp-config.php**: Use `define()` or environment variables
- **File permissions**: Ensure wp-config.php is not web-accessible

### 2. State Token Verification

- **CSRF protection**: State token prevents cross-site request forgery
- **Expiry**: Transients auto-expire after 10 minutes
- **Uniqueness**: Combine site_id + random bytes

### 3. HTTPS Required

- **All endpoints**: Must use HTTPS
- **Redirect URIs**: Must match exactly what's registered in Mollie
- **Token transmission**: Tokens only sent over encrypted connection

### 4. Input Validation

```php
// Sanitize all inputs
$site_id = sanitize_text_field($_GET['site_id']);
$return_url = esc_url_raw($_GET['return_url']);

// Validate return URL (must be HTTPS)
if (parse_url($return_url, PHP_URL_SCHEME) !== 'https') {
    wp_die('Return URL must use HTTPS');
}
```

### 5. Rate Limiting

```php
// Limit OAuth attempts per IP
$ip = $_SERVER['REMOTE_ADDR'];
$attempts = get_transient("mollie_oauth_attempts_{$ip}") ?: 0;

if ($attempts >= 10) {
    wp_die('Too many requests. Please try again later.');
}

set_transient("mollie_oauth_attempts_{$ip}", $attempts + 1, 3600);
```

## Optional Features

### 1. Connection Logging

Track successful Mollie connections:

```php
// Log to custom table or WordPress options
add_action('fair_platform_mollie_connected', function($data) {
    $log_entry = [
        'site_id' => $data['site_id'],
        'organization_id' => $data['organization_id'],
        'organization_name' => $data['organization_name'],
        'site_url' => $data['site_url'],
        'connected_at' => current_time('mysql'),
    ];

    // Store in database or send notification
    update_option('fair_platform_connections',
        array_merge(get_option('fair_platform_connections', []), [$log_entry])
    );
});
```

### 2. Admin Dashboard

Display connected sites (optional):

```php
// Admin page showing connections
add_action('admin_menu', function() {
    add_menu_page(
        'Mollie Connections',
        'Mollie Connections',
        'manage_options',
        'fair-platform-connections',
        'render_connections_page'
    );
});

function render_connections_page() {
    $connections = get_option('fair_platform_connections', []);

    echo '<div class="wrap">';
    echo '<h1>Connected Sites</h1>';
    echo '<table class="wp-list-table widefat">';
    echo '<thead><tr>';
    echo '<th>Site</th>';
    echo '<th>Organization</th>';
    echo '<th>Connected</th>';
    echo '</tr></thead>';
    echo '<tbody>';

    foreach ($connections as $conn) {
        echo '<tr>';
        echo '<td>' . esc_html($conn['site_url']) . '</td>';
        echo '<td>' . esc_html($conn['organization_name']) . '</td>';
        echo '<td>' . esc_html($conn['connected_at']) . '</td>';
        echo '</tr>';
    }

    echo '</tbody></table>';
    echo '</div>';
}
```

### 3. Webhook for Platform Fees

Track platform fee earnings (optional):

```php
// Mollie webhook for platform account
add_action('rest_api_init', function() {
    register_rest_route('fair-platform/v1', '/webhook', [
        'methods' => 'POST',
        'callback' => 'handle_mollie_webhook',
        'permission_callback' => '__return_true',
    ]);
});

function handle_mollie_webhook($request) {
    $payment_id = $request->get_param('id');

    // Verify webhook and process platform fee payment
    // This is for YOUR platform account payments, not client payments
}
```

## WordPress Integration (Client Plugin)

This is how the fair-payment plugin should integrate:

### Connection Button

```php
// admin/settings-page.php
function render_mollie_connection() {
    $connected = get_option('mollie_access_token');

    if ($connected) {
        echo '<p>✅ Connected to Mollie</p>';
        echo '<p>Organization: ' . esc_html(get_option('mollie_organization_id')) . '</p>';
        echo '<a href="' . esc_url(admin_url('admin-post.php?action=mollie_disconnect')) . '" class="button">Disconnect</a>';
    } else {
        $connect_url = add_query_arg([
            'site_id' => get_mollie_site_id(),
            'return_url' => admin_url('admin.php?page=mollie-settings&action=callback'),
            'site_name' => get_bloginfo('name'),
            'site_url' => home_url(),
        ], 'https://fair-event-plugins.com/oauth/authorize');

        echo '<a href="' . esc_url($connect_url) . '" class="button button-primary">Connect with Mollie</a>';
        echo '<p class="description">Platform fee: 2% + €0.10 per transaction</p>';
    }
}
```

### Callback Handler

```php
// includes/oauth-callback.php
add_action('admin_init', function() {
    if (!isset($_GET['mollie_access_token']) || !isset($_GET['page']) || $_GET['page'] !== 'mollie-settings') {
        return;
    }

    if (!current_user_can('manage_options')) {
        wp_die('Unauthorized');
    }

    // Store tokens
    update_option('mollie_access_token', sanitize_text_field($_GET['mollie_access_token']));
    update_option('mollie_refresh_token', sanitize_text_field($_GET['mollie_refresh_token']));
    update_option('mollie_token_expires', time() + intval($_GET['mollie_expires_in']));
    update_option('mollie_organization_id', sanitize_text_field($_GET['mollie_organization_id']));
    update_option('mollie_test_mode', $_GET['mollie_test_mode'] === '1');

    // Redirect to remove tokens from URL
    wp_redirect(admin_url('admin.php?page=mollie-settings&status=connected'));
    exit;
});
```

### Token Refresh

```php
// includes/token-refresh.php
function get_mollie_access_token() {
    $access_token = get_option('mollie_access_token');
    $expires = get_option('mollie_token_expires', 0);

    // Token still valid
    if ($access_token && time() < $expires) {
        return $access_token;
    }

    // Refresh token
    $refresh_token = get_option('mollie_refresh_token');
    if (!$refresh_token) {
        throw new Exception('No refresh token available. Please reconnect Mollie.');
    }

    $response = wp_remote_post('https://fair-event-plugins.com/oauth/refresh', [
        'body' => ['refresh_token' => $refresh_token],
        'timeout' => 15,
    ]);

    if (is_wp_error($response)) {
        throw new Exception('Failed to refresh token: ' . $response->get_error_message());
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);

    if (!isset($body['success']) || !$body['success']) {
        // Refresh failed - user needs to reconnect
        delete_option('mollie_access_token');
        delete_option('mollie_refresh_token');
        throw new Exception('Token refresh failed. Please reconnect Mollie.');
    }

    // Update stored token
    $new_token = $body['data']['access_token'];
    $expires_in = $body['data']['expires_in'];

    update_option('mollie_access_token', $new_token);
    update_option('mollie_token_expires', time() + $expires_in);

    return $new_token;
}
```

## Testing

### 1. Test Mode

Mollie OAuth supports test mode:
- Create payments in test mode using test access tokens
- Platform fees still apply (but in test mode)
- Use test bank accounts for payments

### 2. Test Flow

1. Create test OAuth app in Mollie dashboard
2. Use test credentials in fair-platform plugin
3. Connect from WordPress test site
4. Create test payments
5. Verify platform fee appears in test mode

### 3. Error Scenarios

Test these scenarios:
- ❌ Invalid state token → Should show error
- ❌ Expired state (>10 min) → Should show error
- ❌ User denies authorization → Should show error
- ❌ Invalid refresh token → Should prompt reconnect
- ✅ Token refresh → Should work seamlessly
- ✅ Multiple sites → Each gets own tokens

## Deployment Checklist

- [ ] Create Mollie Partner account
- [ ] Create OAuth app in Mollie dashboard
- [ ] Enable platform fees (contact Mollie)
- [ ] Set up fair-event-plugins.com WordPress site
- [ ] Install fair-platform plugin
- [ ] Configure environment variables (client_id, client_secret)
- [ ] Test OAuth flow in test mode
- [ ] Update fair-payment plugin with OAuth integration
- [ ] Test end-to-end: Connect → Create payment → Verify fee
- [ ] Document platform fee in plugin description
- [ ] Go live with production credentials

## Monitoring & Maintenance

### Logs to Monitor

- OAuth connection attempts
- Token refresh failures
- Platform fee payments received
- Error rates on endpoints

### Regular Tasks

- Review connected sites monthly
- Monitor platform fee earnings
- Check for OAuth app updates from Mollie
- Update Mollie API client library

## Support & Documentation

### For WordPress Users

Provide documentation:
- How to connect Mollie account
- Platform fee explanation
- Troubleshooting connection issues
- How to disconnect/reconnect

### Support Scenarios

**"Connection failed"**
- Check return_url is HTTPS
- Verify state hasn't expired
- Check Mollie dashboard for errors

**"Payments not working"**
- Verify access token is valid
- Check token expiry
- Test token refresh
- Verify organization is fully onboarded in Mollie

**"Platform fee questions"**
- Platform fee: 2% + €0.10 per transaction
- Automatically deducted by Mollie
- Visible in Mollie dashboard transaction details

## Future Enhancements

1. **Split Payments API**: For marketplaces with multiple sellers
2. **Analytics Dashboard**: Track connected sites and fee revenue
3. **Automated Onboarding**: Pre-fill more customer data
4. **Multi-currency Support**: Handle different currencies
5. **Subscription Support**: For recurring events/memberships

## Resources

- [Mollie Connect Documentation](https://docs.mollie.com/docs/connect-platforms-getting-started)
- [Mollie OAuth API Reference](https://docs.mollie.com/reference/oauth-api)
- [Mollie PHP Client](https://github.com/mollie/mollie-api-php)
- [Platform Fees Guide](https://docs.mollie.com/docs/connect-platforms-example-integration)
