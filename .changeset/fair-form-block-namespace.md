---
'fair-form': minor
---

Fair Form's blocks are now registered under Fair Form's own name: `fair-form/fair-form`, `fair-form/fair-form-email` and so on, instead of `fair-audience/…`. Their attributes, form IDs, question keys and stored answers are unchanged.

- After the update, Fair Form renames the blocks in saved content — posts, pages, drafts, revisions, synced patterns and templates — a few posts per page load until every post is done. It leaves posts that still contain the removed Fair Audience Event Signup block alone.
- The old names stay registered and hidden from the inserter, so content that still uses them renders as before. This includes imported content, restored backups and theme files. When such a form is opened in the editor, it switches to the new names, and the next save stores them.
- Migrated forms get a `wp-block-fair-form-fair-form…` class on their wrapper instead of `wp-block-fair-audience-fair-form…`. Update any custom CSS that targets the old class.
