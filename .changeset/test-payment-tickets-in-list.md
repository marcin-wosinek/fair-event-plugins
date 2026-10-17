---
'fair-events': minor
---

Mark tickets bought with test-mode payments in the event List. Each confirmed ticket from a test payment shows a "Test payment" warning beside its reference, on screen and in the printed List, where the bold, bordered warning stays readable in black-and-white print. The warning follows the mode each payment was recorded in, so switching the payment integration between test and live mode does not change past tickets. Live payments and free registrations are unmarked, and unfinished or unsuccessful purchases stay out of the List. The admin get-tickets list now reports `is_test_payment` for each registration.
