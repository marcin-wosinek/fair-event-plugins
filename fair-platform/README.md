# Fair Platform - Mollie OAuth Integration Plugin

A minimal WordPress plugin that provides OAuth proxy endpoints for Mollie Connect integration. This enables WordPress sites using Fair Event Plugins to connect their Mollie accounts while allowing fair-event-plugins.com to collect platform fees.

## Purpose

This plugin runs **exclusively on fair-event-plugins.com** and provides three simple endpoints:

1. **`/oauth/authorize`** - Initiates Mollie OAuth flow
2. **`/oauth/callback`** - Handles OAuth callback and token exchange
3. **`/oauth/refresh`** - Refreshes expired access tokens

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
   - Select scopes: `payments.read`, `payments.write`, `refunds.read`, `refunds.write`, `organizations.read`

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

Client plugins (like fair-payment) connect by redirecting users to:

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
