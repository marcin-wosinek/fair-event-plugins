# Fair Platform - Mollie OAuth Integration Plugin

A minimal WordPress plugin that provides OAuth proxy endpoints for Mollie Connect integration. This enables WordPress sites using Fair Event Plugins to connect their Mollie accounts while allowing fair-event-plugins.com to collect platform fees.

## Purpose

This plugin runs **exclusively on fair-event-plugins.com** and provides three simple Mollie endpoints, plus the Instagram connection endpoints described in [Instagram connections](#instagram-connections-meta-unified-login):

1. **`/oauth/authorize`** - Initiates Mollie OAuth flow
2. **`/oauth/callback`** - Handles OAuth callback and token exchange
3. **`/oauth/refresh`** - Refreshes expired access tokens

A public health route, `GET /wp-json/fair-platform/v1/health`, reports whether the proxy is running and configured. It is used by the post-deploy check and the uptime monitor; see [DEPLOYMENT.md § OAuth proxy monitoring](../DEPLOYMENT.md#oauth-proxy-monitoring-fair-event-pluginscom).

The plugin does NOT store customer tokens or payment data. It only facilitates the OAuth connection.

## Installation

**This plugin should ONLY be installed on fair-event-plugins.com.**

### Automated Deployment (Recommended)

This plugin uses GitHub Actions for automated deployment. To set up:

```bash
# Run the interactive setup script from the monorepo root
./scripts/setup-fair-platform-deployment.sh
```

The script will:
- Generate SSH keys for deployment
- Test the connection to fair-event-plugins.com
- Detect the WordPress plugins directory
- Provide the exact GitHub secrets to configure
- Save configuration for reference

After setup, the plugin automatically deploys when:
- Changes are pushed to the `main` branch (after CI passes)
- Manual deployment is triggered via GitHub Actions

See: `.github/workflows/deploy-fair-platform.yml`

### Manual Installation

1. Deploy this plugin to fair-event-plugins.com
2. Configure Mollie OAuth credentials in `wp-config.php`:

```php
define('MOLLIE_CLIENT_ID', 'app_xxxxxxxxxxxxx');
define('MOLLIE_CLIENT_SECRET', 'xxxxxxxxxxxxx');
define('MOLLIE_PLATFORM_FEE_PERCENTAGE', 2.0);
define('MOLLIE_PLATFORM_FEE_FIXED', 0.10);
```

3. Activate the plugin
4. Verify endpoints are accessible:
   - `https://fair-event-plugins.com/oauth/authorize`
   - `https://fair-event-plugins.com/oauth/callback`
   - `https://fair-event-plugins.com/oauth/refresh`

## Prerequisites

Before using this plugin, you must:

1. **Create Mollie Partner Account**
   - Sign up at https://www.mollie.com/partners
   - Complete business verification

2. **Create OAuth Application**
   - Go to Mollie Dashboard → Developers → Your Apps
   - Create new OAuth app
   - Set redirect URI: `https://fair-event-plugins.com/oauth/callback`
   - Select scopes: `payments.read`, `payments.write`, `refunds.read`, `refunds.write`, `organizations.read`, `profiles.read`, `profiles.write`, `balances.read`, and `settlements.read` (requested only by sites running Fair Finance)

3. **Enable Platform Fees**
   - Contact partners@mollie.com
   - Request platform fee activation
   - Configure fee amount in Mollie dashboard

## How It Works

```
WordPress Site → fair-event-plugins.com → Mollie OAuth → WordPress Site
    (1)                  (2)                  (3)              (4)

1. User clicks "Connect Mollie" in WordPress plugin
2. Plugin redirects to fair-event-plugins.com/oauth/authorize
3. fair-event-plugins.com redirects to Mollie for authorization
4. After authorization, Mollie redirects back to fair-event-plugins.com/oauth/callback
5. Plugin exchanges code for tokens and returns them to WordPress site
6. WordPress site stores tokens and uses them for payments
```

## Security

- ✅ Client secret stored only on fair-event-plugins.com (never on client sites)
- ✅ CSRF protection via state tokens
- ✅ State tokens expire after 10 minutes
- ✅ Tokens transmitted over HTTPS only
- ✅ No token storage on fair-event-plugins.com (stateless)
- ✅ Rate limiting on OAuth endpoints

## Usage

Client plugins (like fair-payments-connector) connect by redirecting users to:

```
https://fair-event-plugins.com/oauth/authorize?
    site_id=abc123&
    return_url=https://example.com/wp-admin/admin.php?page=mollie&
    site_name=Example%20Events&
    site_url=https://example.com
```

After successful authorization, tokens are returned to the `return_url`:

```
https://example.com/wp-admin/admin.php?page=mollie&
    mollie_access_token=access_xxxxx&
    mollie_refresh_token=refresh_xxxxx&
    mollie_expires_in=3600&
    mollie_organization_id=org_xxxxx&
    mollie_test_mode=0
```

## Instagram connections (Meta Unified Login)

Fair Events Experimental connects a site's Instagram professional account
through this plugin, with Meta's Instagram API with Unified Login (Facebook
Login for Business with a configuration ID, #2427). The older Instagram Login
flow is retired: requests from older client plugins are refused with an
"update" page, and `/oauth/instagram/refresh` answers `410 Gone`.

### Endpoints

1. **`/oauth/instagram/authorize`**: a site's server starts an attempt with
   `protocol=2`, its `site_url`, the exact return destination (its
   `wp-admin/admin.php?page=fair-events-instagram`), an S256
   `code_challenge` of a verifier only that server knows, and its own
   `state`. The attempt is stored encrypted under a single-use state for 10
   minutes, and the administrator goes to Meta's login dialog with
   `config_id`, `response_type=code` and `override_default_response_type=true`.
2. **`/oauth/instagram/callback`**: consumes the state first, then exchanges
   the code server side, checks the token with `debug_token` (valid, this
   app, `instagram_basic` and `instagram_content_publish` granted) and
   requires exactly one account in `/me/assigned_instagram_accounts`. The
   credentials are stored encrypted under a single-use handoff code for 5
   minutes, and only that code returns to the site
   (`instagram_handoff`, `state`). Any failure returns `instagram_error`
   (`cancelled`, `insufficient_permissions`, `no_account`,
   `multiple_accounts`, `exchange_failed`, `authorization_failed`,
   `server_error`) and stores nothing.
3. **`POST /wp-json/fair-platform/v1/instagram/redeem`**: the site's server
   redeems the handoff code with its verifier and `site_url`. Each code works
   once, whatever the outcome; the access token is never in a URL or a
   browser response.

Attempts and handoffs live in `{prefix}options` as
`fair_platform_once_ig_state_*` and `fair_platform_once_ig_handoff_*` rows
(SHA-256 of the key as the name, the value encrypted with the site's salts).
Expired rows are removed as new ones are written. Each attempt is logged in
Fair Platform → Instagram Connections without any credential.

### Configuration

```php
define( 'META_APP_ID', '1234567890' );            // Meta app ID (not the Instagram app ID).
define( 'META_APP_SECRET', 'xxxxxxxxxxxxx' );
define( 'META_INSTAGRAM_CONFIG_ID', '1234567890' ); // Unified Login configuration ID.
define( 'META_GRAPH_VERSION', 'v27.0' );          // Optional; v27.0 by default.
```

`INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` are no longer read.

In the Meta app (Use cases → Instagram API → **API setup with Unified login**):

- Create or edit the configuration: login variation **General**, access
  token **System-user access token**, expiration **Never**.
- Assets: **Instagram accounts**, with **Asset Required**. No Pages and no ad
  accounts are needed.
- Permissions: `instagram_basic` and `instagram_content_publish` (the preset
  always includes `instagram_manage_messages` as well).
  `business_management` and the ads permissions are not needed.
- Valid OAuth redirect URI: `https://fair-event-plugins.com/oauth/instagram/callback`.
- In development mode only people with a role on the app can connect, with
  Standard Access. Other businesses need Advanced Access through App Review
  and Business Verification, with the app in Live mode.

The token is a business integration system-user token that does not expire.
Nothing renews it. It stops working when the business removes the app under
Meta Business Settings → Integrations → Connected apps; removing it there is
also how a business revokes access. Removing it resets which accounts the
business shares, so it helps when Meta keeps offering accounts shared before.

## Platform Fees

Platform fees are configured in your Mollie Partner dashboard and automatically deducted by Mollie from each payment. You don't need to handle fee calculation or splitting in code.

**Example**:
- Platform fee: 2% + €0.10
- Customer pays: €10.00
- Your fee: €0.30 (€0.20 + €0.10)
- Client receives: €9.70

## Development

See [IMPLEMENTATION.md](./IMPLEMENTATION.md) for detailed technical documentation.

## Support

For issues with this plugin, contact: support@fair-event-plugins.com

For Mollie integration questions: partners@mollie.com

## License

Private plugin - not for redistribution.
