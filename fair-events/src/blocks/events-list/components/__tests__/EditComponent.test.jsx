/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, render, waitFor, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EditComponent from '../EditComponent.js';

jest.mock( '@wordpress/api-fetch' );

// useBlockProps needs the editor's block context, which jsdom doesn't
// provide; InspectorControls needs a slot-fill provider. Stub both to plain
// passthroughs so the component renders in isolation.
jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: () => ( {} ),
	InspectorControls: ( { children } ) => children,
} ) );

// ServerSideRender hits the REST API for a live render; stub it to a marker
// that exposes the attributes it was given, so tests can assert time/
// category/source changes reach the server-rendered preview.
const mockServerSideRender = jest.fn( ( props ) => (
	<div
		data-testid="ssr"
		data-attributes={ JSON.stringify( props.attributes ) }
	/>
) );
jest.mock(
	'@wordpress/server-side-render',
	() => ( props ) => mockServerSideRender( props ),
	{ virtual: true }
);

// The block picker reads bundled patterns via getBlockPatterns() and
// user-created synced patterns via getEntityRecords( 'postType', 'wp_block' ).
// Both come from the 'core' data store — fixtures are set per test. The rest
// of @wordpress/data is proxied through to its real implementation (a bare
// object mock breaks @wordpress/components, which depends on other data
// exports at module-load time).
let mockFairEventsPatterns = [];
let mockUserPatterns = [];
jest.mock( '@wordpress/data', () => {
	const stub = () => stub;
	return new Proxy(
		{
			useSelect: ( fn ) =>
				fn( () => ( {
					getBlockPatterns: () => mockFairEventsPatterns,
					getEntityRecords: () => mockUserPatterns,
				} ) ),
		},
		{
			get( target, prop ) {
				if ( prop in target ) return target[ prop ];
				return stub;
			},
		}
	);
} );

const QUERY_LOOP_CONTENT =
	'<!-- wp:query {"query":{"postType":"fair_event"}} --><div class="wp-block-query"></div><!-- /wp:query -->';
const PER_EVENT_CONTENT = '<!-- wp:html -->{{title}}<!-- /wp:html -->';

const EVENT_LIST_PATTERN = {
	name: 'fair-events/event-list',
	title: 'Event List - With Dates',
	categories: [ 'fair-events' ],
	content: QUERY_LOOP_CONTENT,
};

const CALENDAR_PATTERN = {
	name: 'fair-events/calendar-event-simple',
	title: 'Calendar Event - Simple',
	categories: [ 'fair-events' ],
	content: '<!-- wp:post-title {"isLink":true} /-->',
};

// Renders the block and waits for the async CategorySelector/EventSourceSelector
// REST lookups (mocked below to resolve immediately) to settle, so assertions
// run after the component's initial effects — not mid-flight.
const renderBlock = async ( attributeOverrides = {} ) => {
	const setAttributes = jest.fn();
	const attributes = {
		timeFilter: 'upcoming',
		categories: [],
		displayPattern: 'fair-events/event-list',
		eventSources: [],
		...attributeOverrides,
	};
	const utils = render(
		<EditComponent
			attributes={ attributes }
			setAttributes={ setAttributes }
		/>
	);
	await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
	return { ...utils, setAttributes, attributes };
};

describe( 'EventsList EditComponent', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		mockFairEventsPatterns = [ EVENT_LIST_PATTERN, CALENDAR_PATTERN ];
		mockUserPatterns = [];
		// EventSourceSelector's and CategorySelector's own REST lookups; keep
		// them quiet and empty.
		apiFetch.mockResolvedValue( [] );
	} );

	it( 'offers the bundled list pattern but not calendar/week-only patterns', async () => {
		const { container } = await renderBlock();

		const select = within( container ).getByLabelText( 'Display Pattern' );
		const labels = Array.from( select.options ).map(
			( option ) => option.textContent
		);

		expect( labels ).toContain( 'Event List - With Dates' );
		expect( labels ).not.toContain( 'Calendar Event - Simple' );
	} );

	it( 'offers a user-created synced pattern', async () => {
		mockUserPatterns = [
			{
				id: 42,
				title: { raw: 'My Custom Layout' },
				content: { raw: PER_EVENT_CONTENT },
			},
		];

		const { container } = await renderBlock();

		const select = within( container ).getByLabelText( 'Display Pattern' );
		const labels = Array.from( select.options ).map(
			( option ) => option.textContent
		);

		expect(
			labels.some( ( label ) => label.includes( 'My Custom Layout' ) )
		).toBe( true );
	} );

	it( 'preserves and flags a saved pattern that is no longer available', async () => {
		const { container } = await renderBlock( {
			displayPattern: 'fair-events/deleted-pattern',
		} );

		const select = within( container ).getByLabelText( 'Display Pattern' );

		expect( select.value ).toBe( 'fair-events/deleted-pattern' );
		expect(
			within( container ).getByText( /Unavailable pattern/i )
		).toBeInTheDocument();
	} );

	it( 'warns when a Query Loop pattern is combined with event feeds', async () => {
		const { container } = await renderBlock( {
			displayPattern: 'fair-events/event-list',
			eventSources: [ 'my-source' ],
		} );

		expect(
			within( container ).getByText(
				/can only show WordPress-linked events/i
			)
		).toBeInTheDocument();
	} );

	it( 'shows no compatibility warning for a per-event custom pattern with event feeds selected', async () => {
		mockUserPatterns = [
			{
				id: 42,
				title: { raw: 'My Custom Layout' },
				content: { raw: PER_EVENT_CONTENT },
			},
		];

		const { container } = await renderBlock( {
			displayPattern: 'wp_block:42',
			eventSources: [ 'my-source' ],
		} );

		expect(
			within( container ).queryByText(
				/can only show WordPress-linked events/i
			)
		).toBeNull();
	} );

	it( 'shows no compatibility warning when no event feeds are selected', async () => {
		const { container } = await renderBlock( {
			displayPattern: 'fair-events/event-list',
			eventSources: [],
		} );

		expect(
			within( container ).queryByText(
				/can only show WordPress-linked events/i
			)
		).toBeNull();
	} );

	it( 'explains recurring-series grouping when only Future is checked', async () => {
		const { container } = await renderBlock( { timeFilter: 'upcoming' } );

		expect(
			within( container ).getByText(
				/A recurring series from this site appears once, at its next date/i
			)
		).toBeInTheDocument();
		expect(
			within( container ).getByText(
				/calendar feeds and external sources are listed one date at a time/i
			)
		).toBeInTheDocument();
	} );

	it( 'omits the recurring-series explanation for other selections', async () => {
		const { container } = await renderBlock( {
			timeFilters: [ 'current', 'future' ],
		} );

		expect(
			within( container ).queryByText(
				/A recurring series from this site/i
			)
		).toBeNull();
		expect(
			within( container ).getByText( /any checked period/i )
		).toBeInTheDocument();
	} );

	it( 'groups the Past, Current and Future checkboxes under one label', async () => {
		const { container } = await renderBlock();

		const group = within( container ).getByRole( 'group', {
			name: 'Show events',
		} );
		const labels = within( group )
			.getAllByRole( 'checkbox' )
			.map( ( box ) => box.closest( 'div' ).textContent );

		expect( labels ).toEqual( [ 'Past', 'Current', 'Future' ] );
	} );

	it.each( [
		[ 'upcoming', [ false, false, true ] ],
		[ 'ongoing', [ false, true, false ] ],
		[ 'past', [ true, false, false ] ],
		[ 'all', [ true, true, true ] ],
		[ undefined, [ false, false, true ] ],
	] )(
		'checks the periods of a legacy "%s" block',
		async ( timeFilter, expected ) => {
			const { container } = await renderBlock( { timeFilter } );

			const boxes = within( container )
				.getByRole( 'group', { name: 'Show events' } )
				.querySelectorAll( 'input[type="checkbox"]' );

			expect( Array.from( boxes ).map( ( box ) => box.checked ) ).toEqual(
				expected
			);
		}
	);

	it( 'prefers saved periods over the legacy filter', async () => {
		const { container } = await renderBlock( {
			timeFilter: 'all',
			timeFilters: [ 'past' ],
		} );

		expect(
			within( container ).getByRole( 'checkbox', { name: 'Past' } )
		).toBeChecked();
		expect(
			within( container ).getByRole( 'checkbox', { name: 'Future' } )
		).not.toBeChecked();
	} );

	it( 'adds a checked period to the saved selection', async () => {
		const { container, setAttributes } = await renderBlock( {
			timeFilter: 'upcoming',
		} );

		await act( async () => {
			within( container )
				.getByRole( 'checkbox', { name: 'Current' } )
				.click();
		} );

		expect( setAttributes ).toHaveBeenCalledWith( {
			timeFilters: [ 'current', 'future' ],
		} );
	} );

	it( 'saves an empty selection when the last period is unchecked', async () => {
		const { container, setAttributes } = await renderBlock( {
			timeFilters: [ 'future' ],
		} );

		await act( async () => {
			within( container )
				.getByRole( 'checkbox', { name: 'Future' } )
				.click();
		} );

		expect( setAttributes ).toHaveBeenCalledWith( { timeFilters: [] } );
	} );

	it( 'guides the editor when no period is checked', async () => {
		const { container } = await renderBlock( { timeFilters: [] } );

		expect(
			container.querySelector( '.components-notice' ).textContent
		).toContain( 'Select at least one period to display events.' );
		within( container )
			.getAllByRole( 'checkbox' )
			.forEach( ( box ) => expect( box ).not.toBeChecked() );
	} );

	it( 'passes the periods, categories, and event feeds to the preview over POST', async () => {
		const { container } = await renderBlock( {
			timeFilters: [ 'current', 'future' ],
			categories: [ 3 ],
			eventSources: [ 'my-source' ],
		} );

		const ssr = within( container ).getByTestId( 'ssr' );
		const passedAttributes = JSON.parse(
			ssr.getAttribute( 'data-attributes' )
		);

		expect( passedAttributes.timeFilters ).toEqual( [
			'current',
			'future',
		] );
		expect( passedAttributes.categories ).toEqual( [ 3 ] );
		expect( passedAttributes.eventSources ).toEqual( [ 'my-source' ] );
		expect( mockServerSideRender ).toHaveBeenLastCalledWith(
			expect.objectContaining( { httpMethod: 'POST' } )
		);
	} );

	it( 'keeps an empty selection in the preview attributes', async () => {
		const { container } = await renderBlock( { timeFilters: [] } );

		const passedAttributes = JSON.parse(
			within( container )
				.getByTestId( 'ssr' )
				.getAttribute( 'data-attributes' )
		);

		expect( passedAttributes.timeFilters ).toEqual( [] );
	} );
} );
