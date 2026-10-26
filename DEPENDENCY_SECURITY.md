# Dependency Security

Every pull request runs four dependency checks
(`.github/workflows/dependency-security.yml`). All four are required before
merging to `main`.

| Check (job name)    | What fails it                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dependency review` | The PR adds or changes a dependency with a known vulnerability of any severity, in runtime, development or unknown scope.                   |
| `npm audit`         | Any advisory in any tracked `package-lock.json`, development dependencies included.                                                         |
| `Composer audit`    | Any advisory in any tracked `composer.lock`, `require-dev` included.                                                                        |
| `Dependency policy` | A direct dependency that the **base branch's** `.github/dependency-policy.json` doesn't approve, or a manifest without a covering lockfile. |

The audits cover the whole repository, not only the PR's changes, so a newly
published advisory fails every open PR until it is fixed or excepted.

## Running the checks locally

```bash
npm run audit:npm                    # every tracked package-lock.json
npm run audit:composer               # every tracked composer.lock (needs composer)
npm run validate:dependency-policy   # direct dependencies vs. the policy
node --test scripts/__tests__/dependency-security.test.mjs
```

Locally the commands read the working tree's policy; CI reads the base
branch's copy (`--policy-file`).

## What gets audited

`scripts/dependency-security.mjs` discovers dependency sets from
`git ls-files`, so a newly committed lockfile is audited without changing
the workflow:

- **npm:** every tracked `package-lock.json`. The root lockfile covers the
  root manifest and every workspace in its `workspaces` list. Any other
  `package.json` with dependencies needs its own tracked lockfile.
  `yarn.lock`, `pnpm-lock.yaml` and `npm-shrinkwrap.json` fail as
  unsupported.
- **Composer:** every tracked `composer.lock`, including `tools/php-tests`
  and `fair-events-shared/php`. A `composer.json` needs a tracked lockfile
  unless it only requires platform packages (`php`, `ext-*`) or packages
  from an in-repository `path` repository; `fair-finance` and `fair-form`
  are lockfile-free for that reason. A lockfile with no packages is
  reported as "no packages".

Audits never install anything: `npm audit --package-lock-only --ignore-scripts`
and `composer audit --locked --no-plugins --no-scripts`. Both include
development, optional and peer dependencies, and the script clears
`NODE_ENV`, `npm_config_omit` and `COMPOSER_NO_DEV` so the environment
can't narrow them. `config.audit.ignore`, `ignore-severity` and
`ignore-abandoned` in a `composer.json` fail the check; use a policy
exception instead.

## Failing checks

A check fails on any reported advisory, whatever its severity. It also fails
when it can't get an answer: a command error, a non-JSON or incomplete
report, an unreachable advisory service, or a dependency graph that can't
provide review data. Rerun the job if the failure was transient. Never
treat it as a pass.

To resolve a finding, in order of preference:

1. Update the dependency (`npm update <pkg>`, an `overrides` entry for a
   transitive npm package, or `composer update <pkg>` in that directory),
   then commit the lockfile.
2. Remove the dependency.
3. Add a time-limited exception (below), approved in its own PR.

## Package approval

`.github/dependency-policy.json` lists the approved direct dependencies of
every tracked manifest, by ecosystem and manifest path. It covers
`dependencies`, `devDependencies`, `optionalDependencies`,
`peerDependencies`, `require`, `require-dev` and Composer `repositories`.

**Adding a new direct package takes two PRs:**

1. A policy PR that only adds the package to the policy, reviewed by a
   maintainer and merged first. Regenerate the entries with
   `npm run dependency-policy:seed` after adding the package locally, then
   commit only the policy change.
2. The PR that adds the package. Rebase or merge `main` into it if it was
   opened earlier. Its checks read the policy from the base commit they ran
   against.

Editing the policy in the same PR that adds the package doesn't approve it:
CI reads the base branch's copy. Version updates of an approved package need
no policy change. Transitive packages aren't listed; the audits and
dependency review cover them.

Identities in the policy make a package's source part of its approval:

| Entry                                   | Meaning                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `lodash`                                | Registry package (npm or Packagist), any version range.                                                                            |
| `workspace:fair-events-shared`          | A root npm workspace. If the workspace disappears, the same name would resolve from the registry and becomes unapproved.           |
| `alias@npm:target`                      | An npm alias (`"alias": "npm:target@^1"`). Retargeting an approved name through an alias is a different identity.                  |
| `name@github:owner/repo`, `name@file:…` | Git, URL and local-path npm specs; the git ref is ignored.                                                                         |
| `path:fair-events/shared`               | A Composer package served by an in-repository `path` repository.                                                                   |
| `repository:<type>:<url>`               | A Composer repository entry (`path`, `vcs`, `composer`, …). Adding one requires approval because it can redirect any package name. |

A manifest the policy doesn't list yet (a new plugin) has no approved
packages; its policy PR lands first, like any other addition.

## Vulnerability exceptions

The policy carries one exception today: `braces` (GHSA-vfj7-8cjw-p6xm), which
has no fixed release and only reaches the build tooling (#2037). Add one only
when no fix is available and the risk is understood. It goes in the base
branch's policy, so it follows the same two-PR rule:

```json
{
	"advisory": "GHSA-xxxx-xxxx-xxxx",
	"package": "braces",
	"dependencySet": "package-lock.json",
	"rationale": "Build-time only, not reachable from shipped code; fix pending upstream.",
	"owner": "@marcin-wosinek",
	"issue": "#1234",
	"expires": "2026-12-31"
}
```

- An exception covers exactly one advisory (GHSA, CVE or Composer advisory
  ID), one package and one lockfile.
- All fields are required. `issue` names the remediation ticket.
- A missing field, a malformed date or a past `expires` fails the audits.
  Renew an exception deliberately, or fix the finding.
- An exception that no longer matches a finding is reported, to be
  removed.

`Dependency review` doesn't read these exceptions. For the rare case where it
must pass a known advisory, add the GHSA to `allow-ghsas` in the workflow,
with the same rationale, owner, issue and expiry in a comment.

## Required checks and repository settings

Repository settings that this setup depends on (verify with
`gh api repos/marcin-wosinek/fair-event-plugins` and
`…/branches/main/protection`):

- **Branch protection on `main`:** require the status checks
  `Dependency review`, `npm audit`, `Composer audit` and
  `Dependency policy`, bound to the GitHub Actions app, and include
  administrators. Add the checks only after they have reported on a pull
  request, so GitHub knows the names.
- **Dependency graph** enabled (needed by `Dependency review`).
- **Secret scanning** and **push protection** enabled.

The workflow triggers on every `pull_request` (opened, synchronized,
reopened, or edited, which covers a base-branch change), with no path, fork
or Dependabot filters, so required checks never stay pending. Fork and
Dependabot PRs get the same read-only token. The workflow has only
`contents: read`, checks out without persisted credentials, uses no
secrets, and never installs dependencies or runs their scripts.

The workflow and `scripts/dependency-security.mjs` run from the PR itself,
so changes to either need careful review: a PR that weakens them is
weakening the gate it is checked by.

Out of scope here: a license policy, pinning actions to SHAs, and
WordPress.org release hardening.
