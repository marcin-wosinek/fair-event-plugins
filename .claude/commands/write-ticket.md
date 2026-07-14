---
description: Draft a GitHub issue (behaviour + risks, no code references), confirm it, and file it into a sprint milestone
argument-hint: <what the ticket is about> [current|next]
---

Write a GitHub issue for: $ARGUMENTS

Follow [TICKETS.md](../../TICKETS.md). The essentials:

1. **Understand the behaviour — don't cite the code.** Explore the codebase as
   much as needed to describe current behaviour and what should change, but the
   ticket body must contain **no direct code references** (no file paths, class
   names, function names, route strings). Tickets often sit a sprint or more
   before planning and the surrounding code changes underneath them — stale
   references mislead. Naming the plugin and existing *features* ("the gallery
   download flow") is fine. Code grounding happens later, at `/plan-ticket`
   time.

2. **Draft the ticket** using the TICKETS.md skeleton: Plugin, Summary,
   Motivation, Expected behaviour, Risks, Open questions (real forks with a
   recommendation), Acceptance criteria as a `- [ ]` behaviour-level checklist.
   Linking reference docs (REST_API_BACKEND.md, TESTING.md, …) is fine — they
   are stable; code isn't.

3. **Pick the milestone.** Tickets go into the current sprint or the next one.
   Milestones are named `YYYY.W<week>`; `date +%G.W%V` gives the current one.
   Verify the exact title exists via
   `gh api 'repos/{owner}/{repo}/milestones?state=open' --jq '.[].title'`.
   If $ARGUMENTS doesn't say current or next, ask me together with the draft
   review.

4. **Check it with me.** Show the full draft (title, body, milestone, any
   label) in chat and pause. Do **not** create the issue until I approve.
   Incorporate feedback and re-confirm if anything changed.

5. **Create the issue.** Write the body to a temp file and run
   `gh issue create --title "…" --body-file /tmp/ticket.md --milestone "YYYY.W<n>"`,
   then `rm -f /tmp/ticket.md`. Labels: only if one genuinely fits
   (`gh label list` first); leave unlabeled rather than forcing one. No Claude
   attribution anywhere. Report the issue URL.
