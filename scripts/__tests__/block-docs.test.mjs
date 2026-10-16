import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	checkSources,
	findDocumentedPlugins,
	generate,
	parsePluginVersion,
	refreshVersion,
	validateExample,
	verifyArchiveDocs,
} from '../block-docs.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const GUIDE = `## Purpose

A demo block used by the block-docs tests. It renders a greeting and has a
single attribute controlling the text, which is enough to exercise the
generated reference, the guide checks, and the example validation.
`;

function write(root, path, content) {
	const full = join(root, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(
		full,
		typeof content === 'string'
			? content
			: `${JSON.stringify(content, null, '\t')}\n`
	);
}

/**
 * Build a throwaway repository with one plugin ("demo") that supplies a
 * parent block and a child block, both documented.
 */
function makeRepo() {
	const root = mkdtempSync(join(tmpdir(), 'block-docs-'));
	write(root, 'package.json', { workspaces: ['demo', 'no-blocks'] });
	write(root, 'no-blocks/package.json', { name: 'no-blocks' });
	write(
		root,
		'demo/demo.php',
		'<?php\n/**\n * Plugin Name: Demo\n * Version: 1.2.3\n */\n'
	);
	write(root, 'demo/src/blocks/parent/block.json', {
		name: 'demo/parent',
		title: 'Parent',
		category: 'widgets',
		attributes: {
			greeting: { type: 'string', default: 'Hello' },
			mode: { type: 'string', enum: ['a', 'b'], default: 'a' },
		},
	});
	write(root, 'demo/src/blocks/parent/docs/doc.json', {
		status: 'authoring',
		registration: { condition: 'always' },
		examples: {
			minimal: {
				title: 'Minimal',
				context: 'page',
				frontend: '.wp-block-demo-parent',
			},
		},
	});
	write(root, 'demo/src/blocks/parent/docs/guide.md', GUIDE);
	write(
		root,
		'demo/src/blocks/parent/docs/examples/minimal.html',
		'<!-- wp:demo/parent {"greeting":"Hi"} /-->\n'
	);
	write(root, 'demo/src/blocks/child/block.json', {
		name: 'demo/child',
		title: 'Child',
		parent: ['demo/parent'],
	});
	write(root, 'demo/src/blocks/child/docs/doc.json', {
		status: 'authoring',
		registration: { condition: 'always' },
		examples: {
			minimal: {
				title: 'Inside the parent',
				context: 'page',
				frontend: '.wp-block-demo-child',
			},
		},
	});
	write(root, 'demo/src/blocks/child/docs/guide.md', GUIDE);
	write(
		root,
		'demo/src/blocks/child/docs/examples/minimal.html',
		'<!-- wp:demo/parent -->\n<!-- wp:demo/child /-->\n<!-- /wp:demo/parent -->\n'
	);
	return root;
}

function listFiles(dir) {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? listFiles(full) : [full];
	});
}

function snapshot(dir) {
	return Object.fromEntries(
		listFiles(dir).map((file) => [
			relative(dir, file),
			readFileSync(file, 'utf8'),
		])
	);
}

/** An in-memory archive of the generated plugin, as wp dist-archive packs it. */
function archiveOf(root, plugin) {
	const files = {};
	for (const file of listFiles(join(root, plugin))) {
		files[`${plugin}/${relative(join(root, plugin), file)}`] =
			readFileSync(file, 'utf8');
	}
	// The build copies block.json files into build/blocks/.
	for (const path of Object.keys(files)) {
		const match = path.match(/^demo\/src\/blocks\/([^/]+)\/block\.json$/);
		if (match) {
			files[`demo/build/blocks/${match[1]}/block.json`] = files[path];
		}
	}
	return files;
}

function verify(files) {
	return verifyArchiveDocs({
		pluginName: 'demo',
		entries: Object.keys(files),
		readEntry: (path) => files[path],
	});
}

test('the repository documents every block it supplies', () => {
	assert.deepEqual(checkSources(repoRoot), []);
	assert.deepEqual(findDocumentedPlugins(repoRoot).sort(), [
		'fair-audience',
		'fair-calendar-button',
		'fair-events',
		'fair-form',
		'fair-payments-connector',
		'fair-timetable',
	]);
});

test('discovers only workspaces with blocks', () => {
	const root = makeRepo();
	try {
		assert.deepEqual(findDocumentedPlugins(root), ['demo']);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('reports a block.json without documentation', () => {
	const root = makeRepo();
	try {
		write(root, 'demo/src/blocks/orphan/block.json', {
			name: 'demo/orphan',
			title: 'Orphan',
		});
		const errors = checkSources(root, ['demo']);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /orphan: block\.json has no documentation/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('reports a missing guide, minimal example, and example descriptor', () => {
	const root = makeRepo();
	try {
		rmSync(join(root, 'demo/src/blocks/parent/docs/guide.md'));
		rmSync(join(root, 'demo/src/blocks/parent/docs/examples/minimal.html'));
		write(
			root,
			'demo/src/blocks/parent/docs/examples/extra.html',
			'<!-- wp:demo/parent /-->\n'
		);
		const errors = checkSources(root, ['demo']).join('\n');
		assert.match(errors, /missing docs\/guide\.md/);
		assert.match(errors, /missing docs\/examples\/minimal\.html/);
		assert.match(errors, /examples\/extra\.html is not described/);
		assert.match(errors, /describes example "minimal" but .* is missing/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('reports a legacy block without a documented replacement', () => {
	const root = makeRepo();
	try {
		const docPath = 'demo/src/blocks/parent/docs/doc.json';
		const doc = JSON.parse(readFileSync(join(root, docPath), 'utf8'));
		write(root, docPath, { ...doc, status: 'legacy' });
		assert.match(
			checkSources(root, ['demo']).join('\n'),
			/legacy block needs a "replacement"/
		);
		write(root, docPath, {
			...doc,
			status: 'legacy',
			replacement: 'demo/missing',
		});
		assert.match(
			checkSources(root, ['demo']).join('\n'),
			/replacement "demo\/missing" is not a documented block/
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('validates examples against the block metadata', () => {
	const inventory = new Map([
		[
			'demo/parent',
			{
				name: 'demo/parent',
				attributes: {
					greeting: { type: 'string' },
					mode: { type: 'string', enum: ['a', 'b'] },
				},
			},
		],
		['demo/child', { name: 'demo/child', parent: ['demo/parent'] }],
		['demo/deep', { name: 'demo/deep', ancestor: ['demo/parent'] }],
	]);
	const entry = (name) => ({ kind: 'block', name, doc: {} });
	const check = (markup, name = 'demo/parent') =>
		validateExample(markup, entry(name), inventory, 'example').join('\n');

	assert.equal(check('<!-- wp:demo/parent {"greeting":"Hi"} /-->'), '');
	assert.match(
		check('<!-- wp:demo/parent {"stale":1} /-->'),
		/has no attribute "stale"/
	);
	assert.match(
		check('<!-- wp:demo/parent {"greeting":3} /-->'),
		/"greeting" must be of type string/
	);
	assert.match(
		check('<!-- wp:demo/parent {"mode":"c"} /-->'),
		/"mode" must be one of a, b/
	);
	assert.match(
		check('<!-- wp:demo/child /-->', 'demo/child'),
		/must be a direct child of demo\/parent/
	);
	assert.match(
		check(
			'<!-- wp:core/group -->\n<div class="wp-block-group"><!-- wp:demo/deep /--></div>\n<!-- /wp:core/group -->',
			'demo/deep'
		),
		/must be nested inside demo\/parent/
	);
	assert.equal(
		check(
			'<!-- wp:demo/parent -->\n<!-- wp:core/group -->\n<div class="wp-block-group"><!-- wp:demo/deep /--></div>\n<!-- /wp:core/group -->\n<!-- /wp:demo/parent -->',
			'demo/deep'
		),
		''
	);
	assert.match(
		check('<!-- wp:demo/unknown /-->'),
		/unknown block "demo\/unknown"/
	);
	assert.match(
		check('<!-- wp:core/paragraph -->\n<p>x</p>\n<!-- /wp:core/paragraph -->'),
		/does not contain "demo\/parent"/
	);
	assert.match(
		check('<p>loose</p>\n<!-- wp:demo/parent /-->'),
		/content outside a block comment/
	);
	assert.equal(
		check('<!-- wp:demo/parent {"className":"x","anchor":"y"} /-->'),
		''
	);
});

test('generates an index, guides with a reference, and examples', () => {
	const root = makeRepo();
	try {
		const index = generate(root, 'demo');
		assert.equal(index.pluginVersion, '1.2.3');
		assert.deepEqual(
			index.blocks.map((block) => block.name),
			['demo/child', 'demo/parent']
		);
		const parent = index.blocks.find((block) => block.name === 'demo/parent');
		assert.equal(parent.ownerPlugin, 'demo');
		assert.equal(parent.metadata, 'build/blocks/parent/block.json');
		assert.equal(parent.guide, 'block-docs/demo/parent/README.md');
		assert.deepEqual(parent.examples, [
			{
				name: 'minimal',
				title: 'Minimal',
				context: 'page',
				path: 'block-docs/demo/parent/examples/minimal.html',
				frontendSelector: '.wp-block-demo-parent',
			},
		]);

		const readme = readFileSync(
			join(root, 'demo/block-docs/demo/parent/README.md'),
			'utf8'
		);
		assert.match(readme, /^# Parent \(`demo\/parent`\)/);
		assert.match(readme, /## Purpose/);
		assert.match(readme, /\| `greeting` \| string \| `"Hello"` \| — \|/);
		assert.match(readme, /\| `mode` \| string \| `"a"` \| `a`, `b` \|/);
		assert.match(readme, /<!-- wp:demo\/parent \{"greeting":"Hi"\} \/-->/);
		assert.match(
			readFileSync(join(root, 'demo/block-docs/README.md'), 'utf8'),
			/Shipped, registered, and available/
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('generation is deterministic and removes stale output', () => {
	const root = makeRepo();
	try {
		write(root, 'demo/block-docs/stale.txt', 'left over');
		generate(root, 'demo');
		const first = snapshot(join(root, 'demo/block-docs'));
		generate(root, 'demo');
		assert.deepEqual(snapshot(join(root, 'demo/block-docs')), first);
		assert.equal('stale.txt' in first, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('generation fails on invalid documentation', () => {
	const root = makeRepo();
	try {
		write(
			root,
			'demo/src/blocks/parent/docs/examples/minimal.html',
			'<!-- wp:demo/parent {"removed":true} /-->\n'
		);
		assert.throws(() => generate(root, 'demo'), /has no attribute "removed"/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('refreshes the recorded version after the header is stamped', () => {
	const root = makeRepo();
	try {
		assert.equal(refreshVersion(root, 'demo'), null);
		generate(root, 'demo');
		write(
			root,
			'demo/demo.php',
			'<?php\n/**\n * Plugin Name: Demo\n * Version: 1.2.3-4-gabc1234\n */\n'
		);
		assert.equal(refreshVersion(root, 'demo'), '1.2.3-4-gabc1234');
		assert.equal(
			JSON.parse(
				readFileSync(join(root, 'demo/block-docs/index.json'), 'utf8')
			).pluginVersion,
			'1.2.3-4-gabc1234'
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('parses plugin version headers', () => {
	assert.equal(parsePluginVersion(' * Version: 2.5.0\n'), '2.5.0');
	assert.equal(parsePluginVersion('Version:1.0.0-3-gdead'), '1.0.0-3-gdead');
	assert.equal(parsePluginVersion('Stable tag: 1.0'), null);
});

test('accepts an archive with complete, release-matched docs', () => {
	const root = makeRepo();
	try {
		generate(root, 'demo');
		assert.deepEqual(verify(archiveOf(root, 'demo')), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('rejects archives with missing or mismatched docs', () => {
	const root = makeRepo();
	try {
		generate(root, 'demo');
		const files = archiveOf(root, 'demo');

		const withoutIndex = { ...files };
		delete withoutIndex['demo/block-docs/index.json'];
		assert.match(verify(withoutIndex).join('\n'), /missing demo\/block-docs\/index\.json/);

		const withoutGuide = { ...files };
		delete withoutGuide['demo/block-docs/demo/parent/README.md'];
		assert.match(verify(withoutGuide).join('\n'), /demo\/parent guide .* is not in the archive/);

		const withoutExample = { ...files };
		delete withoutExample['demo/block-docs/demo/child/examples/minimal.html'];
		assert.match(verify(withoutExample).join('\n'), /demo\/child example .* is not in the archive/);

		const stamped = {
			...files,
			'demo/demo.php': files['demo/demo.php'].replace('1.2.3', '1.2.4'),
		};
		assert.match(
			verify(stamped).join('\n'),
			/records version 1\.2\.3, but the plugin ships 1\.2\.4/
		);

		const undocumented = {
			...files,
			'demo/build/blocks/extra/block.json': '{"name":"demo/extra"}',
		};
		assert.match(
			verify(undocumented).join('\n'),
			/build\/blocks\/extra\/block\.json ships without block documentation/
		);

		const renamed = {
			...files,
			'demo/build/blocks/parent/block.json': '{"name":"demo/renamed"}',
		};
		assert.match(
			verify(renamed).join('\n'),
			/declares "demo\/renamed", but .* maps it to "demo\/parent"/
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
