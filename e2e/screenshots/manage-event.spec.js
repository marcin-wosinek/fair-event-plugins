/**
 * Screenshots of every Manage Event tab for UX review (#2043).
 *
 * Run through `npm run screenshots:manage-event`, which owns the isolated
 * test site, sets FAIR_MANAGE_EVENT_SCREENSHOTS_DIR to a fresh run directory
 * and assembles the index and contact sheet from the records written here.
 * Without that variable the spec is skipped, so the regular E2E suite does
 * not produce screenshots.
 *
 * Before seeding, the external HTTP guard is switched on and the demo
 * fixture refuses to run unless mail is captured and Mollie is doubled. The
 * site and the administrator use English, and every feature a conditional
 * tab needs is switched on; all of it is put back afterwards.
 *
 * Each tab test writes `results/<tab>.json`. A tab counts as captured only
 * when it is selected, its demo data is visible, no REST request failed, no
 * spinner or error notice is left, fonts and images have loaded and the page
 * has stopped changing. See docs/manage-event-screenshots.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
	ADMIN_PASSWORD,
	ADMIN_USER,
	runScript,
	wpCli,
} from '../support/wp-cli.js';
import {
	LOCALE,
	MANAGE_EVENT_TABS,
	SCENARIO,
	VIEWPORT,
	checkTabCoverage,
	describeCoverage,
	screenshotFilename,
} from './manage-event-tabs.js';

const RUN_DIR = process.env.FAIR_MANAGE_EVENT_SCREENSHOTS_DIR;
const RESULTS_DIR = RUN_DIR && path.join( RUN_DIR, 'results' );

/** Feature options and the bundles the conditional tabs need. */
const FEATURE_OPTIONS = {
	fair_events_features: [ 'ticketing' ],
	fair_events_experimental_features: [ 'ticketing', 'mailings' ],
	fair_audience_experimental_features: [ 'groups', 'manage-event-ext' ],
};
const REQUIRED_PLUGINS = [
	'fair-events',
	'fair-events-experimental',
	'fair-audience',
	'fair-audience-experimental',
	'fair-finance',
	'fair-payments-connector',
];

/** Admin notices from the test site's own setup, not from Manage Event. */
const HIDE_SITE_NOTICES = `
	#wpbody-content > .notice,
	#wpbody-content > .error,
	#wpbody-content > .updated { display: none !important; }
`;

function writeRecord( name, record ) {
	fs.mkdirSync( RESULTS_DIR, { recursive: true } );
	fs.writeFileSync(
		path.join( RESULTS_DIR, `${ name }.json` ),
		`${ JSON.stringify( record, null, '\t' ) }\n`
	);
}

function readJsonOption( option ) {
	const out = wpCli( `option get ${ option } --format=json`, {
		allowFailure: true,
	} ).trim();
	try {
		const value = JSON.parse( out.split( '\n' ).pop() );
		return value && ! Array.isArray( value ) ? value : {};
	} catch {
		return {};
	}
}

function writeJsonOption( option, value ) {
	wpCli( `option delete ${ option }`, { allowFailure: true } );
	if ( Object.keys( value ).length > 0 ) {
		const json = JSON.stringify( value ).replace( /'/g, "'\\''" );
		wpCli( `option update ${ option } '${ json }' --format=json` );
	}
}

function readValue( args ) {
	return (
		wpCli( args, { allowFailure: true } ).trim().split( '\n' ).pop() || ''
	);
}

/**
 * Log in without waiting for the dashboard's own requests to settle. The
 * browser may only reach the test site: requests to any other host are
 * aborted, like the server-side external HTTP guard does.
 */
async function logIn( page ) {
	const siteHost = new URL(
		process.env.WP_BASE_URL || 'http://localhost:8889'
	).host;
	await page.route(
		( url ) => url.host !== siteHost,
		( route ) => route.abort( 'blockedbyclient' )
	);
	await page.goto( '/wp-login.php' );
	await page.fill( '#user_login', ADMIN_USER );
	await page.fill( '#user_pass', ADMIN_PASSWORD );
	await Promise.all( [
		page.waitForURL( /\/wp-admin\/?/, { waitUntil: 'commit' } ),
		page.click( '#wp-submit' ),
	] );
}

const manageEventUrl = ( eventDateId, tab ) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=${ tab }`;

/**
 * Wait until fonts and images have loaded and the page content has not
 * changed for half a second (charts finish animating, late requests render).
 */
async function waitForSettledPage( page ) {
	await page.evaluate( () => document.fonts.ready.then( () => null ) );
	// Lazy images below the fold load only once scrolled to, so they are
	// asked to load now; one that has not loaded after 10 s fails the tab.
	await page.evaluate( () =>
		document
			.querySelectorAll( 'img[loading="lazy"]' )
			.forEach( ( image ) => {
				image.loading = 'eager';
			} )
	);
	await expect
		.poll(
			() =>
				page.evaluate( () =>
					Array.from( document.images )
						.filter(
							( image ) =>
								! image.complete || image.naturalWidth === 0
						)
						.map( ( image ) => image.currentSrc || image.src )
				),
			{ message: 'images that did not load', timeout: 10000 }
		)
		.toEqual( [] );
	const fontsLoaded = await page.evaluate(
		() => document.fonts.status === 'loaded'
	);
	expect( fontsLoaded, 'web fonts finished loading' ).toBe( true );

	let previous = '';
	let stableSince = Date.now();
	const deadline = Date.now() + 15000;
	while ( Date.now() < deadline ) {
		const snapshot = await page.evaluate(
			() => document.querySelector( '#wpbody-content' )?.innerHTML || ''
		);
		if ( snapshot !== previous ) {
			previous = snapshot;
			stableSince = Date.now();
		} else if ( Date.now() - stableSince >= 500 ) {
			return;
		}
		await page.waitForTimeout( 100 );
	}
	throw new Error( 'The page kept changing for 15 seconds.' );
}

test.describe( 'Manage Event screenshots', () => {
	test.skip(
		! RUN_DIR,
		'Run through `npm run screenshots:manage-event` to generate screenshots.'
	);
	test.use( {
		viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
	} );

	let demo;
	const restore = {};

	test.beforeAll( () => {
		test.setTimeout( 180 * 1000 );
		try {
			const active = JSON.parse(
				readValue(
					'plugin list --status=active --field=name --format=json'
				)
			);
			const inactive = REQUIRED_PLUGINS.filter(
				( plugin ) => ! active.includes( plugin )
			);
			if ( inactive.length ) {
				throw new Error(
					`Required plugins are not active on the test site: ${ inactive.join(
						', '
					) }`
				);
			}

			restore.options = {};
			for ( const [ option, bundles ] of Object.entries(
				FEATURE_OPTIONS
			) ) {
				const original = readJsonOption( option );
				restore.options[ option ] = original;
				writeJsonOption( option, {
					...original,
					...Object.fromEntries(
						bundles.map( ( bundle ) => [ bundle, true ] )
					),
				} );
			}
			restore.siteLocale = readValue( 'option get WPLANG' );
			restore.userLocale = readValue(
				`user meta get ${ ADMIN_USER } locale`
			);
			wpCli( "option update WPLANG ''" );
			wpCli( `user meta update ${ ADMIN_USER } locale ''` );
			wpCli( 'option update fair_e2e_block_external_http 1' );
			// Avatars come from Gravatar, which the run must not contact.
			restore.showAvatars = readValue( 'option get show_avatars' );
			wpCli( 'option update show_avatars 0' );

			demo = runScript(
				'manage-event-demo.php',
				'E2E_MANAGE_EVENT_DEMO',
				'seed'
			);

			const plugins = JSON.parse(
				readValue(
					'plugin list --status=active --fields=name,version --format=json'
				)
			);
			fs.mkdirSync( RUN_DIR, { recursive: true } );
			fs.writeFileSync(
				path.join( RUN_DIR, 'context.json' ),
				`${ JSON.stringify(
					{
						scenario: SCENARIO,
						locale: LOCALE,
						viewport: VIEWPORT,
						wordpress: readValue( 'core version' ),
						plugins,
						features: Object.fromEntries(
							Object.keys( FEATURE_OPTIONS ).map( ( option ) => [
								option,
								readJsonOption( option ),
							] )
						),
						protections: demo.protections,
						demo: {
							title: demo.title,
							eventDateId: demo.eventDateId,
							paidTickets: demo.paidTickets,
						},
					},
					null,
					'\t'
				) }\n`
			);
		} catch ( error ) {
			writeRecord( '_setup', {
				status: 'failed',
				error: String( error.message || error ).split( '\n' )[ 0 ],
			} );
			throw error;
		}
	} );

	test.afterAll( () => {
		runScript(
			'manage-event-demo.php',
			'E2E_MANAGE_EVENT_DEMO',
			'cleanup'
		);
		if ( restore.showAvatars !== undefined ) {
			wpCli( `option update show_avatars '${ restore.showAvatars }'` );
		}
		wpCli( 'option delete fair_e2e_block_external_http', {
			allowFailure: true,
		} );
		for ( const [ option, value ] of Object.entries(
			restore.options || {}
		) ) {
			writeJsonOption( option, value );
		}
		if ( restore.siteLocale !== undefined ) {
			wpCli( `option update WPLANG '${ restore.siteLocale }'` );
			wpCli(
				`user meta update ${ ADMIN_USER } locale '${ restore.userLocale }'`
			);
		}
	} );

	test( 'Manage Event offers every tab in the manifest', async ( {
		page,
	} ) => {
		await logIn( page );
		await page.goto( manageEventUrl( demo.eventDateId, 'event-details' ) );
		await expect( page.getByRole( 'tab' ).first() ).toBeVisible();

		const offered = await page.getByRole( 'tab' ).evaluateAll( ( tabs ) =>
			tabs.map( ( tab ) => ( {
				name: tab.id.replace( /^tab-panel-\d+-/, '' ),
				title: tab.textContent.trim(),
				disabled:
					tab.disabled ||
					tab.getAttribute( 'aria-disabled' ) === 'true',
			} ) )
		);
		const coverage = checkTabCoverage( MANAGE_EVENT_TABS, offered );
		writeRecord( '_coverage', { ...coverage, offered } );
		expect( coverage.ok, describeCoverage( coverage ) ).toBe( true );
	} );

	for ( const tab of MANAGE_EVENT_TABS ) {
		test( `captures the ${ tab.title } tab`, async ( { page } ) => {
			const file = screenshotFilename( tab );
			const failedRequests = [];
			page.on( 'response', ( response ) => {
				if (
					response.status() >= 400 &&
					response.url().includes( '/wp-json/' )
				) {
					failedRequests.push(
						`${ response.status() } ${ response.url() }`
					);
				}
			} );
			page.on( 'requestfailed', ( request ) => {
				failedRequests.push(
					`${ request.failure()?.errorText } ${ request.url() }`
				);
			} );

			try {
				await logIn( page );
				await page.goto( manageEventUrl( demo.eventDateId, tab.name ) );
				await page.addStyleTag( { content: HIDE_SITE_NOTICES } );

				await expect(
					page.getByRole( 'tab', { name: tab.title, exact: true } )
				).toHaveAttribute( 'aria-selected', 'true' );
				const panel = page.getByRole( 'tabpanel' );
				for ( const locator of tab.ready( panel, demo ) ) {
					await expect( locator ).toBeVisible( { timeout: 20000 } );
				}
				await expect(
					page.locator( '.components-spinner' )
				).toHaveCount( 0 );
				await expect(
					panel.locator( '.components-notice.is-error' )
				).toHaveCount( 0 );
				await waitForSettledPage( page );
				// A full-page capture of a taller page resizes the charts and
				// restarts their animation, so the viewport takes the page's
				// height first and the page settles again at that size.
				const height = await page.evaluate(
					() => document.documentElement.scrollHeight
				);
				await page.setViewportSize( {
					width: VIEWPORT.width,
					height: Math.max( VIEWPORT.height, height ),
				} );
				await waitForSettledPage( page );
				expect( failedRequests, 'failed requests' ).toEqual( [] );

				await page.screenshot( {
					path: path.join( RUN_DIR, file ),
					fullPage: true,
				} );
				writeRecord( tab.name, {
					tab: tab.name,
					status: 'passed',
					file,
					capturedAt: new Date().toISOString(),
				} );
			} catch ( error ) {
				writeRecord( tab.name, {
					tab: tab.name,
					status: 'failed',
					file: null,
					error: String( error.message || error ).split( '\n' )[ 0 ],
					failedRequests,
				} );
				throw error;
			}
		} );
	}
} );
