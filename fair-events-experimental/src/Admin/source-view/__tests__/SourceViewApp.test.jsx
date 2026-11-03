/**
 * @jest-environment jsdom
 *
 * Tests for the event feed preview on the shared calendar (#1847): month URL
 * and Back/Forward navigation, feed details, event links, crowded days, and
 * the empty, error and stale-response states.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	act,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );

const BASE_PATH = '/wp-admin/admin.php';

window.fairEventsSourceViewData = {
	sourceId: 2,
	startOfWeek: 1,
	sourcesListUrl: '/wp-admin/admin.php?page=fair-events-sources',
	icalUrlTemplate: '/wp-json/fair-events/v1/sources/{slug}/ical',
	jsonUrlTemplate: '/wp-json/fair-events/v1/sources/{slug}/json',
};
// The app reads its settings when the module loads.
const SourceViewApp = require( '../SourceViewApp.js' ).default;

const source = {
	id: 2,
	name: 'Community calendar',
	slug: 'community-calendar',
	enabled: true,
	data_sources: [ { source_type: 'categories', config: {} } ],
	page_url: null,
};

function makeEvent( title, day, extra = {} ) {
	return {
		uid: `feed-${ title }-${ day }@elsewhere`,
		title,
		start: `2026-07-${ String( day ).padStart( 2, '0' ) }T10:00:00`,
		url: '',
		...extra,
	};
}

let eventsResponder;

function eventsCalls() {
	return apiFetch.mock.calls
		.map( ( [ options ] ) => options.path )
		.filter( ( path ) =>
			path.startsWith(
				'/fair-events/v1/sources/community-calendar/json?'
			)
		)
		.map( ( path ) => new URLSearchParams( path.split( '?' )[ 1 ] ) );
}

function setUrl( search ) {
	window.history.replaceState( null, '', `${ BASE_PATH }${ search }` );
}

function urlParams() {
	return new URLSearchParams( window.location.search );
}

async function renderApp() {
	render( <SourceViewApp /> );
	await waitFor( () =>
		expect(
			document.querySelector( '.fair-events-calendar-grid' )
		).toBeInTheDocument()
	);
}

beforeEach( () => {
	setUrl( '?page=fair-events-source-view&source_id=2&month=2026-07' );
	eventsResponder = () =>
		Promise.resolve( {
			events: [
				makeEvent( 'Partner festival', 10, {
					url: 'https://example.com/festival',
				} ),
				makeEvent( '', 12 ),
			],
		} );
	apiFetch.mockReset();
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/fair-events/v1/sources/2' ) {
			return Promise.resolve( source );
		}
		if (
			path.startsWith(
				'/fair-events/v1/sources/community-calendar/json?'
			)
		) {
			return eventsResponder(
				new URLSearchParams( path.split( '?' )[ 1 ] )
			);
		}
		return Promise.reject( new Error( `Unexpected path ${ path }` ) );
	} );
} );

it( 'shows the feed details and requests the visible grid range', async () => {
	await renderApp();

	expect(
		screen.getByRole( 'heading', {
			name: 'Event feed: Community calendar',
		} )
	).toBeInTheDocument();
	expect( screen.getByText( '1 configured source' ) ).toBeInTheDocument();
	expect( screen.getByText( 'July 2026' ) ).toBeInTheDocument();

	const [ params ] = eventsCalls();
	expect( params.get( 'start_date' ) ).toBe( '2026-06-29' );
	expect( params.get( 'end_date' ) ).toBe( '2026-08-02' );
} );

it( 'links events to their destinations without creation actions', async () => {
	await renderApp();

	const title = await screen.findByRole( 'link', {
		name: /Partner festival/,
	} );
	expect( title ).toHaveAttribute( 'href', 'https://example.com/festival' );
	expect( screen.getByTitle( 'Open link destination' ) ).toHaveAttribute(
		'target',
		'_blank'
	);
	expect( screen.getByText( '(untitled event)' ) ).toBeInTheDocument();
	expect(
		screen.queryByRole( 'button', { name: 'Add event' } )
	).not.toBeInTheDocument();
} );

it( 'keeps every event of a crowded day in the DOM for the mobile agenda', async () => {
	eventsResponder = () =>
		Promise.resolve( {
			events: [ 1, 2, 3, 4, 5 ].map( ( n ) =>
				makeEvent( `Event ${ n }`, 18 )
			),
		} );
	await renderApp();

	for ( let n = 1; n <= 5; n++ ) {
		expect( await screen.findByText( `Event ${ n }` ) ).toBeInTheDocument();
	}
	expect( screen.getByText( '+2 more' ) ).toBeInTheDocument();
} );

it( 'pushes the month through Previous, Next and Today, keeping other parameters', async () => {
	setUrl( '?page=fair-events-source-view&source_id=2&month=2020-07' );
	await renderApp();
	const startLength = window.history.length;

	fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
	expect( urlParams().get( 'month' ) ).toBe( '2020-08' );
	expect( urlParams().get( 'source_id' ) ).toBe( '2' );
	expect( urlParams().get( 'page' ) ).toBe( 'fair-events-source-view' );
	expect( await screen.findByText( 'August 2020' ) ).toBeInTheDocument();

	fireEvent.click( screen.getByRole( 'button', { name: 'Previous' } ) );
	fireEvent.click( screen.getByRole( 'button', { name: 'Previous' } ) );
	expect( urlParams().get( 'month' ) ).toBe( '2020-06' );

	const now = new Date();
	const thisMonth = `${ now.getFullYear() }-${ String(
		now.getMonth() + 1
	).padStart( 2, '0' ) }`;
	fireEvent.click( screen.getByRole( 'button', { name: 'Today' } ) );
	expect( urlParams().get( 'month' ) ).toBe( thisMonth );
	expect( window.history.length ).toBe( startLength + 4 );

	// Today again stays on the same month and adds no entry.
	fireEvent.click( screen.getByRole( 'button', { name: 'Today' } ) );
	expect( window.history.length ).toBe( startLength + 4 );
	await waitFor( () =>
		expect(
			document.querySelector( '.fair-events-calendar-grid' )
		).toBeInTheDocument()
	);
} );

it( 'restores the month on Back/Forward without pushing history', async () => {
	await renderApp();
	const startLength = window.history.length;

	act( () => {
		setUrl( '?page=fair-events-source-view&source_id=2&month=2026-03' );
		window.dispatchEvent( new PopStateEvent( 'popstate' ) );
	} );

	expect( await screen.findByText( 'March 2026' ) ).toBeInTheDocument();
	expect( window.history.length ).toBe( startLength );
	await waitFor( () =>
		expect( eventsCalls().at( -1 ).get( 'start_date' ) ).toBe(
			'2026-02-23'
		)
	);
} );

it( 'normalizes a missing or malformed month in place', async () => {
	setUrl( '?page=fair-events-source-view&source_id=2&month=2026-13' );
	const startLength = window.history.length;
	await renderApp();

	expect( urlParams().get( 'month' ) ).toMatch( /^\d{4}-\d{2}$/ );
	expect( urlParams().get( 'month' ) ).not.toBe( '2026-13' );
	expect( window.history.length ).toBe( startLength );
} );

it( 'shows the empty-month message only after a successful load', async () => {
	let resolveEvents;
	eventsResponder = () =>
		new Promise( ( resolve ) => {
			resolveEvents = resolve;
		} );
	render( <SourceViewApp /> );
	await waitFor( () => expect( resolveEvents ).toBeDefined() );
	expect(
		screen.queryByText( 'No events this month.' )
	).not.toBeInTheDocument();

	await act( async () => resolveEvents( { events: [] } ) );

	expect(
		await screen.findByText( 'No events this month.' )
	).toBeInTheDocument();
} );

it( 'reports a failed events request instead of an empty month', async () => {
	eventsResponder = () => Promise.reject( new Error( 'Feed unavailable' ) );
	render( <SourceViewApp /> );

	expect( await screen.findByText( 'Feed unavailable' ) ).toBeInTheDocument();
	expect(
		document.querySelector( '.fair-events-calendar-grid' )
	).toBeInTheDocument();
	expect(
		screen.queryByText( 'No events this month.' )
	).not.toBeInTheDocument();
} );

it( 'ignores an obsolete response that arrives after a newer month', async () => {
	const pending = {};
	eventsResponder = ( params ) =>
		new Promise( ( resolve ) => {
			pending[ params.get( 'start_date' ) ] = resolve;
		} );
	render( <SourceViewApp /> );
	await waitFor( () => expect( pending[ '2026-06-29' ] ).toBeDefined() );

	fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
	await waitFor( () => expect( pending[ '2026-07-27' ] ).toBeDefined() );

	await act( async () =>
		pending[ '2026-07-27' ]( {
			events: [ makeEvent( 'August event', 3 ) ],
		} )
	);
	await act( async () =>
		pending[ '2026-06-29' ]( { events: [ makeEvent( 'July event', 10 ) ] } )
	);

	expect( screen.getByText( 'August 2026' ) ).toBeInTheDocument();
	expect( screen.queryByText( 'July event' ) ).not.toBeInTheDocument();
} );

function withSource( extra ) {
	const fallback = apiFetch.getMockImplementation();
	apiFetch.mockImplementation( ( options ) =>
		options.path === '/fair-events/v1/sources/2'
			? Promise.resolve( { ...source, ...extra } )
			: fallback( options )
	);
}

describe( 'feed header (#2083)', () => {
	it( 'shows one edit button that opens the editor', async () => {
		await renderApp();

		const editButtons = screen.getAllByRole( 'button', {
			name: 'Edit event feed',
		} );
		expect( editButtons ).toHaveLength( 1 );
		// The editor loads its pages and categories on open.
		await act( async () => {
			fireEvent.click( editButtons[ 0 ] );
		} );
		expect(
			screen.getByRole( 'dialog', { name: 'Edit Event Feed' } )
		).toBeInTheDocument();
	} );

	it.each( [
		[ 0, '0 configured sources' ],
		[ 1, '1 configured source' ],
		[ 3, '3 configured sources' ],
	] )( 'counts %d configured sources', async ( count, text ) => {
		withSource( {
			data_sources: Array.from( { length: count }, () => ( {
				source_type: 'categories',
				config: {},
			} ) ),
		} );
		await renderApp();

		expect( screen.getByText( text ) ).toBeInTheDocument();
	} );

	it( 'labels the status and links the published public page', async () => {
		withSource( {
			page_id: 7,
			page_url: 'http://example.com/agenda/',
			page_title: 'Agenda',
		} );
		await renderApp();

		expect( screen.getByText( 'Enabled' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Public page: Agenda' ) ).toBeInTheDocument();
		const link = screen.getByRole( 'link', { name: /Open public page/ } );
		expect( link ).toHaveAttribute( 'href', 'http://example.com/agenda/' );
		expect( link ).toHaveAttribute( 'target', '_blank' );
	} );

	it( 'explains a missing or unpublished public page', async () => {
		withSource( { page_id: null, page_url: null } );
		await renderApp();
		expect(
			screen.getByText( /Public page: none selected/ )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', { name: /Open public page/ } )
		).not.toBeInTheDocument();
	} );

	it( 'explains a selected page that is not published', async () => {
		withSource( { page_id: 7, page_url: null } );
		await renderApp();
		expect(
			screen.getByText( /selected page isn’t published/ )
		).toBeInTheDocument();
	} );

	it( 'labels a disabled feed and explains the consequences', async () => {
		withSource( { enabled: false } );
		await renderApp();
		expect( screen.getByText( 'Disabled' ) ).toBeInTheDocument();
		expect(
			screen.getByText( /This feed is disabled/ )
		).toBeInTheDocument();
	} );
} );

describe( 'subscription and integrations', () => {
	it( 'keeps the slug, iCal and JSON in a collapsed section', async () => {
		await renderApp();

		const toggle = screen.getByRole( 'button', {
			name: 'Subscription and integrations',
		} );
		expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( screen.queryByText( 'community-calendar' ) ).toBeNull();

		fireEvent.click( toggle );
		expect( toggle ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'community-calendar' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'iCal' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'JSON' } ) ).toBeVisible();
	} );
} );

describe( 'weekly summary (#2045, #2083)', () => {
	const LINK =
		'http://example.com/fair-events-weekly-summary/community-calendar/';

	const openButton = () =>
		screen.getByRole( 'button', { name: 'Open weekly summary' } );

	function expectNoCopyControls() {
		expect(
			screen.queryByRole( 'button', { name: 'Copy summary link' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Show summary link' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'textbox', { name: 'Weekly summary link' } )
		).not.toBeInTheDocument();
	}

	it( 'opens the summary as the only action', async () => {
		withSource( { weekly_summary_url: LINK, page_id: 7 } );
		await renderApp();

		expect(
			screen.getByRole( 'heading', { name: 'Weekly summary' } )
		).toBeInTheDocument();
		const open = screen.getByRole( 'link', {
			name: /Open weekly summary/,
		} );
		expect( open ).toHaveAttribute( 'href', LINK );
		expect( open ).toHaveAttribute( 'target', '_blank' );
		expect( open ).toHaveTextContent( '(opens in a new tab)' );
		expect(
			screen.queryByText( /Choose a public page in the feed settings/ )
		).not.toBeInTheDocument();
		expectNoCopyControls();
	} );

	it( 'explains why a disabled feed cannot open its summary', async () => {
		withSource( { weekly_summary_url: LINK, page_id: 7, enabled: false } );
		await renderApp();

		expect( openButton() ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( openButton() ).toHaveAccessibleDescription(
			'Enable this feed to open its weekly summary.'
		);
		expect(
			screen.queryByRole( 'link', { name: /Open weekly summary/ } )
		).not.toBeInTheDocument();
		expectNoCopyControls();
	} );

	it( 'keeps the section without a page and asks for one', async () => {
		withSource( { weekly_summary_url: null, page_id: null } );
		await renderApp();

		expect(
			screen.getByRole( 'heading', { name: 'Weekly summary' } )
		).toBeInTheDocument();
		expect( openButton() ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( openButton() ).toHaveAccessibleDescription(
			/Choose a public page in the feed settings/
		);
		expect(
			screen.queryByRole( 'link', { name: /Open weekly summary/ } )
		).not.toBeInTheDocument();
		expectNoCopyControls();
	} );

	it( 'asks for a page first when a page-less feed is disabled', async () => {
		withSource( {
			weekly_summary_url: null,
			page_id: null,
			enabled: false,
		} );
		await renderApp();

		expect( openButton() ).toHaveAccessibleDescription(
			/Choose a public page in the feed settings/
		);
	} );

	it( 'opens the new summary once a page is linked in the editor', async () => {
		let current = { weekly_summary_url: null, page_id: null };
		const fallback = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( options ) =>
			options.path === '/fair-events/v1/sources/2'
				? Promise.resolve( { ...source, ...current } )
				: fallback( options )
		);
		await renderApp();
		expect( openButton() ).toHaveAttribute( 'aria-disabled', 'true' );

		// Saving in the editor refetches the feed with its new link.
		current = { weekly_summary_url: LINK, page_id: 7 };
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit event feed' } )
		);
		const dialog = screen.getByRole( 'dialog' );
		await act( async () => {
			fireEvent.submit( dialog.querySelector( 'form' ) );
		} );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		await waitFor( () =>
			expect(
				screen.getByRole( 'link', { name: /Open weekly summary/ } )
			).toHaveAttribute( 'href', LINK )
		);
		expect(
			screen.queryByText( /Choose a public page in the feed settings/ )
		).not.toBeInTheDocument();
	} );
} );
