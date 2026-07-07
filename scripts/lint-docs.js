#!/usr/bin/env node

/**
 * Lint the root guideline docs (*.md) so they don't rot:
 *
 * 1. Relative markdown links must point at files that exist.
 * 2. Names of plugins that were removed from the monorepo must not appear —
 *    a hit means a doc still teaches a pattern against dead code.
 *
 * Run: npm run lint:docs
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Plugins/workflows that no longer exist. Docs must reference live code only.
const BANNED_REFERENCES = [
	'fair-rsvp',
	'fair-membership',
	'fair-registration',
	'fair-user-import',
	'fair-schedule-blocks',
	'fair-calendar-button',
	'fair-team',
	'php-ci.yml',
	'deploy-acroyoga.yml',
];

// Historical records are allowed to mention old names.
const SKIP_FILES = new Set(['CHANGELOG.md']);

const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)\)/g;

const docFiles = readdirSync(rootDir).filter(
	(name) => name.endsWith('.md') && !SKIP_FILES.has(name)
);

const errors = [];

for (const fileName of docFiles) {
	const filePath = join(rootDir, fileName);
	const lines = readFileSync(filePath, 'utf8').split('\n');

	lines.forEach((line, index) => {
		const lineNumber = index + 1;

		for (const banned of BANNED_REFERENCES) {
			if (line.includes(banned)) {
				errors.push(
					`${fileName}:${lineNumber} references removed plugin/workflow "${banned}"`
				);
			}
		}

		for (const match of line.matchAll(LINK_PATTERN)) {
			const target = match[1];
			if (/^(https?:|mailto:|#)/.test(target)) {
				continue;
			}
			const targetPath = join(rootDir, target.split('#')[0]);
			if (!existsSync(targetPath)) {
				errors.push(
					`${fileName}:${lineNumber} broken link to "${target}"`
				);
			}
		}
	});
}

if (errors.length > 0) {
	console.error(`docs lint failed (${errors.length} problem(s)):\n`);
	for (const error of errors) {
		console.error(`  ${error}`);
	}
	process.exit(1);
}

console.log(`docs lint passed (${docFiles.length} files checked)`);
