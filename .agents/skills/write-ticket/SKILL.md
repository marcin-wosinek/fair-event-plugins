---
name: write-ticket
description: Draft and, after explicit approval, create a Fair Event Plugins GitHub issue and place it in the requested sprint. Use for ticket or issue-writing requests in this repository.
---

# Write a ticket

Read `TICKETS.md` before drafting.

Describe behavior, motivation, expected behavior, risks, genuine open questions with recommendations, and behavior-level acceptance criteria. Explore the repository as needed, but do not put file paths, symbols, class names, functions, or route strings in the issue. Stable reference-doc links are allowed.

If the request starts with `current` or `next`, treat that as the target sprint. Otherwise ask for the sprint when presenting the draft. Resolve the matching iteration from the existing iterations in GitHub Project 5 (`marcin-wosinek`) by comparing today's date with iteration dates. Apply `responsive-ui` whenever behavior changes layout across viewports; otherwise inspect existing labels before choosing one.

Iteration configuration is outside this workflow's authority. If the requested iteration does not exist, stop and report that it must be created in the project settings before the ticket can be assigned. Never call `updateProjectV2Field`, and never create, edit, or delete iterations through GraphQL: iteration configuration updates replace the whole configuration, so an incomplete list can delete iterations and clear every affected item assignment.

Show the complete title, body, sprint, and labels in chat. Do not create or mutate anything until the user explicitly approves that draft. After approval:

1. Create the issue using a temporary body file and `gh issue create`.
2. Add it to GitHub Project 5 and set its Iteration field.
3. Remove the temporary file and report the issue URL.

Do not add AI attribution.
