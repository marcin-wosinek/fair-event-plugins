---
"fair-events": minor
"fair-events-experimental": patch
"fair-audience": patch
"fair-audience-experimental": patch
---

Fixed a PHP 8.2 dynamic-property deprecation notice that fired on nearly every event-date read (`EventDates::$signup_price`, left over from a partially-reverted merge). Rather than re-declaring the field, finished removing it: the flat per-date "simple pricing" mode and pay-what-you-can sliding scale it powered were already superseded by ticket-type pricing everywhere except the legacy fair-audience Event Signup block, which now prices signups from ticket types only. The `signup_price` column is dropped from the event dates table via migration. Also fixed the same class of deprecation notice on `FairAudienceExperimental\Models\Group::$member_count`, populated by the groups admin list.
