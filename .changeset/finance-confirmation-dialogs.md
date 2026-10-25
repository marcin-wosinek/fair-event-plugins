---
'fair-finance': patch
---

Deleting a budget, deleting an entry or transfer, and unsplitting an entry now ask in a dialog instead of the browser's own prompt.

- Budget deletion names the budget and says how many entries move to Unbudgeted.
- Entry deletion names the entry with its date and amount, says that a transfer's two budget allocations go with it, and that matched transactions are not deleted.
- Unsplit opens over the split editor and lists every allocation it deletes. Cancelling returns to the editor with your changes intact.
- Failures stay in the dialog for a retry, and nothing can be submitted twice while a request runs.
