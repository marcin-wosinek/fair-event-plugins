import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	checkFile,
	findJsDomains,
	findPhpDomains,
	validateTextDomains,
} from '../validate-text-domains.mjs';

function domains(found) {
	return found.map(({ name, domain, reason }) => [name, domain ?? reason]);
}

function withRepo(files, callback) {
	const root = mkdtempSync(path.join(tmpdir(), 'text-domains-'));
	try {
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

test('reads the domain position of each JS i18n function', () => {
	assert.deepEqual(
		domains(
			findJsDomains(`
				import { __, _x, _n, _nx, sprintf } from '@wordpress/i18n';
				__( 'Save', 'fair-finance' );
				_x( 'Post', 'verb', 'fair-finance' );
				_n( '%d entry', '%d entries', count, 'fair-payments-connector' );
				_nx( '%d entry', '%d entries', count, 'noun', 'fair-finance' );
				sprintf( __( 'Hi %s', \`fair-finance\` ), name );
			`)
		),
		[
			['__', 'fair-finance'],
			['_x', 'fair-finance'],
			['_n', 'fair-payments-connector'],
			['_nx', 'fair-finance'],
			['__', 'fair-finance'],
		]
	);
});

test('reports missing and non-literal JS domains', () => {
	assert.deepEqual(
		domains(
			findJsDomains(`
				import { __, _x } from '@wordpress/i18n';
				__( 'Save' );
				_x( 'Post', 'verb' );
				__( 'Save', domain );
			`)
		),
		[
			['__', 'missing'],
			['_x', 'missing'],
			['__', 'non-literal'],
		]
	);
});

test('follows wp.i18n access and ignores unrelated helpers', () => {
	assert.deepEqual(
		domains(
			findJsDomains(`
				const { __ } = wp.i18n;
				__( 'A', 'fair-finance' );
				wp.i18n._x( 'B', 'ctx', 'fair-events' );
				function list( _n ) { return _n( 1, 2, 3 ); }
				import { __ as translate } from './local';
				const _x = ( a ) => a;
				_x( 'not i18n' );
				lodash.__( 'x' );
			`)
		),
		[
			['__', 'fair-finance'],
			['_x', 'fair-events'],
		]
	);
});

test('reads the domain position of each PHP gettext function', () => {
	assert.deepEqual(
		domains(
			findPhpDomains(`<?php
				__( 'Save', 'fair-finance' );
				_e( "Save", "fair-finance" );
				esc_html__( 'It\\'s', 'fair-finance' );
				esc_attr_x( 'Post', 'verb', 'fair-audience' );
				_n( '%d entry', '%d entries', $count, 'fair-finance' );
				_nx( '%d entry', '%d entries', $count, 'noun', 'fair-finance' );
				_n_noop( '%d entry', '%d entries', 'fair-finance' );
				\\__( sprintf( 'a %s', implode( ',', array( 1, 2 ) ) ), 'fair-finance', );
			`)
		),
		[
			['__', 'fair-finance'],
			['_e', 'fair-finance'],
			['esc_html__', 'fair-finance'],
			['esc_attr_x', 'fair-audience'],
			['_n', 'fair-finance'],
			['_nx', 'fair-finance'],
			['_n_noop', 'fair-finance'],
			['__', 'fair-finance'],
		]
	);
});

test('checks PHP translation registrations', () => {
	assert.deepEqual(
		domains(
			findPhpDomains(`<?php
				wp_set_script_translations( 'fair-finance-' . $page, 'fair-finance', Features::script_translations_path() );
				wp_set_script_translations( 'handle', 'fair-audience' );
				load_plugin_textdomain( 'fair-payments-connector', false, 'x/languages' );
				wp_set_script_translations( 'handle' );
			`)
		),
		[
			['wp_set_script_translations', 'fair-finance'],
			['wp_set_script_translations', 'fair-audience'],
			['load_plugin_textdomain', 'fair-payments-connector'],
			['wp_set_script_translations', 'missing'],
		]
	);
});

test('ignores PHP comments, strings, inline HTML and method calls', () => {
	assert.deepEqual(
		domains(
			findPhpDomains(`<?php
				// __( 'comment', 'fair-events' );
				/* _e( 'block', 'fair-events' ); */
				# _x( 'hash', 'c', 'fair-events' );
				$s = "__( 'string', 'fair-events' )";
				$this->__( 'method', 'fair-events' );
				Foo::__( 'static', 'fair-events' );
				function __( $text, $domain ) {}
				?>
				<p>Don't __( 'html', 'fair-events' )</p>
				<?php __( 'Real', "fair-{$plugin}" );
			`)
		),
		[['__', 'non-literal']]
	);
});

test('checks block metadata textdomain', () => {
	assert.deepEqual(
		checkFile(
			JSON.stringify({
				name: 'fair-audience/form',
				textdomain: 'fair-audience',
			}),
			'fair-form/src/blocks/form/block.json',
			'fair-form'
		),
		[
			"fair-form/src/blocks/form/block.json: block textdomain is 'fair-audience'; expected 'fair-form'",
		]
	);
	assert.deepEqual(
		checkFile(
			JSON.stringify({ name: 'fair-audience/form' }),
			'block.json',
			'fair-form'
		),
		["block.json: block textdomain is missing; expected 'fair-form'"]
	);
	assert.deepEqual(
		checkFile(
			JSON.stringify({
				name: 'fair-audience/form',
				textdomain: 'fair-form',
			}),
			'block.json',
			'fair-form'
		),
		[]
	);
});

test('scans an enforced plugin and reports file and line', () => {
	withRepo(
		{
			'fair-finance/fair-finance.php':
				"<?php\n/**\n * Plugin Name: Fair Finance\n * Text Domain: fair-finance\n */\n__( 'Ok', 'fair-finance' );\n",
			'fair-finance/src/Admin/App.js':
				"import { __ } from '@wordpress/i18n';\n__( 'Ok', 'fair-finance' );\n__( 'Budgets', 'fair-payments-connector' );\n",
			'fair-finance/src/Admin/Page.php':
				"<?php\n\n_e( 'Entries', 'fair-payments-connector' );\n",
			'fair-finance/src/Admin/__tests__/App.test.js':
				"__( 'Fixture', 'fair-events' );\n",
			'fair-finance/src/Admin/App.test.js':
				"__( 'Fixture', 'fair-events' );\n",
			'fair-finance/build/index.js': "__( 'Built', 'fair-events' );\n",
			'fair-finance/src/blocks/x/block.json':
				'{"textdomain":"fair-finance"}',
			'fair-events/src/Other.js':
				"__( 'Not enforced', 'fair-audience' );\n",
		},
		(root) => {
			assert.deepEqual(
				validateTextDomains(root, { 'fair-finance': 'fair-finance' }),
				[
					"fair-finance/src/Admin/App.js:3: __() uses text domain 'fair-payments-connector'; expected 'fair-finance'",
					"fair-finance/src/Admin/Page.php:3: _e() uses text domain 'fair-payments-connector'; expected 'fair-finance'",
				]
			);
		}
	);
});

test('checks the main plugin file header', () => {
	withRepo(
		{
			'fair-form/fair-form.php':
				'<?php\n/**\n * Plugin Name: Fair Form\n * Text Domain: fair-audience\n */\n',
			'fair-form/src/.keep': '',
		},
		(root) => {
			assert.deepEqual(
				validateTextDomains(root, { 'fair-form': 'fair-form' }),
				[
					"fair-form/fair-form.php: plugin header Text Domain is 'fair-audience'; expected 'fair-form'",
				]
			);
		}
	);
});

test('reports a missing source directory and parse errors', () => {
	withRepo(
		{
			'fair-finance/src/Broken.js': 'const = ;',
		},
		(root) => {
			const errors = validateTextDomains(root, {
				'fair-finance': 'fair-finance',
				'fair-form': 'fair-form',
			});
			assert.equal(errors.length, 2);
			assert.match(
				errors[0],
				/^fair-finance\/src\/Broken\.js: parse error:/
			);
			assert.equal(errors[1], 'fair-form/src: directory not found');
		}
	);
});

test('the repository passes for every enforced plugin', () => {
	const root = path.resolve(import.meta.dirname, '..', '..');
	assert.deepEqual(validateTextDomains(root), []);
});
