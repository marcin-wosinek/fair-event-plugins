---
description: Propose an implementation plan for a GitHub ticket, confirm it, and post it as a comment
argument-hint: <ticket-number>
---

Propose an implementation plan for GitHub issue #$ARGUMENTS.

1. **Read the ticket.** `gh issue view $ARGUMENTS --comments` to get the body and
   any existing discussion. Note any Open Questions the ticket already lists.

2. **Ground the plan in the codebase.** Before writing anything, explore the real
   files, patterns, and constraints the work will touch — the same discipline as
   [TICKETS.md](../../TICKETS.md): name the existing block / model / REST
   controller / service this mirrors or extends, and cite concrete paths. Load
   the relevant CLAUDE.md reference doc for the area (REST, React admin, blocks,
   i18n, testing).

3. **Draft the implementation plan.** Structure it as the layers an implementer
   works through (access/URL, frontend, backend, data, tests), referencing real
   files and the sibling pattern to model on. Prefer reuse over invention.
   **End the plan with a "Read first" list** naming the exact reference docs
   from the CLAUDE.md table that apply (e.g. REST_API_BACKEND.md, TESTING.md) —
   the implementing session reads those before touching code instead of
   guessing which docs matter.

4. **Surface open questions — only if still relevant.** Re-check the ticket's Open
   Questions against the current code: some may already be resolved. List the ones
   that genuinely remain, with a recommended option and why, plus the alternative.
   Drop any that no longer apply.

5. **Check it with me.** Show the full plan in chat and pause. Do **not** post
   until I approve. Incorporate my feedback and re-confirm if I change anything.

6. **Post as a comment.** Once approved, write the body to a temp file and post
   with `gh issue comment $ARGUMENTS --body-file /tmp/plan-$ARGUMENTS.md`, then
   `rm -f /tmp/plan-$ARGUMENTS.md`. Use heredoc-clean markdown (headings,
   checkboxes). Follow the no-attribution rule — no Claude footer.
