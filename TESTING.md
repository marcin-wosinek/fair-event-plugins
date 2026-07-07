# Testing Architecture

## Introduction

This document defines the unified testing architecture for the Fair Event Plugins monorepo. The architecture provides a scalable, consistent approach to testing across all plugins while keeping tests close to the code they verify.

### Philosophy

-   **Co-location**: Tests live next to the source code they test in `__tests__/` directories
-   **Separation of concerns**: Different test types use different file extensions and runners
-   **Pragmatic tooling**: Playwright for API testing to avoid WordPress PHP test suite complexity
-   **Consistency**: Same structure across all 10+ plugins in the monorepo

## Architecture Overview

The testing architecture supports four main test types:

1. **Unit Tests** (`.test.js`) - Test JavaScript utilities and functions in isolation using Jest
2. **Component Tests** (`.test.jsx`) - Test React components with Jest + React Testing Library
3. **API Tests** (`.api.spec.js`) - Test WordPress REST API endpoints using Playwright
4. **E2E Tests** (`.spec.js`) - Test complete user flows through the browser using Playwright

### Why Playwright for API Testing?

We use Playwright instead of PHPUnit for REST API testing because:

-   Avoids complex WordPress test suite setup (wp-phpunit, test database configuration)
-   Tests real HTTP requests against a running WordPress instance
-   Same tool and patterns for both API and E2E tests
-   Tests exactly what the frontend JavaScript calls

## Directory Structure

### Per-Plugin Structure

```
fair-{plugin-name}/
├── src/
│   ├── blocks/
│   │   └── {block-name}/
│   │       ├── editor.js
│   │       ├── frontend.js
│   │       ├── components/
│   │       │   ├── ComponentName.jsx
│   │       │   └── __tests__/
│   │       │       └── ComponentName.test.jsx
│   │       └── utils/
│   │           ├── utilityName.js
│   │           └── __tests__/
│   │               └── utilityName.test.js
│   ├── API/                              # Uppercase "API" (standardized)
│   │   ├── PluginController.php
│   │   └── __tests__/
│   │       └── PluginController.api.spec.js
│   ├── Admin/
│   │   └── pages/
│   │       ├── AdminPage.jsx
│   │       └── __tests__/
│   │           └── AdminPage.test.jsx
│   └── Utils/
│       ├── helper.js
│       └── __tests__/
│           └── helper.test.js
├── e2e/                                  # All E2E tests
│   ├── user-flows/
│   │   └── feature-name.spec.js
│   └── screenshots/
│       └── wordpress-org.spec.js
├── build/                                # Build artifacts (gitignored)
├── jest.config.js
├── playwright.config.js
├── phpunit.xml                           # Kept for future use
└── package.json
```

### Key Principles

1. **Co-located unit/component tests**: `__tests__/` directories next to source files
2. **Centralized E2E tests**: All in `e2e/` directory at plugin root
3. **API tests with controllers**: In `src/API/__tests__/` next to PHP controllers
4. **Consistent naming**: Uppercase `API/` directory across all plugins

## File Naming Conventions

| Test Type                | Extension      | Test Runner | Location Pattern                         | Example                      |
| ------------------------ | -------------- | ----------- | ---------------------------------------- | ---------------------------- |
| **JavaScript Unit Test** | `.test.js`     | Jest        | `src/**/__tests__/*.test.js`             | `timeUtils.test.js`          |
| **React Component Test** | `.test.jsx`    | Jest        | `src/**/components/__tests__/*.test.jsx` | `StatusBadge.test.jsx`       |
| **REST API Test**        | `.api.spec.js` | Playwright  | `src/API/__tests__/*.api.spec.js`        | `RsvpController.api.spec.js` |
| **E2E Test**             | `.spec.js`     | Playwright  | `e2e/**/*.spec.js`                       | `complete-rsvp-flow.spec.js` |
| **Screenshot Test**      | `.spec.js`     | Playwright  | `e2e/screenshots/*.spec.js`              | `wordpress-org.spec.js`      |

### Naming Rules

-   **Unit tests**: Match the source file name (e.g., `dateTime.js` → `dateTime.test.js`)
-   **Component tests**: Match component name (e.g., `Button.jsx` → `Button.test.jsx`)
-   **API tests**: Match controller name (e.g., `RsvpController.php` → `RsvpController.api.spec.js`)
-   **E2E tests**: Describe the user flow (e.g., `complete-rsvp-flow.spec.js`)

## Test Types

### JavaScript Unit Tests

**Purpose**: Test pure JavaScript functions and utilities in isolation

**Runner**: Jest
**Environment**: Node.js
**Location**: `src/**/__tests__/*.test.js`

**When to use**:

-   Utility functions (date formatting, validation, calculations)
-   Data transformation logic
-   Business logic that doesn't require DOM

### React Component Tests

**Purpose**: Test React components with DOM interaction

**Runner**: Jest + React Testing Library
**Environment**: jsdom
**Location**: `src/**/components/__tests__/*.test.jsx`

**When to use**:

-   Block editor components
-   Admin page React components
-   Interactive UI elements
-   Component rendering and user interactions

### REST API Tests

**Purpose**: Test WordPress REST API endpoints via HTTP requests

**Runner**: Playwright
**Environment**: Real WordPress instance (Docker)
**Location**: `src/API/__tests__/*.api.spec.js`

**When to use**:

-   Testing REST endpoint responses
-   Validating authentication and permissions
-   Testing request/response formats
-   Error handling for API calls

**Key features**:

-   Tests real HTTP requests
-   Includes WordPress nonce authentication
-   Tests against running WordPress (localhost:8080)
-   No PHP test suite setup required

### E2E Tests

**Purpose**: Test complete user workflows through the browser

**Runner**: Playwright
**Environment**: Real WordPress instance (Docker)
**Location**: `e2e/**/*.spec.js`

**When to use**:

-   Complete user journeys (registration, RSVP, payment)
-   Block insertion and interaction in editor
-   Admin page workflows
-   Integration of multiple features

### PHP Unit Tests (PHPUnit)

**Purpose**: Test pure PHP logic in isolation — no WordPress bootstrap, no DB,
no HTTP. Use for boundary-level regression locks (e.g. arguments reaching a
third-party SDK) and logic that's awkward to reach through `.api.spec.js`.

**Runner**: PHPUnit (plain — no Brain Monkey / WP_Mock / Mockery anywhere in
the repo)
**Location**: `phpunit.xml` at the plugin root, bootstrap at
`__tests__/bootstrap.php`, tests at `__tests__/**/*Test.php`
**Namespace**: `Fair…\Tests\…`, mirroring the `src/` namespace under test

**Convention**:

-   `phpunit.xml` points `bootstrap` at `__tests__/bootstrap.php` and the
    testsuite `<directory suffix="Test.php">./__tests__</directory>`.
-   `__tests__/bootstrap.php` loads the Composer autoloader, defines `WPINC`,
    and hand-writes stubs for just the WordPress functions the code under test
    calls (e.g. `get_option()` backed by `$GLOBALS['_fair_test_options']`). Add
    stubs only as needed — don't pre-stub the whole API surface.
-   If the code under test touches `$wpdb`, stub a minimal fake in the bootstrap
    (e.g. an `insert()` that returns success) rather than pulling in a DB
    library.
-   Run via `npm run test:php` (→ `vendor/bin/phpunit`) or `composer test`.
    `npm test` already chains `test:php` after `test:js`, so it runs in CI with
    no dedicated workflow step.

**When to use**:

-   Locking a regression at a boundary that's hard/unsafe to reach via `.api.spec.js`
    (e.g. arguments passed to a third-party SDK client that has its own HTTP
    transport, so `pre_http_request` can't intercept it — see
    `fair-payments-connector/__tests__/Payment/MolliePaymentHandlerTest.php`).
-   Pure PHP logic (settings parsing, formatting, recurrence math) that doesn't
    need a live WordPress instance — see `fair-events/__tests__/`.

**Examples**: `fair-events`, `fair-payments-connector`,
`fair-payments-connector-experimental`, `fair-events-experimental`,
`fair-timetable`.

### WordPress.org Screenshot Tests

**Purpose**: Generate screenshots for WordPress.org plugin directory

**Runner**: Playwright
**Location**: `e2e/screenshots/wordpress-org.spec.js`

**Special considerations**:

-   Use consistent viewport (1200x900)
-   Capture specific states for documentation
-   Save to `assets/` directory

### Ad-hoc page screenshots (`npm run screenshot`)

**Purpose**: Grab a one-off screenshot of any admin/public page — e.g. a
before/after for a PR — without writing a spec.

**Runner**: `scripts/screenshot.js` (headless Playwright, reuses the e2e
login + `WP_BASE_URL` convention; defaults to the dev wp-env on `:8888`,
`admin` / `password`).

```bash
# npm run screenshot -- <path> <dimensions> <filename>
npm run screenshot -- "/wp-admin/admin.php?page=fair-payments-connector-budgets" mobile budgets-mobile.png

# dimensions: desktop | tablet | mobile | WIDTHxHEIGHT (e.g. 414x900)
# options: --viewport (visible area only), --wait <ms>, --wait-for <selector>,
#          --no-login, --upload imgbb, --expiry <seconds>
```

The file is written **relative to the current working directory**, so run it
from wherever you want the image. Point it elsewhere with
`WP_BASE_URL=http://localhost:8889 npm run screenshot -- …`.

#### Embedding in a PR (`--upload imgbb`)

To turn a capture into a PR-embeddable link in one command, add
`--upload imgbb`. The local PNG is still written; the upload is **in addition**
to it. The script prints the public URL and a paste-ready markdown snippet:

```bash
npm run screenshot -- "/" desktop home.png --no-login --upload imgbb
# Saved desktop (1280x900) screenshot of http://localhost:8888/
#   → /…/home.png
# Uploaded: https://i.ibb.co/abc123/home.png
# Markdown:  ![home](https://i.ibb.co/abc123/home.png)
```

**Setup**: get a free API key at <https://api.imgbb.com/> and add it to the repo
`.env` as `IMGBB_API_KEY=<key>` (gitignored — never commit it). Without it the
command errors and exits non-zero rather than silently skipping the upload.

Uploads default to a **30-day expiry** so stale PR images self-clean; override
with `--expiry <seconds>` (imgbb accepts `60`–`15552000`; `0` keeps it
indefinitely).

> ⚠️ **Public exposure, synthetic data only.** imgbb is a public host: anyone
> with the link can view the image and GitHub caches it via camo. Admin captures
> can leak participant names, emails, or finance figures — only upload
> synthetic/demo pages. For real-data screenshots keep using the `pr-assets/<n>`
> branch + authenticated `…?raw=true` embeds. imgbb is also not a durable
> archive (hence the default expiry), so for long-lived PRs prefer the
> `pr-assets` branch or a manual GitHub drag-drop attachment.

### Plugin Check reporting (`e2e/plugin-check.spec.js`)

**Purpose**: Install the official [Plugin Check](https://wordpress.org/plugins/plugin-check/)
plugin on the wp-env `tests` instance, run the **complete** scan
(`--include-experimental --severity=0`, all checks) against each Fair Event
plugin, and report the error / warning counts exactly as Plugin Check returns
them.

**Runner**: Playwright (e2e harness). It shells out via
`npx wp-env run tests-cli wp plugin check …`; it does not drive a browser.

**Special considerations**:

-   It's a **reporting** suite — it does not fail on findings, only if Plugin
    Check can't run or its output can't be parsed. Flip the per-plugin assertion
    to `expect(result.errors)` to make it a CI gate.
-   Needs the `tests` instance running (`npm run test:e2e:setup`) and **network
    access** (Plugin Check is fetched from wordpress.org on first run).
-   Slow (full scan of every plugin); the spec sets generous per-test timeouts.
-   `node_modules` / `vendor` are excluded by Plugin Check's defaults; `build/`
    is included, since that is what ships.
-   Counts print per-plugin and as a combined summary table in the test output.

### Manual Integration Checks (WP-CLI `eval-file`)

**Purpose**: One-off verification of behavior that needs a fully bootstrapped
WordPress (DB, plugins, hooks loaded) but isn't worth a permanent test — e.g.
server-rendered block output, hook side-effects, repository/model calls against
real tables.

**Runner**: WP-CLI inside the Docker container (`wpcli` service)
**Lifetime**: Throwaway — written, run, and deleted in the same step. Never
committed.

**How it works**: `compose.yml` mounts each plugin dir into the container at
`wp-content/plugins/<plugin>/`. A loose file at the repo root is **not**
mounted, so a scratch script must be copied _into a mounted plugin dir_ to be
visible to `wp eval-file`, then removed afterward.

**Recipe** (assumes the repo root is
`/Users/marcinwosinek/workspace/fair-event-plugins`; adjust to your checkout):

```bash
# 1. Write the scratch script at the repo root (a real WordPress bootstrap is
#    available; assert PASS/FAIL and clean up its own test data).
#    e.g. /Users/.../fair-event-plugins/.tmp-check.php

# 2. Copy it into the mounted plugin dir — use ABSOLUTE paths, never `cd`.
cp /Users/marcinwosinek/workspace/fair-event-plugins/.tmp-check.php \
   /Users/marcinwosinek/workspace/fair-event-plugins/fair-audience/.tmp-check.php

# 3. Run it inside the container (path is container-relative here).
docker compose --profile cli run --rm wpcli \
  wp eval-file wp-content/plugins/fair-audience/.tmp-check.php 2>&1 | grep -E "PASS|FAIL|done"

# 4. Remove both copies — again ABSOLUTE paths, no `cd`.
rm -f /Users/marcinwosinek/workspace/fair-event-plugins/fair-audience/.tmp-check.php \
      /Users/marcinwosinek/workspace/fair-event-plugins/.tmp-check.php
```

> **Always use absolute paths, never `cd … && cp/rm`.** Chaining `cd` into a
> write (`cp`/`rm`) makes the working directory unverifiable, so Claude Code
> forces a manual approval prompt on _every_ run. Absolute paths run the exact
> same thing with no prompt.

**Guidelines**:

-   The script must clean up any rows/posts/users it creates.
-   Prefix scratch files with `.tmp-` so they're obvious and easy to sweep.
-   If you find yourself reaching for this repeatedly for the same scenario,
    promote it to a real Playwright API or E2E test instead.

## Test Discovery Rules

### Jest Discovery

Jest automatically finds tests matching these patterns:

```javascript
testMatch: ['**/__tests__/**/*.test.js', '**/__tests__/**/*.test.jsx'];
```

Jest **excludes**:

-   `node_modules/`
-   `vendor/`
-   `build/`
-   `e2e/` directory
-   Files ending with `.api.spec.js`

### Playwright Discovery

Playwright finds tests matching these patterns:

```javascript
testMatch: ['e2e/**/*.spec.js', 'src/API/__tests__/**/*.api.spec.js'];
```

This allows both E2E and API tests to use Playwright while keeping them separated.

## Configuration Files

### jest.config.js Template

Each plugin should have a `jest.config.js` at its root:

```javascript
export default {
	preset: '@wordpress/jest-preset-default',
	testEnvironment: 'jsdom',

	testMatch: ['**/__tests__/**/*.test.js', '**/__tests__/**/*.test.jsx'],

	testPathIgnorePatterns: [
		'/node_modules/',
		'/vendor/',
		'/build/',
		'/svn/',
		'/e2e/',
		'/.api.spec.js$',
	],

	collectCoverageFrom: [
		'src/**/*.{js,jsx}',
		'!src/**/index.js',
		'!src/**/__tests__/**',
		'!**/node_modules/**',
		'!**/build/**',
	],

	coverageDirectory: 'coverage',
	coverageReporters: ['text', 'lcov', 'html'],

	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},
};
```

### playwright.config.js Template

Each plugin should have a `playwright.config.js` at its root:

```javascript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
	testDir: './',
	testMatch: ['e2e/**/*.spec.js', 'src/API/__tests__/**/*.api.spec.js'],

	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'line',

	use: {
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8080',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		viewport: { width: 1200, height: 900 },
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	webServer: process.env.CI
		? undefined
		: {
				command: 'docker compose up',
				url: 'http://localhost:8080',
				reuseExistingServer: true,
				timeout: 120 * 1000,
		  },
});
```

### phpunit.xml

See [PHP Unit Tests (PHPUnit)](#php-unit-tests-phpunit) above for the
convention. Not every plugin needs one — add `phpunit.xml` +
`__tests__/bootstrap.php` only when there's boundary-level PHP logic worth
locking down.

## Running Tests

### Plugin-Level Commands

From within a plugin directory (e.g., `cd fair-events`):

```bash
# Run all tests
npm test

# Run specific test types
npm run test:js             # Jest (unit + component tests)
npm run test:e2e            # Playwright E2E tests only
npm run test:api            # Playwright API tests only

# Run Jest in watch mode
npm run test:js -- --watch

# Run specific test file
npm run test:js -- src/utils/__tests__/validation.test.js

# Run with coverage
npm run test:js -- --coverage

# Run Playwright with UI
npm run test:e2e -- --ui
```

### Monorepo-Level Commands

From the monorepo root:

```bash
# Run all tests across all plugins
npm test

# Run specific test type across all plugins
npm run test:js             # All Jest tests
npm run test:e2e            # All E2E tests
npm run test:api            # All API tests

# Run tests for specific plugin
npm run test --workspace=fair-events
npm run test:js --workspace=fair-payments-connector
```

### Required package.json Scripts

Each plugin should define these scripts:

```json
{
	"scripts": {
		"test": "npm-run-all test:*",
		"test:js": "jest",
		"test:e2e": "playwright test e2e/",
		"test:api": "playwright test src/API/__tests__/"
	}
}
```

## Notes and Best Practices

### Directory Naming

-   **Always use uppercase** `API/` for REST controllers (not `REST/` or `rest/`)
-   **Always use** `e2e/` for end-to-end tests (not `tests/` or `e2e-tests/`)
-   **Always use** `__tests__/` for co-located tests (double underscore)

### File Naming

-   Use `.test.js` and `.test.jsx` for Jest tests
-   Use `.api.spec.js` for Playwright API tests
-   Use `.spec.js` for Playwright E2E tests
-   This naming prevents test runner conflicts

### Test Organization

-   Keep tests close to the code they test
-   E2E tests are the exception - centralize in `e2e/`
-   API tests go with controllers in `src/API/__tests__/`
-   Shared test helpers can go in `__tests__/helpers/` directories

### WordPress Testing

-   Use Playwright for API testing (not PHPUnit)
-   Docker WordPress instance at `localhost:8080`
-   Set `WP_BASE_URL` environment variable for CI
-   Use `WP_ADMIN_USER` and `WP_ADMIN_PASS` for authentication

### Coverage

-   Collect coverage from `src/**/*.{js,jsx}`
-   Exclude `__tests__`, `build/`, `node_modules/`, `vendor/`
-   Target 70%+ coverage for new code
-   Use coverage reports to identify untested code

### CI/CD

-   Run tests in GitHub Actions
-   Use `npm run test:js` for fast unit/component tests
-   Use `npm run test:e2e` and `npm run test:api` for integration tests
-   Consider running E2E/API tests only on main branch or PRs

## Isolated E2E Harness (`@wordpress/env`)

E2E specs in the repo-root `e2e/` directory run against a clean, throwaway
WordPress instance provisioned by [`@wordpress/env`](https://www.npmjs.com/package/@wordpress/env)
— **not** the dev `docker compose` stack. The two never collide:

| Stack                | Tool                | Port     |
| -------------------- | ------------------- | -------- |
| Dev environment      | `docker compose up` | 8080     |
| E2E `tests` instance | `@wordpress/env`    | **8889** |

wp-env auto-installs WordPress, creates an `admin` / `password` user, and mounts +
activates the four plugins listed in `.wp-env.json`. The root
`playwright.config.js` is E2E-only (`testDir: ./e2e`); per-plugin API tests keep
their own configs.

### Running E2E locally

A clean clone needs only `docker` + `node`:

```bash
npm run test:e2e:setup      # build assets, install composer deps, boot wp-env, set permalinks
npm run test:e2e            # run the Playwright specs against :8889
npm run test:e2e:teardown   # stop wp-env
```

The dev stack on 8080 can keep running the whole time. `npm test` runs only unit
tests — E2E is opt-in via the scripts above.

Interactive / headed runs for development (the opposite of the default
headless run):

```bash
npm run test:e2e:headed     # run with a visible browser window
npm run test:e2e:ui         # Playwright UI mode: pick, watch, and step through tests
```

Useful extras:

```bash
npm run test:e2e -- --debug         # Playwright Inspector (step debugger)
npx wp-env run tests-cli wp ...     # WP-CLI against the tests instance
WP_BASE_URL=http://localhost:8889 npm run test:e2e   # override base URL
```

### Adding a new E2E test

1. Drop a `*.spec.js` file under `e2e/` (subdirectories like `e2e/user-flows/`
   are fine — `testMatch` is recursive).
2. Import from `@playwright/test`; use relative paths (`page.goto('/wp-admin')`) —
   `baseURL` is already set.
3. For admin flows, log in via `/wp-login.php` with `WP_ADMIN_USER` /
   `WP_ADMIN_PASSWORD` (default `admin` / `password`). See `e2e/smoke.spec.js`.

### Capturing email & intercepting external services

Specs that need to assert on outgoing mail, or drive flows that hit external
services (e.g. Mollie payments), rely on a test-only support layer mounted into
wp-env from `e2e/mu-plugins/` (mail is captured via `pre_wp_mail`; Mollie's HTTP
transport is replaced by a double, with no change to plugin code). See
[`e2e/README.md`](./e2e/README.md) for how it works and how to reuse it.

### CI

`.github/workflows/e2e.yml` runs on PRs touching plugin source, `e2e/`,
`playwright.config.js`, or `.wp-env.json`. It boots the same wp-env env, installs
the Chromium browser, runs the suite, and uploads the HTML report + traces as
artifacts on failure.

## Questions?

For questions or suggestions about the testing architecture:

-   Review this document and `CLAUDE.md`
-   Check existing test files in `fair-events` or `fair-audience` for examples
-   Propose changes via pull request
