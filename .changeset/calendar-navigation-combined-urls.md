---
'fair-events': patch
---

Fix calendar and week-view navigation generating crawlable combined-date URLs when both dated event views are on the same page. Monthly navigation no longer carries a weekly selection along (and vice versa), so alternating between the two controls can no longer mint the full cross-product of month/week combinations. A legacy URL that already combines both dated selections still renders and remains accessible, but now declares the plain page URL as canonical instead of independently indexing the combination.
