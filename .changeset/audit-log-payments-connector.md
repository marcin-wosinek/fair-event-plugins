---
"fair-payments-connector": minor
"fair-events-shared": patch
---

Add an audit log for Fair Payments Connector settings and Mollie connection changes. Every successful manual change — saving the mode, currency, or bank-transfer settings, or connecting, reconnecting, or disconnecting Mollie — is recorded with a server-generated description; automated changes (token refresh, connection loss) are attributed to the system. A new Audit Log tab on the settings page shows the paginated history, redacting protected values such as OAuth tokens. The shared Settings → Fair Event Plugins screen gained an optional per-field `requires_reason` flag and a `fair_event_plugins_setting_changed` action so a plugin can record its own audit entry when its field changes there — both are additive and don't affect plugins that don't use them; this plugin's own bundled-translations row does not use the flag.
