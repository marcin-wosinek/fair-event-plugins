# Payment notifications

Fair Payments Connector can announce every paid transaction in a Telegram chat
or channel, or by email. Each notification route sends either immediately or
as an hourly, daily or weekly digest. Useful as a live, mobile-friendly feed of
sales without logging into the WordPress admin.

## Setup

1. **Create a bot** (Telegram routes only). Open Telegram, message
   `@BotFather`, send `/newbot` and follow the prompts. BotFather replies with
   an **HTTP API token** that looks like `123456789:AAH...`. Keep it secret —
   anyone with the token can post as your bot.
2. **Get a chat ID.**
    - For a private DM to yourself: message `@userinfobot` — it replies with
      your numeric user ID.
    - For a group: add the bot to the group, then visit
      `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and look for
      `"chat":{"id":...}` after someone posts.
    - For a public channel: use `@channelname` directly (the bot must be an
      admin in the channel).
3. **Configure the plugin.** WP Admin → Fair Payments Connector →
   Notifications. Paste the bot token, click **Add route**, pick the channel,
   destination (chat ID or email address), frequency and whether to include
   personal information, then click **Save settings**.
4. **Test.** Click **Send test** on a route. The message arrives using sample
   data. If it doesn't, the inline notice reports the failure.

## Message format

The message format is fixed:

```
[TEST] <site domain>
<event title link>
<participant name link>
Group: <group>
Fee: <fee>
Ticket: Regular
Activities: Activity A, Activity B
Discounts: Early bird -10%
Total: 10.00 EUR
```

`[TEST]` appears only for Mollie test-mode transactions. Lines whose value is
empty are left out, so an event signup shows ticket, activity and discount
lines, and a membership fee shows group and fee lines. A digest starts with the
number of sales and the totals per currency, followed by each sale.

## Personal information

Each route has an **Include PII** toggle, on by default. When it is off, the
participant's name is shortened to first name and surname initial (for
example, `Jane D.`) and the email address is never included — useful if the
channel has wider visibility than the admin team.

## How it works

The plugin subscribes to the `fair_payment_paid` action. Immediate routes are
sent through `wp_schedule_single_event`, so the Mollie webhook returns
immediately and is never blocked by Telegram or mail latency. Digest routes
store each sale in the `fair_payment_notification_queue` table; a recurring
WP-Cron event per frequency claims and sends them, retrying failed sends on the
next run.

Other plugins can enrich the message context by hooking the
`fair_payment_notification_context` filter (see fair-audience for an example).

## Moving from Fair Payments Connector Experimental

Notifications used to live in Fair Payments Connector Experimental. Routes, the
bot token and queued digest sales carry over unchanged. While both plugins are
active, only one of them runs notifications: an experimental release from
before the move keeps them until it is updated or deactivated; after that,
Fair Payments Connector takes over.
