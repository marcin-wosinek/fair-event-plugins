#!/usr/bin/env node

/**
 * Stamp Build Version
 *
 * Replaces the Version: header and readme Stable tag of every plugin
 * workspace (discovered from the root package.json, see
 * scripts/plugin-workspaces.mjs) with the output of
 * `git describe --tags --match="<plugin-name>@*"` (prefix stripped), e.g.
 * "1.0.0-2-g8f0bec2". A plugin with no release tag keeps its package.json
 * version. Run during CI build, after `npm run build`. Also rewrites the
 * version recorded in each plugin's generated block-docs/index.json, so the
 * shipped documentation names the stamped release version.
 *
 * Exits non-zero when discovery fails or a header can't be found or written.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { discoverPlugins } from './plugin-workspaces.mjs';
import { stampBuildVersions } from './version-stamp.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('🏷️  Stamping build versions...\n');

try {
	const errors = stampBuildVersions({
		rootDir,
		plugins: discoverPlugins(rootDir),
	});
	if (errors.length) {
		console.error('❌ Stamping failed:');
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
		process.exit(1);
	}
} catch (error) {
	console.error(`❌ ${error.message}`);
	process.exit(1);
}

console.log('🎉 Stamp complete!');
