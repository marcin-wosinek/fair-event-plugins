/**
 * @jest-environment jsdom
 *
 * Component tests for the Custom Mail page (#1784):
 *   - standalone Fair Audience requires an event and hides the experimental
 *     integrations (all-audience sends, groups, photo upload links);
 *   - the recipient preview follows the selection and ignores answers to
 *     requests the organizer has moved on from;
 *   - exclusions and validation gate the send, which fires once per click;
 *   - partial, total and uncertain failures are reported distinctly, as is a
 *     message that was sent but not saved to history;
 *   - deleting a history record goes through a confirmation dialog.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
	act,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import CustomMail from '../CustomMail.js';

jest.mock( '@wordpress/api-fetch' );

const EVENTS = [
	{ id: 16, event_id: 21, display_label: 'Workshop (April 4, 2039)' },
	{ id: 18, event_id: 22, display_label: 'Concert (January 1, 2036)' },
];

const HISTORY = [
	{
		id: 5,
		subject: 'What to bring',
		content: '<p>Bring water.</p>',
		event_id: 21,
		event_date_id: 16,
		event_title: 'Workshop',
		is_marketing: true,
		sent_count: 2,
		failed_count: 0,
		skipped_count: 1,
		created_at: '2026-10-12 03:58:51',
	},
];

function recipient( id, name, overrides = {} ) {
	return {
		participant_id: id,
		name,
		surname: '',
		email: `${ name.toLowerCase() }@example.test`,
		label: 'signed_up',
		has_valid_email: true,
		would_skip_marketing: false,
		...overrides,
	};
}

const WORKSHOP_RECIPIENTS = [
	recipient( 1, 'Ana' ),
	recipient( 2, 'Bruno' ),
	recipient( 3, 'Carla', { would_skip_marketing: true } ),
	recipient( 4, 'Dario', { email: '', has_valid_email: false } ),
];

const SENT_OK = {
	success: true,
	history_saved: true,
	sent_count: 2,
	failed_count: 0,
	skipped_count: 0,
	sent: [ 'ana@example.test', 'bruno@example.test' ],
	failed: [],
	skipped: [],
};

/**
 * Route apiFetch by path and method. `handlers.preview` and `handlers.send`
 * receive the request data and return (a promise of) the response.
 *
 * @param {Object} handlers Overrides for individual endpoints.
 */
function mockApi( handlers = {} ) {
	apiFetch.mockImplementation( ( { path, method = 'GET', data } ) => {
		if ( path === '/fair-audience/v1/custom-mail/events' ) {
			return Promise.resolve( handlers.events || EVENTS );
		}
		if ( path === '/fair-audience/v1/custom-mail/groups' ) {
			return Promise.resolve( handlers.groups || [] );
		}
		if ( path === '/fair-audience/v1/custom-mail/preview' ) {
			return Promise.resolve(
				handlers.preview
					? handlers.preview( data )
					: WORKSHOP_RECIPIENTS
			);
		}
		if ( path === '/fair-audience/v1/custom-mail' && method === 'POST' ) {
			return Promise.resolve(
				handlers.send ? handlers.send( data ) : SENT_OK
			);
		}
		if ( path === '/fair-audience/v1/custom-mail' ) {
			return Promise.resolve( handlers.history || HISTORY );
		}
		if ( method === 'DELETE' ) {
			return Promise.resolve( { success: true } );
		}
		return Promise.resolve( [] );
	} );
}

function callsTo( path, method = 'GET' ) {
	return apiFetch.mock.calls
		.map( ( [ options ] ) => options )
		.filter(
			( options ) =>
				options.path === path && ( options.method || 'GET' ) === method
		);
}

// Notices also announce their text in a live region for screen readers, so
// a message can legitimately appear twice.
const findText = async ( text ) => ( await screen.findAllByText( text ) )[ 0 ];
const getText = ( text ) => screen.getAllByText( text )[ 0 ];

async function renderPage() {
	render( <CustomMail /> );
	await screen.findByRole( 'combobox', { name: 'Event' } );
}

function selectEvent( id ) {
	fireEvent.change( screen.getByRole( 'combobox', { name: 'Event' } ), {
		target: { value: String( id ) },
	} );
}

function writeMessage( subject = 'Hello', content = '<p>See you soon.</p>' ) {
	fireEvent.change( screen.getByRole( 'textbox', { name: 'Subject' } ), {
		target: { value: subject },
	} );
	fireEvent.change( screen.getByLabelText( 'Content' ), {
		target: { value: content },
	} );
}

const sendButton = () => screen.getByRole( 'button', { name: 'Send email' } );

beforeEach( () => {
	apiFetch.mockReset();
	delete window.fairAudienceCustomMailData;
	window.scrollTo = jest.fn();
} );

describe( 'standalone Fair Audience', () => {
	it( 'requires an event and hides the experimental integrations', async () => {
		mockApi();
		await renderPage();

		expect(
			screen.getByRole( 'option', { name: 'Select an event…' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'option', { name: 'All audience' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Insert photo upload link' } )
		).not.toBeInTheDocument();
		expect( screen.queryByText( 'Groups' ) ).not.toBeInTheDocument();

		// Groups are never requested, and nothing is previewed without an event.
		expect(
			callsTo( '/fair-audience/v1/custom-mail/groups' )
		).toHaveLength( 0 );
		expect(
			callsTo( '/fair-audience/v1/custom-mail/preview', 'POST' )
		).toHaveLength( 0 );

		writeMessage();
		expect( sendButton() ).toBeDisabled();
		expect(
			getText(
				'Select the event whose participants should receive this email.'
			)
		).toBeInTheDocument();
	} );

	it( 'previews and sends to the selected occurrence only', async () => {
		mockApi();
		await renderPage();

		selectEvent( 16 );
		await findText( '2 people will receive this email.' );

		const [ previewCall ] = callsTo(
			'/fair-audience/v1/custom-mail/preview',
			'POST'
		);
		expect( previewCall.data ).toEqual( {
			is_marketing: true,
			event_date_id: 16,
			labels: [ 'signed_up', 'collaborator' ],
		} );

		expect( getText( 'No marketing consent' ) ).toBeInTheDocument();
		expect( getText( 'No valid email address' ) ).toBeInTheDocument();

		writeMessage();
		fireEvent.click( sendButton() );

		await findText( '2 emails were sent.' );
		const [ sendCall ] = callsTo( '/fair-audience/v1/custom-mail', 'POST' );
		expect( sendCall.data ).toEqual( {
			subject: 'Hello',
			content: '<p>See you soon.</p>',
			is_marketing: true,
			skip_participant_ids: [],
			event_date_id: 16,
			labels: [ 'signed_up', 'collaborator' ],
		} );

		// The form is cleared so the same email is not sent twice by accident.
		expect(
			screen.getByRole( 'textbox', { name: 'Subject' } )
		).toHaveValue( '' );
	} );
} );

describe( 'recipient preview', () => {
	it( 'ignores the answer to a selection the organizer moved on from', async () => {
		let resolveWorkshop;
		mockApi( {
			preview: ( data ) =>
				data.event_date_id === 16
					? new Promise( ( resolve ) => {
							resolveWorkshop = resolve;
					  } )
					: [ recipient( 9, 'Felix' ) ],
		} );
		await renderPage();

		selectEvent( 16 );
		await waitFor( () => expect( resolveWorkshop ).toBeDefined() );
		selectEvent( 18 );
		await findText( 'Felix' );

		// The slow answer for the first event arrives last.
		await act( async () => {
			resolveWorkshop( WORKSHOP_RECIPIENTS );
		} );

		expect( getText( 'Felix' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Ana' ) ).not.toBeInTheDocument();
		expect(
			getText( '1 person will receive this email.' )
		).toBeInTheDocument();
	} );

	it( 'sends the organizer’s exclusions and blocks a send that reaches no one', async () => {
		mockApi();
		await renderPage();
		selectEvent( 16 );
		await findText( '2 people will receive this email.' );
		writeMessage();

		// People who cannot receive the email cannot be toggled.
		expect(
			screen.getByRole( 'checkbox', { name: 'Do not send to Carla' } )
		).toBeDisabled();

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Do not send to Ana' } )
		);
		expect(
			getText( '1 person will receive this email.' )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Do not send to Bruno' } )
		);
		expect( sendButton() ).toBeDisabled();
		expect(
			getText( 'No one would receive this email.' )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Do not send to Bruno' } )
		);
		fireEvent.click( sendButton() );
		await findText( '2 emails were sent.' );

		const [ sendCall ] = callsTo( '/fair-audience/v1/custom-mail', 'POST' );
		expect( sendCall.data.skip_participant_ids ).toEqual( [ 1 ] );
	} );
} );

describe( 'validation', () => {
	it( 'explains why an incomplete email cannot be sent', async () => {
		mockApi();
		await renderPage();
		selectEvent( 16 );
		await findText( '2 people will receive this email.' );

		expect( sendButton() ).toBeDisabled();
		expect( getText( 'Enter a subject.' ) ).toBeInTheDocument();

		writeMessage( '   ', '<p>Text</p>' );
		expect( getText( 'Enter a subject.' ) ).toBeInTheDocument();

		// Markup the editor leaves behind when emptied is not content.
		writeMessage( 'Hello', '<p>&nbsp;</p>' );
		expect( sendButton() ).toBeDisabled();
		expect( getText( 'Write the email content.' ) ).toBeInTheDocument();

		writeMessage( 'Hello', '<a href="{photo_upload_url}">Upload</a>' );
		expect( sendButton() ).toBeDisabled();
		expect( getText( /contains a photo upload link/ ) ).toBeInTheDocument();

		writeMessage( 'Hello', '<p>Text</p>' );
		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Participants' } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Collaborators' } )
		);
		expect(
			getText( 'Select at least one audience type.' )
		).toBeInTheDocument();
		expect( sendButton() ).toBeDisabled();

		expect(
			callsTo( '/fair-audience/v1/custom-mail', 'POST' )
		).toHaveLength( 0 );
	} );
} );

describe( 'optional integrations', () => {
	it( 'offers all-audience sends, groups and photo links when available', async () => {
		window.fairAudienceCustomMailData = {
			allAudience: true,
			groups: true,
			photoUpload: true,
		};
		mockApi( {
			groups: [ { id: 7, name: 'Volunteers', member_count: 3 } ],
			preview: () => [ recipient( 1, 'Ana' ) ],
		} );
		await renderPage();

		expect(
			screen.getByRole( 'option', { name: 'All audience' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Insert photo upload link' } )
		).toBeInTheDocument();

		// The whole audience is previewed without picking an event.
		await findText( '1 person will receive this email.' );

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Volunteers (3)' } )
		);
		await waitFor( () =>
			expect(
				callsTo( '/fair-audience/v1/custom-mail/preview', 'POST' ).pop()
					.data
			).toEqual( { is_marketing: true, group_ids: [ 7 ] } )
		);

		writeMessage( 'Hello', '<a href="{photo_upload_url}">Upload</a>' );
		await waitFor( () => expect( sendButton() ).toBeEnabled() );
	} );
} );

describe( 'sending', () => {
	async function readyToSend( handlers ) {
		mockApi( handlers );
		await renderPage();
		selectEvent( 16 );
		await findText( '2 people will receive this email.' );
		writeMessage();
	}

	it( 'sends once when the button is pressed repeatedly', async () => {
		let resolveSend;
		await readyToSend( {
			send: () =>
				new Promise( ( resolve ) => {
					resolveSend = resolve;
				} ),
		} );

		const form = sendButton().closest( 'form' );
		fireEvent.submit( form );
		fireEvent.submit( form );
		fireEvent.submit( form );

		expect(
			callsTo( '/fair-audience/v1/custom-mail', 'POST' )
		).toHaveLength( 1 );
		expect(
			screen.getByRole( 'button', { name: 'Sending…' } )
		).toBeDisabled();

		await act( async () => {
			resolveSend( SENT_OK );
		} );
		await findText( '2 emails were sent.' );
	} );

	it( 'lists who could not be reached after a partial failure', async () => {
		await readyToSend( {
			send: () => ( {
				...SENT_OK,
				sent_count: 1,
				failed_count: 1,
				skipped_count: 1,
				sent: [ 'ana@example.test' ],
				failed: [
					{
						name: 'Bruno',
						email: 'bruno@example.test',
						reason: 'wp_mail() failed to send.',
					},
				],
				skipped: [
					{
						name: 'Carla',
						email: 'carla@example.test',
						reason: 'No marketing consent.',
					},
				],
			} ),
		} );
		fireEvent.click( sendButton() );

		await findText( '1 email was sent.' );
		expect( getText( '1 email could not be sent:' ) ).toBeInTheDocument();
		expect(
			getText( 'Bruno — bruno@example.test: wp_mail() failed to send.' )
		).toBeInTheDocument();
		expect(
			getText( 'Carla — carla@example.test: No marketing consent.' )
		).toBeInTheDocument();
		expect(
			getText( /would also reach the people who already received/ )
		).toBeInTheDocument();
	} );

	it( 'says so when nothing was sent', async () => {
		await readyToSend( {
			send: () => ( {
				...SENT_OK,
				sent_count: 0,
				failed_count: 2,
				sent: [],
				failed: [
					{
						name: 'Ana',
						email: 'ana@example.test',
						reason: 'Failed.',
					},
					{
						name: 'Bruno',
						email: 'bruno@example.test',
						reason: 'Failed.',
					},
				],
			} ),
		} );
		fireEvent.click( sendButton() );

		await findText( 'No emails were sent.' );
		expect( getText( '2 emails could not be sent:' ) ).toBeInTheDocument();
	} );

	it( 'warns against resending when the message was not saved to history', async () => {
		await readyToSend( {
			send: () => ( { ...SENT_OK, history_saved: false } ),
		} );
		fireEvent.click( sendButton() );

		await findText( '2 emails were sent.' );
		expect(
			getText( /could not be saved to Mail History/ )
		).toBeInTheDocument();
	} );

	it( 'shows the server’s reason and keeps the draft when the request is rejected', async () => {
		await readyToSend( {
			send: () =>
				Promise.reject( {
					code: 'invalid_event_date',
					message: 'Event date not found.',
					data: { status: 404 },
				} ),
		} );
		fireEvent.click( sendButton() );

		await findText( 'Event date not found.' );
		expect(
			screen.getByRole( 'textbox', { name: 'Subject' } )
		).toHaveValue( 'Hello' );
	} );

	it( 'does not retry and points to history when the outcome is unknown', async () => {
		await readyToSend( {
			send: () => Promise.reject( { message: 'Failed to fetch' } ),
		} );
		fireEvent.click( sendButton() );

		await findText(
			/some emails may already have been sent\. Check Mail History/
		);
		expect(
			callsTo( '/fair-audience/v1/custom-mail', 'POST' )
		).toHaveLength( 1 );
		expect(
			screen.getByRole( 'textbox', { name: 'Subject' } )
		).toHaveValue( 'Hello' );
	} );
} );

describe( 'mail history', () => {
	it( 'shows records from before the move and reuses one as a draft', async () => {
		mockApi( {
			history: [
				...HISTORY,
				{
					...HISTORY[ 0 ],
					id: 4,
					subject: 'Autumn programme',
					event_id: null,
					event_date_id: null,
					event_title: '',
				},
			],
		} );
		await renderPage();

		const row = getText( 'Autumn programme' ).closest( 'tr' );
		expect( within( row ).getByText( 'All audience' ) ).toBeInTheDocument();

		const workshopRow = getText( 'What to bring' ).closest( 'tr' );
		fireEvent.click(
			within( workshopRow ).getByRole( 'button', { name: 'Duplicate' } )
		);

		expect(
			screen.getByRole( 'textbox', { name: 'Subject' } )
		).toHaveValue( 'What to bring' );
		expect( screen.getByLabelText( 'Content' ) ).toHaveValue(
			'<p>Bring water.</p>'
		);
		expect( screen.getByRole( 'combobox', { name: 'Event' } ) ).toHaveValue(
			'16'
		);

		// The duplicated event's recipients are previewed.
		await findText( '2 people will receive this email.' );
	} );

	it( 'deletes a record only after confirmation', async () => {
		mockApi();
		await renderPage();

		fireEvent.click( screen.getByRole( 'button', { name: 'Delete' } ) );
		const dialog = await screen.findByRole( 'dialog' );
		expect(
			within( dialog ).getByText( /Delete the record of “What to bring”/ )
		).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);
		expect(
			callsTo( '/fair-audience/v1/custom-mail/5', 'DELETE' )
		).toHaveLength( 0 );

		fireEvent.click( screen.getByRole( 'button', { name: 'Delete' } ) );
		fireEvent.click(
			within( await screen.findByRole( 'dialog' ) ).getByRole( 'button', {
				name: 'Delete record',
			} )
		);
		await findText( 'The record was deleted.' );
		expect(
			callsTo( '/fair-audience/v1/custom-mail/5', 'DELETE' )
		).toHaveLength( 1 );
	} );
} );
