---
"fair-audience": patch
---

Restyle the All Participants page with native WordPress components: stat tiles sit in an equal-width responsive grid with hover feedback and an accent highlight on the tile matching the active filter (aria-pressed), the tiles/notices/table share consistent VStack spacing, the events popover uses ItemGroup, and the page's inline styles move to a `style.css` built to `style-index.css` (AdminHooks now enqueues per-page stylesheets when present).
