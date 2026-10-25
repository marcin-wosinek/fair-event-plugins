/**
 * @jest-environment jsdom
 *
 * Revoking an API token asks in a dialog that names the token (#1936).
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ApiTokensApp from '../ApiTokensApp.js';

jest.mock( '@wordpress/api-fetch' );

const TOKEN = {
	id: 7,
	label: 'lamutable.example',
	scopes: [ 'transactions:read' ],
	created_at: '2026-10-01 10:00:00',
	last_used_at: null,
	status: 'active',
};

const revokeCalls = () =>
	apiFetch.mock.calls.filter(
		( [ options ] ) => options.method === 'DELETE'
	);

const openRevoke = async ( revoke ) => {
	apiFetch.mockImplementation( ( { method } ) =>
		method === 'DELETE' ? revoke() : Promise.resolve( [ TOKEN ] )
	);
	await act( async () => render( <ApiTokensApp /> ) );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Revoke' } ) );
	return screen.getByRole( 'dialog', {
		name: 'Revoke API token — lamutable.example',
	} );
};

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'ApiTokensApp — revoking a token', () => {
	it( 'names the token and its scopes, and cancelling sends nothing', async () => {
		const dialog = await openRevoke( () => Promise.resolve( {} ) );

		expect(
			within( dialog ).getByText(
				'Any site using this token immediately loses access to: transactions:read.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Revoke token' } )
		).toHaveClass( 'is-destructive' );

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( revokeCalls() ).toHaveLength( 0 );
	} );

	it( 'keeps the dialog open on failure, retries, then reports the result', async () => {
		const revoke = jest
			.fn()
			.mockRejectedValueOnce( {} )
			.mockResolvedValueOnce( { ...TOKEN, status: 'revoked' } );
		const dialog = await openRevoke( revoke );
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Revoke token',
		} );

		await act( async () => fireEvent.click( confirm ) );

		expect(
			within( dialog ).getByText(
				'The API token could not be revoked. Try again.',
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();

		await act( async () => fireEvent.click( confirm ) );

		expect( revokeCalls() ).toHaveLength( 2 );
		expect( revokeCalls()[ 1 ][ 0 ].path ).toBe(
			'/fair-payments-connector/v1/admin/api-tokens/7'
		);
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			await screen.findByText( 'API token “lamutable.example” revoked.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
	} );
} );
