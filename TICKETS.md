# Writing Tickets

How to turn a feature request into a GitHub issue for this monorepo. The goal is
a ticket that is **grounded in the actual codebase** — it names the real files,
patterns, and constraints a future implementer will touch, instead of generic
boilerplate.

## Workflow

1. **Explore before writing.** Spend a few tool calls finding the existing
   pattern this feature mirrors. Most "new" features here are a variation of
   something that already exists (a sibling block, a parallel REST controller, a
   twin email flow). Grep for related models, controllers, blocks, and services.
   - Example: an attendee photo *upload* page is the inverse of the existing
     gallery *download* flow (`EmailService::send_gallery_invitation` →
     `GalleryAccessController::validate`, token via
     `add_query_arg( 'gallery_key', … )`).

2. **Anchor every section in real code.** Reference concrete files, classes,
   models, hooks, and the docs in the CLAUDE.md reference table
   (e.g. REST_API_BACKEND.md for endpoint security). If the ticket says "add a
   REST controller," name where it goes (`src/API/`, namespace, base route) and
   the security rule it must follow.

3. **Prefer reuse over invention.** Call out the existing repository / model /
   block to extend (`GalleryAccessKeyRepository`, `PhotoParticipant`,
   `fair-form-file-upload`) rather than proposing new infrastructure, unless
   there's a reason not to.

4. **Surface decisions as Open Questions.** When a real fork exists (e.g.
   per-participant token vs. open public link), state the recommended option and
   why, and list the alternative — don't silently pick one.

5. **Create the issue with `gh`.** Write the body to a temp file and pass
   `--body-file` (heredocs preserve the markdown / checkboxes cleanly):

   ```bash
   cat > /tmp/ticket.md <<'EOF'
   ...body...
   EOF
   gh issue create --title "…" --body-file /tmp/ticket.md
   rm -f /tmp/ticket.md
   ```

   - Title: imperative, scoped, and names the plugin context where useful
     (e.g. "Add attendee photo-upload page (token-gated via event emails)").
   - Labels: only apply one if it genuinely fits. Check `gh label list` first;
     leave unlabeled rather than forcing a wrong label, and offer to add one.

## Ticket structure

Use this skeleton (drop sections that don't apply):

- **Plugin** — which workspace (`fair-audience`, `fair-events`, …).
- **Summary** — what and why in 2–4 sentences, naming the pattern it mirrors.
- **Motivation** — the user-facing reason it's worth doing.
- **Proposed design** — broken into the layers an implementer works through:
  - Access / URL (tokens, query args, permissions)
  - Frontend (block / admin page, referencing the sibling block to model on)
  - Backend (REST controller location, namespace, route, permission check)
  - Integration points (email service, hooks, models the data links to)
  - Admin / moderation
- **Open questions** — real forks with a recommendation.
- **Security checklist** — token validation, input sanitization, MIME/size
  limits, rate limiting, escaping — per PHP_PATTERNS.md & REST_API_BACKEND.md.
- **Acceptance criteria** — a `- [ ]` checklist, including the tests required
  (API spec, component test, e2e) per TESTING.md.

## Principles

- Specific beats exhaustive. A short ticket that names the right three files
  beats a long one full of generic advice.
- Write for an implementer who knows WordPress but not this codebase's history.
- Don't restate rules the reference docs already own — link to them.
