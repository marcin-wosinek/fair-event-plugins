/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import WebhookSetup, {
	credentialHelp,
	webhookProgress,
} from '../WebhookSetup.js';

jest.mock( '@wordpress/api-fetch' );

const PATH = '/fair-events-experimental/v1/whatsapp/webhook-credentials';

function credential( overrides ) {
	return {
		configured: false,
		source: 'none',
		override_name: 'FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_APP_SECRET',
		...overrides,
	};
}

function webhook( overrides ) {
	return {
		app_secret: credential(),
		verify_token: credential( {
			override_name: 'FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_VERIFY_TOKEN',
		} ),
		callback_url:
			'http://example.test/wp-json/fair-events-experimental/v1/whatsapp/webhook',
		verified_at_local: null,
		received_at_local: null,
		...overrides,
	};
}

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'credentialHelp', () => {
	it( 'names an override and never the value', () => {
		expect(
			credentialHelp( credential( { configured: true, source: 'env' } ) )
		).toContain( 'FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_APP_SECRET' );
		expect(
			credentialHelp(
				credential( { configured: true, source: 'database' } )
			)
		).toBe( 'Saved, not shown. Enter a new value to replace it.' );
		expect( credentialHelp( credential() ) ).toBe( 'Not set.' );
	} );
} );

describe( 'webhookProgress', () => {
	it( 'keeps verification and event receipt apart', () => {
		const verifiedOnly = webhookProgress(
			webhook( { verified_at_local: 'October 29, 2026 9:00 am' } )
		);
		expect( verifiedOnly[ 0 ] ).toEqual(
			expect.objectContaining( { status: 'success' } )
		);
		expect( verifiedOnly[ 0 ].message ).toContain(
			'October 29, 2026 9:00 am'
		);
		expect( verifiedOnly[ 1 ].status ).toBe( 'warning' );
		expect( verifiedOnly[ 1 ].message ).toContain(
			'Verification alone does not show that updates arrive'
		);

		const both = webhookProgress(
			webhook( {
				verified_at_local: 'October 29, 2026 9:00 am',
				received_at_local: 'October 29, 2026 9:05 am',
			} )
		);
		expect( both[ 1 ].message ).toContain(
			'the last authenticated update for this account arrived on October 29, 2026 9:05 am'
		);
	} );
} );

describe( 'WebhookSetup', () => {
	it( 'saves only the entered credentials and clears the fields', async () => {
		const onSaved = jest.fn();
		const onNotice = jest.fn();
		const next = {
			webhook: webhook( {
				app_secret: credential( {
					configured: true,
					source: 'database',
				} ),
			} ),
		};
		apiFetch.mockResolvedValue( next );

		render(
			<WebhookSetup
				webhook={ webhook() }
				onSaved={ onSaved }
				onNotice={ onNotice }
			/>
		);

		const save = screen.getByRole( 'button', {
			name: 'Save webhook settings',
		} );
		expect( save ).toBeDisabled();
		expect(
			screen.getByText( 'Enter an App Secret or a verify token to save.' )
		).toBeInTheDocument();

		const secret = screen.getByLabelText( 'App Secret' );
		expect( secret ).toHaveAttribute( 'type', 'password' );
		fireEvent.change( secret, {
			target: { value: ' 0123456789abcdef0123456789abcdef ' },
		} );
		expect( save ).toBeEnabled();

		await act( async () => {
			fireEvent.click( save );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: PATH,
			method: 'POST',
			data: { app_secret: '0123456789abcdef0123456789abcdef' },
		} );
		expect( onSaved ).toHaveBeenCalledWith( next );
		expect( onNotice ).toHaveBeenCalledWith(
			expect.objectContaining( { status: 'success' } )
		);
		expect( secret ).toHaveValue( '' );
	} );

	it( 'removes a saved credential', async () => {
		apiFetch.mockResolvedValue( { webhook: webhook() } );

		render(
			<WebhookSetup
				webhook={ webhook( {
					verify_token: credential( {
						configured: true,
						source: 'database',
					} ),
				} ) }
				onSaved={ () => {} }
				onNotice={ () => {} }
			/>
		);

		expect(
			screen.queryByRole( 'button', {
				name: 'Remove the saved App Secret',
			} )
		).not.toBeInTheDocument();
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Remove the saved verify token',
				} )
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: PATH,
			method: 'POST',
			data: { verify_token: '' },
		} );
	} );

	it( 'keeps what was typed and shows the error when saving fails', async () => {
		apiFetch.mockRejectedValue(
			Object.assign( new Error( 'Invalid parameter(s): verify_token' ), {
				code: 'rest_invalid_param',
			} )
		);

		render(
			<WebhookSetup
				webhook={ webhook() }
				onSaved={ () => {} }
				onNotice={ () => {} }
			/>
		);

		fireEvent.change( screen.getByLabelText( 'Verify token' ), {
			target: { value: 'short' },
		} );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Save webhook settings' } )
			);
		} );

		// Notice repeats its text in the a11y live region.
		expect(
			screen.getAllByText( 'Invalid parameter(s): verify_token' )[ 0 ]
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Verify token' ) ).toHaveValue(
			'short'
		);
	} );
} );
