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
 *   - Pending creation (#1942): the dialog can't be dismissed and a repeated
 *     submission can't issue a second token while the token is generated;
 *     a failure keeps the input for a retry and stale errors are cleared.
 *   - Revocation: a dialog names the token and what revoking breaks.
 */
import '@testing-library/jest-dom';
import {
	act,
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

/**
 * A promise the test settles by hand, to hold a request in flight.
 *
 * @return {{promise: Promise, resolve: Function, reject: Function}} Deferred
 */
function deferred() {
	const handle = {};
	handle.promise = new Promise( ( resolve, reject ) => {
		handle.resolve = resolve;
		handle.reject = reject;
	} );
	return handle;
}

/**
 * Press and release the primary button on the overlay around a modal. jsdom
 * has no PointerEvent, so mouse events carry the button the modal checks.
 *
 * @param {HTMLElement} dialog The dialog element.
 */
function pressOutside( dialog ) {
	const overlay = dialog.closest( '.components-modal__screen-overlay' );
	act( () => {
		for ( const type of [ 'pointerdown', 'pointerup' ] ) {
			overlay.dispatchEvent(
				new window.MouseEvent( type, { bubbles: true, button: 0 } )
			);
		}
	} );
}

/**
 * Try every way of dismissing a modal: Escape, its close button when it has
 * one, and a press on the overlay outside it.
 *
 * @param {HTMLElement} dialog The dialog element.
 */
async function tryToDismiss( dialog ) {
	fireEvent.keyDown( dialog, { key: 'Escape', code: 'Escape' } );
	const close = within( dialog ).queryByRole( 'button', { name: 'Close' } );
	if ( close ) {
		fireEvent.click( close );
	}
	pressOutside( dialog );
	// The modal closes after its exit animation promise settles.
	await act( async () => {} );
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

	it( 'can be dismissed from outside before generation starts', async () => {
		mockApi();

		render( <ApiTokensTab /> );
		const dialog = await openCreateDialog();
		pressOutside( dialog );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'stays open and busy while the token is generated, then shows it', async () => {
		const request = deferred();
		mockApi( { POST: () => request.promise } );

		render( <ApiTokensTab /> );
		const dialog = await openCreateDialog();
		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: 'satellite.example' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Generate token' } )
		);

		const busy = within( dialog ).getByRole( 'button', {
			name: 'Generating…',
		} );
		expect( busy ).toBeDisabled();
		expect( busy ).toHaveClass( 'is-busy' );
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect(
			within( dialog ).queryByRole( 'button', { name: 'Close' } )
		).not.toBeInTheDocument();
		expect( within( dialog ).getByLabelText( 'Label' ) ).toBeDisabled();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);
		await tryToDismiss( dialog );

		expect(
			screen.getByRole( 'dialog', { name: 'Generate API token' } )
		).toBeInTheDocument();

		await act( async () => {
			request.resolve( { ...ACTIVE, token: PLAINTEXT } );
		} );

		const result = await screen.findByRole( 'dialog', {
			name: 'Token created',
		} );
		expect( within( result ).getByText( PLAINTEXT ) ).toBeInTheDocument();
		expect( callsWith( 'POST' ) ).toHaveLength( 1 );

		// The token stays until the organizer dismisses the completed dialog.
		await act( async () => {} );
		expect( screen.getByText( PLAINTEXT ) ).toBeInTheDocument();
		fireEvent.click(
			within( result ).getByRole( 'button', { name: 'Done' } )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( screen.queryByText( PLAINTEXT ) ).not.toBeInTheDocument();
	} );

	it( 'sends one request when the form is submitted repeatedly before a re-render', async () => {
		const request = deferred();
		mockApi( { POST: () => request.promise } );

		render( <ApiTokensTab /> );
		const dialog = await openCreateDialog();
		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: 'satellite.example' },
		} );
		const submit = within( dialog ).getByRole( 'button', {
			name: 'Generate token',
		} );
		const form = submit.closest( 'form' );

		// Within one act React doesn't re-render between the events, so each
		// handler still sees the idle form, as with a fast double click or
		// a repeated Enter.
		act( () => {
			fireEvent.click( submit );
			fireEvent.click( submit );
			fireEvent.submit( form );
		} );

		expect( callsWith( 'POST' ) ).toHaveLength( 1 );

		await act( async () => {
			request.resolve( { ...ACTIVE, token: PLAINTEXT } );
		} );
		expect( await screen.findByText( PLAINTEXT ) ).toBeInTheDocument();
		expect( callsWith( 'POST' ) ).toHaveLength( 1 );
	} );

	it( 'keeps the input after failures, clears stale errors and retries', async () => {
		const attempts = [
			() => Promise.reject( new Error( 'Invalid parameter(s): scopes' ) ),
			() => second.promise,
			() => Promise.resolve( { ...ACTIVE, token: PLAINTEXT } ),
		];
		const second = deferred();
		mockApi( { POST: () => attempts.shift()() } );

		render( <ApiTokensTab /> );
		let dialog = await openCreateDialog();
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
			within( dialog ).getByRole( 'checkbox', {
				name: 'Read transactions',
			} )
		).toBeChecked();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeEnabled();

		// Retrying clears the previous error while the new attempt runs.
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Generate token' } )
		);
		expect(
			within( dialog ).queryByText( 'Invalid parameter(s): scopes', {
				selector: '.components-notice__content',
			} )
		).not.toBeInTheDocument();

		// Without a server message, a translated fallback is shown.
		await act( async () => {
			second.reject( {} );
		} );
		expect(
			await within( dialog ).findByText( 'Failed to create API token.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();

		// Cancelling after a failure is allowed; reopening starts clean.
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		dialog = await openCreateDialog();
		expect(
			within( dialog ).queryByText( 'Failed to create API token.', {
				selector: '.components-notice__content',
			} )
		).not.toBeInTheDocument();
		expect( within( dialog ).getByLabelText( 'Label' ) ).toHaveValue( '' );

		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: 'satellite.example' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Generate token' } )
		);
		expect( await screen.findByText( PLAINTEXT ) ).toBeInTheDocument();
		expect( callsWith( 'POST' ) ).toHaveLength( 3 );
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
