---
description: Propose an implementation plan for a GitHub ticket, confirm it, and post it as a comment
argument-hint: <ticket-number>
---

Propose an implementation plan for GitHub issue #$ARGUMENTS.

1. **Read the ticket.** `gh issue view $ARGUMENTS --comments` to get the body and
   any existing discussion. Note any Open Questions the ticket already lists.

2. **Ground the plan in the codebase.** Tickets deliberately avoid code
   references ([TICKETS.md](../../TICKETS.md)) — this step is where the code
   grounding happens, against the codebase **as it exists now**. Explore the
   real files, patterns, and constraints the work will touch: name the existing
   block / model / REST controller / service this mirrors or extends, and cite
   concrete paths. Load the relevant CLAUDE.md reference doc for the area
   (REST, React admin, blocks, i18n, testing).

3. **Draft the implementation plan.** Structure it as the layers an implementer
   works through (access/URL, frontend, backend, data, tests), referencing real
   files and the sibling pattern to model on. Prefer reuse over invention.
   **End the plan with a "Read first" list** naming the exact reference docs
   from the CLAUDE.md table that apply (e.g. REST_API_BACKEND.md, TESTING.md) —
   the implementing session reads those before touching code instead of
   guessing which docs matter.

4. **Collect every open fork.** Re-check the ticket's Open Questions against
   the current code — some may already be resolved; drop those. Then add any
   **new** fork you discovered while grounding the plan in the codebase (these
   are usually the majority). Every fork gets a recommended option with the
   why, plus the alternative.

5. **Check it with me — and resolve the questions.** Show the full plan in
   chat and pause. During this review, ask me to decide each remaining open
   question. Do **not** post until I approve. Incorporate my feedback and
   re-confirm if I change anything.

6. **Post as a comment — decisions, not questions.** Start the comment with a
   `## Implementation plan` heading — `/make-pr` looks for exactly this
   heading to find the plan among an issue's other comments, so it must be
   the first line. The posted plan records the outcomes of step 5 under a
   **Decisions** heading; a plan with unresolved open questions is not ready
   to post. Once approved, write the body to a temp file and post with
   `gh issue comment $ARGUMENTS --body-file /tmp/plan-$ARGUMENTS.md`, then
   `rm -f /tmp/plan-$ARGUMENTS.md`. Use heredoc-clean markdown (headings,
   checkboxes). Follow the no-attribution rule — no Claude footer.
