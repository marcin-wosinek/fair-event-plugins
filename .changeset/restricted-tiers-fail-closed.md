---
'fair-events': patch
'fair-audience': patch
---

Ticket types limited to members of specific groups now stay protected when group membership can't be checked.

- Without Fair Audience or Fair Audience Experimental active, a restricted ticket type is hidden from signup forms and direct signup or purchase requests for it are refused. Before, such requests were accepted from anyone.
- Administrators see a warning across wp-admin while this applies. The group settings are kept, and members can buy these ticket types again once both plugins are active.
