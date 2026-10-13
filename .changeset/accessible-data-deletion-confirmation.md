---
"fair-audience": minor
---

**Delete My Data** on the subscription-management page now asks for confirmation in an accessible dialog instead of the browser's own confirmation box. The dialog names the profile by its email address and says what is deleted, what is kept (event signups and tickets, attendance records, consent history, payment records and the user account) and that it cannot be undone. Opening, cancelling or dismissing it changes nothing, and a confirmed deletion cannot be sent twice. Without JavaScript the same confirmation is shown as a page before anything is deleted.

Deleting now needs an explicit confirmed request carrying a short-lived proof issued for that profile, in addition to the signed link. A failed deletion is reported on the page and can be retried, and refreshing the page after a deletion no longer sends it again.
