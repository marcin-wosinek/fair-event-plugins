/**
 * Newest-wins selection of the bundled shared library (#2181), next to the
 * audited legacy Fair Timetable releases, in both load orders, with and
 * without a shared class loading before selection.
 *
 * Each request runs with a real, shipped release's Composer autoloader;
 * see e2e/mu-plugins/fair-e2e-shared-loader.php.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

const AUTH = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const REPORT = '/wp-json/fair-e2e/v1/shared-loader';

// The audited legacy releases and the shared version each ships.
const RELEASES = {
	'0.7.0': '0.2.1',
	'0.7.1': '0.2.6',
	'0.8.0': '0.2.10',
};

const UPDATED = [ 'fair-events', 'fair-audience', 'fair-payments-connector' ];

async function report( request, headers = {} ) {
	const response = await request.get( `${ BASE_URL }${ REPORT }`, {
		headers: { ...AUTH, ...headers },
	} );
	expect( response.status() ).toBe( 200 );
	return response.json();
}

function legacyHeaders( release, order, early ) {
	return {
		'X-Fair-E2E-Legacy-Shared': release,
		'X-Fair-E2E-Legacy-Order': order,
		'X-Fair-E2E-Legacy-Early': early ? '1' : '0',
	};
}

test.describe( 'Shared library selection', () => {
	test( 'updated plugins alone select one copy and start', async ( {
		request,
	} ) => {
		const body = await report( request );

		expect( body.loader.state ).toBe( 'selected' );
		expect( body.loader.conflicts ).toEqual( [] );
		expect( body.outdated ).toEqual( [] );
		for ( const file of Object.values( body.loaded ) ) {
			expect(
				file.startsWith( `${ body.loader.selected.dir }/src/` )
			).toBe( true );
		}
		for ( const plugin of UPDATED ) {
			expect( body.started[ plugin ] ).toBe( true );
		}
		expect( body.diagnostics ).toEqual( [] );
	} );

	for ( const [ release, legacyVersion ] of Object.entries( RELEASES ) ) {
		for ( const order of [ 'first', 'last' ] ) {
			test( `Fair Timetable ${ release } loading ${ order }: the newest copy serves every shared class`, async ( {
				request,
			} ) => {
				const body = await report(
					request,
					legacyHeaders( release, order, false )
				);

				expect( body.fixture.release ).toBe( release );
				expect( body.loader.state ).toBe( 'selected' );
				expect( body.loader.conflicts ).toEqual( [] );

				// The legacy copy is real and older than the selected one.
				const legacy = body.bundles.find(
					( bundle ) =>
						bundle.dir ===
						`${ body.fixture.dir }/vendor/fair-events/shared`
				);
				expect( legacy?.version ).toBe( legacyVersion );
				expect( body.loader.selected.version ).not.toBe(
					legacyVersion
				);

				// Every class, including one the legacy copy also has and the
				// one its admin bootstrap loads, comes from the selected copy.
				for ( const [ className, file ] of Object.entries(
					body.loaded
				) ) {
					expect(
						file,
						`${ className } loaded from ${ file }`
					).toMatch(
						new RegExp(
							`^${ body.loader.selected.dir.replace(
								/[.*+?^${}()|[\]\\]/g,
								'\\$&'
							) }/src/`
						)
					);
				}

				expect( body.outdated ).toEqual( [ 'Fair Timetable' ] );
				for ( const plugin of UPDATED ) {
					expect( body.started[ plugin ] ).toBe( true );
				}
				expect( body.diagnostics ).toEqual( [] );
			} );

			test( `Fair Timetable ${ release } loading ${ order } with an early shared class: updated plugins stay off`, async ( {
				request,
			} ) => {
				const body = await report(
					request,
					legacyHeaders( release, order, true )
				);

				expect( body.loader.state ).toBe( 'conflict' );
				expect( body.loader.selected ).toBeNull();

				// Provenance is the legacy copy's real file.
				const conflicts = Object.entries( body.loader.conflicts );
				expect( conflicts ).toEqual( [
					[
						'FairEventsShared\\Admin\\SettingsPage',
						`${ body.fixture.dir }/vendor/fair-events/shared/src/Admin/SettingsPage.php`,
					],
				] );

				// Nothing newer was mixed into the legacy class graph.
				expect( body.loaded[ 'FairEventsShared\\Money' ] ).toBeNull();
				expect(
					body.loaded[
						'FairEventsShared\\ApiTokens\\AbstractApiToken'
					]
				).toBeNull();

				for ( const plugin of UPDATED ) {
					expect( body.started[ plugin ] ).toBe( false );
				}
				expect( body.diagnostics ).toEqual( [] );
			} );
		}
	}

	test( 'the next request without the legacy release is back to normal', async ( {
		request,
	} ) => {
		await report( request, legacyHeaders( '0.8.0', 'last', true ) );
		const body = await report( request );

		expect( body.loader.state ).toBe( 'selected' );
		expect( body.outdated ).toEqual( [] );
		expect( body.started[ 'fair-events' ] ).toBe( true );
	} );
} );

/*
 * The administrator email while a conflict pauses Fair Events (#2445). Mail
 * is captured by e2e/mu-plugins/fair-e2e-support.php. A request without the
 * legacy headers is healthy in its context, so state is read from a request
 * that still sees the conflict where the incident must stay open.
 */
test.describe( 'Paused-site alert for a shared-library conflict', () => {
	test.describe.configure( { mode: 'serial' } );

	const CONFLICT = legacyHeaders( '0.8.0', 'last', true );

	async function reset( request ) {
		const response = await request.delete(
			`${ BASE_URL }${ REPORT }/pause-alert`,
			{ headers: AUTH }
		);
		expect( response.status() ).toBe( 200 );
	}

	// Anonymous requests: no login, so nothing but the fixture headers.
	const frontend = ( request, headers = {} ) =>
		request.get( `${ BASE_URL }/`, { headers } );
	const admin = ( request, headers = {} ) =>
		request.get(
			`${ BASE_URL }/wp-admin/admin-ajax.php?action=fair_e2e_noop`,
			{ headers }
		);

	test( 'a frontend conflict emails the administration address once', async ( {
		request,
	} ) => {
		await reset( request );

		// Simultaneous requests: only one claims the first attempt.
		const pages = await Promise.all(
			Array.from( { length: 5 }, () => frontend( request, CONFLICT ) )
		);
		for ( const page of pages ) {
			expect( page.ok() ).toBe( true );
		}

		const body = await report( request, CONFLICT );
		expect( body.loader.state ).toBe( 'conflict' );
		expect( body.diagnostics ).toEqual( [] );
		expect( body.pause_alert.mail ).toHaveLength( 1 );
		expect( body.pause_alert.state.library_conflict ).toMatchObject( {
			attempts: 1,
			sent: true,
			contexts: { frontend: true },
		} );
		const [ mail ] = body.pause_alert.mail;
		expect( mail.subject ).toContain( 'Fair Events is paused' );
		expect( mail.body ).toContain( BASE_URL );
		expect( mail.body ).toContain(
			'another plugin loaded an outdated copy of the Fair Event Plugins shared library'
		);
		expect( mail.body ).toContain( 'ticket purchases are unavailable' );
		expect( mail.body ).toContain( '1. Update all Fair plugins.' );
		expect( mail.body ).not.toContain( 'legacy-shared' );
		expect( mail.body ).not.toContain( 'vendor' );
		expect( mail.body ).not.toContain( 'FairEventsShared' );

		// A healthy frontend request closes the frontend-only incident.
		const healthy = await report( request );
		expect( healthy.pause_alert.state ).toBeNull();
		expect( healthy.pause_alert.mail ).toHaveLength( 1 );
	} );

	test( 'an outdated copy that only warns sends nothing', async ( {
		request,
	} ) => {
		await reset( request );
		const body = await report(
			request,
			legacyHeaders( '0.8.0', 'last', false )
		);

		expect( body.loader.state ).toBe( 'selected' );
		expect( body.outdated ).not.toEqual( [] );
		expect( body.pause_alert.state ).toBeNull();
		expect( body.pause_alert.mail ).toEqual( [] );
	} );

	test( 'an admin-only conflict stays open through healthy frontend requests and alerts again after recovery', async ( {
		request,
	} ) => {
		await reset( request );

		await admin( request, CONFLICT );
		let body = await report( request );
		expect( body.pause_alert.state.library_conflict.contexts ).toEqual( {
			admin: true,
		} );
		expect( body.pause_alert.mail ).toHaveLength( 1 );

		await admin( request, CONFLICT );
		await frontend( request );
		body = await report( request );
		expect( body.pause_alert.mail ).toHaveLength( 1 );

		// A healthy admin request is the recovery that closes it.
		await admin( request );
		body = await report( request );
		expect( body.pause_alert.state ).toBeNull();

		await admin( request, CONFLICT );
		body = await report( request );
		expect( body.pause_alert.mail ).toHaveLength( 2 );
		expect( body.pause_alert.state.library_conflict.attempts ).toBe( 1 );
	} );
} );
