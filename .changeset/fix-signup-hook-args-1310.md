---
"fair-audience": patch
---

Fix the unified Event Signup form crashing with a server error on every submission when fair-audience is active. Two hook registrations in `SignupHookBridge` accepted fewer arguments than fair-events actually passes them, so WordPress threw a fatal `ArgumentCountError` before any signup could save — for every combination, with or without a ticket type or selected activities.
