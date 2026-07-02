---
"fair-events": minor
---

Classify the impact of edits to recurring events and guard against destructive changes: the server categorizes how a change affects existing occurrences and surfaces that impact in the UI before saving. Occurrence reconciliation now preserves existing row IDs instead of regenerating them, and generated occurrences fall back to the master venue when they have none of their own.
