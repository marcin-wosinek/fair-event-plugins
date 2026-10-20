---
'fair-form': patch
'fair-events-shared': patch
---

Fair Form's blocks are now translated on sites running in German, Spanish, French or Polish: the block editor controls, block titles and descriptions, the public form's messages (including the required, email, phone, web address, date and file size checks) and the "Yes"/"No" answers in copied submissions. Their text still belonged to Fair Audience's translations, so it stayed in English. It now uses Fair Form's own translations, with the existing ones carried over. Wording is unchanged, and saved forms keep working as before.

With **Bundled translations** on (**Settings → Fair Event Plugins**), the blocks' JavaScript now uses the translation files shipped with the plugin too; before, only the PHP text did.
