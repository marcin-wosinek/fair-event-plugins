/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import UpgradePanel from '../UpgradePanel.js';

jest.mock( '@wordpress/api-fetch' );

const CHECKS = [
	'representative_purchases',
	'statistics_revenue',
	'shared_allocations',
	'finance_participant_attempts',
	'audience_reactivation',
];

function status( overrides = {} ) {
	return {
		evidence: null,
		safe_to_upgrade: false,
		checks: {
			completion_recorded: false,
			migration_verified: true,
			ownership_cutover: false,
			readers_switched: false,
			no_migration_work: true,
			no_blocking_finding: false,
		},
		blockers: [ 'ownership_cutover_missing' ],
		counts: { migration_work: 0, open_findings: 2 },
		ready_for_cleanup: {
			applicable: true,
			ready: false,
			blockers: [ 'upgrade_unsafe', 'cleanup_unavailable' ],
		},
		staging_verification: null,
		intermediate_release: {
			tag: 'build-2.2.0',
			url: 'https://example.test/release',
			versions: {},
		},
		plugin_versions: {
			'fair-payments-connector': '2.8.0',
			'fair-events': '2.2.0',
			'fair-audience': '2.0.0',
		},
		...overrides,
	};
}

async function renderPanel( data ) {
	apiFetch.mockImplementation( () => Promise.resolve( data ) );
	await act( async () => {
		render( <UpgradePanel /> );
	} );
}

describe( 'UpgradePanel', () => {
	beforeEach( () => apiFetch.mockReset() );

	it( 'says an unmigrated site is not safe and names each missing step', async () => {
		await renderPanel( status() );

		expect(
			screen.getAllByText( /Not safe to upgrade yet/ )[ 0 ]
		).toHaveTextContent( 'build-2.2.0' );
		expect(
			screen.getByText(
				'Not yet: Payment records switched to Fair Events'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Done: Migration verified' )
		).toBeInTheDocument();
		expect(
			screen.getByText( /Link or review every open finding/ )
		).toBeInTheDocument();
		// Being safe to upgrade and cleanup readiness are separate.
		expect(
			screen.getByText( /Being safe to upgrade isn’t enough/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( /comes with a later release/ )
		).toBeInTheDocument();
	} );

	it( 'shows a fresh installation as safe with nothing to clean up', async () => {
		await renderPanel(
			status( {
				evidence: {
					basis: 'fresh_install',
					recorded_at: '2026-11-10 09:00:00',
				},
				safe_to_upgrade: true,
				checks: { completion_recorded: true },
				blockers: [],
				ready_for_cleanup: {
					applicable: false,
					ready: false,
					blockers: [],
				},
			} )
		);

		expect(
			screen.getAllByText( /installed here without earlier payment/ )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'This site has no old payment records to remove.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Save staging verification',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'needs a date before saving, then saves the staging verification once', async () => {
		const saved = status( {
			staging_verification: {
				verified_on: '2026-11-04',
				versions: {
					'fair-payments-connector': '2.8.0',
					'fair-events': '2.2.0',
					'fair-audience': '2.0.0',
				},
				checks: Object.fromEntries(
					CHECKS.map( ( code ) => [
						code,
						code === 'statistics_revenue',
					] )
				),
				note: '',
				user_name: 'Ada Admin',
				recorded_at: '2026-11-04 12:00:00',
			},
		} );
		let resolveSave;
		apiFetch.mockImplementation( ( options ) =>
			options.method === 'PUT'
				? new Promise( ( resolve ) => {
						resolveSave = () => resolve( saved );
					} )
				: Promise.resolve( status() )
		);
		await act( async () => {
			render( <UpgradePanel /> );
		} );

		const button = screen.getByRole( 'button', {
			name: 'Save staging verification',
		} );
		expect( button ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Enter the date of the staging verification.' )
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Fair Events version' ) ).toHaveValue(
			'2.2.0'
		);

		fireEvent.change( screen.getByLabelText( 'Verified on (staging)' ), {
			target: { value: '2026-11-04' },
		} );
		fireEvent.click(
			screen.getByLabelText( 'Statistics match the linked payments' )
		);
		expect(
			screen.getByText( 'You have unsaved changes.' )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click( button );
			fireEvent.click( button );
		} );
		const puts = apiFetch.mock.calls.filter(
			( [ options ] ) => options.method === 'PUT'
		);
		expect( puts ).toHaveLength( 1 );
		expect( puts[ 0 ][ 0 ].path ).toBe(
			'/fair-events/v1/payment-history/upgrade/staging-verification'
		);
		expect( puts[ 0 ][ 0 ].data ).toMatchObject( {
			verified_on: '2026-11-04',
			checks: { statistics_revenue: true, shared_allocations: false },
		} );

		await act( async () => resolveSave() );
		expect(
			screen.getAllByText( 'Staging verification saved.' )[ 0 ]
		).toBeInTheDocument();
		expect( screen.getByText( /by Ada Admin/ ) ).toBeInTheDocument();
	} );

	it( 'shows a save error and keeps the edits', async () => {
		apiFetch.mockImplementation( ( options ) =>
			options.method === 'PUT'
				? Promise.reject( { message: 'Invalid fields.' } )
				: Promise.resolve( status() )
		);
		await act( async () => {
			render( <UpgradePanel /> );
		} );
		fireEvent.change( screen.getByLabelText( 'Verified on (staging)' ), {
			target: { value: '2026-11-04' },
		} );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Save staging verification',
				} )
			);
		} );
		expect(
			screen.getAllByText( 'Invalid fields.' )[ 0 ]
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Verified on (staging)' ) ).toHaveValue(
			'2026-11-04'
		);
	} );
} );
