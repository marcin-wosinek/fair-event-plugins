---
'fair-audience': patch
'fair-audience-experimental': patch
---

Check signup-edit, subscription-management, participant, mailing-signup and fee-payment links with one shared signed-link check. Links sent before this update keep working, and new links are identical. Links whose signed IDs are not plain positive numbers are now refused instead of being read leniently.
