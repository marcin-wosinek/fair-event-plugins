# Commit & PR Guide

## Attribution

- **Do not** add a `Co-Authored-By: Claude …` trailer to commits.
- **Do not** add "🤖 Generated with Claude Code" (or any equivalent attribution
  line) to PR descriptions.
- Commits are authored by the human running the session. No tool/agent
  attribution belongs in the permanent history.

## Commit messages

- Subject: imperative mood, ~50 chars, no trailing period.
  - Good: `Send resume link instead of acting on a known email`
  - Bad: `Sent resume link for known emails.` / `Fix #557`
- Body (when needed): wrap ~72 chars, explain **why** the change exists and what
  user-visible behaviour shifts. Skip restating the diff.
- Reference issues with `Refs #NNN` or `Closes #NNN` on their own line at the
  bottom of the body.
- No trailers other than `Refs:` / `Closes:` / `Reverts:`.

Example:

```
Send resume link instead of acting on a known email

Anonymous signup with an email that matches an existing participant now
returns an email_recognized status and mails the resume link to the
address, unless the browser's audience session already belongs to that
participant. Closes the data-leak path where guessing an email would
sign the stranger up under the real participant's identity.

Closes #557
```

## PR descriptions

- Open with a short **Summary** (bulleted or 1–2 sentences) — what changed
  from the user's perspective.
- Add a **Notes** section for trade-offs, deferred work, or follow-ups worth
  flagging to a reviewer.
- Add a **Test plan** as a markdown checklist of manual / automated checks.
- Link the issue with `Closes #NNN` in the Summary so GitHub auto-closes it
  on merge.
- No emoji footer, no tool attribution.

## Things to keep doing

- Use `HEREDOC` for multi-line commit messages and PR bodies so formatting
  survives the shell.
- Run `npm run format` and the relevant `npm run build` before committing
  generated assets land cleanly.
- Stage files explicitly (`git add path/...`); avoid `git add -A` / `git add .`
  to keep stray edits out of commits.
- Never `--amend` a pushed commit or push to `main` without explicit ask.
