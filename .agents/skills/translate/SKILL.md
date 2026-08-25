---
name: translate
description: Inspect and run this repository's WordPress translation workflow for a requested plugin and locale.
---

# Translate a plugin

Read `TRANSLATIONS.md` and `I18N_SETUP.md`, then inspect the requested plugin and locale. Present a concise plan before changing catalogs or invoking AI translation.

Use the root translation scripts and the standard cycle as applicable: extract POT, update PO, translate, compile MO, and build hashed JSON catalogs. Validate translations and report coverage when relevant. AI-assisted translation requires the user's configured provider key and should only run when requested or approved.

Do not commit unless explicitly asked.
