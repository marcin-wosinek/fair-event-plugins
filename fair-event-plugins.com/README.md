# fair-event-plugins.com standalone site

Plain PHP endpoints and static pages hosted next to the fair-event-plugins.com
WordPress site: Stripe Connect hosted onboarding (`index.html`, `account.php`,
`account_link.php`) and the Instagram OAuth proxy (`oauth/`). This directory is
not an npm workspace; it has its own Composer project and test commands.

## Stripe SDK and API version

| SDK                        | Stripe API version  |
| -------------------------- | ------------------- |
| `stripe/stripe-php` 22.0.0 | `2026-09-30.endive` |

`Config::STRIPE_API_VERSION` pins the API version explicitly for both
endpoints. It matches the version SDK 22.0.0 was generated against
([version mapping](https://github.com/stripe/stripe-php/wiki)), so request
parameters and response objects stay consistent with the SDK's types. Until
#1817 the site ran SDK 12.1.0 on API version `2023-08-16`.

Upgrading again:

1. Read the [migration guides](https://github.com/stripe/stripe-php/wiki) and
   the changelog for every major between the current and target SDK, looking
   for changes to `accounts->create`, `accountLinks->create`, exceptions and
   the minimum PHP version.
2. Bump the SDK constraint and set `STRIPE_API_VERSION` to the target SDK's
   `Stripe\Util\ApiVersion::CURRENT`. Never let the two drift apart.
3. Run the unit tests and the test-mode smoke check below.

The connected-account model is unchanged by the upgrade: `account.php` still
calls `accounts->create()` without parameters, and `account_link.php` creates an
`account_onboarding` link. The smoke check prints the resulting account's
`type` and `controller` so a version bump that changes Stripe's defaults is
visible.

## Requirements

- PHP 8.0+ with `curl`, `json` and `mbstring` (SDK 22 requires PHP 7.4+;
  production runs PHP 8.3 on LiteSpeed).
- Configuration in `.env` (or the server environment):

    | Variable            | Value                                                             |
    | ------------------- | ----------------------------------------------------------------- |
    | `STRIPE_SECRET_KEY` | `sk_live_…` in production, `sk_test_…` everywhere else            |
    | `SITE_BASE_URL`     | Public site root, e.g. `https://fair-event-plugins.com` (no path) |

    `SITE_BASE_URL` builds Stripe's `return_url` and `refresh_url`. It must use
    https, except `http://localhost` / `http://127.0.0.1` for development. When
    either value is missing or invalid the endpoints answer
    `500 { "error": … }` and log the reason; they never echo provider details.

## Endpoints

| Endpoint                 | Request                   | Success       | Errors                                                                                              |
| ------------------------ | ------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `POST /account.php`      | —                         | `{ account }` | 405 non-POST, 500 configuration, 502 provider                                                       |
| `POST /account_link.php` | `{ "account": "acct_…" }` | `{ url }`     | 405 non-POST, 400 malformed JSON / invalid ID, 404 unknown account, 500 configuration, 502 provider |

Stripe's request ID, error code and message go to the PHP error log.

## Hosting: onboarding callbacks

Stripe sends the user back to `/return/{account}` (onboarding finished) or
`/refresh/{account}` (link expired or already used; the page requests a fresh
link). Both must serve `index.html`; `index.js` reads the route from the path.

The site root is shared with WordPress, so do **not** deploy an `.htaccess`
from this directory. Add these lines to the existing root `.htaccess`
**above** the `# BEGIN WordPress` block (LiteSpeed and Apache):

```apache
# BEGIN fair-event-plugins.com onboarding
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteRule ^(return|refresh)/acct_[A-Za-z0-9]+/?$ /index.html [L]
</IfModule>
# END fair-event-plugins.com onboarding
```

Also keep `.env`, `vendor/`, `src/`, `bin/`, `__tests__/`, `composer.*`,
`phpunit.xml` and `router.php` out of the public docroot, or deny them. Only
`index.*`, `account.php`, `account_link.php` and `oauth/` need to be public.

Verify after deploying:

```bash
curl -sI https://fair-event-plugins.com/return/acct_test123 | head -1   # 200, HTML
curl -sI https://fair-event-plugins.com/.env | head -1                  # 403/404
```

## Local development

```bash
composer install
cp .env.example .env   # or create .env with the variables above
php -S localhost:4242 router.php
```

`router.php` reproduces the callback rewrite and hides non-public files. Set
`SITE_BASE_URL=http://localhost:4242` locally.

## Tests

```bash
composer validate --strict
composer check-platform-reqs --no-dev
composer audit
composer test                      # PHPUnit, no network calls
```

The unit tests drive the real `StripeClient` through a fake HTTP transport and
cover the pinned API version, request parameters, response shapes, invalid
input, and configuration and provider failures.

### Stripe test-mode smoke check (opt-in)

Uses the real Stripe **test** API; it exits without calling Stripe unless
`STRIPE_SECRET_KEY` starts with `sk_test_` or `rk_test_`. No payments or
payouts are made.

```bash
composer smoke:stripe-test                         # create account + links, failure cases
composer smoke:stripe-test -- acct_existingTest    # also link pre-existing test accounts
```

It creates one test connected account and an onboarding link for it, requests a
second (refresh) link, checks unknown and invalid account IDs, and prints the
account's `type`/`controller`. To finish the manual check, open a printed link,
complete or abandon onboarding with Stripe's test data, and confirm `/return/…`
shows "Details submitted" and an expired link's `/refresh/…` redirects to a new
one.

Clean up the created test account afterwards:

```bash
composer smoke:stripe-test -- --delete acct_createdBySmoke
```
