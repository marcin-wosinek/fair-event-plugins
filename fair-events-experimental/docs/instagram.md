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

- An Instagram **professional** (business or creator) account, in a Meta
  business portfolio.
- **Connect with Instagram** signs in through Meta's Unified Login (#2427)
  via the Fair Event Plugins OAuth service
  (`fair-event-plugins.com/oauth/instagram/…`, run by Fair Platform). The
  administrator signs in with Facebook, chooses the business, and shares
  exactly one Instagram account. The site must be served over HTTPS; plain
  HTTP is accepted only on `localhost`.
- While the Fair Event Plugins Meta app is in development mode, only people
  with a role on that app can connect.
- PHP Sodium support (the default in PHP 7.2+), so the token and the
  connection attempt are stored encrypted.

There is no manual token entry and no editable account ID: the OAuth service
identifies the account Meta shared.

## How connecting works

1. **Connect with Instagram** asks this site's server to start. It creates a
   state and a verifier for the administrator, keeps them encrypted for 15
   minutes, and sends the browser to the OAuth service with the verifier's
   challenge, the site address and this page as the only return
   destination.
2. After Meta's dialog, the service returns to Fair Events → Instagram with
   the state and a single-use handoff code (or `instagram_error`). The page
   removes them from the address bar and sends them to this site's server.
3. The server checks the state against the administrator's attempt (used up
   either way), redeems the handoff code with the verifier, server to server,
   and checks the credentials: a token, its type, `instagram_basic` and
   `instagram_content_publish`, the account ID and the Graph API version.
4. The token is stored first. If it cannot be stored encrypted, the previous
   connection is kept as it was. Then the account and the metadata are
   written, and the connection-format marker last.

A cancelled or failed authorization changes nothing. The page explains what
to do: allow every permission, share an account, or share only one. If Meta
keeps sharing accounts chosen earlier, remove the app under Meta Business
Settings → Integrations → Connected apps first.

The token, the verifier and the handoff code are never returned in a
response or written to a log.

## Token lifetime

The token is a business integration system-user token that does not expire,
and nothing renews it: the daily renewal of earlier releases
(`fair_events_experimental_instagram_token_refresh`) is removed on every
request. A token Meta reports with a finite expiry is stored with it and
stops being used once it passes; connect again before then.

Stored with the token (all names kept from Fair Audience):

| Option                                      | Value                                         |
| ------------------------------------------- | --------------------------------------------- |
| `fair_audience_instagram_connection_format` | `unified_login`, written last                 |
| `fair_audience_instagram_token_type`        | `system_user` (or `user`)                     |
| `fair_audience_instagram_scopes`            | Granted permissions                           |
| `fair_audience_instagram_token_expiry`      | `never` or `expires`                          |
| `fair_audience_instagram_token_expires`     | Expiry; 2100-01-01 for `never`, so releases older than #2427 never try to renew it |
| `fair_audience_instagram_graph_version`     | Graph API version, such as `v27.0`            |

Publishing, the connection test and Fair Audience → Instagram Posts call
`graph.facebook.com/{version}/{account ID}` with the token in an
`Authorization` header.

## Connections from before Unified Login

Every connection stored before #2427 has no format marker and must be
reconnected. It stays stored and encrypted, but it is never used to test,
publish or renew. The page asks to reconnect, and manual posts in Fair
Audience say where. Posts already published, and their records, are kept.

Older client plugins can no longer connect: the OAuth service refuses their
requests with an "update" page, and their token renewal gets `410 Gone`.
Update Fair Events Experimental, Fair Audience and Fair Audience
Experimental before reconnecting; see
[DEPLOYMENT.md § Upgrade notes: Instagram Unified Login](../../DEPLOYMENT.md#upgrade-notes-instagram-unified-login-2427).

## Disconnecting and revoking

**Disconnect** removes the token and every connection detail from this site.
It does not revoke anything at Meta, since the business may share the same
integration with other sites. To revoke access, the business removes the app
under Meta Business Settings → Integrations → Connected apps; the stored
token then stops working, and the connection test says to connect again.

## Who owns the connection

The stored options keep their Fair Audience names
(`fair_audience_instagram_*`), so moving the connection needs no re-entry.
Exactly one plugin protects the token on each request.
`FairEventsExperimental\Instagram\Ownership` decides:

| State                                             | Token storage and settings             |
| ------------------------------------------------- | -------------------------------------- |
| Instagram feature off                             | Fair Audience                          |
| Feature on, Fair Audience updated or inactive     | Fair Events Experimental               |
| Feature on, Fair Audience older than this release | Fair Audience (page says to update it) |

Connecting always happens here. While Fair Audience holds the connection
(the feature is off), Fair Audience → Settings → Instagram shows its status
and can disconnect it, but accepts no token or account: it says to turn
Instagram on in Fair Events → Settings → Experimental and connect here. A
Unified Login connection keeps publishing while Fair Audience holds it.

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
- **"Instagram needs to be reconnected: the stored access token can no longer
  be read"**: the site's security keys changed or the database moved to
  another site. Connect again, or disconnect to remove it.
- **"Instagram needs to be reconnected: Meta replaced the way sites connect"**:
  the connection predates Unified Login. Connect again.
- **"Instagram needs to be reconnected: the access token has expired"**:
  connect again.
- **"Meta refused the access token"**: the business removed the app in Meta
  Business Settings, or the token was revoked. Connect again.
- **"Meta did not let this site read the connected Instagram account"**: the
  business no longer shares that account. Connect again and share it.
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
