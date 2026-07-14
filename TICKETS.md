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

5. **Pick the milestone.** Tickets go into the current sprint or the next one.
   Milestones are named `YYYY.W<week>` (e.g. `2026.W29`); `date +%G.W%V`
   prints the current one. Confirm the exact title against
   `gh api 'repos/{owner}/{repo}/milestones?state=open' --jq '.[].title'`.

6. **Create the issue with `gh`.** Write the body to a temp file and pass
   `--body-file` (heredocs preserve the markdown / checkboxes cleanly):

   ```bash
   cat > /tmp/ticket.md <<'EOF'
   ...body...
   EOF
   gh issue create --title "…" --body-file /tmp/ticket.md --milestone "2026.W29"
   rm -f /tmp/ticket.md
   ```

   - Title: imperative, scoped, and names the plugin context where useful
     (e.g. "Add attendee photo-upload page (token-gated via event emails)").
   - Labels: only apply one if it genuinely fits. Check `gh label list` first;
     leave unlabeled rather than forcing a wrong label, and offer to add one.

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
