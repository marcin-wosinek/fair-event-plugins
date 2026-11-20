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
  the Instagram account this site publishes to. When Meta shares more than
  one, the administrator chooses one on this page (see below). The site
  must be served over HTTPS; plain HTTP is accepted only on `localhost`.
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
   challenge, the site address, this page as the only return destination,
   and `account_choice=1` (this site can let the administrator choose).
2. After Meta's dialog, the service returns to Fair Events → Instagram with
   the state and a single-use handoff code (or `instagram_error`). The page
   removes them from the address bar and sends them to this site's server.
   Before returning, the service reads every page of the accounts Meta
   shared and counts each account ID once.
3. The server checks the state against the administrator's attempt (used up
   either way), redeems the handoff code with the verifier, server to server,
   and checks the credentials: a token, its type, `instagram_basic` and
   `instagram_content_publish`, the account ID and the Graph API version.
   With one distinct account, the connection completes right away.
4. The token is stored first. If it cannot be stored encrypted, the previous
   connection is kept as it was. Then the account and the metadata are
   written, and the connection-format marker last.

## Choosing between several accounts

When Meta shares more than one distinct account (#2429), the service hands
off every candidate, each with its username, instead of one account. Nothing
is connected yet:

- This site's server keeps the token and the candidates encrypted for 15
  minutes as that administrator's pending choice. The browser gets only a
  random choice ID and each account's ID and username.
- The page lists the accounts by `@username`, with none selected, and marks
  the account that is connected now. **Connect selected account** connects
  the chosen one; until then the current connection stays as it was.
  **Cancel** ends the choice and keeps the connection.
- Confirming needs the administrator's current choice ID and one of its
  listed accounts. Another administrator, a different account ID, or a choice
  that expired, was cancelled, was already confirmed, or was replaced by a
  new **Connect with Instagram** is refused, and nothing changes. A refused
  account ID keeps the choice open, so the administrator can choose again.
- If Meta does not say an account's username, the service looks it up. If it
  still cannot tell the accounts apart, the connection stops with an error
  and nothing changes.

The Fair Platform connection log records such an authorization as
`choice_pending`, without naming any of the candidates as the connected
account.

A site with an older Fair Events Experimental, which does not send
`account_choice`, still gets the "more than one Instagram account" error.

A cancelled or failed authorization changes nothing. The page explains what
to do: allow every permission or share an account. A failure to read a
later page of accounts also stops the connection; connect again. If Meta
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

## Scheduled event-list posts

Fair Events → Event notifications can publish the week's events to the
connected account (#2076). Add a notification of the **Instagram** kind,
choose the event feed, the page whose title heads the image and whose link
ends the caption, and the weekday, time and week, like a Telegram summary.
Each Instagram notification has its own schedule and history.

- **Turning it on authorizes public posts.** Once on, the site publishes a
  public post every week at the chosen time without asking. There is no test
  post; **Preview next Instagram post** draws the image and caption for the
  selected week and publishes nothing, stores nothing and contacts no one.
- **One post per notification and week**: one 1080 × 1350 JPEG (DM Sans,
  SIL Open Font License, bundled in `assets/fonts`) listing each event's day,
  time and name, and a caption with the same list and the page's link.
  Emoji are left out of the image; the caption keeps them. Weeks without
  events are skipped.
- **The whole list or nothing.** Text shrinks down to a readable minimum. If
  the events still do not fit, or the caption exceeds Instagram's limits
  (2,200 characters, 30 hashtags, 20 @mentions), nothing is published and
  the history says why. Choose an event feed with fewer events. Carousels
  are not supported yet.
- **Requirements**: this page's Instagram feature on and connected, WP-Cron
  running (on a low-traffic site, a real cron calling `wp-cron.php` keeps
  posts on time), PHP GD with FreeType, a writable uploads folder, and the
  site served over HTTPS, since Instagram downloads the image from it.
- **The image is public only while Instagram processes it**: it is stored
  under a random name in `uploads/fair-events-instagram/`, and removed once
  the post is published or has failed. Previews are never stored.

### How publishing avoids duplicates

Fair Events keeps the settings, schedule and history; this plugin draws the
post and calls Instagram (`FairEventsExperimental\Instagram\EventListPosts`).
Each scheduled send claims its notification and week once, renders the post
once, and saves a publishing job before every call to Instagram:

1. Create the media container (nothing is public yet).
2. Background steps (`fair_events_notification_instagram_step`) poll its
   processing every 30 seconds, at most 20 times.
3. Just before publishing, the step checks that the notification still
   exists and is on and that the connected account is the one the post was
   prepared for, saves the intent to publish, then publishes.
4. If Instagram's answer is unclear (a timeout, a server error) or the step
   stopped after saving the intent, later steps read the container's status
   every two minutes, at most six times: published, not published, or
   unknown. The container is never published again and no replacement post
   is created.

### Reading the history

Each run is one execution under the notification's **History**, with the
account as the recipient and, once published, a **View the post** link.

| Shown as                                   | What to do                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Instagram posting was unavailable          | Turn on Instagram here and make sure this plugin is active; the next week posts.   |
| Instagram was not connected                | Connect again on this page.                                                        |
| The events did not fit / caption too long  | Use a feed with fewer events; nothing was published.                               |
| Could not be stored / needs HTTPS          | Make uploads writable and serve the site over HTTPS.                               |
| Did not accept / could not process         | Check the image URL is reachable from the internet; nothing was published.         |
| Turned off / deleted / account changed     | The post was stopped before it went public, as asked.                              |
| Not published                              | Instagram reports the container unpublished. It is not retried.                    |
| Outcome unknown                            | Check the account. If the post is missing, publish it by hand; it is never retried. |

A missed week is never posted later: turning the feature back on resumes
with the next scheduled week.

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
