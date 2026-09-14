import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ImportTransactionsModal from './ImportTransactionsModal.js';

jest.mock( '@wordpress/api-fetch' );

beforeEach( () => {
	window.fairPaymentTransactions = {
		testMode: true,
		mollieConnected: true,
		mollieSettingsUrl:
			'/wp-admin/admin.php?page=fair-payments-connector-settings',
	};
	apiFetch.mockReset();
} );

it( 'offers the Mollie import source', () => {
	render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ jest.fn() }
		/>
	);
	expect(
		screen.getByRole( 'button', { name: 'Import from Mollie' } )
	).toBeInTheDocument();
} );

it( 'shows actionable setup guidance when Mollie is disconnected', async () => {
	window.fairPaymentTransactions.mollieConnected = false;
	apiFetch.mockResolvedValueOnce( {
		fair_payment_mollie_connected: false,
		fair_payment_mode: 'test',
	} );
	render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ jest.fn() }
		/>
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Import from Mollie' } )
	);
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

it( 'refreshes the Mollie mode from the server when the source opens, even if the page loaded as test mode', async () => {
	window.fairPaymentTransactions.testMode = true;
	apiFetch.mockResolvedValueOnce( {
		fair_payment_mollie_connected: true,
		fair_payment_mode: 'live',
	} );
	render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ jest.fn() }
		/>
	);

	fireEvent.click(
		screen.getByRole( 'button', { name: 'Import from Mollie' } )
	);

	// Optimistic first paint keeps the page-load-time value...
	expect( screen.getByLabelText( 'Mode' ) ).toHaveValue( 'test' );
	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( { path: '/wp/v2/settings' } )
	);
	// ...then the fresh fetch overwrites it, with no user interaction.
	await waitFor( () =>
		expect( screen.getByLabelText( 'Mode' ) ).toHaveValue( 'live' )
	);
	expect( console ).toHaveLogged();
} );

it( 'disables the Mode control while the fresh connection check is pending', async () => {
	let resolveSettings;
	apiFetch.mockImplementationOnce(
		() =>
			new Promise( ( resolve ) => {
				resolveSettings = resolve;
			} )
	);
	render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ jest.fn() }
		/>
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Import from Mollie' } )
	);

	expect( screen.getByLabelText( 'Mode' ) ).toBeDisabled();

	resolveSettings( {
		fair_payment_mollie_connected: true,
		fair_payment_mode: 'test',
	} );

	await waitFor( () =>
		expect( screen.getByLabelText( 'Mode' ) ).not.toBeDisabled()
	);
	expect( console ).toHaveLogged();
} );

it( 'loads, selects, and imports eligible payments while disabling existing rows', async () => {
	apiFetch
		.mockResolvedValueOnce( {
			fair_payment_mollie_connected: true,
			fair_payment_mode: 'test',
		} )
		.mockResolvedValueOnce( {
			connected: true,
			default_mode: 'test',
			payments: [
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
					mollie_payment_id: 'tr_existing',
					description: 'Existing payment',
					amount: 5,
					currency: 'EUR',
					created_at: '2026-09-09 12:00:00',
					testmode: true,
					already_imported: true,
				},
			],
			next: null,
		} )
		.mockResolvedValueOnce( {
			imported: 1,
			skipped: 0,
			failed: 0,
			failures: [],
			message: 'Imported 1, skipped 0, and failed 0 payment(s).',
		} );
	const onImported = jest.fn();
	render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ onImported }
		/>
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Import from Mollie' } )
	);
	fireEvent.click( screen.getByRole( 'button', { name: 'Find payments' } ) );

	expect( await screen.findByText( 'Manual payment' ) ).toBeInTheDocument();
	expect( screen.getByLabelText( 'Existing payment' ) ).toBeDisabled();
	fireEvent.click( screen.getByLabelText( 'Manual payment' ) );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Import selected payments' } )
	);

	await waitFor( () => expect( onImported ).toHaveBeenCalled() );
	expect( apiFetch ).toHaveBeenLastCalledWith(
		expect.objectContaining( {
			path: '/fair-payments-connector/v1/transactions/mollie',
			method: 'POST',
			data: expect.objectContaining( { payment_ids: [ 'tr_new' ] } ),
		} )
	);
	expect(
		( await screen.findAllByText( /Imported 1, skipped 0/ ) ).length
	).toBeGreaterThan( 0 );
	expect( console ).toHaveLogged();
} );

it( 'shows empty, API error, and partial-failure feedback', async () => {
	apiFetch
		.mockResolvedValueOnce( {
			fair_payment_mollie_connected: true,
			fair_payment_mode: 'test',
		} )
		.mockResolvedValueOnce( {
			connected: true,
			payments: [],
			next: null,
		} );
	const { unmount } = render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ jest.fn() }
		/>
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Import from Mollie' } )
	);
	fireEvent.click( screen.getByRole( 'button', { name: 'Find payments' } ) );
	expect(
		await screen.findByText(
			'No paid Mollie payments match these filters.'
		)
	).toBeInTheDocument();
	expect( console ).toHaveLogged();
	unmount();

	apiFetch
		.mockResolvedValueOnce( {
			fair_payment_mollie_connected: true,
			fair_payment_mode: 'test',
		} )
		.mockRejectedValueOnce( new Error( 'Mollie unavailable' ) );
	render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ jest.fn() }
		/>
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Import from Mollie' } )
	);
	fireEvent.click( screen.getByRole( 'button', { name: 'Find payments' } ) );
	expect(
		( await screen.findAllByText( 'Mollie unavailable' ) ).length
	).toBeGreaterThan( 0 );
	expect( console ).toHaveLogged();
} );
