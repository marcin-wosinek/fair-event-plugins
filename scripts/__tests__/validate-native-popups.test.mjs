import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	SCANNED_PLUGINS,
	findNativePopups,
	validateNativePopups,
} from '../validate-native-popups.mjs';

function names(source) {
	return findNativePopups(source).map(({ name }) => name);
}

function withRepo(files, callback) {
	const root = mkdtempSync(path.join(tmpdir(), 'native-popups-'));
	try {
		for (const plugin of SCANNED_PLUGINS) {
			mkdirSync(path.join(root, plugin, 'src'), { recursive: true });
		}
		for (const [relative, contents] of Object.entries(files)) {
			const full = path.join(root, relative);
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(full, contents);
		}
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test('rejects bare global confirm, alert and prompt', () => {
	assert.deepEqual(
		names(`
			if ( confirm( 'Delete?' ) ) {}
			alert( 'Saved' );
			const name = prompt( 'Name?' );
		`),
		['confirm', 'alert', 'prompt']
	);
});

test('rejects calls through window, globalThis and self', () => {
	assert.deepEqual(
		names(`
			window.confirm( 'a' );
			globalThis.alert( 'b' );
			self.prompt( 'c' );
		`),
		['confirm', 'alert', 'prompt']
	);
});

test('rejects static computed properties and optional calls', () => {
	assert.deepEqual(
		names(`
			window[ 'confirm' ]( 'a' );
			window[ \`alert\` ]( 'b' );
			window?.prompt?.( 'c' );
			confirm?.( 'd' );
		`),
		['confirm', 'alert', 'prompt', 'confirm']
	);
});

test('rejects references that are not direct calls', () => {
	assert.deepEqual(
		names(`
			const ask = window.confirm;
			const { alert } = window;
			const { prompt: question } = globalThis;
			onClick( confirm );
		`),
		['confirm', 'alert', 'prompt', 'confirm']
	);
});

test('rejects native popups inside JSX handlers', () => {
	assert.deepEqual(
		names(
			`const B = () => <button onClick={ () => alert( 'x' ) }>x</button>;`
		),
		['alert']
	);
});

test('reports the line and column of each call', () => {
	assert.deepEqual(findNativePopups('foo();\n  window.alert( 1 );'), [
		{ line: 2, column: 3, name: 'alert' },
	]);
});

test('ignores comments, strings and object keys', () => {
	assert.deepEqual(
		names(`
			// Never call confirm( 'x' ) here.
			/* window.alert( 'y' ) */
			const s = "alert('xss')";
			const t = \`<img onerror="alert(1)">\`;
			const actions = { confirm: true, alert() {}, prompt: 1 };
			class Dialog { confirm() {} }
		`),
		[]
	);
});

test('ignores methods on other objects', () => {
	assert.deepEqual(
		names(`
			dialog.confirm();
			notices.alert( 'x' );
			window.dialog.confirm();
			this.prompt();
			window[ name ]( 'dynamic' );
		`),
		[]
	);
});

test('ignores locally bound functions with the same names', () => {
	assert.deepEqual(
		names(`
			import { confirm } from './dialogs';
			function alert( message ) { return message; }
			const run = ( prompt ) => prompt( 'x' );
			confirm( 'local' );
			alert( 'local' );
		`),
		[]
	);
});

test('ignores a shadowed window object', () => {
	assert.deepEqual(
		names(`
			function render( window ) { window.confirm( 'x' ); }
		`),
		[]
	);
});

test('allows beforeunload navigation protection', () => {
	assert.deepEqual(
		names(`
			window.addEventListener( 'beforeunload', ( event ) => {
				if ( isDirty ) {
					event.preventDefault();
					event.returnValue = '';
				}
			} );
			window.onbeforeunload = () => true;
		`),
		[]
	);
});

test('still rejects a native popup inside a beforeunload handler', () => {
	assert.deepEqual(
		names(`
			window.addEventListener( 'beforeunload', () => {
				confirm( 'Leave?' );
			} );
		`),
		['confirm']
	);
});

test('throws on unparseable source', () => {
	assert.throws(() => findNativePopups('const = ;'), SyntaxError);
});

test('scans each core plugin and reports file locations', () => {
	const files = Object.fromEntries(
		SCANNED_PLUGINS.map((plugin) => [
			`${plugin}/src/Admin/page.js`,
			`\nwindow.confirm( 'x' );\n`,
		])
	);
	withRepo(files, (root) => {
		assert.deepEqual(
			validateNativePopups(root).map((error) => error.split(': ')[0]),
			SCANNED_PLUGINS.map((plugin) => `${plugin}/src/Admin/page.js:2:1`)
		);
	});
});

test('scans .jsx, .mjs and .cjs files', () => {
	withRepo(
		{
			'fair-form/src/a.jsx': 'alert( 1 );',
			'fair-form/src/b.mjs': 'alert( 1 );',
			'fair-form/src/c.cjs': 'alert( 1 );',
		},
		(root) => assert.equal(validateNativePopups(root).length, 3)
	);
});

test('skips tests, build output and other plugins', () => {
	withRepo(
		{
			'fair-events/src/__tests__/page.test.js': 'alert( 1 );',
			'fair-events/src/page.test.jsx': 'alert( 1 );',
			'fair-events/src/page.spec.js': 'alert( 1 );',
			'fair-events/src/build/index.js': 'alert( 1 );',
			'fair-events/build/index.js': 'alert( 1 );',
			'fair-events/e2e/flow.spec.js': 'alert( 1 );',
			'fair-finance/src/page.js': 'alert( 1 );',
			'fair-events/src/Page.php': '<?php $this->confirm();',
			'scripts/tool.mjs': 'confirm( 1 );',
		},
		(root) => assert.deepEqual(validateNativePopups(root), [])
	);
});

test('fails on a parse error with the file location', () => {
	withRepo({ 'fair-audience/src/broken.js': 'const = ;' }, (root) => {
		const [error] = validateNativePopups(root);
		assert.match(error, /^fair-audience\/src\/broken\.js: parse error: /);
	});
});

test('fails when a scanned plugin source directory is missing', () => {
	withRepo({}, (root) => {
		rmSync(path.join(root, 'fair-form', 'src'), { recursive: true });
		assert.deepEqual(validateNativePopups(root), [
			'fair-form/src: directory not found',
		]);
	});
});
