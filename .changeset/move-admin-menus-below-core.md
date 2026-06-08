---
'fair-events': patch
'fair-payment': patch
'fair-audience': patch
'fair-platform': patch
---

Move admin menus below core WordPress menus

Each plugin's top-level admin menu now registers in the `>= 80` range (string
positions `80.1`–`83.1`) so they sit below Settings instead of crowding the core
Pages/Comments group, per wp.org plugin review feedback.
