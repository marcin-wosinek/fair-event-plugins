/**
 * Mollie payment import from External Updates (#1695): bounded search,
 * selection, already-imported rows, retry of failures, and a logged run.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import MollieImportPanel from '../components/MollieImportPanel.js';

jest.mock( '@wordpress/api-fetch' );

const MOLLIE = '/fair-payments-connector/v1/transactions/mollie';
const RUNS = '/fair-payments-connector/v1/external-updates/runs';

const noticeText = ( text ) =>
	screen.queryByText(
		( content, element ) =>
			content === text &&
			element?.className === 'components-notice__content'
	);

const PAYMENTS = [
	{
		mollie_payment_id: 'tr_new',
		description: 'Manual payment',
		amount: 12.5,
		currency: 'EUR',
		created_at: '2026-09-10 12:00:00',
		testmode: true,
		already_imported: false,
	},
	{
		mollie_payment_id: 'tr_flaky',
		description: 'Flaky payment',
		amount: 7,
		currency: 'EUR',
		created_at: '2026-09-10 11:00:00',
		testmode: true,
		already_imported: false,
	},
	{
		mollie_payment_id: 'tr_existing',
		description: 'Existing payment',
		amount: 5,
		currency: 'EUR',
		created_at: '2026-09-09 12:00:00',
		testmode: true,
		already_imported: true,
	},
];

const renderPanel = ( props = {} ) =>
	render(
		<MollieImportPanel
			activeAction={ null }
			onBegin={ () => true }
			onEnd={ jest.fn() }
			{ ...props }
		/>
	);

beforeEach( () => {
	window.fairPaymentsExternalUpdates = {
		testMode: true,
		mollieConnected: true,
		mollieSettingsUrl:
			'/wp-admin/admin.php?page=fair-payments-connector-settings',
	};
} );

afterEach( () => {
	apiFetch.mockReset();
} );

it( 'shows setup guidance when Mollie is disconnected', async () => {
	window.fairPaymentsExternalUpdates.mollieConnected = false;
	apiFetch.mockResolvedValueOnce( {
		fair_payment_mollie_connected: false,
		fair_payment_mode: 'test',
	} );

	renderPanel();

	expect(
		screen.getByText( 'Connect Mollie before importing payments.' )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'link', { name: 'Open Mollie settings' } )
	).toHaveAttribute(
		'href',
		'/wp-admin/admin.php?page=fair-payments-connector-settings'
	);
	await waitFor( () =>
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( { path: '/wp/v2/settings' } )
		)
	);
	expect( console ).toHaveLogged();
} );

it( 'refreshes the mode from the server and disables it while checking', async () => {
	let resolveSettings;
	apiFetch.mockImplementationOnce(
		() =>
			new Promise( ( resolve ) => {
				resolveSettings = resolve;
			} )
	);

	renderPanel();

	expect( screen.getByLabelText( 'Mode' ) ).toBeDisabled();
	expect( screen.getByLabelText( 'Mode' ) ).toHaveValue( 'test' );

	resolveSettings( {
		fair_payment_mollie_connected: true,
		fair_payment_mode: 'live',
	} );

	await waitFor( () =>
		expect( screen.getByLabelText( 'Mode' ) ).toHaveValue( 'live' )
	);
	expect( screen.getByLabelText( 'Mode' ) ).not.toBeDisabled();
	expect( console ).toHaveLogged();
} );

it( 'imports selected payments under a run and keeps failures selected for retry', async () => {
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path === '/wp/v2/settings' ) {
			return Promise.resolve( {
				fair_payment_mollie_connected: true,
				fair_payment_mode: 'test',
			} );
		}
		if ( options.path.startsWith( `${ MOLLIE }?` ) ) {
			return Promise.resolve( {
				connected: true,
				payments: PAYMENTS,
				next: null,
			} );
		}
		if ( options.path === RUNS ) {
			return Promise.resolve( { run: { id: 21, status: 'running' } } );
		}
		if ( options.path === MOLLIE && options.method === 'POST' ) {
			return Promise.resolve( {
				imported: 1,
				skipped: 0,
				failed: 1,
				failures: [ { payment_id: 'tr_flaky' } ],
				run: {
					id: 21,
					status: 'partial',
					counts: { created: 1, updated: 0, skipped: 0, failed: 1 },
					error_message: null,
				},
			} );
		}
		return Promise.reject( new Error( `unexpected ${ options.path }` ) );
	} );
	const onEnd = jest.fn();

	renderPanel( { onEnd } );
	await waitFor( () =>
		expect( screen.getByLabelText( 'Mode' ) ).not.toBeDisabled()
	);
	fireEvent.click( screen.getByRole( 'button', { name: 'Find payments' } ) );

	expect( await screen.findByText( 'Manual payment' ) ).toBeInTheDocument();
	expect( screen.getByLabelText( 'Existing payment' ) ).toBeDisabled();
	expect(
		screen.getByRole( 'button', { name: 'Import selected payments' } )
	).toBeDisabled();
	expect(
		screen.getByText( 'Select at least one payment to import.' )
	).toBeInTheDocument();

	fireEvent.click( screen.getByLabelText( 'Manual payment' ) );
	fireEvent.click( screen.getByLabelText( 'Flaky payment' ) );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Import selected payments' } )
	);

	await waitFor( () =>
		expect(
			noticeText( 'Partly completed: 1 new, 1 failed.' )
		).toBeInTheDocument()
	);
	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( {
			path: RUNS,
			data: { action: 'import_mollie_payments', source_id: 'test' },
		} )
	);
	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( {
			path: MOLLIE,
			method: 'POST',
			data: expect.objectContaining( {
				mode: 'test',
				payment_ids: [ 'tr_new', 'tr_flaky' ],
				run_id: 21,
			} ),
		} )
	);
	expect( screen.getByLabelText( 'Manual payment' ) ).toBeDisabled();
	expect( screen.getByLabelText( 'Flaky payment' ) ).toBeChecked();
	expect(
		screen.getByRole( 'button', { name: 'Import selected payments' } )
	).toBeEnabled();
	expect( onEnd ).toHaveBeenCalledTimes( 1 );
	expect( console ).toHaveLogged();
} );

it( 'shows the empty state and search errors', async () => {
	apiFetch
		.mockResolvedValueOnce( {
			fair_payment_mollie_connected: true,
			fair_payment_mode: 'test',
		} )
		.mockResolvedValueOnce( { connected: true, payments: [], next: null } )
		.mockRejectedValueOnce( new Error( 'Mollie unavailable' ) );

	renderPanel();
	await waitFor( () =>
		expect( screen.getByLabelText( 'Mode' ) ).not.toBeDisabled()
	);

	fireEvent.click( screen.getByRole( 'button', { name: 'Find payments' } ) );
	expect(
		await screen.findByText(
			'No paid Mollie payments match these filters.'
		)
	).toBeInTheDocument();

	fireEvent.click( screen.getByRole( 'button', { name: 'Find payments' } ) );
	await waitFor( () =>
		expect( noticeText( 'Mollie unavailable' ) ).toBeInTheDocument()
	);
	expect( console ).toHaveLogged();
} );
