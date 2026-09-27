# Writing Tickets

How to turn a feature request into a GitHub issue for this monorepo. The goal
is a ticket that nails down the **intended behaviour and the risks** — and
deliberately contains **no direct code references**. Tickets often sit a
sprint or more between writing and planning, and the surrounding code changes
underneath them; a stale path or class name misleads more than it helps. Code
grounding happens at planning time (`/plan-ticket`), not in the ticket.

## Workflow

1. **Explore to understand behaviour, not to cite code.** Skim the relevant
   plugin enough to describe what currently happens and what should change.
   Use what you learn to make the behaviour precise — but keep file paths,
   class names, function names, and route strings out of the ticket body.
   Naming the plugin and existing *features* is fine and encouraged ("the
   gallery download flow", "the weekly digest email"); naming the class that
   implements them is not.

2. **Describe behaviour from the outside.** Who does what, where they start,
   what they see, what changes as a result. When the feature mirrors or
   inverts an existing one, say so in feature terms — that hint survives
   refactors.

3. **Call out risks.** Security surface (tokens, uploads, public endpoints),
   data compatibility with existing content, i18n, performance, anything the
   implementer could underestimate. Link the stable reference docs from the
   CLAUDE.md table (e.g. REST_API_BACKEND.md, PHP_PATTERNS.md) — docs are
   durable, code references aren't.

4. **Surface decisions as Open Questions.** When a real fork exists (e.g.
   per-participant token vs. open public link), state the recommended option
   and why, and list the alternative — don't silently pick one.

5. **Pick the sprint.** Tickets go into the current sprint or the next one, as
   items in the **Fair Event Plugins** GitHub Project (project 5, owned by
   `marcin-wosinek`) — not a milestone:
   - Current sprint view: https://github.com/users/marcin-wosinek/projects/5/views/1
   - Next sprint view: https://github.com/users/marcin-wosinek/projects/5/views/2

   Sprints are the project's `Iteration` field (named `YYYY.W<week>`, e.g.
   `2026.W29`). Resolve which iteration is current/next by comparing today
   (`date +%F`) against each iteration's `startDate`/`duration`:

   ```bash
   gh api graphql -f query='query { user(login: "marcin-wosinek") { projectV2(number: 5) { fields(first: 20) { nodes { ... on ProjectV2IterationField { id configuration { iterations { id title startDate duration } } } } } } } }'
   ```

   Resolve the sprint only from iteration IDs already returned by this
   read-only query. If the requested current or next iteration is missing,
   stop and ask the user to create it in the GitHub project settings. Do not
   attempt to create it as part of ticket writing.

   **Iteration configuration safety:** Never call `updateProjectV2Field` from
   this workflow, and never create, edit, or delete iterations through
   GraphQL. The mutation replaces the complete iteration configuration;
   supplying only the desired iterations deletes omitted current and completed
   iterations and clears their item assignments.

6. **Create the issue, then verify its sprint.** Write the body to a temp file
   and pass `--body-file` (heredocs preserve the markdown / checkboxes cleanly).
   Project automation may add the new issue to Project 5 and assign its
   Iteration. Read the issue's project items before attempting either write:

   ```bash
   cat > /tmp/ticket.md <<'EOF'
   ...body...
   EOF
   gh issue create --title "…" --body-file /tmp/ticket.md
   gh api graphql -f query='query { repository(owner: "marcin-wosinek", name: "fair-event-plugins") { issue(number: <issue-number>) { projectItems(first: 20) { nodes { id project { id number } fieldValues(first: 30) { nodes { ... on ProjectV2ItemFieldIterationValue { title iterationId } } } } } } } }'
   rm -f /tmp/ticket.md
   ```

   Find the item whose project number is 5. If it already has the requested
   iteration ID, the assignment is complete. If the item is missing, add it
   with `gh project item-add 5 --owner marcin-wosinek --url <issue-url>`.
   If the item exists but its Iteration differs, set only that item's field
   with `gh project item-edit` using the resolved iteration ID. Re-read the
   issue's project item after any write and verify its Iteration before
   reporting the result.

   If a `gh project` command reports an error, re-read the issue's project
   item before retrying or claiming that assignment failed; automation may
   have completed the work. In this environment, `gh auth status` can report
   invalid credentials even when `gh api graphql` succeeds. Diagnose access
   from the relevant API operation and its readback, not that status alone.
   If the project CLI remains unusable and the readback shows work remains,
   use the GraphQL item-level mutations `addProjectV2ItemById` and
   `updateProjectV2ItemFieldValue` as appropriate. Never use
   `updateProjectV2Field`, which changes iteration configuration for the
   entire project.

   - Title: imperative, scoped, and names the plugin context where useful
     (e.g. "Add attendee photo-upload page (token-gated via event emails)").
   - Labels: only apply one if it genuinely fits. Check `gh label list` first;
     leave unlabeled rather than forcing a wrong label, and offer to add one.
     Apply `responsive-ui` whenever the expected behaviour changes layout or
     rendering across viewports — it's the only signal
     [COMMIT_GUIDE.md](./COMMIT_GUIDE.md) uses to require before/after
     screenshots at PR time, so skipping it silently skips that check.

## Ticket structure

Use this skeleton (drop sections that don't apply):

- **Plugin** — which workspace (`fair-audience`, `fair-events`, …).
- **Summary** — what and why in 2–4 sentences, naming the feature it mirrors
  or extends (in feature terms, not code terms).
- **Motivation** — the user-facing reason it's worth doing.
- **Expected behaviour** — the flows from the user's perspective: entry point,
  steps, outcomes, edge cases. Behaviour-level only.
- **Risks** — security, data, compatibility, performance concerns; link the
  relevant reference docs.
- **Open questions** — real forks with a recommendation.
- **Acceptance criteria** — a `- [ ]` checklist of observable behaviour,
  including the kinds of tests required (API spec, component test, e2e) per
  TESTING.md.

## Principles

- Durable beats precise-today. A behaviour description is still correct after
  three refactors; a file path may not survive one.
- Specific beats exhaustive. A short ticket that pins down the three decisive
  behaviours beats a long one full of generic advice.
- Write for a planner who will ground the work in the codebase **as it exists
  then** — give them intent and constraints, not directions that may have
  moved.
- Don't restate rules the reference docs already own — link to them.
