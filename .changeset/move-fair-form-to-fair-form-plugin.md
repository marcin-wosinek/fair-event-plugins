---
"fair-form": minor
"fair-audience": patch
---

Move fair-form blocks and questionnaire data layer from fair-audience into fair-form. Block names (fair-audience/fair-form*) and table names (fair_audience_questionnaire_*) are unchanged for backward compatibility. fair-audience degrades gracefully when fair-form is absent via class_exists guards.
