/**
 * External Updates page (#1695): one action at a time across all panels.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ExternalUpdatesApp from '../ExternalUpdatesApp.js';

jest.mock( '@wordpress/api-fetch' );

beforeEach( () => {
	window.fairPaymentsExternalUpdates = {
		testMode: true,
		mollieConnected: true,
	};
} );

afterEach( () => {
	apiFetch.mockReset();
} );

it( 'disables every other action while one runs, and starts it only once', async () => {
	let resolveImport;
	apiFetch.mockImplementation( ( options ) => {
		if (
			options.path === '/fair-payments-connector/v1/admin/connected-sites'
		) {
			return Promise.resolve( [
				{
					id: 1,
					label: 'one.example',
					base_url: 'https://1',
					enabled: true,
				},
				{
					id: 2,
					label: 'two.example',
					base_url: 'https://2',
					enabled: true,
				},
			] );
		}
		if ( options.path === '/wp/v2/settings' ) {
			return Promise.resolve( {
				fair_payment_mollie_connected: true,
				fair_payment_mode: 'test',
			} );
		}
		if (
			options.path.startsWith(
				'/fair-payments-connector/v1/external-updates/runs?'
			)
		) {
			return Promise.resolve( {
				items: [],
				total: 0,
				pages: 0,
				page: 1,
			} );
		}
		if (
			options.path === '/fair-payments-connector/v1/external-updates/runs'
		) {
			return Promise.resolve( { run: { id: 5, status: 'running' } } );
		}
		if ( options.path.endsWith( '/import-transactions' ) ) {
			return new Promise( ( resolve ) => {
				resolveImport = resolve;
			} );
		}
		return Promise.reject( new Error( `unexpected ${ options.path }` ) );
	} );

	render( <ExternalUpdatesApp /> );

	const first = await screen.findByRole( 'button', {
		name: 'Import transactions from one.example',
	} );
	fireEvent.click( first );
	fireEvent.click( first );

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', {
				name: 'Import transactions from two.example',
			} )
		).toBeDisabled()
	);
	expect(
		screen.getByRole( 'button', { name: 'Load missing Mollie fees' } )
	).toBeDisabled();

	await waitFor( () => expect( resolveImport ).toBeDefined() );
	const starts = apiFetch.mock.calls.filter(
		( [ options ] ) =>
			options.path === '/fair-payments-connector/v1/external-updates/runs'
	);
	expect( starts ).toHaveLength( 1 );

	resolveImport( {
		run: {
			id: 5,
			status: 'succeeded',
			counts: { created: 0, updated: 0, skipped: 0, failed: 0 },
		},
	} );

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: 'Load missing Mollie fees' } )
		).toBeEnabled()
	);
	expect( console ).toHaveLogged();
} );
