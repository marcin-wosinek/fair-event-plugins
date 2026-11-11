---
'fair-audience': minor
'fair-events': patch
---

Weekly event feed subscriptions no longer depend on marketing consent. Subscribers receive only the feeds they choose, and feeds added later need their own subscription, so the "All weekly emails" option is gone from the signup form, the manage-subscription page and the participant editor. Marketing emails and feed subscriptions can be changed separately: turning marketing off keeps the chosen feeds, and removing every feed keeps the marketing preference. The Mailing Signup block now asks for marketing emails separately whenever it offers feeds, so visitors can subscribe to feeds only.

On upgrade, existing "All weekly emails" subscribers are converted once to the feeds eligible at that moment. Subscribers who were not receiving the weekly email at the time get no feeds. Consent, confirmation and opt-outs stay as they were. Fair Events' event notification screens now describe weekly email recipients as feed subscribers.
