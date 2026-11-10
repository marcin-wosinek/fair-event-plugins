import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	compareVersions,
	findProblems,
	isShippedSharedFile,
} from '../validate-shared-version.mjs';

test('compares dotted versions numerically', () => {
	assert.ok(compareVersions('0.2.18', '0.2.9') > 0);
	assert.ok(compareVersions('0.2.9', '0.2.18') < 0);
	assert.equal(compareVersions('0.3', '0.3.0'), 0);
});

test('shipped shared files include the bootstrap but not the lock or vendor', () => {
	assert.ok(isShippedSharedFile('fair-events-shared/php/bootstrap.php'));
	assert.ok(isShippedSharedFile('fair-events-shared/php/src/Money.php'));
	assert.ok(isShippedSharedFile('fair-events-shared/php/composer.json'));
	assert.ok(!isShippedSharedFile('fair-events-shared/php/composer.lock'));
	assert.ok(
		!isShippedSharedFile('fair-events-shared/php/vendor/autoload.php')
	);
	assert.ok(!isShippedSharedFile('fair-events-shared/src/index.js'));
});

test('a shipped change without a version bump fails', () => {
	const problems = findProblems({
		changed: ['fair-events-shared/php/bootstrap.php'],
		baseVersion: '0.2.18',
		version: '0.2.18',
		locks: {},
	});
	assert.equal(problems.length, 1);
	assert.match(problems[0], /bootstrap\.php/);
});

test('a bumped change with matching locks passes', () => {
	assert.deepEqual(
		findProblems({
			changed: [
				'fair-events-shared/php/src/Money.php',
				'fair-events-shared/php/composer.json',
			],
			baseVersion: '0.2.17',
			version: '0.2.18',
			locks: { 'fair-events': '0.2.18', 'fair-audience': '0.2.18' },
		}),
		[]
	);
});

test('a stale or missing consumer lock fails without any shared change', () => {
	const problems = findProblems({
		changed: [],
		baseVersion: '0.2.18',
		version: '0.2.18',
		locks: { 'fair-events': '0.2.17', 'fair-form': null },
	});
	assert.equal(problems.length, 2);
	assert.match(problems[0], /fair-events\/composer\.lock .*0\.2\.17/);
	assert.match(problems[1], /fair-form\/composer\.lock .*\(missing\)/);
});

test('lock-only changes need no bump', () => {
	assert.deepEqual(
		findProblems({
			changed: ['fair-events-shared/php/composer.lock'],
			baseVersion: '0.2.18',
			version: '0.2.18',
			locks: {},
		}),
		[]
	);
});
