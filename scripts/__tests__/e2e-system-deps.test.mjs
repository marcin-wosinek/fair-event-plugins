import assert from 'node:assert/strict';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	aptVersionSpec,
	cacheKey,
	classifyArchive,
	environmentIdentity,
	finishReport,
	install,
	parseAptCacheShow,
	parseAptOutput,
	parseOsRelease,
	parseSize,
	preparationState,
	renderSummary,
	sha256,
} from '../e2e-system-deps.mjs';

const IDENTITY = {
	osId: 'ubuntu',
	osVersion: '26.04',
	arch: 'amd64',
	imageOs: 'ubuntu26',
	imageVersion: '20261026.1',
	playwrightVersion: '1.64.1',
	scriptHash: 'abcdef0123456789',
};

const FRESH_OUTPUT = `Installing dependencies...
Get:3 http://azure.archive.ubuntu.com/ubuntu resolute-updates InRelease [137 kB]
Fetched 3675 kB in 0s (13.6 MB/s)
Reading package lists...
The following NEW packages will be installed:
  fonts-freefont-ttf xfonts-utils
4 upgraded, 9 newly installed, 0 to remove and 182 not upgraded.
Need to get 24.9 MB of archives.
After this operation, 80.2 MB of additional disk space will be used.
Get:1 file:/etc/apt/apt-mirrors.txt Mirrorlist [144 B]
Get:2 http://azure.archive.ubuntu.com/ubuntu resolute/universe amd64v3 fonts-ipafont-gothic all 00303-23ubuntu1 [3703 kB]
Get:7 http://azure.archive.ubuntu.com/ubuntu resolute-updates/main amd64v3 libnss3 amd64 2:3.120-1ubuntu2.2 [1518 kB]
Fetched 24.9 MB in 9min 29s (43.9 kB/s)
Selecting previously unselected package fonts-ipafont-gothic.
`;

test('cacheKey changes with every environment input', () => {
	const base = cacheKey(IDENTITY);
	assert.equal(base, cacheKey({ ...IDENTITY }));
	assert.match(
		base,
		/^e2e-apt-v1-ubuntu26\.04-amd64-ubuntu26-20261026\.1-pw1\.64\.1-chromium-abcdef012345$/
	);
	for (const [field, value] of [
		['osId', 'debian'],
		['osVersion', '24.04'],
		['arch', 'arm64'],
		['imageOs', 'ubuntu24'],
		['imageVersion', '20261102.3'],
		['playwrightVersion', '1.65.0'],
		['scriptHash', '1111110123456789'],
	]) {
		assert.notEqual(cacheKey({ ...IDENTITY, [field]: value }), base, field);
	}
	assert.notEqual(cacheKey({ ...IDENTITY, schema: 'v2' }), base);
});

test('cacheKey keeps only safe characters and marks missing parts', () => {
	const key = cacheKey({ ...IDENTITY, imageVersion: 'a b/c', osId: '' });
	assert.match(key, /^[a-z0-9.-]+$/);
	assert.match(key, /-unknown26\.04-/);
	assert.match(key, /-ubuntu26-a-b-c-/);
});

test('environmentIdentity reads the release, architecture, image and versions', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'deps-root-'));
	mkdirSync(path.join(root, 'node_modules', 'playwright-core'), {
		recursive: true,
	});
	writeFileSync(
		path.join(root, 'node_modules', 'playwright-core', 'package.json'),
		JSON.stringify({ version: '1.64.1' })
	);
	const identity = environmentIdentity({
		env: { ImageOS: 'ubuntu26', ImageVersion: '20261026.1' },
		exec: () => ({ status: 0, stdout: 'amd64\n', stderr: '' }),
		root,
		readOsRelease: () =>
			'ID=ubuntu\nVERSION_ID="26.04"\nVERSION_CODENAME=resolute\n',
		scriptSource: () => Buffer.from('script'),
	});
	assert.deepEqual(identity, {
		osId: 'ubuntu',
		osVersion: '26.04',
		osCodename: 'resolute',
		arch: 'amd64',
		imageOs: 'ubuntu26',
		imageVersion: '20261026.1',
		playwrightVersion: '1.64.1',
		scriptHash: sha256(Buffer.from('script')),
	});
	rmSync(root, { recursive: true, force: true });
});

test('parseOsRelease strips quotes', () => {
	assert.deepEqual(parseOsRelease('ID=ubuntu\nVERSION_ID="26.04"\n# c\n'), {
		ID: 'ubuntu',
		VERSION_ID: '26.04',
	});
});

test('parseSize converts APT sizes', () => {
	assert.equal(parseSize('0 B'), 0);
	assert.equal(parseSize('917 kB'), 917000);
	assert.equal(parseSize('24.9 MB'), 24900000);
	assert.equal(parseSize('1,024 kB'), 1024000);
	assert.equal(parseSize('nonsense'), null);
});

test('parseAptOutput reads a cold download', () => {
	const apt = parseAptOutput(FRESH_OUTPUT);
	assert.equal(apt.needToGet, 'Need to get 24.9 MB of archives.');
	assert.equal(apt.downloadBytes, 24900000);
	assert.equal(apt.totalArchiveBytes, 24900000);
	assert.equal(apt.fetched, 'Fetched 24.9 MB in 9min 29s (43.9 kB/s)');
	assert.equal(apt.upgraded, 4);
	assert.equal(apt.newlyInstalled, 9);
	assert.deepEqual(apt.downloads, [
		{
			host: 'azure.archive.ubuntu.com',
			package: 'fonts-ipafont-gothic',
			size: '3703 kB',
		},
		{
			host: 'azure.archive.ubuntu.com',
			package: 'libnss3',
			size: '1518 kB',
		},
	]);
	assert.deepEqual(apt.problems, []);
});

test('parseAptOutput reads full reuse, partial reuse and problems', () => {
	const reuse = parseAptOutput(
		'0 upgraded, 13 newly installed, 0 to remove and 1 not upgraded.\nNeed to get 0 B/24.9 MB of archives.\n'
	);
	assert.equal(reuse.downloadBytes, 0);
	assert.equal(reuse.totalArchiveBytes, 24900000);
	assert.deepEqual(reuse.downloads, []);

	const partial = parseAptOutput(
		'Need to get 917 kB/90.1 MB of archives.\nIgn:4 http://azure.archive.ubuntu.com/ubuntu resolute/main amd64 xvfb amd64 2:21 [905 kB]\nErr:4 http://azure.archive.ubuntu.com/ubuntu resolute/main amd64 xvfb amd64 2:21\n  Connection timed out\nGet:4 http://azure.archive.ubuntu.com/ubuntu resolute/main amd64 xvfb amd64 2:21 [905 kB]\nW: Some index files failed to download.\n'
	);
	assert.equal(partial.downloadBytes, 917000);
	assert.equal(partial.downloads.length, 1);
	assert.equal(partial.problems.length, 3);

	const nothing = parseAptOutput(
		'0 upgraded, 0 newly installed, 0 to remove and 1 not upgraded.\n'
	);
	assert.equal(nothing.needToGet, null);
	assert.equal(nothing.newlyInstalled, 0);
});

test('parseAptCacheShow splits records', () => {
	const records = parseAptCacheShow(
		'Package: a\nVersion: 1\nArchitecture: all\nSHA256: aa\n\nPackage: b\nVersion: 2\nArchitecture: amd64\nSHA256: bb\n'
	);
	assert.deepEqual(
		records.map((record) => [record.Package, record.SHA256]),
		[
			['a', 'aa'],
			['b', 'bb'],
		]
	);
});

test('aptVersionSpec omits :all for arch-independent packages', () => {
	assert.equal(
		aptVersionSpec({ package: 'fonts', version: '1:2', arch: 'all' }),
		'fonts=1:2'
	);
	assert.equal(
		aptVersionSpec({ package: 'libnss3', version: '2:3', arch: 'amd64' }),
		'libnss3:amd64=2:3'
	);
});

test('classifyArchive keeps only an exact, checksum-matching index version', () => {
	const fields = { package: 'xvfb', version: '2:21.1', arch: 'amd64' };
	const record = {
		Package: 'xvfb',
		Version: '2:21.1',
		Architecture: 'amd64',
		SHA256: 'good',
	};
	assert.deepEqual(
		classifyArchive({ fields, hash: 'good', records: [record] }),
		{
			keep: true,
			reason: 'verified',
		}
	);
	assert.equal(
		classifyArchive({ fields, hash: 'bad', records: [record] }).reason,
		'checksum-mismatch'
	);
	assert.equal(
		classifyArchive({
			fields: { ...fields, version: '2:21.0' },
			hash: 'good',
			records: [record],
		}).reason,
		'not-in-index'
	);
	assert.equal(
		classifyArchive({
			fields: { ...fields, arch: 'arm64' },
			hash: 'good',
			records: [record],
		}).reason,
		'not-in-index'
	);
	assert.equal(
		classifyArchive({ fields: null, hash: 'good', records: [record] })
			.reason,
		'unreadable'
	);
});

/**
 * A fake system: `.deb` files hold JSON fields (anything else is unreadable),
 * the index lists `index` versions with the SHA256 of their real content, and
 * `installDeps` "downloads" whatever the system archive directory lacks.
 */
function fakeSystem({ index, needed, installStatuses = [] }) {
	const dir = mkdtempSync(path.join(tmpdir(), 'deps-'));
	const cache = path.join(dir, 'cache');
	const system = path.join(dir, 'system');
	const reports = path.join(dir, 'report');
	mkdirSync(cache);
	mkdirSync(system);
	const content = (pkg) => `${JSON.stringify(pkg)}\n`;
	const fileName = (pkg) =>
		`${pkg.package}_${pkg.version.replace(':', '%3a')}_${pkg.arch}.deb`;
	const calls = [];
	let updateStatus = 0;
	const exec = (command, args) => {
		calls.push([command, ...args]);
		if (command === 'dpkg-deb') {
			try {
				const fields = JSON.parse(readFileSync(args.at(-1), 'utf8'));
				return {
					status: 0,
					stdout: `${fields.package}\t${fields.version}\t${fields.arch}`,
					stderr: '',
				};
			} catch {
				return {
					status: 2,
					stdout: '',
					stderr: 'not a debian archive',
				};
			}
		}
		if (command === 'apt-get') {
			return {
				status: updateStatus,
				stdout: '',
				stderr: 'E: fetch failed',
			};
		}
		if (command === 'apt-cache') {
			const specs = args.slice(1);
			const found = index.filter((pkg) =>
				specs.includes(aptVersionSpec(pkg))
			);
			return {
				status: found.length === specs.length ? 0 : 100,
				stdout: found
					.map(
						(pkg) =>
							`Package: ${pkg.package}\nArchitecture: ${pkg.arch}\nVersion: ${pkg.version}\nSHA256: ${sha256(Buffer.from(content(pkg)))}\n`
					)
					.join('\n'),
				stderr: '',
			};
		}
		if (command === 'cp') {
			const files = args.slice(1, -1);
			for (const file of files) {
				copyFileSync(file, path.join(system, path.basename(file)));
			}
			return { status: 0, stdout: '', stderr: '' };
		}
		if (command === 'rm') {
			for (const file of args.slice(2)) {
				rmSync(file, { force: true });
			}
			return { status: 0, stdout: '', stderr: '' };
		}
		throw new Error(`unexpected command ${command}`);
	};
	const installDeps = () => {
		const status = installStatuses.length > 0 ? installStatuses.shift() : 0;
		const present = new Set(readdirSync(system));
		const missing = needed.filter((pkg) => !present.has(fileName(pkg)));
		if (status === 0) {
			for (const pkg of missing) {
				writeFileSync(path.join(system, fileName(pkg)), content(pkg));
			}
		}
		const bytes = missing.length * 1000;
		const total = needed.length * 1000;
		const need =
			bytes === total
				? `Need to get ${total / 1000} kB of archives.`
				: `Need to get ${bytes === 0 ? '0 B' : `${bytes / 1000} kB`}/${total / 1000} kB of archives.`;
		return {
			status,
			stdout: [
				need,
				...missing.map(
					(pkg, i) =>
						`Get:${i + 1} http://azure.archive.ubuntu.com/ubuntu resolute/main amd64 ${pkg.package} ${pkg.arch} ${pkg.version} [1000 B]`
				),
			].join('\n'),
			stderr: '',
		};
	};
	const run = (env = {}) =>
		install({
			env: {
				E2E_DEPS_CACHE_DIR: cache,
				E2E_DEPS_REPORT_DIR: reports,
				...env,
			},
			exec,
			now: (() => {
				let t = 1000;
				return () => (t += 10);
			})(),
			log: () => {},
			isRoot: true,
			systemArchives: system,
			identity: IDENTITY,
			installDeps,
		});
	return {
		dir,
		cache,
		system,
		calls,
		run,
		content,
		fileName,
		failIndexRefresh: () => {
			updateStatus = 100;
		},
		seed: (pkg, body = content(pkg)) =>
			writeFileSync(path.join(cache, fileName(pkg)), body),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

const FONT = {
	package: 'fonts-ipafont-gothic',
	version: '00303-23',
	arch: 'all',
};
const NSS = { package: 'libnss3', version: '2:3.120-1', arch: 'amd64' };

test('a cold run downloads everything and keeps that set for saving', () => {
	const sys = fakeSystem({ index: [FONT, NSS], needed: [FONT, NSS] });
	const report = sys.run();
	assert.equal(report.status, 0);
	assert.equal(preparationState(report), 'fresh');
	assert.equal(report.restored.length, 0);
	assert.equal(report.attempts[0].apt.downloads.length, 2);
	assert.deepEqual(readdirSync(sys.cache).sort(), [
		sys.fileName(FONT),
		sys.fileName(NSS),
	]);
	assert.deepEqual(
		report.saved.map((entry) => [entry.package, entry.source]),
		[
			['fonts-ipafont-gothic', 'downloaded'],
			['libnss3', 'downloaded'],
		]
	);
	// Nothing restored, so no extra index refresh before installing.
	assert.ok(!sys.calls.some(([command]) => command === 'apt-get'));
	sys.cleanup();
});

test('a warm run verifies and reuses every archive', () => {
	const sys = fakeSystem({ index: [FONT, NSS], needed: [FONT, NSS] });
	sys.seed(FONT);
	sys.seed(NSS);
	const report = sys.run({ E2E_DEPS_CACHE_HIT: 'true' });
	assert.equal(report.status, 0);
	assert.equal(preparationState(report), 'reuse');
	assert.equal(report.restored.length, 2);
	assert.equal(report.attempts[0].apt.downloadBytes, 0);
	assert.deepEqual(report.attempts[0].apt.downloads, []);
	assert.ok(existsSync(path.join(sys.system, sys.fileName(NSS))));
	// The index is refreshed before verification; one batched lookup.
	assert.deepEqual(
		sys.calls.find(([command]) => command === 'apt-get'),
		['apt-get', 'update', '-qq']
	);
	assert.equal(
		sys.calls.filter(([command]) => command === 'apt-cache').length,
		1
	);
	assert.ok(report.saved.every((entry) => entry.source === 'restored'));
	sys.cleanup();
});

test('corrupt and unreadable archives are dropped and downloaded again', () => {
	const sys = fakeSystem({ index: [FONT, NSS], needed: [FONT, NSS] });
	sys.seed(FONT);
	sys.seed(NSS, `${JSON.stringify({ ...NSS, tampered: true })}\n`);
	writeFileSync(path.join(sys.cache, 'junk_1_amd64.deb'), 'junk');
	const report = sys.run({ E2E_DEPS_CACHE_HIT: 'true' });
	assert.equal(report.status, 0);
	assert.deepEqual(
		report.dropped.map((entry) => [entry.file, entry.reason]).sort(),
		[
			['junk_1_amd64.deb', 'unreadable'],
			[sys.fileName(NSS), 'checksum-mismatch'],
		]
	);
	assert.equal(preparationState(report), 'partial-reuse');
	assert.deepEqual(
		report.attempts[0].apt.downloads.map((entry) => entry.package),
		['libnss3']
	);
	assert.equal(
		readFileSync(path.join(sys.cache, sys.fileName(NSS)), 'utf8'),
		sys.content(NSS)
	);
	assert.ok(!existsSync(path.join(sys.cache, 'junk_1_amd64.deb')));
	sys.cleanup();
});

test('superseded versions are dropped and pruned from the cache', () => {
	const newer = { ...NSS, version: '2:3.120-2' };
	const sys = fakeSystem({ index: [FONT, newer], needed: [FONT, newer] });
	sys.seed(FONT);
	sys.seed(NSS);
	const report = sys.run({ E2E_DEPS_CACHE_HIT: 'true' });
	assert.equal(report.status, 0);
	assert.deepEqual(
		report.dropped.map((entry) => entry.reason),
		['not-in-index']
	);
	assert.deepEqual(readdirSync(sys.cache).sort(), [
		sys.fileName(FONT),
		sys.fileName(newer),
	]);
	sys.cleanup();
});

test('an unavailable index drops every restored archive and installs normally', () => {
	const sys = fakeSystem({ index: [FONT], needed: [FONT] });
	sys.seed(FONT);
	sys.failIndexRefresh();
	const report = sys.run({ E2E_DEPS_CACHE_HIT: 'true' });
	assert.equal(report.status, 0);
	assert.deepEqual(
		report.dropped.map((entry) => entry.reason),
		['index-unavailable']
	);
	assert.equal(report.recovery[0].event, 'index-refresh-failed');
	assert.equal(preparationState(report), 'recovered');
	sys.cleanup();
});

test('a failed install with reused archives retries once without them', () => {
	const sys = fakeSystem({
		index: [FONT, NSS],
		needed: [FONT, NSS],
		installStatuses: [100, 0],
	});
	sys.seed(FONT);
	sys.seed(NSS);
	const report = sys.run({ E2E_DEPS_CACHE_HIT: 'true' });
	assert.equal(report.status, 0);
	assert.deepEqual(
		report.attempts.map((attempt) => [attempt.mode, attempt.status]),
		[
			['normal', 100],
			['without-cache', 0],
		]
	);
	assert.equal(report.recovery[0].event, 'install-retry-without-cache');
	assert.equal(preparationState(report), 'recovered');
	assert.equal(report.attempts[1].apt.downloads.length, 2);
	assert.ok(report.saved.every((entry) => entry.source === 'downloaded'));
	sys.cleanup();
});

test('a persistent failure stays a failure after one retry', () => {
	const sys = fakeSystem({
		index: [FONT],
		needed: [FONT],
		installStatuses: [100, 100, 0],
	});
	sys.seed(FONT);
	const report = sys.run({ E2E_DEPS_CACHE_HIT: 'true' });
	assert.equal(report.status, 100);
	assert.equal(report.attempts.length, 2);
	assert.deepEqual(report.saved, []);
	sys.cleanup();
});

test('a failure without reused archives is not retried', () => {
	const sys = fakeSystem({
		index: [FONT],
		needed: [FONT],
		installStatuses: [100, 0],
	});
	const report = sys.run();
	assert.equal(report.status, 100);
	assert.equal(report.attempts.length, 1);
	assert.deepEqual(readdirSync(sys.cache), []);
	sys.cleanup();
});

test('finishReport adds save and total timing and the summary lists them', () => {
	const sys = fakeSystem({ index: [FONT], needed: [FONT] });
	const report = sys.run({ E2E_DEPS_STARTED_AT: '500' });
	const finished = finishReport(report, {
		now: report.finishedAt + 250,
		saveOutcome: 'success',
	});
	assert.equal(finished.durations.restoreMs, 1010 - 500);
	assert.equal(finished.durations.saveMs, 250);
	assert.equal(finished.durations.totalMs, report.finishedAt + 250 - 500);
	assert.equal(finished.state, 'fresh');
	const summary = renderSummary(finished);
	assert.match(summary, /### E2E system dependencies/);
	assert.match(summary, /\| State \| `fresh` \|/);
	assert.match(summary, /\| Save step \| success \|/);
	assert.match(summary, /Need to get 1 kB of archives\./);
	assert.match(summary, /\| fonts-ipafont-gothic \| 00303-23 \| all \|/);
	sys.cleanup();
});
