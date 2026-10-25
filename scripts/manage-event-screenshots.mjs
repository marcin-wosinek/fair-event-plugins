#!/usr/bin/env node
/* eslint-disable no-console */

// Generate the Manage Event screenshot set (#2043): run the dedicated spec
// on the isolated local test site, then index the run and publish it as
// `latest` only when every manifest tab was captured. See
// docs/manage-event-screenshots.md.

import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	createProcessExecutor,
	loadWorkspaces,
	resolveTestsPort,
	runTests,
} from './api-test-runner.mjs';
import {
	LOCALE,
	MANAGE_EVENT_TABS,
	SCENARIO,
	VIEWPORT,
	screenshotFilename,
} from '../e2e/screenshots/manage-event-tabs.js';

export const SPEC = 'e2e/screenshots/manage-event.spec.js';
export const OUTPUT_DIR = 'e2e/screenshots/output/manage-event';

const LOCAL_HOSTS = new Set( [ 'localhost', '127.0.0.1', '[::1]' ] );

export function parseArguments( args ) {
	const options = { reuse: false, forwarded: [] };
	for ( const argument of args ) {
		if ( argument === '--reuse' ) {
			options.reuse = true;
		} else if ( argument !== '--' ) {
			options.forwarded.push( argument );
		}
	}
	return options;
}

/**
 * Refuse any target other than a site on this machine, so the run can never
 * seed or capture a production site.
 *
 * @param {string} url Base URL of the site to capture.
 * @return {string} The URL, when it is local.
 */
export function assertLocalTarget( url ) {
	let host;
	try {
		host = new URL( url ).host.replace( /:\d+$/, '' );
	} catch {
		throw new Error( `Invalid screenshot target URL: ${ url }` );
	}
	if ( ! LOCAL_HOSTS.has( host ) ) {
		throw new Error(
			`Refusing to capture ${ url }: Manage Event screenshots run only against the local test site.`
		);
	}
	return url;
}

function readJson( file ) {
	try {
		return JSON.parse( readFileSync( file, 'utf8' ) );
	} catch {
		return undefined;
	}
}

/**
 * Build the index for a run from the records the spec wrote.
 *
 * A tab without a passing record, or whose image is missing or empty, makes
 * the run incomplete; each such tab is listed in `failures`.
 *
 * @param {object} params
 * @param {string} params.runDirectory Run directory.
 * @param {object} params.revision     { commit, dirty }.
 * @param {Array}  [params.tabs]       Manifest entries.
 * @return {object} Index.
 */
export function buildIndex( {
	runDirectory,
	revision,
	tabs = MANAGE_EVENT_TABS,
} ) {
	const context = readJson( path.join( runDirectory, 'context.json' ) ) || {};
	const coverage = readJson(
		path.join( runDirectory, 'results', '_coverage.json' )
	);
	const failures = [];

	const setup = readJson(
		path.join( runDirectory, 'results', '_setup.json' )
	);
	if ( ! coverage ) {
		failures.push( {
			tab: null,
			scenario: SCENARIO,
			reason: setup?.error
				? `Setup failed: ${ setup.error }`
				: 'Tab coverage was not checked (setup failed before capture).',
		} );
	} else if ( ! coverage.ok ) {
		for ( const [ kind, names ] of [
			[ 'missing from Manage Event', coverage.missing ],
			[ 'disabled', coverage.disabled ],
			[ 'not in the manifest', coverage.unexpected ],
		] ) {
			for ( const name of names || [] ) {
				failures.push( {
					tab: name,
					scenario: SCENARIO,
					reason: `Tab ${ kind }.`,
				} );
			}
		}
	}

	const images = tabs.map( ( tab ) => {
		const file = screenshotFilename( tab );
		const record = readJson(
			path.join( runDirectory, 'results', `${ tab.name }.json` )
		);
		const imagePath = path.join( runDirectory, file );
		let reason;
		if ( ! record ) {
			reason = 'Not captured.';
		} else if ( record.status !== 'passed' ) {
			reason = record.error || 'Capture failed.';
		} else if (
			! existsSync( imagePath ) ||
			statSync( imagePath ).size === 0
		) {
			reason = 'Screenshot file is missing or empty.';
		}
		if ( reason ) {
			failures.push( { tab: tab.name, scenario: SCENARIO, reason } );
		}
		return {
			tab: tab.name,
			title: tab.title,
			plugin: tab.plugin,
			prerequisites: tab.prerequisites,
			scenario: SCENARIO,
			locale: LOCALE,
			viewport: VIEWPORT,
			fullPage: true,
			file: reason ? null : file,
			status: reason ? 'failed' : 'passed',
			capturedAt: record?.capturedAt ?? null,
		};
	} );

	return {
		status: failures.length ? 'failed' : 'complete',
		generatedAt: new Date().toISOString(),
		revision,
		scenario: SCENARIO,
		locale: LOCALE,
		viewport: VIEWPORT,
		wordpress: context.wordpress ?? null,
		plugins: context.plugins ?? [],
		features: context.features ?? {},
		protections: context.protections ?? {},
		images,
		failures,
	};
}

function escapeHtml( value ) {
	return String( value ?? '' )
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

/**
 * Render the contact sheet: every image with its capture context.
 *
 * @param {object} index Index from buildIndex().
 * @return {string} HTML document.
 */
export function renderContactSheet( index ) {
	const revision = `${ index.revision?.commit ?? 'unknown' }${
		index.revision?.dirty ? ' (uncommitted changes)' : ''
	}`;
	const plugins = index.plugins
		.map(
			( plugin ) =>
				`${ escapeHtml( plugin.name ) } ${ escapeHtml( plugin.version ) }`
		)
		.join( ', ' );
	const cards = index.images
		.map(
			( image ) => `<figure>
<figcaption><strong>${ escapeHtml( image.title ) }</strong> <code>${ escapeHtml(
				image.tab
			) }</code> · ${ escapeHtml( image.plugin ) }</figcaption>
${
	image.file
		? `<a href="${ escapeHtml( image.file ) }"><img src="${ escapeHtml(
				image.file
			) }" alt="${ escapeHtml( image.title ) } tab" loading="lazy"></a>`
		: '<p class="missing">Not captured</p>'
}
</figure>`
		)
		.join( '\n' );

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manage Event screenshots</title>
<style>
body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; color: #1e1e1e; background: #f6f7f7; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
dt { font-weight: 600; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; }
figure { margin: 0; background: #fff; border: 1px solid #dcdcde; padding: 12px; }
img { width: 100%; height: auto; border: 1px solid #f0f0f1; }
.missing { color: #b32d2e; }
</style>
</head>
<body>
<h1>Manage Event screenshots</h1>
<dl>
<dt>Status</dt><dd>${ escapeHtml( index.status ) }</dd>
<dt>Scenario</dt><dd>${ escapeHtml( index.scenario ) }</dd>
<dt>Locale</dt><dd>${ escapeHtml( index.locale ) }</dd>
<dt>Viewport</dt><dd>${ escapeHtml( index.viewport.name ) } ${ escapeHtml(
		index.viewport.width
	) } × ${ escapeHtml( index.viewport.height ) }, full page</dd>
<dt>Revision</dt><dd>${ escapeHtml( revision ) }</dd>
<dt>WordPress</dt><dd>${ escapeHtml( index.wordpress ) }</dd>
<dt>Plugins</dt><dd>${ plugins }</dd>
<dt>Generated</dt><dd>${ escapeHtml( index.generatedAt ) }</dd>
</dl>
<div class="grid">
${ cards }
</div>
</body>
</html>
`;
}

function gitRevision( rootDirectory ) {
	try {
		const commit = execFileSync(
			'git',
			[ 'rev-parse', '--short', 'HEAD' ],
			{
				cwd: rootDirectory,
				encoding: 'utf8',
			}
		).trim();
		const dirty =
			execFileSync( 'git', [ 'status', '--porcelain' ], {
				cwd: rootDirectory,
				encoding: 'utf8',
			} ).trim() !== '';
		return { commit, dirty };
	} catch {
		return { commit: null, dirty: null };
	}
}

/**
 * Run the capture and publish a complete set as `latest`.
 *
 * @param {object}   params
 * @param {string}   params.rootDirectory Repository root.
 * @param {string}   params.baseUrl       Site to capture.
 * @param {Function} params.runSpec       ( runDirectory ) => Promise<exit code>.
 * @param {object}   [params.revision]    { commit, dirty }.
 * @param {Function} [params.logger]
 * @param {string}   [params.runId]
 * @return {Promise<number>} Exit status.
 */
export async function runManageEventScreenshots( {
	rootDirectory,
	baseUrl,
	runSpec,
	revision = gitRevision( rootDirectory ),
	logger = console.log,
	runId = new Date().toISOString().replace( /[:.]/g, '-' ),
} ) {
	try {
		assertLocalTarget( baseUrl );
	} catch ( error ) {
		logger( error.message );
		return 2;
	}

	const outputDirectory = path.join( rootDirectory, OUTPUT_DIR );
	const runsDirectory = path.join( outputDirectory, 'runs' );
	// Earlier runs are removed so a new run can never pick up their images.
	rmSync( runsDirectory, { recursive: true, force: true } );
	const runDirectory = path.join( runsDirectory, runId );
	mkdirSync( runDirectory, { recursive: true } );

	const specStatus = await runSpec( runDirectory );
	const index = buildIndex( { runDirectory, revision } );
	if ( specStatus !== 0 && ! index.failures.length ) {
		index.status = 'failed';
		index.failures.push( {
			tab: null,
			scenario: SCENARIO,
			reason: `The screenshot run exited with status ${ specStatus }.`,
		} );
	}
	writeFileSync(
		path.join( runDirectory, 'index.json' ),
		`${ JSON.stringify( index, null, '\t' ) }\n`
	);
	writeFileSync(
		path.join( runDirectory, 'index.html' ),
		renderContactSheet( index )
	);

	if ( index.status !== 'complete' ) {
		logger( '\nManage Event screenshots failed:' );
		for ( const failure of index.failures ) {
			logger(
				`  - ${ failure.tab ? `tab "${ failure.tab }"` : `scenario "${ failure.scenario }"` }: ${ failure.reason }`
			);
		}
		logger(
			`Partial output for debugging: ${ path.relative( rootDirectory, runDirectory ) }`
		);
		logger( 'The previous complete set (if any) was left untouched.' );
		return specStatus || 1;
	}

	const latest = path.join( outputDirectory, 'latest' );
	rmSync( latest, { recursive: true, force: true } );
	cpSync( runDirectory, latest, {
		recursive: true,
		filter: ( source ) => ! source.includes( `${ path.sep }results` ),
	} );
	logger(
		`\nCaptured ${ index.images.length } Manage Event tabs: ${ path.relative(
			rootDirectory,
			path.join( latest, 'index.html' )
		) }`
	);
	return 0;
}

async function main() {
	const options = parseArguments( process.argv.slice( 2 ) );
	const rootDirectory = fileURLToPath(
		new URL( '..', import.meta.url )
	).replace( /\/$/, '' );
	const testsPort = await resolveTestsPort( rootDirectory );
	const baseUrl =
		process.env.WP_BASE_URL || `http://localhost:${ testsPort }`;
	const workspaceConfig = await loadWorkspaces( rootDirectory );

	process.exitCode = await runManageEventScreenshots( {
		rootDirectory,
		baseUrl,
		runSpec: ( runDirectory ) =>
			runTests( {
				options: {
					reuse: options.reuse,
					suite: 'e2e',
					workspace: undefined,
					forwarded: [
						SPEC,
						'--retries=0',
						'--reporter=line',
						...options.forwarded,
					],
				},
				executor: createProcessExecutor( {
					cwd: rootDirectory,
					env: {
						...process.env,
						CI: '1',
						WP_BASE_URL: baseUrl,
						WP_ADMIN_USER: 'admin',
						WP_ADMIN_PASS: 'password',
						WP_ADMIN_PASSWORD: 'password',
						FAIR_MANAGE_EVENT_SCREENSHOTS_DIR: runDirectory,
					},
				} ),
				workspaceConfig,
			} ),
	} );
}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {
	await main();
}
