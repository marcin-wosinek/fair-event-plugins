---
"fair-events": minor
"fair-events-experimental": patch
"fair-audience": patch
---

Removed the invitation-gated ticket signup mechanism: the "invitation only" ticket type toggle, the Manage Invitations admin page and its REST routes, and the public signup form's `?invitation=` link handling and "show inviter's name" option. The gating check had silently broken (an autoloader namespace mismatch made it dead code — invitation-only ticket types were already invisible on the public form, not merely restricted), so a migration disables any ticket type that was previously marked invitation-only rather than making it suddenly public, and drops the now-unused `invitation_only` column and `fair_events_invitation_tokens` table. Group-restricted ticket types and the separate bulk "send invite emails" outreach feature are unaffected.
