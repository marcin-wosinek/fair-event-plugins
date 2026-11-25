---
'fair-events-experimental': minor
---

Share marketing assets publicly: with Marketing assets on, every event date gets a page that collaborators can open without an account, at `/?fair_marketing_assets={id}`, plus a list of every date's page at `/?fair_marketing_assets=all`. The pages work for draft, private and published events. There, collaborators filter by team member or use case, copy texts exactly as written, and download PNG/JPEG images. Unpublished events are named by ID only. Team members' names (name and surname only) appear only after an administrator confirms it when linking them. Links saved before this release stay private until confirmed, and the authenticated API needs `publish_member_names` to add a member. Manage Event → Marketing links to the public page and says that asset content is public.
