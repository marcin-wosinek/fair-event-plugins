# Instagram connection

**Fair Events → Instagram** manages the Instagram professional account this
site publishes to. Turn the page on in Fair Events → Settings → Experimental
(**Instagram**). It is off by default, and only an administrator turns it on:
a connection already stored in Fair Audience does not. Until then Fair
Audience keeps managing that connection, and manual posting keeps working.
Turning the feature on moves the stored connection here without re-entering
it. A choice already saved in the Experimental settings, a
`FAIR_EVENTS_EXPERIMENTAL_FEATURE_INSTAGRAM` constant, the
`FAIR_EVENTS_EXPERIMENTAL_INTERNAL` master switch and the
`fair_events_experimental_feature_enabled` filter keep working as before.
That includes a site where an earlier release turned the feature on
automatically.

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

The connection API (`GET /fair-events-experimental/v1/instagram/connection`)
reports `managed_here` and, without any credential, an `ownership_reason`:

| `ownership_reason`           | Meaning                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `managed_here`               | This plugin owns the connection.                                                                                            |
| `audience_handoff_missing`   | The active Fair Audience is a release without the handoff, in the code that ran and in its files on disk. Update it.        |
| `audience_update_not_loaded` | Fair Audience's files on disk hand the connection over, but the code that ran did not: the update has not taken effect yet. |
| `not_claimed`                | Nothing blocks the handoff now, but this plugin did not claim it while the plugins loaded on that request.                  |
| `feature_disabled`           | The Instagram feature is off.                                                                                               |

The page recommends updating Fair Audience only for
`audience_handoff_missing`. A response without `managed_here` or with an
unknown reason is shown as an incomplete response, not as an old plugin.

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
- **"This site’s Fair Audience is older than this plugin"**
  (`audience_handoff_missing`): update Fair Audience. Until then, manage the
  connection in Fair Audience → Settings → Instagram.
- **"Fair Audience is updated, but the site still runs its previous code"**
  (`audience_update_not_loaded`): PHP is still running the earlier Fair
  Audience. This happens when a PHP opcode cache does not check file changes,
  or when a request runs while the update is still being copied. Clear the
  opcode cache or restart PHP (usually from the hosting control panel), then
  reload the page. If it stays, check that the deployed
  `fair-audience/fair-audience.php` is the one PHP loads, for example that no
  second copy of Fair Audience is active.
- **"Fair Events Experimental did not take over the Instagram connection"**
  (`not_claimed`): reload the page. If it stays, check the PHP error log for
  errors during plugin loading. The connection stays with Fair Audience and
  keeps working meanwhile.
- **"The site did not say who manages the Instagram connection"**: the
  response lacked the ownership fields. Reload the page. If it keeps
  happening, make sure no caching plugin, CDN or proxy caches responses under
  `/wp-json/`.

None of these lose stored credentials or posting records. To diagnose a site
with WP-CLI, compare the API response with the loaded constants:

```bash
wp eval 'var_dump( defined( "FAIR_AUDIENCE_INSTAGRAM_HANDOFF" ), defined( "FAIR_EVENTS_EXPERIMENTAL_INSTAGRAM_OWNER" ), \FairEventsExperimental\Instagram\Ownership::reason() );'
```

WP-CLI runs its own PHP process, so its result can differ from the web
server's when the web server's opcode cache is stale.
