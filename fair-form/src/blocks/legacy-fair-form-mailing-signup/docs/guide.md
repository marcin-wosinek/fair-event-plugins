## Purpose

`fair-audience/fair-form-mailing-signup` is the name **Mailing Sign Up** had before Fair Form registered its
blocks under its own namespace. It is kept only so that content saved under
that name keeps working. **Never author new content with it** — use
`fair-form/fair-form-mailing-signup`.

## Availability

- Registered in PHP (`src/Hooks/BlockHooks.php`) as an alias of
  `fair-form/fair-form-mailing-signup`, hidden from the inserter, with the same attributes,
  template, and frontend assets.
- After an update, Fair Form rewrites stored content to the canonical name
  once, a batch of posts per request. The alias covers what that cannot
  reach or what arrives later: imported content, restored revisions and
  backups, theme files, and posts that still contain the removed
  `fair-audience/event-signup` block.
- In the block editor a saved instance replaces itself, together with any
  legacy-named blocks nested in it, by `fair-form/fair-form-mailing-signup`, so the next save stores
  the canonical name. Where the canonical block is not allowed (an Event
  Signup block of a Fair Events version that only knows the legacy names), it
  keeps this name and stays editable.
- Its examples are covered by rendering tests only, not by editor tests.

## Composition

Nests exactly like `fair-form/fair-form-mailing-signup`; legacy and canonical names can be mixed
within one form.

## Rendering

Renders exactly what `fair-form/fair-form-mailing-signup` renders for the same attributes. Its wrapper keeps the `wp-block-fair-audience-fair-form-mailing-signup` class it always had, where the canonical block has `wp-block-fair-form-fair-form-mailing-signup`.
