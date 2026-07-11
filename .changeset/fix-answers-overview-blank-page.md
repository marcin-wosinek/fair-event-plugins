---
"fair-form": patch
---

Fix the Answers Overview admin page rendering blank. It imported `ToggleGroupControl`/`ToggleGroupControlOption` from `@wordpress/components` under their stable names, which some WordPress versions only expose under the experimental aliases, crashing the whole React tree. The DataViews table also needed its columns listed explicitly via `view.fields`, which is required in the installed `@wordpress/dataviews` version.
