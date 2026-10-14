/**
 * @jest-environment jsdom
 *
 * Tests for the admin calendar's category filter (#1850): selection, clearing,
 * month navigation, URL initialization and Back/Forward restoration, invalid
 * categories, request races, pagination, and the empty-results state.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	act,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import CalendarApp, { EVENTS_PER_PAGE } from '../CalendarApp.js';

jest.mock( '@wordpress/api-fetch' );

jest.mock( '../components/QuickEventModal.js', () => ( { onSuccess } ) => (
	<button onClick={ () => onSuccess( { id: 7, title: 'Created' } ) }>
		Finish quick event
	</button>
) );

const BASE_PATH = '/wp-admin/admin.php';

const categories = [
	{ id: 3, name: 'Music', slug: 'music' },
	{ id: 4, name: 'Sports', slug: 'sports' },
	{ id: 5, name: 'Música', slug: 'musica', language: 'Español' },
	{ id: 1, name: 'Uncategorized', slug: 'uncategorized' },
];

function makeEvent( title, day, month = 7 ) {
	return {
		uid: `standalone_${ title.length }${ day }@example.com`,
		title,
		start: `2026-${ String( month ).padStart( 2, '0' ) }-${ String(
			day
		).padStart( 2, '0' ) }T10:00:00`,
		end: '',
		url: '',
	};
}

// Events per category slug ('' = All categories).
let eventsBySlug;
let categoriesResponse;
let eventsResponder;

function eventsPathParams( path ) {
	return new URLSearchParams( path.split( '?' )[ 1 ] );
}

function eventsCalls() {
	return apiFetch.mock.calls
		.map( ( [ options ] ) => options.path )
		.filter( ( path ) => path.startsWith( '/fair-events/v1/events?' ) )
		.map( eventsPathParams );
}

function setUrl( search ) {
	window.history.replaceState( null, '', `${ BASE_PATH }${ search }` );
}

function urlParams() {
	return new URLSearchParams( window.location.search );
}

function goBackTo( search ) {
	act( () => {
		setUrl( search );
		window.dispatchEvent( new PopStateEvent( 'popstate' ) );
	} );
}

function categorySelect() {
	return screen.getByLabelText( 'Category' );
}

async function renderApp() {
	render( <CalendarApp /> );
	await waitFor( () => expect( categorySelect() ).toBeEnabled() );
	await waitFor( () =>
		expect(
			document.querySelector( '.fair-events-calendar-grid' )
		).toBeInTheDocument()
	);
}

beforeEach( () => {
	jest.useRealTimers();
	window.fairEventsCalendarData = { startOfWeek: 1, manageEventUrl: '' };
	setUrl( '?page=fair-events-calendar&month=2026-07' );
	categoriesResponse = () => Promise.resolve( categories );
	eventsBySlug = {
		'': [
			makeEvent( 'Concert', 10 ),
			makeEvent( 'Match', 12 ),
			makeEvent( 'Plain event', 14 ),
		],
		music: [ makeEvent( 'Concert', 10 ) ],
		sports: [ makeEvent( 'Match', 12 ) ],
		musica: [],
		uncategorized: [ makeEvent( 'Plain event', 14 ) ],
	};
	eventsResponder = ( params ) =>
		Promise.resolve( {
			events: eventsBySlug[ params.get( 'categories' ) || '' ] || [],
		} );
	apiFetch.mockReset();
	apiFetch.mockImplementation( ( { path } ) => {
		if (
			path === '/fair-events/v1/sources/categories?all_languages=true'
		) {
			return categoriesResponse();
		}
		if ( path.startsWith( '/fair-events/v1/events?' ) ) {
			return eventsResponder( eventsPathParams( path ) );
		}
		return Promise.reject( new Error( `Unexpected path ${ path }` ) );
	} );
} );

it( 'shows a labelled category filter defaulting to All categories', async () => {
	await renderApp();

	expect( categorySelect() ).toHaveValue( '' );
	expect(
		screen.getByRole( 'option', { name: 'All categories' } )
	).toBeInTheDocument();
	// Every category is offered, including Uncategorized, with its language.
	expect(
		screen.getByRole( 'option', { name: 'Uncategorized' } )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'option', { name: 'Música — Español' } )
	).toBeInTheDocument();

	expect( await screen.findByText( 'Plain event' ) ).toBeInTheDocument();
	const [ params ] = eventsCalls();
	expect( params.get( 'categories' ) ).toBeNull();
	expect( params.get( 'context' ) ).toBe( 'edit' );
	expect( params.get( 'per_page' ) ).toBe( String( EVENTS_PER_PAGE ) );
	expect( urlParams().get( 'category' ) ).toBeNull();
} );

it( 'filters by the selected category and puts its ID in the URL', async () => {
	await renderApp();
	await screen.findByText( 'Plain event' );
	const historyLength = window.history.length;

	fireEvent.change( categorySelect(), { target: { value: '3' } } );

	expect( await screen.findByText( 'Concert' ) ).toBeInTheDocument();
	await waitFor( () =>
		expect( screen.queryByText( 'Match' ) ).not.toBeInTheDocument()
	);
	expect( eventsCalls().at( -1 ).get( 'categories' ) ).toBe( 'music' );
	expect( urlParams().get( 'category' ) ).toBe( '3' );
	expect( urlParams().get( 'month' ) ).toBe( '2026-07' );
	expect( urlParams().get( 'page' ) ).toBe( 'fair-events-calendar' );
	expect( window.history.length ).toBe( historyLength + 1 );
} );

it( 'clearing the filter restores all events and removes the URL parameter', async () => {
	setUrl( '?page=fair-events-calendar&month=2026-07&category=4' );
	await renderApp();
	expect( await screen.findByText( 'Match' ) ).toBeInTheDocument();
	expect( screen.queryByText( 'Plain event' ) ).not.toBeInTheDocument();

	fireEvent.change( categorySelect(), { target: { value: '' } } );

	expect( await screen.findByText( 'Plain event' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Concert' ) ).toBeInTheDocument();
	expect( urlParams().has( 'category' ) ).toBe( false );
	expect( eventsCalls().at( -1 ).get( 'categories' ) ).toBeNull();
} );

it( 'keeps the category through Previous, Next, and Today', async () => {
	setUrl( '?page=fair-events-calendar&month=2026-07&category=3' );
	await renderApp();
	await screen.findByText( 'Concert' );

	fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
	await waitFor( () =>
		expect( urlParams().get( 'month' ) ).toBe( '2026-08' )
	);
	expect( urlParams().get( 'category' ) ).toBe( '3' );
	await waitFor( () => {
		const params = eventsCalls().at( -1 );
		expect( params.get( 'start_date' ) ).toBe( '2026-07-27' );
		expect( params.get( 'categories' ) ).toBe( 'music' );
	} );

	fireEvent.click( screen.getByRole( 'button', { name: 'Previous' } ) );
	fireEvent.click( screen.getByRole( 'button', { name: 'Previous' } ) );
	await waitFor( () =>
		expect( urlParams().get( 'month' ) ).toBe( '2026-06' )
	);
	expect( urlParams().get( 'category' ) ).toBe( '3' );

	fireEvent.click( screen.getByRole( 'button', { name: 'Today' } ) );
	const today = new Date();
	const todayMonth = `${ today.getFullYear() }-${ String(
		today.getMonth() + 1
	).padStart( 2, '0' ) }`;
	await waitFor( () =>
		expect( urlParams().get( 'month' ) ).toBe( todayMonth )
	);
	expect( urlParams().get( 'category' ) ).toBe( '3' );
	await waitFor( () =>
		expect( eventsCalls().at( -1 ).get( 'categories' ) ).toBe( 'music' )
	);
	expect( categorySelect() ).toHaveValue( '3' );
} );

it( 'initializes month and category from the URL on reload', async () => {
	setUrl( '?page=fair-events-calendar&month=2026-09&category=4' );
	await renderApp();

	await waitFor( () => {
		const params = eventsCalls().at( -1 );
		expect( params.get( 'categories' ) ).toBe( 'sports' );
		expect( params.get( 'start_date' ) ).toBe( '2026-08-31' );
	} );
	expect( categorySelect() ).toHaveValue( '4' );
	expect( screen.getByText( 'September 2026' ) ).toBeInTheDocument();
} );

it( 'restores month and category on Back/Forward without pushing history', async () => {
	await renderApp();
	await screen.findByText( 'Plain event' );

	fireEvent.change( categorySelect(), { target: { value: '3' } } );
	await waitFor( () => expect( urlParams().get( 'category' ) ).toBe( '3' ) );
	const historyLength = window.history.length;

	// Back within the same month: only the category changes.
	goBackTo( '?page=fair-events-calendar&month=2026-07' );
	await waitFor( () => expect( categorySelect() ).toHaveValue( '' ) );
	expect( await screen.findByText( 'Plain event' ) ).toBeInTheDocument();

	// Forward again.
	goBackTo( '?page=fair-events-calendar&month=2026-07&category=3' );
	await waitFor( () => expect( categorySelect() ).toHaveValue( '3' ) );
	await waitFor( () =>
		expect( screen.queryByText( 'Plain event' ) ).not.toBeInTheDocument()
	);

	// Back to a different month and category.
	goBackTo( '?page=fair-events-calendar&month=2026-05&category=4' );
	await waitFor( () => expect( categorySelect() ).toHaveValue( '4' ) );
	expect( screen.getByText( 'May 2026' ) ).toBeInTheDocument();
	expect( window.history.length ).toBe( historyLength );
} );

it.each( [
	[ 'deleted', '99' ],
	[ 'malformed', 'abc' ],
	[ 'zero', '0' ],
] )(
	'falls back to All categories for a %s category in the URL',
	async ( _label, value ) => {
		setUrl(
			`?page=fair-events-calendar&month=2026-07&category=${ value }`
		);
		const historyLength = window.history.length;
		await renderApp();

		expect( await screen.findByText( 'Plain event' ) ).toBeInTheDocument();
		expect( categorySelect() ).toHaveValue( '' );
		expect( urlParams().has( 'category' ) ).toBe( false );
		expect( urlParams().get( 'month' ) ).toBe( '2026-07' );
		expect( window.history.length ).toBe( historyLength );
		// The calendar never requested an unresolved slug.
		for ( const params of eventsCalls() ) {
			expect( params.get( 'categories' ) ).toBeNull();
		}
	}
);

it( 'keeps the selection when categories fail to load', async () => {
	setUrl( '?page=fair-events-calendar&month=2026-07&category=3' );
	categoriesResponse = () => Promise.reject( new Error( 'Network down' ) );
	render( <CalendarApp /> );

	expect( await screen.findByText( 'Network down' ) ).toBeInTheDocument();
	expect( urlParams().get( 'category' ) ).toBe( '3' );
	expect( categorySelect() ).toHaveValue( '3' );
	expect(
		screen.queryByText( 'No events match this category.' )
	).not.toBeInTheDocument();
	expect( eventsCalls() ).toHaveLength( 0 );
} );

it( 'shows a message and keeps the dated grid when a category has no matches', async () => {
	setUrl( '?page=fair-events-calendar&month=2026-07&category=5' );
	await renderApp();

	expect(
		await screen.findByText( 'No events match this category.' )
	).toBeInTheDocument();
	const grid = document.querySelector( '.fair-events-calendar-grid' );
	expect( grid ).toHaveClass( 'is-grid-forced' );
	expect( grid.querySelectorAll( '.fair-events-calendar-day' ) ).toHaveLength(
		35
	);
	// The agenda's own empty state is not shown alongside it.
	expect(
		screen.queryByText( 'No events this month.' )
	).not.toBeInTheDocument();
} );

it( 'does not show the no-matches message while loading or after an error', async () => {
	setUrl( '?page=fair-events-calendar&month=2026-07&category=5' );
	let rejectEvents;
	eventsResponder = () =>
		new Promise( ( _resolve, reject ) => {
			rejectEvents = reject;
		} );
	render( <CalendarApp /> );
	await waitFor( () => expect( rejectEvents ).toBeDefined() );
	expect(
		screen.queryByText( 'No events match this category.' )
	).not.toBeInTheDocument();

	await act( async () => rejectEvents( new Error( 'Server error' ) ) );

	expect( await screen.findByText( 'Server error' ) ).toBeInTheDocument();
	expect(
		screen.queryByText( 'No events match this category.' )
	).not.toBeInTheDocument();
} );

it( 'does not show the no-matches message for an empty unfiltered month', async () => {
	eventsBySlug[ '' ] = [];
	await renderApp();
	expect(
		await screen.findByText( 'No events this month.' )
	).toBeInTheDocument();
	expect(
		screen.queryByText( 'No events match this category.' )
	).not.toBeInTheDocument();
} );

it( 'ignores an obsolete response that arrives after a newer selection', async () => {
	const pending = {};
	eventsResponder = ( params ) => {
		const slug = params.get( 'categories' ) || '';
		if ( slug === 'music' ) {
			return new Promise( ( resolve ) => {
				pending.music = resolve;
			} );
		}
		return Promise.resolve( { events: eventsBySlug[ slug ] } );
	};
	await renderApp();
	await screen.findByText( 'Plain event' );

	fireEvent.change( categorySelect(), { target: { value: '3' } } );
	await waitFor( () => expect( pending.music ).toBeDefined() );
	fireEvent.change( categorySelect(), { target: { value: '4' } } );
	expect( await screen.findByText( 'Match' ) ).toBeInTheDocument();

	await act( async () =>
		pending.music( { events: [ makeEvent( 'Stale concert', 10 ) ] } )
	);

	expect( screen.queryByText( 'Stale concert' ) ).not.toBeInTheDocument();
	expect( screen.getByText( 'Match' ) ).toBeInTheDocument();
} );

it( 'fetches every page until a short page', async () => {
	const fullPage = Array.from( { length: EVENTS_PER_PAGE }, ( _, i ) => ( {
		...makeEvent( 'Bulk', 1 ),
		uid: `standalone_${ i }@example.com`,
	} ) );
	eventsResponder = ( params ) =>
		Promise.resolve( {
			events:
				params.get( 'page' ) === '1'
					? fullPage
					: [ makeEvent( 'Second page event', 20 ) ],
		} );
	await renderApp();

	expect(
		await screen.findByText( 'Second page event' )
	).toBeInTheDocument();
	expect( eventsCalls().map( ( params ) => params.get( 'page' ) ) ).toEqual( [
		'1',
		'2',
	] );
} );

it( 'refreshes the filtered view after creating an event', async () => {
	setUrl( '?page=fair-events-calendar&month=2026-07&category=3' );
	await renderApp();
	await screen.findByText( 'Concert' );
	const callsBefore = eventsCalls().length;

	fireEvent.click(
		within(
			document.querySelector( '.fair-events-calendar-nav' )
		).getByRole( 'button', { name: 'Add event' } )
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Finish quick event' } )
	);

	await waitFor( () =>
		expect( eventsCalls().length ).toBe( callsBefore + 1 )
	);
	expect( eventsCalls().at( -1 ).get( 'categories' ) ).toBe( 'music' );
	expect(
		screen.getAllByText( /Event "Created" created\./ ).length
	).toBeGreaterThan( 0 );
} );
