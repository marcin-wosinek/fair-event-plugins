=== Fair Platform - Mollie OAuth Integration ===
Contributors: marcinwosinek
Tags: mollie, oauth, payment, platform
Requires at least: 6.7
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 1.0.0
License: Private
License URI: https://fair-event-plugins.com

OAuth proxy for Mollie Connect integration. Runs exclusively on fair-event-plugins.com to enable platform fees.

== Description ==

**IMPORTANT**: This is a private plugin that runs exclusively on fair-event-plugins.com. It is NOT available on WordPress.org and should NOT be installed on client websites.

This plugin provides OAuth proxy endpoints for Mollie Connect integration, enabling WordPress sites using Fair Event Plugins to connect their Mollie accounts while allowing fair-event-plugins.com to collect platform fees.

**Features:**

* OAuth authorization flow (`/oauth/authorize`)
* OAuth callback handling (`/oauth/callback`)
* Token refresh endpoint (`/oauth/refresh`)
* Stateless architecture (no token storage)
* CSRF protection with state tokens
* HTTPS-only security

**How It Works:**

1. Client site redirects user to fair-event-plugins.com/oauth/authorize
2. Platform redirects to Mollie for authorization
3. Mollie redirects back to platform with authorization code
4. Platform exchanges code for tokens and returns them to client site
5. Client site stores tokens and uses them for payments
6. Platform fees are automatically deducted by Mollie

**Security:**

* Client secret stored only on fair-event-plugins.com
* State tokens expire after 10 minutes
* All communication over HTTPS
* No token storage on platform (stateless)
* Rate limiting on OAuth endpoints

== Installation ==

**This plugin should ONLY be installed on fair-event-plugins.com.**

1. Deploy plugin to fair-event-plugins.com
2. Configure Mollie OAuth credentials in `wp-config.php`:
   ```php
   define('MOLLIE_CLIENT_ID', 'app_xxxxxxxxxxxxx');
   define('MOLLIE_CLIENT_SECRET', 'xxxxxxxxxxxxx');
   ```
3. Activate the plugin
4. Verify endpoints are accessible:
   - https://fair-event-plugins.com/oauth/authorize
   - https://fair-event-plugins.com/oauth/callback
   - https://fair-event-plugins.com/oauth/refresh

== Prerequisites ==

Before using this plugin, you must:

1. Create Mollie Partner account (https://www.mollie.com/partners)
2. Complete business verification
3. Create OAuth application in Mollie Dashboard
4. Set redirect URI: https://fair-event-plugins.com/oauth/callback
5. Enable platform fees (contact partners@mollie.com)

See IMPLEMENTATION.md for detailed setup instructions.

== Frequently Asked Questions ==

= Can I install this on my WordPress site? =

No. This plugin is designed to run exclusively on fair-event-plugins.com as an OAuth proxy. Client sites should use the fair-payment plugin instead.

= How do platform fees work? =

Platform fees are configured in your Mollie Partner dashboard and automatically deducted by Mollie from each payment. The platform does not handle fee calculation or splitting.

= Where are tokens stored? =

Tokens are NOT stored on fair-event-plugins.com. They are passed directly to the client site via the return URL and stored there.

== Changelog ==

= 1.0.0 =
* Initial release
* OAuth authorization flow
* OAuth callback handling
* Token refresh endpoint
* Admin status page

== Upgrade Notice ==

= 1.0.0 =
Initial release
