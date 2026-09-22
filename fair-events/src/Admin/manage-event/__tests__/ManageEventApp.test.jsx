/**
 * @jest-environment jsdom
 *
 * Tests for the tab registry mechanism in ManageEventApp (#919).
 *
 * Exercises:
 *   - Built-in tabs render after the event loads.
 *   - A tab registered via addFilter('fairEvents.manageEvent.tabs') appears.
 *   - A descriptor with isVisible:false is omitted from the tab bar.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { addFilter, removeFilter } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import { formatSiteLocalDatetime } from 'fair-events-shared';
import ManageEventApp from '../ManageEventApp.js';

jest.mock( '@wordpress/api-fetch' );

jest.mock( '../EventTickets.js', () => {
	return function MockEventTickets( { isSeries } ) {
		return <div>Prices content; isSeries: { String( isSeries ) }</div>;
	};
} );

jest.mock( '../EventSignups.js', () => {
	return function MockEventSignups() {
		return <div>List content</div>;
	};
} );

const mockEventDate = {
	id: 1,
	title: 'Test Event',
	start_datetime: '2026-07-01 18:00:00',
	end_datetime: '2026-07-01 20:00:00',
	all_day: false,
	occurrence_type: 'single',
	link_type: 'none',
	external_url: '',
	venue_id: null,
	address: '',
	categories: [],
	linked_posts: [],
	rrule: null,
	display_url: null,
	event_id: null,
	master: null,
	generated_occurrences: [],
	cancelled_dates: [],
	status: 'active',
	recurrence_mode: 'none',
};

beforeEach( () => {
	// Use the Admin tab as the landing tab so the event-details form
	// (SelectControl / FormTokenField) does not render by default.
	// Those components emit @wordpress/components deprecation warnings that
	// would fail the @wordpress/jest-console check.
	window.history.replaceState( {}, '', '?tab=admin' );

	window.fairEventsManageEventData = {
		eventDateId: '1',
		calendarUrl: 'http://example.com/calendar',
		manageEventUrl: 'http://example.com/manage',
		enabledPostTypes: [],
		enabledFeatures: {},
	};

	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );

	apiFetch.mockImplementation( ( opts ) => {
		if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
			return Promise.resolve( mockEventDate );
		}
		return Promise.resolve( [] );
	} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
	delete window.fairEventsManageEventData;
	window.history.replaceState( {}, '', '/' );
} );

it( 'renders built-in Event Details and Admin tabs after loading', async () => {
	render( <ManageEventApp /> );
	// Admin is the initial tab (set via URL in beforeEach). Wait for it to
	// appear, which confirms the event loaded and the tab bar rendered.
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'Admin' } )
		).toBeInTheDocument()
	);
	expect(
		screen.getByRole( 'tab', { name: 'Event Details' } )
	).toBeInTheDocument();
} );

it( 'renders a tab registered via addFilter', async () => {
	const NAMESPACE = 'test/custom-tab-919';
	addFilter( 'fairEvents.manageEvent.tabs', NAMESPACE, ( descriptors ) => [
		...descriptors,
		{
			name: 'custom',
			title: 'Custom Tab',
			order: 999,
			isVisible: true,
			render: () => <div>Custom content</div>,
		},
	] );

	render( <ManageEventApp /> );
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'Admin' } )
		).toBeInTheDocument()
	);
	expect(
		screen.getByRole( 'tab', { name: 'Custom Tab' } )
	).toBeInTheDocument();

	removeFilter( 'fairEvents.manageEvent.tabs', NAMESPACE );
} );

it( 'renders extra admin actions registered via addFilter', async () => {
	const NAMESPACE = 'test/admin-action-919';
	addFilter(
		'fairEvents.manageEvent.adminActions',
		NAMESPACE,
		( actions ) => [
			...actions,
			<div key="custom-action">Custom action</div>,
		]
	);

	render( <ManageEventApp /> );
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'Admin' } )
		).toBeInTheDocument()
	);
	expect( screen.getByText( 'Custom action' ) ).toBeInTheDocument();

	removeFilter( 'fairEvents.manageEvent.adminActions', NAMESPACE );
} );

describe( 'copy event action (#1517)', () => {
	it( 'links to the authorized copy URL and keeps delete separate', async () => {
		window.fairEventsManageEventData.copyEventUrl =
			'http://example.com/wp-admin/admin.php?page=fair-events-copy&event_id=42&_wpnonce=test';

		render( <ManageEventApp /> );

		const copyAction = await screen.findByRole( 'link', {
			name: 'Copy event',
		} );
		expect( copyAction ).toHaveAttribute(
			'href',
			window.fairEventsManageEventData.copyEventUrl
		);
		expect(
			screen.getByText(
				'Open copy options with this event selected as the source.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Delete Event' } )
		).toBeInTheDocument();
		expect(
			screen.getByText( /Permanently delete this event/ ).parentElement
		).toHaveStyle( { borderTop: '1px solid #dcdcde' } );
	} );

	it( 'does not render the action without an authorized copy URL', async () => {
		render( <ManageEventApp /> );

		await screen.findByRole( 'tab', { name: 'Admin' } );
		expect(
			screen.queryByRole( 'link', { name: 'Copy event' } )
		).not.toBeInTheDocument();
	} );

	it( 'explains that a generated occurrence copies its recurring event', async () => {
		window.fairEventsManageEventData.copyEventUrl =
			'http://example.com/copy-event';
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( {
					...mockEventDate,
					occurrence_type: 'generated',
					master: { id: 10, title: 'Recurring source' },
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );

		expect(
			await screen.findByText(
				'Open copy options for the underlying recurring event, not only this date.'
			)
		).toBeInTheDocument();
	} );
} );

it( 'disables Prices and Finance tabs for external-URL events', async () => {
	window.history.replaceState( {}, '', '?tab=tickets' );
	window.fairEventsManageEventData = {
		eventDateId: '1',
		calendarUrl: 'http://example.com/calendar',
		manageEventUrl: 'http://example.com/manage',
		enabledPostTypes: [],
		enabledFeatures: { ticketing: true },
		paymentEntriesUrl: 'http://example.com/entries',
	};
	apiFetch.mockImplementation( ( opts ) => {
		if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
			return Promise.resolve( {
				...mockEventDate,
				link_type: 'external',
			} );
		}
		return Promise.resolve( [] );
	} );

	render( <ManageEventApp /> );
	// Prices tab is disabled, so the initial tab falls back to Event Details.
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'Event Details' } )
		).toBeInTheDocument()
	);
	expect( screen.getByRole( 'tab', { name: 'Prices' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect( screen.getByRole( 'tab', { name: 'Finance' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
} );

it( 'keeps Prices and Finance tabs enabled for post-linked events', async () => {
	window.history.replaceState( {}, '', '?tab=admin' );
	window.fairEventsManageEventData = {
		eventDateId: '1',
		calendarUrl: 'http://example.com/calendar',
		manageEventUrl: 'http://example.com/manage',
		enabledPostTypes: [],
		enabledFeatures: { ticketing: true },
		paymentEntriesUrl: 'http://example.com/entries',
	};
	apiFetch.mockImplementation( ( opts ) => {
		if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
			return Promise.resolve( { ...mockEventDate, link_type: 'post' } );
		}
		return Promise.resolve( [] );
	} );

	render( <ManageEventApp /> );
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'Admin' } )
		).toBeInTheDocument()
	);
	expect( screen.getByRole( 'tab', { name: 'Prices' } ) ).not.toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect(
		screen.getByRole( 'tab', { name: 'Finance' } )
	).not.toHaveAttribute( 'aria-disabled', 'true' );
} );

it( 'passes isSeries=true to EventTickets for an irregular (manual) series (#1158)', async () => {
	window.history.replaceState( {}, '', '?tab=prices' );
	window.fairEventsManageEventData = {
		eventDateId: '1',
		calendarUrl: 'http://example.com/calendar',
		manageEventUrl: 'http://example.com/manage',
		enabledPostTypes: [],
		enabledFeatures: { ticketing: true },
		paymentEntriesUrl: 'http://example.com/entries',
	};
	apiFetch.mockImplementation( ( opts ) => {
		if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
			return Promise.resolve( {
				...mockEventDate,
				rrule: null,
				recurrence_mode: 'manual',
			} );
		}
		return Promise.resolve( [] );
	} );

	render( <ManageEventApp /> );
	await waitFor( () =>
		expect( screen.getByText( /isSeries: true/ ) ).toBeInTheDocument()
	);
} );

describe( 'Prices and List tab routing (#1590)', () => {
	beforeEach( () => {
		window.fairEventsManageEventData.enabledFeatures = { ticketing: true };
	} );

	it( 'renders the renamed tab labels and writes canonical URL values', async () => {
		render( <ManageEventApp /> );

		const pricesTab = await screen.findByRole( 'tab', { name: 'Prices' } );
		const listTab = screen.getByRole( 'tab', { name: 'List' } );
		fireEvent.click( pricesTab );
		expect( window.location.search ).toBe( '?tab=prices' );
		fireEvent.click( listTab );
		expect( window.location.search ).toBe( '?tab=list' );
	} );

	it.each( [
		[ 'prices', 'Prices content' ],
		[ 'list', 'List content' ],
	] )( 'opens the %s canonical tab directly', async ( tab, content ) => {
		window.history.replaceState( {}, '', `?tab=${ tab }` );
		render( <ManageEventApp /> );
		expect(
			await screen.findByText( new RegExp( content ) )
		).toBeInTheDocument();
	} );

	it.each( [
		[ 'tickets', 'prices', 'Prices content' ],
		[ 'signups', 'list', 'List content' ],
	] )(
		'opens legacy tab %s and normalizes it to %s',
		async ( legacyTab, canonicalTab, content ) => {
			window.history.replaceState( {}, '', `?tab=${ legacyTab }` );
			render( <ManageEventApp /> );

			expect(
				await screen.findByText( new RegExp( content ) )
			).toBeInTheDocument();
			expect( window.location.search ).toBe( `?tab=${ canonicalTab }` );
		}
	);
} );

it( 'omits a descriptor with isVisible: false', async () => {
	const NAMESPACE = 'test/hidden-tab-919';
	addFilter( 'fairEvents.manageEvent.tabs', NAMESPACE, ( descriptors ) => [
		...descriptors,
		{
			name: 'hidden',
			title: 'Hidden Tab',
			order: 999,
			isVisible: false,
			render: () => null,
		},
	] );

	render( <ManageEventApp /> );
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'Admin' } )
		).toBeInTheDocument()
	);
	expect(
		screen.queryByRole( 'tab', { name: 'Hidden Tab' } )
	).not.toBeInTheDocument();

	removeFilter( 'fairEvents.manageEvent.tabs', NAMESPACE );
} );

describe( 'context header (#986)', () => {
	it( 'shows the date and no series/occurrence badge for a one-off event', async () => {
		render( <ManageEventApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Admin' } )
			).toBeInTheDocument()
		);

		expect(
			screen.getByText(
				new RegExp(
					formatSiteLocalDatetime(
						mockEventDate.start_datetime
					).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' )
				)
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText( /Recurring series/ )
		).not.toBeInTheDocument();
		expect( screen.queryByText( /Occurrence of/ ) ).not.toBeInTheDocument();
	} );

	it( 'shows a series badge with the occurrence count for a master', async () => {
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( {
					...mockEventDate,
					occurrence_type: 'master',
					rrule: 'FREQ=WEEKLY',
					generated_occurrences: [
						{ id: 2, start_datetime: '2026-07-08 18:00:00' },
						{ id: 3, start_datetime: '2026-07-15 18:00:00' },
					],
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Admin' } )
			).toBeInTheDocument()
		);

		expect(
			screen.getByText( 'Recurring series — 3 dates' )
		).toBeInTheDocument();
	} );

	it( 'links a generated occurrence to its master and removes the bottom notice', async () => {
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( {
					...mockEventDate,
					occurrence_type: 'generated',
					master: {
						id: 1,
						title: 'Master Event',
						start_datetime: '2026-07-01 18:00:00',
					},
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Admin' } )
			).toBeInTheDocument()
		);

		expect( screen.getByText( /Occurrence of/ ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'view series' } )
		).toHaveAttribute(
			'href',
			'http://example.com/manage&event_date_id=1'
		);
		expect(
			screen.queryByText( 'This is a recurring occurrence of:' )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( /Tickets are managed on the series/ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'open the master event' } )
		).toHaveAttribute(
			'href',
			'http://example.com/manage&event_date_id=1'
		);
	} );
} );

describe( 'edit instances modal (#981 Part 3)', () => {
	it( 'opens the Edit instances modal from the Recurrence card', async () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( {
					...mockEventDate,
					occurrence_type: 'master',
					rrule: 'FREQ=WEEKLY',
					generated_occurrences: [
						{
							id: 2,
							start_datetime: '2026-07-08 18:00:00',
							status: 'active',
						},
						{
							id: 3,
							start_datetime: '2026-07-15 18:00:00',
							status: 'cancelled',
						},
					],
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Event Details' } )
			).toBeInTheDocument()
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit instances' } )
		);

		expect(
			screen.getByRole( 'heading', { name: 'Edit instances' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Restore' } )
		).toBeInTheDocument();
	} );
} );

describe( 'create-on-the-fly categories (#992)', () => {
	beforeEach( () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
	} );

	it( 'creates and links a category typed as an unknown token', async () => {
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( mockEventDate );
			}
			if (
				opts.path &&
				opts.path.startsWith( '/fair-events/v1/sources/categories' )
			) {
				if ( opts.method === 'POST' ) {
					return Promise.resolve( {
						id: 5,
						name: 'Workshops',
						slug: 'workshops',
					} );
				}
				return Promise.resolve( [
					{ id: 1, name: 'Music', slug: 'music' },
				] );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Event Details' } )
			).toBeInTheDocument()
		);

		const input = await screen.findByLabelText( 'Categories' );
		fireEvent.change( input, { target: { value: 'Workshops' } } );
		fireEvent.keyDown( input, { key: 'Enter', code: 'Enter' } );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-events/v1/sources/categories',
					method: 'POST',
					data: { name: 'Workshops' },
				} )
			)
		);

		expect( await screen.findByText( 'Workshops' ) ).toBeInTheDocument();
	} );
} );

describe( 'multilingual categories (#1636)', () => {
	beforeEach( () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
	} );

	const multilingualEventDate = {
		...mockEventDate,
		categories: [
			{ id: 1, name: 'Bart', slug: 'bart' },
			{ id: 2, name: 'Bart', slug: 'bart-es' },
		],
	};

	const mockMultilingualCategories = ( { availableIds = [ 1, 2 ] } = {} ) => {
		const allCategories = [
			{ id: 1, name: 'Bart', slug: 'bart', language: 'English' },
			{ id: 2, name: 'Bart', slug: 'bart-es', language: 'Spanish' },
		];
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				if ( opts.method === 'PUT' ) {
					return Promise.resolve( multilingualEventDate );
				}
				return Promise.resolve( multilingualEventDate );
			}
			if (
				opts.path &&
				opts.path.startsWith( '/fair-events/v1/sources/categories' )
			) {
				return Promise.resolve(
					allCategories.filter( ( c ) =>
						availableIds.includes( c.id )
					)
				);
			}
			return Promise.resolve( [] );
		} );
	};

	it( 'requests every configured language and distinguishes same-named categories', async () => {
		mockMultilingualCategories();

		render( <ManageEventApp /> );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-events/v1/sources/categories?all_languages=true',
				} )
			)
		);

		expect(
			await screen.findByText( 'Bart — English' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Bart — Spanish' ) ).toBeInTheDocument();
	} );

	it( 'keeps a selected category that the latest fetch omitted', async () => {
		// Only the English term comes back from sources/categories (e.g. a
		// slow or partial fetch); the Spanish one is still on the event.
		mockMultilingualCategories( { availableIds: [ 1 ] } );

		render( <ManageEventApp /> );

		expect(
			await screen.findByText( 'Bart — English' )
		).toBeInTheDocument();
		// The context header also renders a "Bart" category badge, so scope
		// this check to the token field itself rather than screen.getByText.
		const tokenLabels = Array.from(
			document.querySelectorAll(
				'.components-form-token-field__token-text > [aria-hidden="true"]'
			)
		).map( ( el ) => el.textContent );
		expect( tokenLabels ).toEqual(
			expect.arrayContaining( [ 'Bart — English', 'Bart' ] )
		);
	} );

	it( 'keeps language labels when the saved event resolves after the language-rich options', async () => {
		// Reproduces #1636's follow-up report: if the saved-event fetch
		// (whose categories carry no language) lands *after* the
		// all-languages options fetch, it must not blank out the language
		// labels the options response already supplied.
		const allCategories = [
			{ id: 1, name: 'Bart', slug: 'bart', language: 'English' },
			{ id: 2, name: 'Bart', slug: 'bart-es', language: 'Spanish' },
		];
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return new Promise( ( resolve ) =>
					setTimeout( () => resolve( multilingualEventDate ), 10 )
				);
			}
			if (
				opts.path &&
				opts.path.startsWith( '/fair-events/v1/sources/categories' )
			) {
				return Promise.resolve( allCategories );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );

		expect(
			await screen.findByText( 'Bart — English' )
		).toBeInTheDocument();
		expect(
			await screen.findByText( 'Bart — Spanish' )
		).toBeInTheDocument();
	} );

	it( 'preserves every language on an unrelated save', async () => {
		mockMultilingualCategories();

		render( <ManageEventApp /> );
		const titleInput = await screen.findByLabelText( 'Title' );
		fireEvent.change( titleInput, { target: { value: 'Edited title' } } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save event details' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					method: 'PUT',
					data: expect.objectContaining( { categories: [ 1, 2 ] } ),
				} )
			)
		);
	} );

	it( 'shows an error when the save response drops a selected category', async () => {
		mockMultilingualCategories();
		const originalFetch = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( options ) =>
			options.method === 'PUT'
				? Promise.resolve( {
						...multilingualEventDate,
						categories: multilingualEventDate.categories.slice(
							0,
							1
						),
				  } )
				: originalFetch( options )
		);

		render( <ManageEventApp /> );
		await screen.findByText( 'Bart — Spanish' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save event details' } )
		);
		expect(
			await screen.findByText(
				'Some selected categories were not saved. Please try again.'
			)
		).toBeInTheDocument();
	} );

	it( 'removing one category persists only the remaining selection', async () => {
		mockMultilingualCategories();

		render( <ManageEventApp /> );
		await screen.findByText( 'Bart — Spanish' );

		const removeButtons = screen.getAllByRole( 'button', {
			name: 'Remove item',
		} );
		fireEvent.click( removeButtons[ 1 ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save event details' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					method: 'PUT',
					data: expect.objectContaining( { categories: [ 1 ] } ),
				} )
			)
		);
	} );
} );

describe( 'single-event recurrence action (#1343)', () => {
	beforeEach( () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
	} );

	it( 'shows only the Turn into a series button, with no Recurrence card', async () => {
		render( <ManageEventApp /> );

		expect(
			await screen.findByRole( 'button', {
				name: 'Turn into a series',
			} )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'heading', { name: 'Recurrence' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'This event happens once.' )
		).not.toBeInTheDocument();
	} );

	it( 'opens the series modal from the standalone button', async () => {
		render( <ManageEventApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Turn into a series',
			} )
		);

		expect(
			screen.getByRole( 'heading', { name: 'Turn into a series' } )
		).toBeInTheDocument();
	} );

	it( 'keeps the Recurrence card with its summary and controls for a series master', async () => {
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( {
					...mockEventDate,
					occurrence_type: 'master',
					rrule: 'FREQ=WEEKLY',
					generated_occurrences: [
						{ id: 2, start_datetime: '2026-07-08 18:00:00' },
					],
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );

		expect(
			await screen.findByRole( 'heading', { name: 'Recurrence' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Edit series' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'End series' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Turn into a series',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'shows neither the button nor the card for a generated occurrence', async () => {
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( {
					...mockEventDate,
					occurrence_type: 'generated',
					master: { id: 1, title: 'Master Event' },
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );

		await screen.findByLabelText( 'Title' );
		expect(
			screen.queryByRole( 'button', {
				name: 'Turn into a series',
			} )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'heading', { name: 'Recurrence' } )
		).not.toBeInTheDocument();
	} );
} );

describe( 'delete confirmation dialog (#991)', () => {
	it( 'shows the title and date, and no occurrence count, for a one-off event', async () => {
		render( <ManageEventApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Admin' } )
			).toBeInTheDocument()
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete Event' } )
		);

		expect(
			screen.getByText(
				`Delete Test Event on ${ formatSiteLocalDatetime(
					mockEventDate.start_datetime
				) }? This cannot be undone.`
			)
		).toBeInTheDocument();
	} );

	it( 'shows the occurrence count for a recurring master', async () => {
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( {
					...mockEventDate,
					occurrence_type: 'master',
					generated_occurrences: Array.from(
						{ length: 9 },
						( _, i ) => ( {
							id: i + 2,
							start_datetime: '2026-07-08 18:00:00',
						} )
					),
				} );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Admin' } )
			).toBeInTheDocument()
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete Event' } )
		);

		expect(
			screen.getByText(
				'Delete Test Event and its 9 occurrences? This cannot be undone.'
			)
		).toBeInTheDocument();
	} );
} );

describe( 'per-tab save model (#987)', () => {
	it( 'renders no save button on the read-only Admin tab', async () => {
		render( <ManageEventApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Admin' } )
			).toBeInTheDocument()
		);

		expect(
			screen.queryByRole( 'button', { name: 'Save event details' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save tickets' } )
		).not.toBeInTheDocument();
	} );

	it( 'renders "Save event details" only on the Event Details tab', async () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
		render( <ManageEventApp /> );

		expect(
			await screen.findByRole( 'button', { name: 'Save event details' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save tickets' } )
		).not.toBeInTheDocument();
		// The old tab-dependent global button is gone.
		expect(
			screen.queryByRole( 'button', { name: 'Save Changes' } )
		).not.toBeInTheDocument();
	} );

	it( 'disables the save button and shows an inline message when the title is empty', async () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
		render( <ManageEventApp /> );

		const titleInput = await screen.findByLabelText( 'Title' );
		fireEvent.change( titleInput, { target: { value: '' } } );

		expect(
			screen.getByRole( 'button', { name: 'Save event details' } )
		).toBeDisabled();
		expect( screen.getByText( 'Title is required' ) ).toBeInTheDocument();
	} );

	it( 'enables the save button once a title is entered', async () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
		render( <ManageEventApp /> );

		const titleInput = await screen.findByLabelText( 'Title' );
		fireEvent.change( titleInput, { target: { value: '' } } );
		fireEvent.change( titleInput, { target: { value: 'New title' } } );

		expect(
			screen.getByRole( 'button', { name: 'Save event details' } )
		).not.toBeDisabled();
		expect(
			screen.queryByText( 'Title is required' )
		).not.toBeInTheDocument();
	} );

	it( 'marks the Event Details tab dirty and guards navigation while editing', async () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
		const addListenerSpy = jest.spyOn( window, 'addEventListener' );
		render( <ManageEventApp /> );

		const titleInput = await screen.findByLabelText( 'Title' );
		expect(
			screen.getByRole( 'tab', { name: 'Event Details' } )
		).toBeInTheDocument();

		fireEvent.change( titleInput, { target: { value: 'Edited title' } } );

		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Event Details •' } )
			).toBeInTheDocument()
		);
		expect( addListenerSpy ).toHaveBeenCalledWith(
			'beforeunload',
			expect.any( Function )
		);

		addListenerSpy.mockRestore();
	} );

	it( 'clears the dirty marker after a successful save', async () => {
		window.history.replaceState( {}, '', '?tab=event-details' );
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.method === 'PUT' ) {
				return Promise.resolve( {
					...mockEventDate,
					title: 'Edited title',
				} );
			}
			if ( opts.path && opts.path.includes( '/event-dates/' ) ) {
				return Promise.resolve( mockEventDate );
			}
			return Promise.resolve( [] );
		} );

		render( <ManageEventApp /> );

		const titleInput = await screen.findByLabelText( 'Title' );
		fireEvent.change( titleInput, { target: { value: 'Edited title' } } );

		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Event Details •' } )
			).toBeInTheDocument()
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save event details' } )
		);

		await waitFor( () =>
			expect(
				screen.getByRole( 'tab', { name: 'Event Details' } )
			).toBeInTheDocument()
		);
	} );
} );
