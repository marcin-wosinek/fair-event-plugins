---
"fair-form": minor
"fair-events-shared": minor
"fair-events": patch
"fair-audience": patch
---

The Conditional Section block, when nested inside a signup form, can now show or hide its contents based on the visitor's selected ticket type (in addition to the existing question and event-option sources) — pick one or more ticket types and an "is selected" / "is not selected" operator, and the section reacts live as the visitor changes their selection. Also fixes the Conditional Section's "Event option" condition source, which failed to appear when nested inside the unified Event Signup block (it only recognized the older, hidden legacy block).
