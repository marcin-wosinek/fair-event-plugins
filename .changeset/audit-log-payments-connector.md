---
"fair-payments-connector": minor
"fair-events-shared": patch
---

Add an audit log for Fair Payments Connector settings and Mollie connection changes. Administrators must now supply a reason before saving the mode, currency, or bank-transfer settings, or before connecting, reconnecting, or disconnecting Mollie; automated changes (token refresh, connection loss) are attributed to the system. A new Audit Log tab on the settings page shows the paginated history, redacting protected values such as OAuth tokens. The shared Settings → Fair Event Plugins screen gained an optional per-field `requires_reason` flag and a `fair_event_plugins_setting_changed` action so a plugin can record its own audit entry when its field changes there — both are additive and don't affect plugins that don't use them.
