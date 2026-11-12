# Moving an audience between Fair Audience sites

Fair Audience can export its audience as a CSV file and import that file on
another Fair Audience site (#2218). Use it, for example, to move a mailing list
from one site to another.

Both actions are in the **⋮ (Export or import the audience)** menu next to
**Add Participant** on **Fair Audience → All Participants**. Only
administrators (`manage_options`) can use them.

## Steps

1. On the source site, choose **Export audience CSV…**. A popup asks who to
   export (see [Export scope](#export-scope)); nothing is downloaded until you
   select **Download CSV**. The scope never follows the table filters.
2. Keep the file private: it contains names, email addresses and phone
   numbers. It is downloaded directly and never stored on the server.
3. On the destination site, choose **Import audience CSV…**, pick the file
   and select **Import members**.
4. Read the report. Resolve conflicts (see
   [Conflicts and opt-outs](#conflicts-and-opt-outs)) **before** sending mail
   from the destination site.
5. Ask the new members to confirm their address and choose their feeds on the
   destination site, for example with the participant's **Resend mailing
   confirmation email** action. The import itself sends nothing.

Importing the same file again is safe. Members added the first time are
reported as already present, and nobody is added twice.

## Export scope

| Choice                         | Who is in the file                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **All participants** (default) | Every participant                                                                                                       |
| **Mailing subscribers only**   | Confirmed participants whose mailing choice is `marketing`: the members counted as **In the mailing** in the statistics |

The weekly summary opt-out and feed choices do not change who counts as a
mailing subscriber, so a subscriber who opted out of the weekly summary is
exported with `weekly_summary_opt_out` set to `1`. Pending, `minimal` and
`declined` members are left out of the subscriber-only file. Both choices
produce the same CSV format; a subscriber-only file is named
`fair-audience-subscribers-<date>.csv`.

If a download fails, the popup keeps your choice and shows the error, so you
can try again. An export with nobody in it holds only the header row, and the
import refuses it as having no audience members.

Over the REST API, `GET /fair-audience/v1/participants/export` takes an
optional `scope` of `all` (the default) or `subscribers`; any other value
returns `400`.

## CSV format (version 1)

UTF-8 text, comma separated, with a header row. Exports start with a byte order
mark so spreadsheets detect the encoding; a byte order mark is optional on
import. Fields that contain a comma, quote or line break are quoted, and quotes
inside them are doubled (RFC 4180).

| Column                   | Required | Values                                                        |
| ------------------------ | -------- | ------------------------------------------------------------- |
| `format_version`         | yes      | `1`                                                           |
| `name`                   | yes      | First name, not empty, up to 255 characters                   |
| `surname`                | yes      | Up to 255 characters, may be empty                            |
| `email`                  | yes      | Valid address; rows with an empty value are skipped           |
| `phone`                  | yes      | Up to 50 characters, may be empty                             |
| `instagram`              | yes      | Up to 255 characters, may be empty                            |
| `email_profile`          | yes      | `minimal`, `marketing` or `declined` (the **Mailing** column) |
| `weekly_summary_opt_out` | yes      | `1` or `0` (`true`/`false` and `yes`/`no` are accepted)       |
| `weekly_feed_mode`       | no       | Legacy: `all`, `selected` or empty. Accepted and ignored      |

Every required column must be present, in any order. Any other column, or a
column that appears twice, rejects the file.

**Spreadsheet formulas.** A value starting with `=`, `+`, `-`, `@`, a tab, a
carriage return or an apostrophe is exported with one extra leading apostrophe
(`'+34 600 000 000`), so spreadsheets show it as text instead of running it.
The import removes that apostrophe again. If a spreadsheet saves the value
without it (`+34 600 000 000`), the import reads that unchanged too. An
apostrophe that does not precede one of those characters (`O'Neil`, `'Ana`) is
part of the value.

### What is not exported

Participant IDs, confirmation status, WordPress accounts, confirmation and
subscription-management tokens, timestamps, groups, categories, event
signups, tickets, payments, consent history and **feed subscriptions**.

## Normalization and matching

- Email is trimmed and lowercased. Members are matched by email,
  case-insensitively.
- Other text fields are trimmed. Their case and punctuation are kept, so `ana`
  and `Ana` differ.
- `email_profile`, `weekly_summary_opt_out` and `weekly_feed_mode` are trimmed
  and lowercased.
- Invalid values are reported, never repaired: an empty first name, an invalid
  email address, an unknown mailing choice, an empty or unknown opt-out value,
  a value that is too long, and text containing line breaks or HTML tags.

## What the import does with each row

| Row                                         | Result                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| Invalid value                               | Rejected, with the reason per field                  |
| No email                                    | Skipped                                              |
| New email                                   | Added (see below)                                    |
| Existing email, every field below identical | Skipped as **already present**                       |
| Existing email, any field below different   | Skipped as a **conflict**, with the differing fields |
| Could not be saved                          | Reported; import the file again to retry             |

Compared fields: first name, surname, phone, Instagram, mailing choice
(`email_profile`) and weekly summary opt-out. The legacy `weekly_feed_mode` is
never compared, and the destination member's feed subscriptions are neither
compared nor changed.

A new member is added with:

- the contact details, mailing choice and weekly summary opt-out from the file;
- status **pending**: the source site's confirmation is not trusted, so the
  member must confirm the address on this site. The import creates no
  confirmation token and sends no email;
- **no feed subscriptions**;
- no WordPress account;
- a consent log entry with source `csv_import`.

The weekly unconfirmed-signup timeout, which reverts pending marketing members
to minimal after a week, skips members whose latest consent entry is the
import. Their mailing choice stays as imported until they confirm or an
administrator changes it.

The file is checked before anything is written: missing, unsupported or
duplicate columns, broken quoting, rows with the wrong number of values, a
different `format_version`, text that is not UTF-8, more than 10,000 rows or
more than 5 MB reject the whole file without changes. Larger audiences can be
split into several files, each with the header row.

## Feed subscriptions are not transferred

Feed IDs belong to the site that created them, so an import never subscribes
anyone to a feed. This holds for both legacy `weekly_feed_mode` values: `all`
does not expand to the destination's current or future feeds, and neither
value grants marketing consent. Imported members receive no feed-based weekly
email until they choose feeds on the destination site, for example from the
subscription management link or a Mailing Signup form.

## Conflicts and opt-outs

A conflict leaves the destination member exactly as it was, so an opt-out in
the file does **not** reach an existing destination member. The report marks
these rows in red: "Opt-out not transferred". It happens when:

- the file's mailing choice is `minimal` or `declined` but the destination
  member has `marketing`, or
- the file opts out of the weekly summary but the destination member does not.

Before mailing resumes, open each of those members on the destination site and
apply the opt-out: set **Mailing** and the weekly summary option to match the
person's latest choice. Conflicts in the other direction (opted out on the
destination, opted in in the file) also change nothing. Keep the stricter
choice unless the person has opted in again.

Other conflicts (name, phone, Instagram) are informational: update the
destination member by hand if the file is right.
