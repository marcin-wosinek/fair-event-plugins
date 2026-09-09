/**
 * @jest-environment jsdom
 *
 * Component tests for series nesting in AllEvents (#1202).
 *
 * Covers:
 *   - Series masters are collapsed by default; generated children are not rendered.
 *   - Toggling the disclosure button reveals the nested date rows.
 *   - Nested date rows show their date, not "(untitled event)".
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import AllEvents from '../AllEvents.js';

jest.mock( '@wordpress/api-fetch' );

function jsonResponse( data, headers = {} ) {
	return {
		headers: {
			get: ( name ) => headers[ name.toLowerCase() ] ?? null,
		},
		json: () => Promise.resolve( data ),
	};
}

const masterEvent = {
	id: 1,
	event_id: null,
	title: 'Summer Workshops',
	start_datetime: '2037-02-01 10:00:00',
	end_datetime: '2037-02-01 12:00:00',
	all_day: false,
	occurrence_type: 'master',
	master_id: null,
	link_type: 'none',
	external_url: null,
	venue_id: null,
	status: 'active',
	display_url: null,
	categories: [],
	children_count: 2,
	children: [
		{
			id: 2,
			title: '',
			start_datetime: '2037-02-01 10:00:00',
			occurrence_type: 'generated',
			master_id: 1,
			status: 'active',
			categories: [],
			copy_url: '#series-source-url',
		},
		{
			id: 3,
			title: '',
			start_datetime: '2037-02-08 10:00:00',
			occurrence_type: 'generated',
			master_id: 1,
			status: 'active',
			categories: [],
		},
	],
};

const copyableEvent = {
	id: 10,
	title: 'Copyable Event',
	start_datetime: '2037-03-01 10:00:00',
	occurrence_type: 'single',
	master_id: null,
	status: 'active',
	categories: [],
	copy_url: '#exact-server-url',
};

beforeEach( () => {
	window.CSS.supports = jest.fn( () => false );
	apiFetch.mockImplementation( () =>
		Promise.resolve(
			jsonResponse( [ masterEvent ], {
				'x-wp-total': '1',
				'x-wp-totalpages': '1',
			} )
		)
	);
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

it( 'renders the series collapsed by default, without its nested dates', async () => {
	render( <AllEvents /> );

	await waitFor( () =>
		expect( screen.getByText( 'Summer Workshops' ) ).toBeInTheDocument()
	);

	expect(
		screen.getByRole( 'button', { name: 'Expand series dates' } )
	).toBeInTheDocument();
	expect( screen.queryByText( '(untitled event)' ) ).not.toBeInTheDocument();
	expect( screen.getAllByRole( 'row' ) ).toHaveLength( 2 ); // header + master.
} );

it( 'reveals nested date rows when the disclosure button is toggled', async () => {
	render( <AllEvents /> );

	await waitFor( () =>
		expect( screen.getByText( 'Summer Workshops' ) ).toBeInTheDocument()
	);

	fireEvent.click(
		screen.getByRole( 'button', { name: 'Expand series dates' } )
	);

	await waitFor( () =>
		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 4 )
	); // header + master + 2 children.

	expect( screen.queryByText( '(untitled event)' ) ).not.toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Collapse series dates' } )
	).toBeInTheDocument();
} );

it( 'shows Copy only for eligible rows and navigates to the server URL', async () => {
	apiFetch.mockResolvedValue(
		jsonResponse( [ copyableEvent, masterEvent ], {
			'x-wp-total': '2',
			'x-wp-totalpages': '1',
		} )
	);

	render( <AllEvents /> );
	await screen.findByText( 'Copyable Event' );

	const copyableRow = screen.getByRole( 'row', { name: /Copyable Event/ } );
	expect(
		within(
			screen.getByRole( 'row', { name: /Summer Workshops/ } )
		).queryByRole( 'button', { name: 'Actions' } )
	).not.toBeInTheDocument();
	fireEvent.click(
		within( copyableRow ).getByRole( 'button', { name: 'Actions' } )
	);
	const copyAction = await screen.findByRole( 'menuitem', { name: 'Copy' } );
	expect( copyAction ).toBeInTheDocument();
	fireEvent.click( copyAction );
	expect( window.location.href ).toContain( '#exact-server-url' );
} );

it( 'uses the series source URL for an expanded generated occurrence', async () => {
	render( <AllEvents /> );
	await screen.findByText( 'Summer Workshops' );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Expand series dates' } )
	);

	const generatedRow = screen
		.getAllByRole( 'row' )
		.find( ( row ) => row.textContent.includes( 'Series date' ) );
	fireEvent.click(
		within( generatedRow ).getByRole( 'button', { name: 'Actions' } )
	);
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Copy' } ) );
	expect( window.location.href ).toContain( '#series-source-url' );
} );
