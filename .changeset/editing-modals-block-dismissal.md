---
'fair-events': patch
'fair-audience': patch
'fair-payments-connector': patch
'fair-events-shared': patch
---

Moving a registration, changing its ticket type, editing a ticket and importing transactions now keep their popup open until the request finishes. While it runs, the popup cannot be dismissed or submitted twice and its fields are locked. A failure keeps your choices, reason or imported file in the popup, with the error shown inline, so you can retry. A failed transaction import offers **Retry import** without choosing the file again. A successful move, type change or ticket edit is now confirmed above the List.
