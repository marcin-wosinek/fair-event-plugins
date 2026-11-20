# Direct WhatsApp Cloud API setup

Use Fair Events → WhatsApp for your own business’s API sender. Keep your
original number in the WhatsApp Business mobile app and use a separate,
dedicated number for API notifications. This flow does not provide Embedded
Signup, Tech Provider onboarding, Coexistence, or a conversation inbox.

## Start with a test sender

Open the existing Meta app’s **Use cases → Connect on WhatsApp → Customize**,
then Quickstart or API Setup. Older apps use **WhatsApp → API Setup**. Only
change WhatsApp settings; preserve the existing Instagram integration.

Choose Meta’s test sender, generate a temporary token, and add and verify the
test recipients allowed by API Setup. The test sender cannot send to arbitrary
numbers. In WordPress, save the token in **Settings → Connectors → WhatsApp**,
then save the matching account and sender IDs on **Fair Events → WhatsApp**.
Select **Validate connection**. Follow the current
[Meta setup guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
for dashboard details and system-user asset assignments and permissions.

## Credentials and identifiers

| Value           | Purpose and location                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Access token    | Authorizes API requests; obtain through API Setup for testing or Business Settings for a system user. Manage it in Connectors.          |
| App Secret      | Authenticates webhook signatures; copy from App settings → Basic and save under Delivery updates.                                       |
| Verify token    | A separate administrator-chosen secret, at least eight characters; enter the same value in WordPress and Meta’s callback configuration. |
| WABA ID         | Identifies the WhatsApp Business Account in API Setup.                                                                                  |
| Phone Number ID | Identifies the selected API sender in API Setup; this is not its telephone number.                                                      |

Keep secrets out of screenshots, tickets, logs, and source control. Existing
credentials need no re-entry. Environment and PHP constant overrides retain
their precedence; inspect the source reported by the interface before rotating
a value. Replacing a saved value cannot override an active deployment override.
Rotate an access token at its effective source, validate again, and revoke the
old token through Meta. Coordinate App Secret rotation in Meta and WordPress;
callbacks signed with a different secret are rejected. Changing the verify
token requires callback verification again. Never use one secret for all three
credential fields.

## Webhook prerequisites

1. Make the displayed callback URL externally reachable over HTTPS. A local
   development URL alone is insufficient for Meta.
2. Save the App Secret and chosen verify token under Delivery updates.
3. In the app’s WhatsApp Configuration, enter the callback URL and the same
   verify token, then Verify and save. The callback indicator records a
   successful challenge with the current token.
4. Subscribe to the `messages` field in the WhatsApp webhook configuration.
5. Separately inspect the account subscription in Meta’s Graph API Explorer:
   `GET /{WABA-ID}/subscribed_apps`, using the supported Graph version and a
   token belonging to the intended app with access to that WABA. Confirm the
   returned app ID. If absent, an administrator can explicitly perform
   `POST /{WABA-ID}/subscribed_apps` and inspect again. Follow Meta’s current
   [subscription API instructions](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api)
   for authorization and parameters. WordPress validation performs neither
   subscription inspection nor subscription changes.
6. Check and complete your app dashboard’s publication requirements. The
   dashboard reported in #2442 says unpublished apps receive only
   dashboard-generated test webhooks, including for administrator/tester
   accounts. This is a dashboard-reported restriction, not a universal claim
   established by the public documentation. Check your app’s current rules.

Saving or validating in WordPress does not publish an app, register a number,
subscribe an account, or send a message.

## Prepare the production sender

Add a dedicated number in Meta and complete ownership verification by SMS or
voice, number registration, and two-step verification. Configure billing in
WhatsApp Manager. Create a system user in Business Settings with access to the
app and WhatsApp account, then generate a token with the permissions required
by Meta’s current guide. Save it in Connectors, replace the test IDs with the
production WABA and Phone Number IDs, and validate again. Ensure the webhook
subscriptions and publication checks apply to that account and app.

Prepare an approved template with its intended language. The plugin’s test
sender supports approved templates without parameters; parameterized templates
are excluded. Meta’s test setup commonly provides `hello_world` in `en_US`.
Obtain recipient consent, choose the template and recipient, confirm consent,
and explicitly select **Send test template** once.

## Interpret the evidence

| Indicator                       | What it establishes                                                             |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Settings saved                  | Configuration exists locally.                                                   |
| Connection validated            | The effective token can read the account and the selected number belongs to it. |
| Callback verified               | A verification challenge succeeded with the current verify token.               |
| Authenticated callback received | A matching signed callback arrived; it may be a dashboard test.                 |
| Accepted                        | Meta accepted a particular message request.                                     |
| Sent                            | Meta reported sending; delivery remains unconfirmed.                            |
| Delivered / Read                | A corresponding delivery/read update was applied to that send.                  |
| Failed / Outcome unknown        | Delivery failed or the send outcome is uncertain; no automatic resend occurs.   |

Validation does not prove registration, billing, publication, subscription, or
production readiness. Use **Recent messages** for message-specific evidence.

## Missing updates and replies

Check prerequisites in order: saved matching IDs and effective credentials;
public HTTPS reachability; callback verification; correct App Secret for signed
callbacks; `messages` subscription; intended app’s WABA subscription; and current
publication requirements. Then check the specific send’s outcome and Meta error
code. Refresh Recent messages after its polling stops. A dashboard test or an
unrelated callback does not confirm delivery of the send. Do not resend blindly
when updates are missing or the send outcome is unknown.

Replies to the dedicated API number do not appear in the Business app on the
organizer’s original number. The existing incoming-message hook can feed an
integration, but this plugin supplies no conversation inbox or reply interface.

For a live verification record, retain only sanitized sender/recipient
identifiers, template and language, time, API acceptance, and any corresponding
delivery update. Record publication, reachability, credential, or other external
blockers separately. Mocked tests cannot establish live delivery.
