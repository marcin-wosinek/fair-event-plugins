---
"fair-events": minor
"fair-audience": minor
"fair-payments-connector": patch
---

Let a participant buy tickets again for a date they already hold a ticket for. Each purchase keeps its own signup, tickets and payment. The Event Signup form now protects against accidental repeats instead: submitting the same purchase twice, or retrying after a lost connection or a payment that could not be started, continues the first purchase and never charges twice. After an error message the form can be submitted again without reloading the page.
