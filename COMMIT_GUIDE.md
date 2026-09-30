# Commit & PR Guide

## Branch & PR workflow

The default loop while working a ticket:

1. **Branch.** Do the work on a topic branch off `main` — never commit ticket
   work directly to `main`.
2. **Open a PR when the code is ready.** Once the change satisfies the ticket
   and the relevant builds/tests pass, push the branch and open a PR by default
   (no need to ask first). Link the issue with `Closes #NNN` per
   [Referencing & closing issues](#referencing--closing-issues).
3. **Clean up after merge.** When the PR is merged, delete the source branch
   both remotely and locally:

    ```bash
    git push origin --delete <branch>      # remote (GitHub may already do this)
    git checkout main && git pull           # get the merge, mark the branch [gone]
    git branch -d <branch>                  # local
    ```

    To sweep every branch the remote has already deleted, run the
    `/clean_gone` command, which prunes all local branches marked `[gone]`
    (and their worktrees).

## Attribution

-   **Do not** add a `Co-Authored-By: Claude …` trailer to commits.
-   **Do not** add "🤖 Generated with Claude Code" (or any equivalent attribution
    line) to PR descriptions.
-   Commits are authored by the human running the session. No tool/agent
    attribution belongs in the permanent history.

## Commit messages

-   Subject: imperative mood, ~50 chars, no trailing period.
    -   Good: `Send resume link instead of acting on a known email`
    -   Bad: `Sent resume link for known emails.` / `Fix #557`
-   Body (when needed): wrap ~72 chars, explain **why** the change exists and what
    user-visible behaviour shifts. Skip restating the diff.
-   Reference issues with `Refs #NNN` or `Closes #NNN` on their own line at the
    bottom of the body (see [Referencing & closing issues](#referencing--closing-issues)).
-   No trailers other than `Refs:` / `Closes:` / `Reverts:`.

## Referencing & closing issues

When work relates to a GitHub issue (e.g. one written per [TICKETS.md](./TICKETS.md)),
link it so the history and the tracker stay connected:

-   **`Closes #NNN`** when the commit/PR fully resolves the issue — GitHub
    auto-closes it on merge to the default branch. Use this for the change that
    completes the ticket's acceptance criteria.
-   **`Refs #NNN`** when the change relates to but does not finish the issue
    (partial work, one of several PRs, or a follow-up). It links without closing.
-   Put the keyword on its own line at the bottom of the commit body. In PRs,
    also put `Closes #NNN` in the **Summary** so the link is visible in the UI.
-   Find the issue number with `gh issue list` / `gh issue view` when unsure.
-   Don't invent or guess issue numbers — only reference an issue that exists and
    actually matches the work. If none does, omit the trailer.

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

-   Open with a short **Summary** (bulleted or 1–2 sentences) — what changed
    from the user's perspective.
-   Add a **Notes** section for trade-offs, deferred work, or follow-ups worth
    flagging to a reviewer.
-   Add a **Test plan** as a markdown checklist of manual / automated checks.
-   Link the issue with `Closes #NNN` in the Summary so GitHub auto-closes it
    on merge.
-   No emoji footer, no tool attribution.

## Responsive-UI tickets (`responsive-ui` label)

When a PR resolves an issue carrying the **`responsive-ui`** label, the
description must show the change works across all three viewports.

**Detect it.** Before opening the PR, read the linked issue's labels:

```bash
gh issue view <NNN> --json labels --jq '.labels[].name'
```

If `responsive-ui` is among them, this section applies.

**Capture _before_ first — at the start of the task, not the end.** The "before"
state is the base branch, so grab it _before_ touching any code (rebuilding the
old state later means a branch switch + extra `npm run build`). Create the
implementation branch first, then, for each changed page, run the screenshot
helper at all three presets against the running dev instance
(`docker compose up` must be live):

```bash
npm run screenshot -- "<admin-or-public-path>" desktop before-<page>-desktop.png --upload github --issue <NNN>
npm run screenshot -- "<admin-or-public-path>" tablet  before-<page>-tablet.png  --upload github --issue <NNN>
npm run screenshot -- "<admin-or-public-path>" mobile  before-<page>-mobile.png  --upload github --issue <NNN>
```

**Capture _after_** once the change is built (`npm run build` in the affected
plugin), repeating the three presets with `after-` filenames.

The presets are `desktop` (1280×900), `tablet` (768×1024), `mobile` (375×812) —
see [TESTING.md](./TESTING.md) and `scripts/screenshot.js`.

**Public, synthetic data only.** Every upload below is a GitHub attachment
that anyone can open and GitHub caches, even after the PR closes. Capture from
the local dev/demo instance only — no real participant names, emails, or
finance figures.

**How uploads work.** `--upload github` writes the local PNG first, then
attaches it through the already-authenticated `gh` CLI (no new key; no
screenshot branch, no companion PR):

-   **Before the PR exists**, `--issue <NNN>` attaches the PNG to a comment on
    the ticket, marked with the checked-out implementation branch and the
    filename. Uploading the same filename again from the same branch supersedes
    that comment; other branches' uploads for the same issue are untouched.
    Screenshots can't be uploaded from `main` — pass `--branch <name>` if you
    capture from somewhere else.
-   **Once the branch has an open PR** (or with `--pr <n>`), the PNG is attached
    to the PR itself, and the description's `![<filename>](...)` reference
    points at it. The PR is the durable home of the final evidence.

In the PR description, add a **Screenshots** section with a before/after row
per viewport (and per changed page). Write each image as a local placeholder
whose alt text is its filename:

```markdown
## Screenshots

| Viewport | Before                                                    | After                                                   |
| -------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Desktop  | ![before-<page>-desktop.png](./before-<page>-desktop.png) | ![after-<page>-desktop.png](./after-<page>-desktop.png) |
| Tablet   | ![before-<page>-tablet.png](./before-<page>-tablet.png)   | ![after-<page>-tablet.png](./after-<page>-tablet.png)   |
| Mobile   | ![before-<page>-mobile.png](./before-<page>-mobile.png)   | ![after-<page>-mobile.png](./after-<page>-mobile.png)   |
```

After creating the PR, attach all final PNGs to it, then verify:

```bash
npm run screenshot:attach -- --pr <PR> before-<page>-*.png after-<page>-*.png
npm run screenshot:verify -- --pr <PR> before-<page>-{desktop,tablet,mobile}.png after-<page>-{desktop,tablet,mobile}.png
```

`screenshot:attach` replaces each placeholder with a verified
`github.com/user-attachments` URL. A before PNG you no longer have locally is
fetched from its issue comment for the PR's branch (the ticket comes from
`Closes #N`/`Refs #N`, or pass `--issue <NNN>`). `screenshot:verify` fails if
any referenced image is still a local path or doesn't resolve, or if a listed
filename isn't referenced.

**Replacing a screenshot** — re-run `screenshot:attach` (or the capture with
`--upload github`) for that filename. The new attachment is verified before
its reference changes, so a failed replacement leaves the old image showing.

**If an upload fails,** the command exits non-zero and the local PNG stays
where it was. `gh` can attach some files and still fail, so the script
re-reads the description after every attempt and retries only the files that
are still missing; a fresh attachment can take 15+ seconds to resolve, which
it waits for. Re-running is safe and doesn't duplicate images. If a file still
can't be attached, state plainly in the PR description which viewport/state is
missing and why, and don't claim complete visual evidence.

Never commit the PNGs. Older PRs embed images from the legacy `pr-assets`
branch; that branch is kept so they keep rendering, but nothing uploads to it
any more.

## Before committing

Run format and build in the affected plugin so every committed file has
correct styling and up-to-date generated assets:

```bash
# From inside the affected plugin directory
npm run format   # JS/CSS/JSON via wp-scripts; PHP via phpcbf
npm run build    # Rebuild generated assets after JS/CSS changes
```

The PostToolUse hook auto-formats each file as you edit it, but running
`npm run format` explicitly before staging catches any files that were
touched outside the hook (e.g. manual shell edits, generated files, or
files edited across multiple sessions).

Only stage the resulting clean files — never commit formatting noise
mixed with logic changes.

## Things to keep doing

-   Use `HEREDOC` for multi-line commit messages and PR bodies so formatting
    survives the shell.
-   Stage files explicitly (`git add path/...`); avoid `git add -A` / `git add .`
    to keep stray edits out of commits.
-   Never `--amend` a pushed commit or push to `main` without explicit ask.
