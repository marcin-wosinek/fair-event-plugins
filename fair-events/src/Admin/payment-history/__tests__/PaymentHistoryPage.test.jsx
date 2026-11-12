/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import PaymentHistoryPage from '../PaymentHistoryPage.js';

jest.mock( '@wordpress/api-fetch' );

const STATUS = {
	reconciliation_available: true,
	payment_information: 'available',
	finding_statuses: {},
};

const UPGRADE = {
	evidence: { basis: 'fresh_install', recorded_at: '2026-11-01 10:00:00' },
	safe_to_upgrade: true,
	checks: {},
	blockers: [],
	counts: { migration_work: 0, open_findings: 0 },
	ready_for_cleanup: { applicable: false, ready: false, blockers: [] },
	staging_verification: null,
	intermediate_release: {
		tag: 'build-2.2.0',
		url: 'https://example.test/release',
		versions: {},
	},
	plugin_versions: {},
};

function findingsResponse( items = [] ) {
	return Promise.resolve( {
		json: () => Promise.resolve( { items, event_dates: [], reasons: {} } ),
		headers: {
			get: ( name ) =>
				( {
					'X-WP-Total': String( items.length ),
					'X-WP-TotalPages': '1',
				} )[ name ],
		},
	} );
}

describe( 'PaymentHistoryPage', () => {
	beforeEach( () => {
		jest.resetAllMocks();
		jest.useFakeTimers();
		apiFetch.mockImplementation( ( { path } ) => {
			if (
				path.startsWith( '/fair-events/v1/payment-history/findings' )
			) {
				return findingsResponse();
			}
			if (
				path.startsWith( '/fair-events/v1/payment-history/upgrade' )
			) {
				return Promise.resolve( UPGRADE );
			}
			return Promise.resolve( STATUS );
		} );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	it( 'shows the records to review without a migration run', async () => {
		render( <PaymentHistoryPage /> );

		expect(
			await screen.findByRole( 'heading', { name: 'Records to review' } )
		).toBeInTheDocument();
		expect(
			await screen.findByText(
				'Nothing needs a decision. Payments are linked to their purchases as they come in.'
			)
		).toBeInTheDocument();
	} );

	it( 'offers no migration controls and doesn’t poll', async () => {
		render( <PaymentHistoryPage /> );
		await screen.findByText( '0 records' );

		for ( const name of [
			'Run a dry run',
			'Start the migration',
			'Continue the migration',
			'Verify again',
			'Switch payment records to Fair Events',
			'Switch statistics to Fair Events records',
		] ) {
			expect(
				screen.queryByRole( 'button', { name } )
			).not.toBeInTheDocument();
		}
		expect(
			screen.queryByRole( 'heading', { name: 'Migration' } )
		).not.toBeInTheDocument();

		const calls = apiFetch.mock.calls.length;
		await act( async () => {
			jest.advanceTimersByTime( 60000 );
		} );
		expect( apiFetch ).toHaveBeenCalledTimes( calls );
		// Only the status, upgrade readiness and the findings were read;
		// nothing was started.
		expect(
			apiFetch.mock.calls.map( ( [ options ] ) => options.method )
		).not.toContain( 'POST' );
	} );
} );
