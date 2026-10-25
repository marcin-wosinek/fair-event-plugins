/**
 * The Collaborators page and its public registration form are retired
 * (#1987).
 *
 * Covers the upgrade cleanup of the stored `collaborators` choice on a site
 * with an existing collaborator (including a repeated run), the missing menu
 * entry, bookmarked page, REST route and assets, the 410 answer for old
 * registration links with fair-audience-experimental active and inactive,
 * and the event collaborator management and mailing recipient selection
 * that stay.
 *
 * Run: `npm run test:e2e:local -- e2e/retired-collaborators.spec.js`.
 */

import { test, expect } from './support/fixtures.js';
import {
	wpCli,
	runScript,
	loginAsAdmin,
	resetCapturedMail,
	ADMIN_USER,
	ADMIN_PASSWORD,
} from './support/wp-cli.js';

const SLUG = 'fair-audience-collaborators';

const RETIRED_ROUTE = '/fair-audience/v1/collaborators';

const RETIRED_SCRIPT =
	'/wp-content/plugins/fair-audience-experimental/build/admin/collaborators/index.js';

const REGISTRATION_LINK = '/?collaborator_profile=1';

const GONE_TEXT = 'Collaborator registration is no longer available.';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

/**
 * True iff WordPress has a route matching `path`, whatever methods it
 * accepts: OPTIONS answers a registered route with its schema and an
 * unregistered one with an empty array.
 */
async function routeIsRegistered( request, path ) {
	const response = await request.fetch( `/wp-json${ path }`, {
		method: 'OPTIONS',
	} );
	const body = await response.json();
	return ! Array.isArray( body );
}

/** Whether a dotted version is at least the given one. */
function versionAtLeast( version, minimum ) {
	const a = String( version ).split( '.' ).map( Number );
	const b = minimum.split( '.' ).map( Number );
	for ( let i = 0; i < Math.max( a.length, b.length ); i++ ) {
		if ( ( a[ i ] || 0 ) !== ( b[ i ] || 0 ) ) {
			return ( a[ i ] || 0 ) > ( b[ i ] || 0 );
		}
	}
	return true;
}

/** GET and POST an old registration link; both must answer 410. */
async function expectRegistrationGone( request, email ) {
	const response = await request.get( REGISTRATION_LINK, {
		maxRedirects: 0,
	} );
	expect( response.status() ).toBe( 410 );
	expect( response.headers()[ 'cache-control' ] ).toContain( 'no-cache' );
	expect( await response.text() ).toContain( GONE_TEXT );

	const submission = await request.post( REGISTRATION_LINK, {
		maxRedirects: 0,
		form: {
			name: 'Retired',
			surname: 'Signup',
			email,
			marketing: '1',
			collaborator_profile_submit: '1',
		},
	} );
	expect( submission.status() ).toBe( 410 );
	expect( await submission.text() ).toContain( GONE_TEXT );

	const state = runScript(
		'retired-collaborators-state.php',
		'E2E_STATE',
		`0 ${ email }`
	);
	expect( state.submittedPeople ).toBe( 0 );
	expect( state.submittedTokens ).toBe( 0 );
	expect( state.mailToSubmitted ).toBe( 0 );
}

test.describe( 'Retired Collaborators page and registration form', () => {
	test( 'upgrade removes the stored choice, keeps collaborators, and can repeat', async ( {
		request,
		seedEvent,
	} ) => {
		const event = seedEvent( 'free' );
		const seed = runScript(
			'seed-retired-collaborators.php',
			'E2E_SEED',
			`${ event.eventId } ${ event.eventDateId }`
		);
		const stateArgs = `${ seed.participantId } unused@example.com`;

		try {
			// Any wp-cli call boots WordPress, which runs the pending upgrade.
			const state = runScript(
				'retired-collaborators-state.php',
				'E2E_STATE',
				stateArgs
			);

			expect( state.audienceFeatures ).toEqual( { polls: true } );
			expect( state.participantExists ).toBe( true );
			expect( state.collaboratorLabels ).toBe( 1 );
			expect( versionAtLeast( state.audienceDbVersion, '1.47.0' ) ).toBe(
				true
			);

			// Rewind the version: the cleanup runs again over clean data.
			wpCli( 'option update fair_audience_db_version 1.46.0' );

			const repeated = runScript(
				'retired-collaborators-state.php',
				'E2E_STATE',
				stateArgs
			);
			expect( repeated ).toEqual( state );

			// Event collaborator management still lists and adds collaborators.
			const roster = await request.get(
				`/wp-json/fair-audience/v1/event-dates/${ event.eventDateId }/participants`,
				{ headers: adminHeaders }
			);
			expect( roster.status() ).toBe( 200 );
			const rows = await roster.json();
			const row = rows.find(
				( r ) => Number( r.participant_id ) === seed.participantId
			);
			expect( row?.label ).toBe( 'collaborator' );

			// Mailing recipient selection still offers collaborators.
			const preview = await request.post(
				'/wp-json/fair-audience/v1/custom-mail/preview',
				{
					headers: adminHeaders,
					data: {
						event_date_id: event.eventDateId,
						is_marketing: false,
						labels: [ 'collaborator' ],
					},
				}
			);
			expect( preview.status() ).toBe( 200 );
			expect( JSON.stringify( await preview.json() ) ).toContain(
				seed.email
			);
		} finally {
			runScript(
				'cleanup-retired-collaborators.php',
				'E2E_CLEANUP',
				`${ seed.participantId }`
			);
		}
	} );

	test( 'old registration links answer 410 without accepting submissions', async ( {
		request,
	} ) => {
		resetCapturedMail();
		await expectRegistrationGone(
			request,
			`e2e-retired-signup-${ Date.now() }@example.com`
		);
	} );

	test( 'old registration links answer 410 with the companion inactive', async ( {
		request,
	} ) => {
		resetCapturedMail();
		wpCli( 'plugin deactivate fair-audience-experimental' );
		try {
			await expectRegistrationGone(
				request,
				`e2e-retired-signup-off-${ Date.now() }@example.com`
			);
		} finally {
			wpCli( 'plugin activate fair-audience-experimental' );
		}
	} );

	test( 'collaborators REST route and assets are gone', async ( {
		request,
	} ) => {
		expect( await routeIsRegistered( request, RETIRED_ROUTE ) ).toBe(
			false
		);

		const asset = await request.get( RETIRED_SCRIPT );
		expect( asset.status() ).toBe( 404 );
	} );

	test( 'menu entry, bookmarked page and settings toggle are gone', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );

		const loadedScripts = [];
		page.on( 'request', ( req ) => loadedScripts.push( req.url() ) );

		await page.goto(
			'/wp-admin/admin.php?page=fair-audience-experimental-settings'
		);
		// Another bundle's toggle and menu entry prove both lists rendered.
		await expect(
			page.getByLabel( 'Polls', { exact: true } )
		).toBeVisible();
		await expect(
			page.getByLabel( 'Collaborators', { exact: true } )
		).toHaveCount( 0 );
		await expect(
			page.locator( '#adminmenu a[href*="fair-audience-polls"]' )
		).toHaveCount( 1 );
		await expect(
			page.locator( `#adminmenu a[href*="${ SLUG }"]` )
		).toHaveCount( 0 );

		// The bookmarked page gets WordPress's answer for an unregistered page.
		const response = await page.goto(
			`/wp-admin/admin.php?page=${ SLUG }`
		);
		expect( response.status() ).toBe( 403 );
		await expect( page.locator( `#${ SLUG }-root` ) ).toHaveCount( 0 );
		await expect(
			page.getByRole( 'heading', { name: 'Collaborators' } )
		).toHaveCount( 0 );

		expect(
			loadedScripts.filter( ( url ) =>
				url.includes( 'admin/collaborators/' )
			)
		).toEqual( [] );
	} );
} );
