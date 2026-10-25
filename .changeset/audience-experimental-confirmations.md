---
'fair-audience-experimental': patch
---

Polls, extra messages, groups, Instagram posts, group rules and membership fees no longer use the browser's own prompts and alerts.

- Deleting a poll, extra message, group, Instagram post or fee, removing a group member or a group's event rules, sending poll invitations or fee reminders, and marking a fee payment paid or canceled each ask in a dialog. It names what changes and what does not: for example, deleting a fee lists how many payment records go with it and says that payments already received are not refunded.
- Failures stay in the dialog for a retry, and an action can't be sent twice while it runs. When only some of a group's rules are removed, the dialog keeps just the remaining ones.
- Form validation and save errors appear next to the form, which keeps what you entered. Adding several members to a group reports who could not be added, and why, and keeps them selected. Bulk fee reminders list which members were not reminded, and why.
- The public poll page shows a missing choice or failed submission beside the form and keeps the selected options, so you can submit again. Clicking an option's text now selects it; before, it left the option unchanged.
