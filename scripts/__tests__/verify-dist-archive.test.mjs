import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'verify-dist-archive.cjs'
);

const PLUGINS = [
	'fair-events-experimental',
	'fair-payments-connector-experimental',
];

/**
 * Files a clean experimental plugin ZIP ships: the entry point, the Composer
 * autoloader (both plugins have a composer.json), runtime source, built
 * assets, translations, and documentation — including production
 * dependencies whose own packages contain test-named files.
 */
function runtimeFiles(plugin) {
	return [
		`${plugin}.php`,
		'readme.txt',
		'CHANGELOG.md',
		'docs/weekly-summary.md',
		'vendor/autoload.php',
		'vendor/composer/autoload_real.php',
		'vendor/fair-events/shared/tests/SharedTest.php',
		'vendor/fair-events/shared/phpunit.xml',
		'src/API/SourcesController.php',
		'src/Admin/settings/index.js',
		'build/admin/settings/index.js',
		'build/admin/settings/index.asset.php',
		`languages/${plugin}-pl_PL.mo`,
	];
}

const DEV_ARTIFACTS = {
	'root test suite': '__tests__/bootstrap.php',
	'nested JS test suite': 'src/Admin/settings/__tests__/index.test.jsx',
	'tests directory': 'tests/Unit/ExampleTest.php',
	'nested e2e directory': 'src/e2e/flow.spec.js',
	'PHPUnit configuration': 'phpunit.xml',
	'PHPUnit dist configuration': 'phpunit.xml.dist',
	'PHPUnit result cache': '.phpunit.result.cache',
	'PHPUnit cache directory': '.phpunit.cache/test-results',
	'test results': 'test-results/.last-run.json',
	'Playwright report': 'playwright-report/index.html',
};

function makeZip(plugin, files) {
	const dir = mkdtempSync(join(tmpdir(), 'verify-dist-archive-'));
	for (const file of files) {
		const full = join(dir, plugin, file);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, '');
	}
	const zipPath = join(dir, `${plugin}.1.0.0.zip`);
	execFileSync('zip', ['-qr', zipPath, plugin], { cwd: dir });
	return { dir, zipPath };
}

function verify(plugin, files) {
	const { dir, zipPath } = makeZip(plugin, files);
	try {
		const result = spawnSync(process.execPath, [SCRIPT, plugin, zipPath], {
			encoding: 'utf8',
		});
		return { ...result, zipPath };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

for (const plugin of PLUGINS) {
	test(`${plugin}: accepts a clean archive with runtime files`, () => {
		const result = verify(plugin, runtimeFiles(plugin));

		assert.equal(result.status, 0, result.stderr);
		assert.match(
			result.stdout,
			new RegExp(`${plugin}: .* contains no development test artifacts`)
		);
	});

	for (const [category, artifact] of Object.entries(DEV_ARTIFACTS)) {
		test(`${plugin}: rejects ${category}`, () => {
			const result = verify(plugin, [...runtimeFiles(plugin), artifact]);

			assert.equal(result.status, 1);
			assert.ok(
				result.stderr.includes(
					`${plugin}: ${result.zipPath} contains development artifact ${plugin}/${artifact}`
				),
				result.stderr
			);
		});
	}
}

test('does not apply the development-artifact rule to other plugins', () => {
	const result = verify('fair-platform', [
		'fair-platform.php',
		'vendor/autoload.php',
		'__tests__/bootstrap.php',
		'phpunit.xml',
	]);

	assert.equal(result.status, 0, result.stderr);
	assert.doesNotMatch(result.stdout, /development test artifacts/);
});
