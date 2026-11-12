/**
 * @jest-environment jsdom
 *
 * Component tests for viewing a recorded Custom Mail message (#2164):
 *   - each history subject links to its own message, and following it shows
 *     that record's saved subject, body, audience, date and counts;
 *   - going there and back keeps the composer's draft and sends nothing;
 *   - a direct visit loads only the message, not the composer's data;
 *   - missing records and refused access show a notice with a way back;
 *   - Back and Forward follow the address.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	within,
	waitFor,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import CustomMailApp from '../CustomMailApp.js';

jest.mock( '@wordpress/api-fetch' );

const PAGE = '/wp-admin/admin.php?page=fair-audience-custom-mail';

const EVENTS = [
	{ id: 16, event_id: 21, display_label: 'Workshop (April 4, 2039)' },
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
		failed_count: 1,
		skipped_count: 3,
		created_at: '2026-10-12 03:58:51',
	},
	{
		id: 4,
		subject: 'Autumn programme',
		content: '<p>Hi {name}, <strong>new dates</strong> are out.</p>',
		event_id: null,
		event_date_id: null,
		event_title: '',
		is_marketing: false,
		sent_count: 40,
		failed_count: 0,
		skipped_count: 7,
		created_at: '2026-09-01 10:00:00',
	},
];

/**
 * Route apiFetch by path. `messages` maps an ID to a record or to an error
 * status the single-message endpoint answers with.
 *
 * @param {Object} messages Single-message answers by ID.
 */
function mockApi( messages = { 4: HISTORY[ 1 ], 5: HISTORY[ 0 ] } ) {
	apiFetch.mockImplementation( ( { path, method = 'GET' } ) => {
		if ( path === '/fair-audience/v1/custom-mail/events' ) {
			return Promise.resolve( EVENTS );
		}
		if ( path === '/fair-audience/v1/custom-mail/preview' ) {
			return Promise.resolve( [] );
		}
		if ( path === '/fair-audience/v1/custom-mail' && method === 'GET' ) {
			return Promise.resolve( HISTORY );
		}
		const match = path.match( /^\/fair-audience\/v1\/custom-mail\/(\d+)$/ );
		if ( match && method === 'GET' ) {
			const answer = messages[ match[ 1 ] ];
			if ( typeof answer === 'number' ) {
				return Promise.reject( {
					code: 'error',
					message: 'Request refused.',
					data: { status: answer },
				} );
			}
			return answer
				? Promise.resolve( answer )
				: Promise.reject( {
						code: 'not_found',
						message: 'Custom mail message not found.',
						data: { status: 404 },
					} );
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

const historyLink = ( name ) => screen.getByRole( 'link', { name } );

// jsdom traverses history asynchronously; wait until it has landed.
const arrivedAt = ( search ) =>
	waitFor( () => expect( window.location.search ).toBe( search ) );

beforeEach( () => {
	apiFetch.mockReset();
	delete window.fairAudienceCustomMailData;
	window.scrollTo = jest.fn();
	window.history.replaceState( null, '', PAGE );
} );

describe( 'opening a recorded message', () => {
	it( 'links every subject to its own message', async () => {
		mockApi();
		render( <CustomMailApp /> );
		await screen.findByRole( 'combobox', { name: 'Event' } );

		expect( historyLink( 'What to bring' ) ).toHaveAttribute(
			'href',
			`http://localhost${ PAGE }&message_id=5`
		);
		expect( historyLink( 'Autumn programme' ) ).toHaveAttribute(
			'href',
			`http://localhost${ PAGE }&message_id=4`
		);
	} );

	it( 'shows the saved message and keeps the draft on the way back', async () => {
		mockApi();
		render( <CustomMailApp /> );
		await screen.findByRole( 'combobox', { name: 'Event' } );

		fireEvent.change( screen.getByRole( 'textbox', { name: 'Subject' } ), {
			target: { value: 'Draft in progress' },
		} );
		fireEvent.change( screen.getByLabelText( 'Content' ), {
			target: { value: '<p>Half written.</p>' },
		} );

		fireEvent.click( historyLink( 'Autumn programme' ) );

		const heading = await screen.findByRole( 'heading', {
			level: 1,
			name: 'Autumn programme',
		} );
		expect( window.location.search ).toBe(
			'?page=fair-audience-custom-mail&message_id=4'
		);
		expect( callsTo( '/fair-audience/v1/custom-mail/4' ) ).toHaveLength(
			1
		);
		expect( callsTo( '/fair-audience/v1/custom-mail/5' ) ).toHaveLength(
			0
		);
		expect( heading ).toHaveFocus();

		// The hidden composer's history also has a "Sent to" column.
		const meta = screen
			.getAllByText( 'Sent to' )
			.find( ( node ) => node.tagName === 'DT' )
			.closest( 'dl' );
		const valueOf = ( term ) =>
			within( meta ).getByText( term ).nextElementSibling.textContent;
		expect( valueOf( 'Sent to' ) ).toBe( 'All audience' );
		expect( valueOf( 'Sent' ) ).toBe( '40' );
		expect( valueOf( 'Failed' ) ).toBe( '0' );
		expect( valueOf( 'Skipped' ) ).toBe( '7' );
		expect( valueOf( 'Marketing email' ) ).toBe( 'No' );
		expect( valueOf( 'Date' ) ).not.toBe( '—' );

		// Formatted, with placeholders left as written.
		expect( screen.getByText( 'new dates' ).tagName ).toBe( 'STRONG' );
		expect( screen.getByText( /Hi \{name\},/ ) ).toBeInTheDocument();

		// The composer is out of view, not gone.
		expect(
			screen.queryByRole( 'textbox', { name: 'Subject' } )
		).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'link', { name: /Back to Mail History/ } )
		);
		await arrivedAt( '?page=fair-audience-custom-mail' );
		await screen.findByRole( 'textbox', { name: 'Subject' } );
		expect(
			screen.getByRole( 'textbox', { name: 'Subject' } )
		).toHaveValue( 'Draft in progress' );
		expect( screen.getByLabelText( 'Content' ) ).toHaveValue(
			'<p>Half written.</p>'
		);
		expect( historyLink( 'Autumn programme' ) ).toHaveFocus();

		// Nothing was sent, and the page data was loaded only once.
		expect( callsTo( '/fair-audience/v1/custom-mail', 'POST' ) ).toEqual(
			[]
		);
		expect( callsTo( '/fair-audience/v1/custom-mail' ) ).toHaveLength( 1 );
		expect(
			callsTo( '/fair-audience/v1/custom-mail/events' )
		).toHaveLength( 1 );
	} );

	it( 'leaves modified clicks to the browser', async () => {
		mockApi();
		render( <CustomMailApp /> );
		await screen.findByRole( 'combobox', { name: 'Event' } );

		// Stand in for the browser opening a new tab: jsdom cannot navigate.
		// This runs after the page's own handler, which must not intervene.
		const seen = [];
		const stopNavigation = ( event ) => {
			seen.push( event.defaultPrevented );
			event.preventDefault();
		};
		document.addEventListener( 'click', stopNavigation );
		fireEvent.click( historyLink( 'What to bring' ), { ctrlKey: true } );
		document.removeEventListener( 'click', stopNavigation );

		expect( seen ).toEqual( [ false ] );

		expect( window.location.search ).toBe(
			'?page=fair-audience-custom-mail'
		);
		expect( callsTo( '/fair-audience/v1/custom-mail/5' ) ).toHaveLength(
			0
		);
	} );

	it( 'follows Back and Forward', async () => {
		mockApi();
		render( <CustomMailApp /> );
		await screen.findByRole( 'combobox', { name: 'Event' } );

		fireEvent.click( historyLink( 'What to bring' ) );
		await screen.findByRole( 'heading', {
			level: 1,
			name: 'What to bring',
		} );

		window.history.back();
		await arrivedAt( '?page=fair-audience-custom-mail' );
		expect(
			await screen.findByRole( 'textbox', { name: 'Subject' } )
		).toBeInTheDocument();

		window.history.forward();
		await arrivedAt( '?page=fair-audience-custom-mail&message_id=5' );
		expect(
			await screen.findByRole( 'heading', {
				level: 1,
				name: 'What to bring',
			} )
		).toBeInTheDocument();
	} );
} );

describe( 'direct visits', () => {
	it( 'loads only the message, then starts the composer on the way back', async () => {
		window.history.replaceState( null, '', `${ PAGE }&message_id=5` );
		mockApi();
		render( <CustomMailApp /> );

		await screen.findByRole( 'heading', {
			level: 1,
			name: 'What to bring',
		} );
		expect( screen.getByText( 'Workshop' ) ).toBeInTheDocument();
		expect( apiFetch.mock.calls.map( ( [ o ] ) => o.path ) ).toEqual( [
			'/fair-audience/v1/custom-mail/5',
		] );

		fireEvent.click(
			screen.getByRole( 'link', { name: /Back to Mail History/ } )
		);

		await screen.findByRole( 'combobox', { name: 'Event' } );
		expect( window.location.search ).toBe(
			'?page=fair-audience-custom-mail'
		);
	} );

	it( 'reports a missing record with a way back', async () => {
		window.history.replaceState( null, '', `${ PAGE }&message_id=99` );
		mockApi();
		render( <CustomMailApp /> );

		expect(
			await screen.findByRole( 'heading', {
				level: 1,
				name: 'Email not found',
			} )
		).toBeInTheDocument();
		expect(
			screen.getAllByText(
				'This email is no longer in Mail History. Its record may have been deleted.'
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: /Back to Mail History/ } )
		).toHaveAttribute( 'href', `http://localhost${ PAGE }` );
		expect(
			screen.queryByRole( 'button', { name: 'Try again' } )
		).not.toBeInTheDocument();
	} );

	it( 'reports refused access without showing the message', async () => {
		window.history.replaceState( null, '', `${ PAGE }&message_id=5` );
		mockApi( { 5: 403 } );
		render( <CustomMailApp /> );

		expect(
			(
				await screen.findAllByText(
					'You do not have permission to view sent emails.'
				)
			)[ 0 ]
		).toBeInTheDocument();
		expect( screen.queryByText( 'Bring water.' ) ).not.toBeInTheDocument();
	} );

	it( 'offers a retry after a failed request', async () => {
		window.history.replaceState( null, '', `${ PAGE }&message_id=5` );
		const messages = { 5: 500 };
		mockApi( messages );
		render( <CustomMailApp /> );

		const retry = await screen.findByRole( 'button', {
			name: 'Try again',
		} );
		messages[ 5 ] = HISTORY[ 0 ];
		fireEvent.click( retry );

		expect(
			await screen.findByRole( 'heading', {
				level: 1,
				name: 'What to bring',
			} )
		).toBeInTheDocument();
		expect( callsTo( '/fair-audience/v1/custom-mail/5' ) ).toHaveLength(
			2
		);
	} );
} );
