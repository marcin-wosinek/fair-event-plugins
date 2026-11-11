---
'fair-events': minor
'fair-audience': minor
---

Fair Events and Fair Audience now check that a site may run this version before they start. A new installation, or a site that finished the payment history migration on Fair Events 2.2.0 (with Fair Payments Connector 2.8.0 and Fair Audience 2.0.0), starts as usual and records that it is complete. An existing site that hasn't finished the migration starts neither plugin and changes nothing; administrators see a notice naming what is missing and how to finish the migration on the 2.2.0 release. Fair Audience also waits for Fair Events to be updated first. Payment history gains an Upgrade readiness card: whether the site is safe to upgrade, what is still missing, whether the old payment records could be removed, and a form to record the final checks run on a staging copy.
