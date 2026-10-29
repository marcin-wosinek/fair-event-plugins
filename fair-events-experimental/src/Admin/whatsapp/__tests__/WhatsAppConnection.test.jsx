/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import WhatsAppConnection, {
	errorDetail,
	tokenStatus,
} from '../WhatsAppConnection.js';

jest.mock( '@wordpress/api-fetch' );

const PATH = '/fair-events-experimental/v1/whatsapp';

const VALIDATION = {
	validated_at: '2026-10-28 10:00:00',
	validated_at_local: 'October 28, 2026 11:00 am',
	sender: {
		display_phone_number: '+34 600 000 002',
		verified_name: 'Fair Events',
		quality_rating: 'GREEN',
	},
};

const WEBHOOK = {
	app_secret: {
		configured: false,
		source: 'none',
		override_name: 'FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_APP_SECRET',
	},
	verify_token: {
		configured: false,
		source: 'none',
		override_name: 'FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_VERIFY_TOKEN',
	},
	callback_url:
		'http://example.test/wp-json/fair-events-experimental/v1/whatsapp/webhook',
	verified_at_local: null,
	received_at_local: null,
};

const NO_DELIVERIES = { items: [], retention_days: 30, webhook: WEBHOOK };

const TEMPLATES = [
	{ name: 'hello_world', language: 'en_US', category: 'UTILITY' },
];

function config( overrides ) {
	return {
		waba_id: '100000000000001',
		phone_number_id: '200000000000002',
		token_configured: true,
		token_source: 'database',
		token_override_name: 'FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_ACCESS_TOKEN',
		connectors_url: 'http://example.test/wp-admin/options-connectors.php',
		validation: null,
		webhook: WEBHOOK,
		...overrides,
	};
}

function apiError( code, message, data = {} ) {
	return Object.assign( new Error( message ), { code, data } );
}

/**
 * Answer apiFetch calls by method and path.
 *
 * @param {Object} routes `"METHOD path"` → value or function( options ).
 */
function mockApi( routes ) {
	const all = {
		[ `GET ${ PATH }/deliveries` ]: NO_DELIVERIES,
		...routes,
	};
	apiFetch.mockImplementation( ( options ) => {
		const key = `${ options.method || 'GET' } ${ options.path }`;
		if ( ! ( key in all ) ) {
			return Promise.reject( new Error( `Unexpected ${ key }` ) );
		}
		const route = all[ key ];
		try {
			const value =
				typeof route === 'function' ? route( options ) : route;
			return Promise.resolve( value );
		} catch ( error ) {
			return Promise.reject( error );
		}
	} );
}

function calls( method, path ) {
	return apiFetch.mock.calls.filter(
		( [ options ] ) =>
			( options.method || 'GET' ) === method && options.path === path
	);
}

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'tokenStatus', () => {
	it( 'warns when no token is configured', () => {
		expect(
			tokenStatus( config( { token_configured: false } ) ).status
		).toBe( 'warning' );
	} );

	it( 'names the override that supplies the token', () => {
		expect(
			tokenStatus( config( { token_source: 'env' } ) ).message
		).toContain( 'FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_ACCESS_TOKEN' );
	} );
} );

describe( 'errorDetail', () => {
	it( "joins Meta's error code and trace ID", () => {
		expect( errorDetail( { meta_code: 190, trace_id: 'AbC' } ) ).toBe(
			'Meta error code: 190 · Trace ID: AbC'
		);
		expect( errorDetail( {} ) ).toBe( '' );
	} );
} );

describe( 'WhatsAppConnection', () => {
	it( 'explains that the IDs are not the telephone number', async () => {
		mockApi( { [ `GET ${ PATH }` ]: config() } );

		render( <WhatsAppConnection onNotice={ () => {} } /> );

		expect(
			await screen.findByLabelText( 'WhatsApp Business Account ID' )
		).toHaveValue( '100000000000001' );
		expect(
			screen.getByText( /It is an account ID, not a telephone number/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( /It differs from the telephone number itself/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Settings saved, not validated.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: /Manage in Connectors/ } )
		).toHaveAttribute(
			'href',
			'http://example.test/wp-admin/options-connectors.php'
		);
	} );

	it( 'saves trimmed IDs and blocks validation while there are unsaved edits', async () => {
		const onNotice = jest.fn();
		mockApi( {
			[ `GET ${ PATH }` ]: config(),
			[ `POST ${ PATH }` ]: ( { data } ) => config( data ),
		} );

		render( <WhatsAppConnection onNotice={ onNotice } /> );

		const phone = await screen.findByLabelText( 'Phone Number ID' );
		fireEvent.change( phone, { target: { value: ' 200000000000003 ' } } );

		expect(
			screen.getByRole( 'button', { name: 'Validate connection' } )
		).toBeDisabled();
		expect(
			screen.getByText( /Save or discard your changes before validating/ )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Save settings' } )
			);
		} );

		expect( calls( 'POST', PATH )[ 0 ][ 0 ].data ).toEqual( {
			waba_id: '100000000000001',
			phone_number_id: '200000000000003',
		} );
		expect( onNotice ).toHaveBeenCalledWith(
			expect.objectContaining( { status: 'success' } )
		);
		expect(
			screen.getByRole( 'button', { name: 'Validate connection' } )
		).toBeEnabled();
	} );

	it( 'refuses an ID with anything but digits', async () => {
		mockApi( { [ `GET ${ PATH }` ]: config() } );

		render( <WhatsAppConnection onNotice={ () => {} } /> );

		const waba = await screen.findByLabelText(
			'WhatsApp Business Account ID'
		);
		fireEvent.change( waba, { target: { value: '+34 600 000 002' } } );

		expect( screen.getByText( 'Use digits only.' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save settings' } )
		).toBeDisabled();
	} );

	it( 'says why validation is unavailable without a token', async () => {
		mockApi( {
			[ `GET ${ PATH }` ]: config( { token_configured: false } ),
		} );

		render( <WhatsAppConnection onNotice={ () => {} } /> );

		expect(
			await screen.findByText(
				'Add a WhatsApp access token in Connectors before validating the connection.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Validate connection' } )
		).toBeDisabled();
	} );

	it( 'shows the sender after validation and loads templates', async () => {
		mockApi( {
			[ `GET ${ PATH }` ]: config(),
			[ `POST ${ PATH }/validate` ]: config( {
				validation: VALIDATION,
			} ),
			[ `GET ${ PATH }/templates` ]: TEMPLATES,
		} );

		render( <WhatsAppConnection onNotice={ () => {} } /> );

		const validate = await screen.findByRole( 'button', {
			name: 'Validate connection',
		} );
		await act( async () => {
			fireEvent.click( validate );
		} );

		expect(
			screen.getByText(
				'Connection validated: messages are sent as Fair Events (+34 600 000 002). Checked on October 28, 2026 11:00 am.'
			)
		).toBeInTheDocument();
		expect(
			await screen.findByRole( 'option', {
				name: 'hello_world (en_US)',
			} )
		).toBeInTheDocument();
	} );

	it( 'shows an actionable validation error with Meta details', async () => {
		mockApi( {
			[ `GET ${ PATH }` ]: config( { validation: VALIDATION } ),
			[ `GET ${ PATH }/templates` ]: TEMPLATES,
			[ `POST ${ PATH }/validate` ]: () => {
				throw apiError(
					'whatsapp_phone_number_mismatch',
					'This Phone Number ID belongs to a different WhatsApp Business Account.',
					{ meta_code: null, trace_id: 'AbC' }
				);
			},
		} );

		render( <WhatsAppConnection onNotice={ () => {} } /> );
		await screen.findByText( /Connection validated/ );

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Validate connection' } )
			);
		} );

		expect(
			screen.getByText(
				'This Phone Number ID belongs to a different WhatsApp Business Account.'
			)
		).toBeInTheDocument();
		expect( screen.getByText( 'Trace ID: AbC' ) ).toBeInTheDocument();
		// The earlier validation no longer applies.
		expect(
			screen.queryByText( /Connection validated/ )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Send test template' } )
		).toBeDisabled();
	} );

	it( 'sends a test only after the recipient authorization, and asks again next time', async () => {
		mockApi( {
			[ `GET ${ PATH }` ]: config( { validation: VALIDATION } ),
			[ `GET ${ PATH }/templates` ]: TEMPLATES,
			[ `POST ${ PATH }/test` ]: {
				outcome: 'accepted',
				message_status: 'accepted',
				recipient: '••••••••123',
				template: { name: 'hello_world', language: 'en_US' },
			},
		} );

		render( <WhatsAppConnection onNotice={ () => {} } /> );
		await screen.findByRole( 'option', { name: 'hello_world (en_US)' } );

		fireEvent.change( screen.getByLabelText( 'Template' ), {
			target: { value: 'hello_world|en_US' },
		} );
		fireEvent.change( screen.getByLabelText( 'Recipient number' ), {
			target: { value: '+34 600 000 123' },
		} );
		const send = screen.getByRole( 'button', {
			name: 'Send test template',
		} );
		expect( send ).toBeDisabled();
		expect(
			screen.getByText(
				'Confirm that the recipient agreed to receive this test message.'
			)
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByLabelText(
				'The recipient agreed to receive this test message.'
			)
		);
		expect( send ).toBeEnabled();

		await act( async () => {
			fireEvent.click( send );
		} );

		expect( calls( 'POST', `${ PATH }/test` )[ 0 ][ 0 ].data ).toEqual( {
			recipient: '+34 600 000 123',
			template_name: 'hello_world',
			template_language: 'en_US',
			authorized: true,
		} );
		expect(
			screen.getByRole( 'heading', { name: 'Accepted by WhatsApp' } )
		).toBeInTheDocument();
		expect(
			screen.getByText( /This does not confirm delivery/ )
		).toBeInTheDocument();
		expect(
			screen.getByLabelText(
				'The recipient agreed to receive this test message.'
			)
		).not.toBeChecked();
		expect( send ).toBeDisabled();
	} );

	it( 'reports an uncertain send without claiming success', async () => {
		mockApi( {
			[ `GET ${ PATH }` ]: config( { validation: VALIDATION } ),
			[ `GET ${ PATH }/templates` ]: TEMPLATES,
			[ `POST ${ PATH }/test` ]: () => {
				throw apiError(
					'whatsapp_transport',
					'WhatsApp did not confirm the message, so it may or may not have been sent.',
					{ outcome: 'uncertain' }
				);
			},
		} );

		render( <WhatsAppConnection onNotice={ () => {} } /> );
		await screen.findByRole( 'option', { name: 'hello_world (en_US)' } );
		fireEvent.change( screen.getByLabelText( 'Template' ), {
			target: { value: 'hello_world|en_US' },
		} );
		fireEvent.change( screen.getByLabelText( 'Recipient number' ), {
			target: { value: '+34 600 000 123' },
		} );
		fireEvent.click(
			screen.getByLabelText(
				'The recipient agreed to receive this test message.'
			)
		);

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Send test template' } )
			);
		} );

		expect(
			screen.getByRole( 'heading', { name: 'Outcome unknown' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'heading', { name: 'Accepted by WhatsApp' } )
		).not.toBeInTheDocument();
		expect( calls( 'POST', `${ PATH }/test` ) ).toHaveLength( 1 );
	} );

	it( 'says when the account has no template it can send', async () => {
		mockApi( {
			[ `GET ${ PATH }` ]: config( { validation: VALIDATION } ),
			[ `GET ${ PATH }/templates` ]: [],
		} );

		render( <WhatsAppConnection onNotice={ () => {} } /> );

		expect(
			await screen.findByText(
				/This account has no approved templates without parameters/
			)
		).toBeInTheDocument();
	} );

	it( 'reloads the delivery history after a send', async () => {
		mockApi( {
			[ `GET ${ PATH }` ]: config( { validation: VALIDATION } ),
			[ `GET ${ PATH }/templates` ]: TEMPLATES,
			[ `POST ${ PATH }/test` ]: {
				outcome: 'accepted',
				message_status: 'accepted',
				recipient: '••••••••123',
				delivery_id: 7,
				template: { name: 'hello_world', language: 'en_US' },
			},
		} );

		render( <WhatsAppConnection onNotice={ () => {} } /> );
		await screen.findByRole( 'option', { name: 'hello_world (en_US)' } );
		expect(
			await screen.findByText( 'No messages sent yet.' )
		).toBeInTheDocument();
		const before = calls( 'GET', `${ PATH }/deliveries` ).length;

		fireEvent.change( screen.getByLabelText( 'Template' ), {
			target: { value: 'hello_world|en_US' },
		} );
		fireEvent.change( screen.getByLabelText( 'Recipient number' ), {
			target: { value: '+34 600 000 123' },
		} );
		fireEvent.click(
			screen.getByLabelText(
				'The recipient agreed to receive this test message.'
			)
		);
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Send test template' } )
			);
		} );

		expect( calls( 'GET', `${ PATH }/deliveries` ) ).toHaveLength(
			before + 1
		);
	} );

	it( 'shows the webhook setup with the callback URL', async () => {
		mockApi( { [ `GET ${ PATH }` ]: config() } );

		render( <WhatsAppConnection onNotice={ () => {} } /> );

		expect( await screen.findByLabelText( 'Callback URL' ) ).toHaveValue(
			WEBHOOK.callback_url
		);
		// Notice repeats its text in the a11y live region.
		expect(
			screen.getAllByText(
				/Verification alone does not show that updates arrive/
			)[ 0 ]
		).toBeInTheDocument();
	} );
} );
