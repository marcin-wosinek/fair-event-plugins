/**
 * @jest-environment jsdom
 *
 * Component tests for the "Add Participants" dialog of the Audience tab
 * (#2437): candidates load when it opens, the role defaults to Signed up, a
 * resolved request closes it and refreshes the list, and a rejected one
 * reports the error and keeps the selection.
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
import EventAudience from '../EventAudience.js';

jest.mock( '@wordpress/api-fetch' );

const JANE = {
	id: 1,
	participant_id: 10,
	event_date_id: 5,
	is_series_pass: false,
	participant_name: 'Jane Doe',
	name: 'Jane',
	surname: 'Doe',
	participant_email: 'jane@example.com',
	email_profile: 'marketing',
	label: 'interested',
	ticket_type_id: null,
	ticket_type_name: null,
	attended_at: null,
	created_at: '2026-01-01 10:00:00',
	payment_expires_at: null,
	ticket_option_names: [],
	ticket_option_ids: [],
	admin_comment: '',
	removal_blockers: [],
};

const PROFILES = [
	{ id: 10, name: 'Jane', surname: 'Doe', email: 'jane@example.com' },
	{ id: 11, name: 'Sam', surname: 'Lee', email: 'sam@example.com' },
	{ id: 12, name: 'Sam', surname: 'Lee', email: 'sam.lee@other.test' },
];

const isBatch = ( { path, method } ) =>
	method === 'POST' && path.endsWith( '/participants/batch' );

/**
 * @param {Function} batch Answers the batch request.
 */
function mockApi( batch ) {
	apiFetch.mockImplementation( ( request ) => {
		const { path } = request;
		if ( isBatch( request ) ) {
			return batch( request );
		}
		if ( path === '/fair-audience/v1/participants?per_page=0' ) {
			return Promise.resolve( PROFILES );
		}
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( [ JANE ] );
		}
		if ( path.includes( '/tickets' ) ) {
			return Promise.resolve( { options: [], ticket_types: [] } );
		}
		return Promise.resolve( [] );
	} );
}

const batchCalls = () =>
	apiFetch.mock.calls.map( ( [ request ] ) => request ).filter( isBatch );

const listLoads = () =>
	apiFetch.mock.calls.filter(
		( [ { path, method } ] ) =>
			! method && path === '/fair-audience/v1/event-dates/5/participants'
	).length;

async function openAdd() {
	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Weekly class"
		/>
	);
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Add Participants' } )
	);
	const dialog = await screen.findByRole( 'dialog', {
		name: 'Add Participants',
	} );
	await within( dialog ).findByRole( 'textbox', {
		name: 'Search participants',
	} );
	return dialog;
}

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'EventAudience — Add Participants (#2437)', () => {
	it( 'offers the people not yet in the audience, told apart by email', async () => {
		mockApi( () => Promise.resolve( { added: 1 } ) );
		const dialog = await openAdd();

		expect(
			within( dialog ).queryByText( /jane@example\.com/ )
		).not.toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'checkbox', {
				name: 'Sam Lee sam@example.com',
			} )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'checkbox', {
				name: 'Sam Lee sam.lee@other.test',
			} )
		).toBeInTheDocument();
		expect( within( dialog ).getByRole( 'combobox' ) ).toHaveValue(
			'signed_up'
		);
		expect(
			within( dialog ).queryByRole( 'button', { name: 'Select All' } )
		).not.toBeInTheDocument();
	} );

	it( 'adds the selection with the chosen role, closes and refreshes', async () => {
		mockApi( () => Promise.resolve( { added: 1 } ) );
		const dialog = await openAdd();
		const loadsBefore = listLoads();

		fireEvent.change( within( dialog ).getByRole( 'combobox' ), {
			target: { value: 'collaborator' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'checkbox', {
				name: 'Sam Lee sam.lee@other.test',
			} )
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Add 1 Selected' } )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( batchCalls() ).toEqual( [
			expect.objectContaining( {
				path: '/fair-audience/v1/event-dates/5/participants/batch',
				data: { participant_ids: [ 12 ], label: 'collaborator' },
			} ),
		] );
		expect( listLoads() ).toBe( loadsBefore + 1 );
	} );

	it( 'reports a rejected request and keeps the selection for a retry', async () => {
		let fails = true;
		mockApi( () =>
			fails
				? Promise.reject( { message: 'Event date not found.' } )
				: Promise.resolve( { added: 1 } )
		);
		const dialog = await openAdd();

		fireEvent.click(
			within( dialog ).getByRole( 'checkbox', {
				name: 'Sam Lee sam@example.com',
			} )
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Add 1 Selected' } )
		);

		expect(
			await screen.findByText(
				'Error adding participants: Event date not found.'
			)
		).toBeInTheDocument();
		expect( dialog ).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'checkbox', {
				name: 'Sam Lee sam@example.com',
			} )
		).toBeChecked();

		fails = false;
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Add 1 Selected' } )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect(
			batchCalls().map( ( request ) => request.data.participant_ids )
		).toEqual( [ [ 11 ], [ 11 ] ] );
	} );

	it( 'starts with an empty search and selection when reopened', async () => {
		mockApi( () => Promise.resolve( { added: 1 } ) );
		let dialog = await openAdd();

		fireEvent.change(
			within( dialog ).getByRole( 'textbox', {
				name: 'Search participants',
			} ),
			{ target: { value: 'other' } }
		);
		fireEvent.click( within( dialog ).getByRole( 'checkbox' ) );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add Participants' } )
		);
		dialog = await screen.findByRole( 'dialog', {
			name: 'Add Participants',
		} );
		const searchBox = await within( dialog ).findByRole( 'textbox', {
			name: 'Search participants',
		} );

		expect( searchBox ).toHaveValue( '' );
		expect( within( dialog ).getAllByRole( 'checkbox' ) ).toHaveLength( 2 );
		within( dialog )
			.getAllByRole( 'checkbox' )
			.forEach( ( box ) => expect( box ).not.toBeChecked() );
	} );
} );
