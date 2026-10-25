---
'fair-finance': patch
---

Unmatching a financial entry now opens a confirmation instead of the browser's own prompt. It names the entry and lists every transaction it will be unlinked from, flagging any whose record no longer exists, and says what stays: the entry, its split allocations and the payment-provider transactions.

- An entry that belongs to a saved settlement reconciliation can't be unmatched from Entries. The dialog says so before you try and links to Reconciliation, where the association can be released. Previously the refusal only showed as a notice at the top of the page, so it looked like Unmatch did nothing.
- Unmatching is now all-or-nothing: if removing a link fails, nothing changes. The error shows in the dialog so you can try again, and you can't submit twice while it runs.
- After unmatching, the list refreshes in place. If the refresh fails, a notice says so; the unmatch itself still happened.
