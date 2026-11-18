# Instagram connection

**Fair Events → Instagram** manages the Instagram professional account this
site publishes to. Turn the page on in Fair Events → Settings → Experimental
(**Instagram**). It is off by default. A site that was already connected in
Fair Audience has it turned on once, automatically, on the first request after
the update.

## Requirements

- An Instagram **professional** (business or creator) account.
- One of two ways to connect:
    - **Connect with Instagram** signs in through the Fair Event Plugins OAuth
      service (`fair-event-plugins.com/oauth/instagram/…`, run by Fair
      Platform). The site must be served over HTTPS, because the service only
      returns to an `https` URL.
    - **Enter an access token**: an Instagram API (Instagram Login) token with
      `instagram_business_basic` and `instagram_business_content_publish`.
- The **user ID** of the account, which Instagram needs for publishing.
  **Test connection** fills it in.
- PHP Sodium support (the default in PHP 7.2+), so the token can be stored
  encrypted.

The token is stored encrypted (`ProtectedOptions` in fair-events-shared) and
is never returned to the browser. The page shows the username, user ID and
token expiry only.

## Token renewal

A daily cron event (`fair_events_experimental_instagram_token_refresh`)
renews the token through the OAuth service during its last 7 days, or when
its expiry is not known. Failures are written to the PHP error log without
the token, and the next daily run tries again. When a token has expired,
connect again.

## Who owns the connection

The stored options keep their Fair Audience names
(`fair_audience_instagram_*`), so moving the connection needs no re-entry.
Exactly one plugin protects the token and exactly one renews it on each
request. `FairEventsExperimental\Instagram\Ownership` decides:

| State                                                          | Token storage and settings             | Renewal                                                    |
| -------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| Instagram feature off                                          | Fair Audience                          | Fair Audience Experimental                                 |
| Feature on, Fair Audience updated or inactive                  | Fair Events Experimental               | Fair Events Experimental                                   |
| Feature on, Fair Audience older than this release              | Fair Audience (page says to update it) | Fair Audience Experimental                                 |
| Feature on, Fair Audience Experimental older than this release | Fair Events Experimental               | Fair Audience Experimental (if its Instagram bundle is on) |

While Fair Events Experimental owns the connection, Fair Audience → Settings
→ Instagram links here, and Fair Audience no longer offers the token in
`/wp/v2/settings`. Manual posts (Fair Audience → Instagram Posts) keep their
location and records, and publish with the same account. Turning the feature
off hands the connection back to Fair Audience on the next request.

## Recovering

- **"Instagram is paused"**: the server lost Sodium support. Restore it; the
  connection resumes without reconnecting.
- **"Instagram needs to be reconnected"**: the stored token can no longer be
  decrypted. This happens when the site's security keys change or the
  database moved to another site. Connect again, or disconnect to remove it.
- **"Instagram refused the access token"**: the token is invalid, expired or
  revoked. Connect again.
- **"Fair Audience … still manages the Instagram connection"**: update Fair
  Audience. Until then, manage the connection in Fair Audience → Settings →
  Instagram.
