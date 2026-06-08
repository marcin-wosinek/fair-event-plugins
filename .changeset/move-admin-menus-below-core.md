---
'fair-events': patch
'fair-payment': patch
'fair-audience': patch
'fair-platform': patch
---

Group admin menus with string positions to avoid overwriting core menus

Each plugin's top-level admin menu now registers with a unique string decimal
position (`20.1`–`20.4`) so the four menus cluster together in order without
colliding with each other or with core WordPress menu items.
