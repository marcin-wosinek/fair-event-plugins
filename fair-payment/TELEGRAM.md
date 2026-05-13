# Telegram notifications

Fair Payment can post a message to a Telegram chat or channel every time a
transaction is paid. Useful as a live, mobile-friendly feed of sales without
logging into the WordPress admin.

## Setup

1. **Create a bot.** Open Telegram, message `@BotFather`, send `/newbot` and
   follow the prompts. BotFather replies with an **HTTP API token** that looks
   like `123456789:AAH...`. Keep it secret — anyone with the token can post as
   your bot.
2. **Get a chat ID.**
   - For a private DM to yourself: message `@userinfobot` — it replies with
     your numeric user ID.
   - For a group: add the bot to the group, then visit
     `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and look for
     `"chat":{"id":...}` after someone posts.
   - For a public channel: use `@channelname` directly (the bot must be an
     admin in the channel).
3. **Configure the plugin.** WP Admin → Fair Payment → Settings → Telegram.
   Paste the token, the chat ID (or multiple comma-separated IDs), edit the
   message template if you like, and click **Save settings**.
4. **Test.** Click **Send test message**. The message lands in the configured
   chat using sample data. If it doesn't arrive, the inline notice surfaces
   the Telegram API error description (e.g. `chat not found`, `Unauthorized`).

## Message template

The default template renders as:

```
<site domain>
<event title link>
<participant name link> (participant@example.com)
Ticket: Regular
Activities: Activity A, Activity B
Discounts: Early bird -10%
Total: 10.00 EUR
```

Telegram already shows the message time, so the default template omits the
transaction date — add `{date}` back to the template if you want it.

Available placeholders:

| Placeholder            | Notes                                                |
| ---------------------- | ---------------------------------------------------- |
| `{site_domain}`        | Host portion of the site URL (e.g. `example.com`).   |
| `{date}`               | YYYY-MM-DD of the transaction.                       |
| `{amount}`             | Numeric, two decimals.                               |
| `{currency}`           | Currency code.                                       |
| `{transaction_id}`     | Internal transaction ID.                             |
| `{event_title}`        | Event post title (when fair-audience active).        |
| `{event_url}`          | Admin edit link for the event.                       |
| `{participant_name}`   | PII — see toggle.                                    |
| `{participant_url}`    | Admin link to the participant.                       |
| `{participant_email}`  | PII — see toggle.                                    |
| `{ticket_label}`       | Ticket type / option name(s).                        |
| `{activities}`         | Activities the participant signed up for.            |
| `{discounts}`          | Applied discounts (e.g. early bird, group).          |

Allowed HTML: `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<a href>`, `<br>`,
`<code>`. Other tags are stripped on save.

## PII toggle

`Include participant name and email` is on by default. Turn it off to render
`{participant_name}` and `{participant_email}` as empty strings — useful if
the channel has wider visibility than the admin team.

## How it works

The plugin subscribes to the `fair_payment_paid` action and dispatches via
`wp_schedule_single_event`, so the Mollie webhook returns immediately and is
never blocked by Telegram latency. Send failures are written to the PHP error
log and never bubble up to the payment flow.

Other plugins can enrich the message context by hooking the
`fair_payment_notification_context` filter (see fair-audience for an example).
