---
"fair-audience": patch
---

Fix the group discount note on the signup form so it always matches the price actually charged: it now compares each rule against the ticket's real price (not a notional reference price), stays hidden unless a price is genuinely reduced, and shows fractional percentages (e.g. 12.5%) without rounding them away. When different ticket tiers get their best price from different rules, the shared note is dropped in favor of a per-tier label.
