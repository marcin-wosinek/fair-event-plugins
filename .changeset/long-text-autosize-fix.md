---
"fair-events-shared": patch
"fair-form": patch
"fair-events": patch
"fair-audience": patch
---

Fix long-answer question fields rendering collapsed to a single line instead of sizing to fit their content. A long-text question nested inside a Conditional Section stayed collapsed until the respondent typed in it, because the auto-grow behavior ran on hidden textareas (always 0 height) and never re-ran once the section was revealed. Long-text fields also had no styling at all outside the plain Fair Form block (e.g. in the Event Signup blocks), and could grow without limit; they now cap at roughly 12 lines and scroll internally beyond that.
