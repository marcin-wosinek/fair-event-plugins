/**
 * Component tests for the API Tokens settings tab (#1747).
 *
 * Exercises:
 *   - Listing: tokens render with their stored scopes, including one that is
 *     no longer offered.
 *   - Creation: only `transactions:read` is offered and sent; the plaintext
 *     token is shown once and is gone after the dialog closes.
 *   - Validation: a missing label or scope disables the submit and says why.
 *   - Errors: load, create and revoke failures are reported in place.
 *   - Revocation: a dialog names the token and what revoking breaks.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ApiTokensTab from '../ApiTokensTab.js';

jest.mock( '@wordpress/api-fetch' );

const TOKENS_PATH = '/fair-payments-connector/v1/admin/api-tokens';
const PLAINTEXT = 'plaintext-token-shown-exactly-once-0123456789';

const ACTIVE = {
	id: 2,
	label: 'satellite.example',
	scopes: [ 'transactions:read' ],
	created_at: '2026-01-02 10:00:00',
	last_used_at: null,
	status: 'active',
};

const LEGACY = {
	id: 1,
	label: 'legacy.example',
	scopes: [ 'transactions:read', 'locations:read' ],
	created_at: '2025-12-01 08:30:00',
	last_used_at: '2026-01-01 09:15:00',
	status: 'revoked',
};

/**
 * Route apiFetch by method; each handler may return a value or a rejection.
 *
 * @param {Object} handlers Per-method responders.
 */
function mockApi( handlers = {} ) {
	apiFetch.mockImplementation( ( options ) => {
		const method = options.method || 'GET';
		const handler = handlers[ method ];
		return handler ? handler( options ) : Promise.resolve( [] );
	} );
}

function callsWith( method ) {
	return apiFetch.mock.calls
		.map( ( [ options ] ) => options )
		.filter( ( options ) => ( options.method || 'GET' ) === method );
}

async function openCreateDialog() {
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Generate token' } )
	);
	return screen.findByRole( 'dialog', { name: 'Generate API token' } );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'ApiTokensTab', () => {
	it( 'lists tokens with their stored scopes, status and usage', async () => {
		mockApi( { GET: () => Promise.resolve( [ ACTIVE, LEGACY ] ) } );

		render( <ApiTokensTab /> );

		const active = (
			await screen.findByText( 'satellite.example' )
		).closest( 'tr' );
		expect(
			within( active ).getByText( 'transactions:read' )
		).toBeInTheDocument();
		expect(
			within( active ).getByText( '2026-01-02 10:00 UTC' )
		).toBeInTheDocument();
		expect( within( active ).getByText( 'Never' ) ).toBeInTheDocument();
		expect( within( active ).getByText( 'Active' ) ).toBeInTheDocument();
		expect(
			within( active ).getByRole( 'button', { name: 'Revoke' } )
		).toBeInTheDocument();

		// A scope that is no longer offered still shows on an older token.
		const legacy = screen.getByText( 'legacy.example' ).closest( 'tr' );
		expect(
			within( legacy ).getByText( 'transactions:read, locations:read' )
		).toBeInTheDocument();
		expect( within( legacy ).getByText( 'Revoked' ) ).toBeInTheDocument();
		expect(
			within( legacy ).queryByRole( 'button', { name: 'Revoke' } )
		).not.toBeInTheDocument();

		expect( callsWith( 'GET' )[ 0 ].path ).toBe( TOKENS_PATH );
	} );

	it( 'says so when there are no tokens', async () => {
		mockApi();

		render( <ApiTokensTab /> );

		expect(
			await screen.findByText(
				'No API tokens yet. Generate one to share transactions with another site.'
			)
		).toBeInTheDocument();
	} );

	it( 'reports a failed load instead of an empty list', async () => {
		mockApi( {
			GET: () => Promise.reject( new Error( 'Server unavailable.' ) ),
		} );

		render( <ApiTokensTab /> );

		expect(
			await screen.findByText( 'Server unavailable.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect(
			screen.queryByText( /No API tokens yet/ )
		).not.toBeInTheDocument();
	} );

	it( 'offers only the transactions scope and requires a label', async () => {
		mockApi();

		render( <ApiTokensTab /> );
		const dialog = await openCreateDialog();

		expect( within( dialog ).getAllByRole( 'checkbox' ) ).toHaveLength( 1 );
		expect(
			within( dialog ).getByRole( 'checkbox', {
				name: 'Read transactions',
			} )
		).toBeChecked();
		expect(
			within( dialog ).queryByText( /locations/i )
		).not.toBeInTheDocument();

		const submit = within( dialog ).getByRole( 'button', {
			name: 'Generate token',
		} );
		expect( submit ).toBeDisabled();
		expect(
			within( dialog ).getByText( 'Enter a label to generate the token.' )
		).toBeInTheDocument();

		// Whitespace is not a label.
		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: '   ' },
		} );
		expect( submit ).toBeDisabled();

		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: 'satellite.example' },
		} );
		expect( submit ).toBeEnabled();

		fireEvent.click(
			within( dialog ).getByRole( 'checkbox', {
				name: 'Read transactions',
			} )
		);
		expect( submit ).toBeDisabled();
		expect(
			within( dialog ).getByText(
				'Select at least one scope to generate the token.'
			)
		).toBeInTheDocument();
		expect( callsWith( 'POST' ) ).toHaveLength( 0 );
	} );

	it( 'creates a token and shows its plaintext only until the dialog closes', async () => {
		let created = false;
		mockApi( {
			GET: () => Promise.resolve( created ? [ ACTIVE ] : [] ),
			POST: () => {
				created = true;
				return Promise.resolve( { ...ACTIVE, token: PLAINTEXT } );
			},
		} );

		render( <ApiTokensTab /> );
		const dialog = await openCreateDialog();

		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: '  satellite.example ' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Generate token' } )
		);

		const result = await screen.findByRole( 'dialog', {
			name: 'Token created',
		} );
		expect( within( result ).getByText( PLAINTEXT ) ).toBeInTheDocument();
		expect(
			within( result ).getByText(
				'Copy this token now. For security it will not be shown again.'
			)
		).toBeInTheDocument();

		expect( callsWith( 'POST' ) ).toEqual( [
			{
				path: TOKENS_PATH,
				method: 'POST',
				data: {
					label: 'satellite.example',
					scopes: [ 'transactions:read' ],
				},
			},
		] );

		fireEvent.click(
			within( result ).getByRole( 'button', { name: 'Done' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( screen.queryByText( PLAINTEXT ) ).not.toBeInTheDocument();
		// The list was reloaded and never carries the plaintext.
		expect(
			await screen.findByText( 'satellite.example' )
		).toBeInTheDocument();

		// Reopening starts a fresh form, not the previous token.
		const reopened = await openCreateDialog();
		expect( within( reopened ).getByLabelText( 'Label' ) ).toHaveValue(
			''
		);
		expect( screen.queryByText( PLAINTEXT ) ).not.toBeInTheDocument();
	} );

	it( 'drops the plaintext token when the tab is left', async () => {
		mockApi( {
			POST: () => Promise.resolve( { ...ACTIVE, token: PLAINTEXT } ),
		} );

		const { unmount } = render( <ApiTokensTab /> );
		const dialog = await openCreateDialog();
		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: 'satellite.example' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Generate token' } )
		);
		expect( await screen.findByText( PLAINTEXT ) ).toBeInTheDocument();

		unmount();
		expect( document.body ).not.toHaveTextContent( PLAINTEXT );

		render( <ApiTokensTab /> );
		await screen.findByRole( 'button', { name: 'Generate token' } );
		expect( document.body ).not.toHaveTextContent( PLAINTEXT );
	} );

	it( 'copies the token and reports a failed copy', async () => {
		const writeText = jest
			.fn()
			.mockResolvedValueOnce()
			.mockRejectedValueOnce( new Error( 'denied' ) );
		Object.defineProperty( window.navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		} );
		mockApi( {
			POST: () => Promise.resolve( { ...ACTIVE, token: PLAINTEXT } ),
		} );

		render( <ApiTokensTab /> );
		const dialog = await openCreateDialog();
		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: 'satellite.example' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Generate token' } )
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Copy token' } )
		);
		expect(
			await screen.findByRole( 'button', { name: 'Copied!' } )
		).toBeInTheDocument();
		expect( writeText ).toHaveBeenCalledWith( PLAINTEXT );

		fireEvent.click( screen.getByRole( 'button', { name: 'Copied!' } ) );
		expect(
			await screen.findByText(
				'Copying failed. Select the token above and copy it manually.'
			)
		).toBeInTheDocument();

		delete window.navigator.clipboard;
	} );

	it( 'keeps the form open and shows the reason when creation fails', async () => {
		mockApi( {
			POST: () =>
				Promise.reject( new Error( 'Invalid parameter(s): scopes' ) ),
		} );

		render( <ApiTokensTab /> );
		const dialog = await openCreateDialog();
		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: 'satellite.example' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Generate token' } )
		);

		expect(
			await within( dialog ).findByText( 'Invalid parameter(s): scopes', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect( within( dialog ).getByLabelText( 'Label' ) ).toHaveValue(
			'satellite.example'
		);
		expect(
			within( dialog ).getByRole( 'button', { name: 'Generate token' } )
		).toBeEnabled();
	} );

	it( 'confirms a revoke by naming the token and what stops working', async () => {
		let revoked = false;
		mockApi( {
			GET: () =>
				Promise.resolve( [
					revoked ? { ...ACTIVE, status: 'revoked' } : ACTIVE,
				] ),
			DELETE: () => {
				revoked = true;
				return Promise.resolve( { ...ACTIVE, status: 'revoked' } );
			},
		} );

		render( <ApiTokensTab /> );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Revoke' } )
		);

		const dialog = await screen.findByRole( 'dialog', {
			name: 'Revoke API token',
		} );
		expect(
			within( dialog ).getByText(
				'Revoke the API token "satellite.example"? Every site connected with it loses access to this site\'s transactions immediately. This cannot be undone.'
			)
		).toBeInTheDocument();
		// Nothing is revoked until the action is confirmed.
		expect( callsWith( 'DELETE' ) ).toHaveLength( 0 );

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( callsWith( 'DELETE' ) ).toHaveLength( 0 );

		fireEvent.click( screen.getByRole( 'button', { name: 'Revoke' } ) );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Revoke token' } )
		);

		expect(
			await screen.findByText( 'API token "satellite.example" revoked.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect( callsWith( 'DELETE' ) ).toEqual( [
			{ path: `${ TOKENS_PATH }/2`, method: 'DELETE' },
		] );
		expect( await screen.findByText( 'Revoked' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Revoke' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the revoke dialog open with the reason when revoking fails', async () => {
		mockApi( {
			GET: () => Promise.resolve( [ ACTIVE ] ),
			DELETE: () => Promise.reject( new Error( 'API token not found.' ) ),
		} );

		render( <ApiTokensTab /> );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Revoke' } )
		);
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Revoke token' } )
		);

		const dialog = screen.getByRole( 'dialog', {
			name: 'Revoke API token',
		} );
		expect(
			await within( dialog ).findByText( 'API token not found.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Revoke token' } )
		).toBeEnabled();
		expect( screen.getByText( 'Active' ) ).toBeInTheDocument();
	} );
} );
