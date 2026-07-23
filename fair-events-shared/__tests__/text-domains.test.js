import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { config } from '../../scripts/translation/config.js';

const sharedSrcDir = join(__dirname, '..', 'src');

function listJsFiles(dir) {
	let files = [];
	for (const entry of readdirSync(dir)) {
		if (entry === '__tests__') {
			continue;
		}
		const fullPath = join(dir, entry);
		if (statSync(fullPath).isDirectory()) {
			files = files.concat(listJsFiles(fullPath));
		} else if (entry.endsWith('.js')) {
			files.push(fullPath);
		}
	}
	return files;
}

// Matches `__( 'string', 'domain' )` when the domain is a string literal.
// Calls whose domain is a variable (e.g. `this.textDomain`) are
// runtime-dynamic, can't be statically extracted by `wp i18n make-pot`, and
// are intentionally skipped here the same way the extractor skips them.
const TRANSLATION_CALL =
	/\b__\(\s*(['"`])(?:\\.|(?!\1).)*\1\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2\s*\)/g;

describe('fair-events-shared text domains', () => {
	test('every literal text domain used in shared source belongs to a known plugin', () => {
		const allowedDomains = new Set(
			config.plugins.map((plugin) => plugin.textDomain)
		);
		const foundDomains = new Map();

		for (const file of listJsFiles(sharedSrcDir)) {
			const contents = readFileSync(file, 'utf8');
			for (const match of contents.matchAll(TRANSLATION_CALL)) {
				const domain = match[3];
				if (!foundDomains.has(domain)) {
					foundDomains.set(domain, file);
				}
			}
		}

		const unknownDomains = [...foundDomains.entries()].filter(
			([domain]) => !allowedDomains.has(domain)
		);

		expect(unknownDomains).toEqual([]);
	});
});
