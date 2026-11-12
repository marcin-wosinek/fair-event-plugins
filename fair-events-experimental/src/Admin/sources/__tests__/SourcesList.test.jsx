/**
 * @jest-environment jsdom
 *
 * Event Feeds management screen (#1808): the feature is presented as
 * "Event Feeds" while admin URLs and REST routes keep their `sources` names.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SourcesList from '../SourcesList.js';

jest.mock( '@wordpress/api-fetch' );

const FEEDS = [
	{
		id: 3,
		name: 'Club nights',
		slug: 'club-nights',
		enabled: true,
		data_sources: [
			{ source_type: 'categories', config: { category_ids: [ 1 ] } },
			{
				source_type: 'ical_url',
				config: { url: 'https://x.test/a.ics' },
			},
		],
	},
	{
		id: 4,
		name: 'Workshops',
		slug: 'workshops',
		enabled: false,
		data_sources: [ { source_type: 'categories', config: {} } ],
	},
];

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	apiFetch.mockImplementation( ( { path } ) =>
		Promise.resolve( path === '/fair-events/v1/sources' ? FEEDS : [] )
	);
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

const deleteCalls = () =>
	apiFetch.mock.calls.filter(
		( [ options ] ) => options.method === 'DELETE'
	);

const NOTICE = { selector: '.components-notice__content' };

const rowOf = ( name ) => screen.getByRole( 'link', { name } ).closest( 'tr' );

/** Open a feed's overflow menu and choose one of its items. */
async function chooseMenuItem( feed, item ) {
	const toggle = screen.getByRole( 'button', {
		name: `More actions for “${ feed }”`,
	} );
	act( () => toggle.focus() );
	fireEvent.click( toggle );
	const menu = await screen.findByRole( 'menu', {
		name: `More actions for “${ feed }”`,
	} );
	await act( async () =>
		fireEvent.click(
			within( menu ).getByRole( 'menuitem', { name: item } )
		)
	);
	return toggle;
}

describe( 'SourcesList', () => {
	it( 'lists event feeds and keeps the existing view links', async () => {
		render( <SourcesList /> );

		expect(
			await screen.findByRole( 'link', { name: 'Club nights' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-source-view&source_id=3'
		);
		expect(
			screen.getByRole( 'heading', { name: 'Event Feeds' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'columnheader', { name: 'Feed inputs' } )
		).toBeInTheDocument();
		expect( screen.getByText( '2 feed inputs' ) ).toBeInTheDocument();
		expect( screen.getByText( '1 feed input' ) ).toBeInTheDocument();
	} );

	it( 'puts Add Event Feed beside the title and counts every feed', async () => {
		render( <SourcesList /> );
		await screen.findByRole( 'link', { name: 'Club nights' } );

		const header = screen
			.getByRole( 'heading', { name: 'Event Feeds' } )
			.closest( '.fair-admin-list-header' );
		expect(
			within( header ).getByRole( 'button', { name: 'Add Event Feed' } )
		).toBeInTheDocument();
		expect( screen.getByRole( 'status' ) ).toHaveTextContent(
			'2 event feeds'
		);
		// The complete list: no search, filters, selection or pagination.
		expect( screen.queryByRole( 'searchbox' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'checkbox' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'navigation' ) ).not.toBeInTheDocument();
	} );

	it( 'explains the empty state in event feed terms', async () => {
		apiFetch.mockResolvedValue( [] );

		render( <SourcesList /> );

		expect(
			await screen.findByText(
				'No event feeds yet. Add your first event feed to get started.'
			)
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add your first event feed' } )
		);
		const dialog = screen.getByRole( 'dialog', { name: 'Add Event Feed' } );
		await within( dialog ).findByText(
			'No categories found. Create categories first.'
		);
	} );

	it( 'opens the add form with feed input controls', async () => {
		render( <SourcesList /> );
		await screen.findByRole( 'link', { name: 'Club nights' } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add Event Feed' } )
		);

		const dialog = screen.getByRole( 'dialog', { name: 'Add Event Feed' } );
		// Let the categories input finish loading before the test ends.
		await within( dialog ).findByText(
			'No categories found. Create categories first.'
		);
		expect(
			within( dialog ).getByLabelText( 'Event feed name' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'heading', { name: 'Feed input #1' } )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByLabelText( 'Input type' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Add feed input' } )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Create event feed',
			} )
		).toBeInTheDocument();
	} );

	it( 'opens the edit form for an existing event feed', async () => {
		render( <SourcesList /> );
		await screen.findByRole( 'link', { name: 'Club nights' } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit “Club nights”' } )
		);

		const dialog = screen.getByRole( 'dialog', {
			name: 'Edit Event Feed',
		} );
		// Let the categories input finish loading before the test ends.
		await within( dialog ).findByText(
			'No categories found. Create categories first.'
		);
		expect(
			within( dialog ).getByLabelText( 'Event feed name' )
		).toHaveValue( 'Club nights' );
		expect(
			within( dialog ).getByRole( 'heading', { name: 'Feed input #2' } )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Update event feed',
			} )
		).toBeInTheDocument();
	} );

	describe( 'feed rows', () => {
		it( 'combines name and slug, shows status text and keeps five columns', async () => {
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Club nights' } );

			expect(
				screen
					.getAllByRole( 'columnheader' )
					.map( ( header ) => header.textContent )
			).toEqual( [
				'Feed',
				'Feed inputs',
				'WhatsApp',
				'Status',
				'Actions',
			] );
			const club = within( rowOf( 'Club nights' ) );
			expect( club.getByText( 'club-nights' ) ).toHaveClass(
				'fair-admin-table__identity-meta'
			);
			expect( club.getByText( 'Enabled' ) ).toHaveClass(
				'fair-admin-table__status--success'
			);
			expect(
				within( rowOf( 'Workshops' ) ).getByText( 'Disabled' )
			).toHaveClass( 'fair-admin-table__status--neutral' );
			expect(
				screen.queryByRole( 'button', { name: 'View' } )
			).not.toBeInTheDocument();
		} );

		it( 'names an unnamed feed with a fallback', async () => {
			apiFetch.mockResolvedValue( [ { ...FEEDS[ 0 ], name: '' } ] );
			render( <SourcesList /> );

			expect(
				await screen.findByRole( 'link', { name: '(untitled feed)' } )
			).toHaveAttribute(
				'href',
				'admin.php?page=fair-events-source-view&source_id=3'
			);
			expect(
				screen.getByRole( 'button', {
					name: 'More actions for “(untitled feed)”',
				} )
			).toBeInTheDocument();
		} );
	} );

	describe( 'copying feed URLs', () => {
		let writeText;

		beforeEach( () => {
			window.fairEventsSourcesData = {
				icalUrlTemplate:
					'https://example.test/?rest_route=/fair-events/v1/sources/{slug}/ical',
				jsonUrlTemplate:
					'https://example.test/wp-json/fair-events/v1/sources/{slug}/json',
			};
			writeText = jest.fn().mockResolvedValue( undefined );
			Object.defineProperty( window.navigator, 'clipboard', {
				configurable: true,
				value: { writeText },
			} );
		} );

		afterEach( () => {
			delete window.fairEventsSourcesData;
			delete window.navigator.clipboard;
		} );

		it( 'copies the exact iCal and JSON URLs and confirms each', async () => {
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Club nights' } );

			const toggle = await chooseMenuItem(
				'Club nights',
				'Copy iCal feed URL'
			);
			expect( writeText ).toHaveBeenLastCalledWith(
				'https://example.test/?rest_route=/fair-events/v1/sources/club-nights/ical'
			);
			expect(
				await screen.findByText(
					'iCal feed URL for “Club nights” copied.',
					NOTICE
				)
			).toBeInTheDocument();
			expect( toggle ).toHaveFocus();

			await chooseMenuItem( 'Workshops', 'Copy JSON API URL' );
			expect( writeText ).toHaveBeenLastCalledWith(
				'https://example.test/wp-json/fair-events/v1/sources/workshops/json'
			);
			expect(
				await screen.findByText(
					'JSON API URL for “Workshops” copied.',
					NOTICE
				)
			).toBeInTheDocument();
		} );

		it( 'shows the URL when the clipboard rejects the copy, and retries', async () => {
			writeText.mockRejectedValueOnce( new Error( 'denied' ) );
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Club nights' } );

			await chooseMenuItem( 'Club nights', 'Copy JSON API URL' );
			expect(
				await screen.findByText(
					'The JSON API URL for “Club nights” could not be copied to the clipboard. Copy it here instead: https://example.test/wp-json/fair-events/v1/sources/club-nights/json',
					NOTICE
				)
			).toBeInTheDocument();

			await chooseMenuItem( 'Club nights', 'Copy JSON API URL' );
			expect(
				await screen.findByText(
					'JSON API URL for “Club nights” copied.',
					NOTICE
				)
			).toBeInTheDocument();
		} );

		it( 'explains a missing clipboard', async () => {
			delete window.navigator.clipboard;
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Club nights' } );

			await chooseMenuItem( 'Club nights', 'Copy iCal feed URL' );
			expect(
				await screen.findByText(
					/could not be copied to the clipboard\. Copy it here instead: https:\/\/example\.test\/\?rest_route=\/fair-events\/v1\/sources\/club-nights\/ical$/,
					NOTICE
				)
			).toBeInTheDocument();
		} );
	} );

	describe( 'list states', () => {
		it( 'reports an initial load failure and retries', async () => {
			apiFetch.mockRejectedValueOnce( { message: 'Server down.' } );
			render( <SourcesList /> );

			expect(
				await screen.findByText( 'Server down.', NOTICE )
			).toBeInTheDocument();
			expect(
				screen.queryByText(
					'No event feeds yet. Add your first event feed to get started.'
				)
			).not.toBeInTheDocument();

			await act( async () =>
				fireEvent.click(
					screen.getByRole( 'button', { name: 'Try again' } )
				)
			);
			expect(
				await screen.findByRole( 'link', { name: 'Club nights' } )
			).toBeInTheDocument();
			expect(
				screen.queryByText( 'Server down.', NOTICE )
			).not.toBeInTheDocument();
		} );

		it( 'keeps the rows when a refresh fails', async () => {
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Club nights' } );
			apiFetch.mockImplementation( ( { method } ) =>
				method === 'DELETE'
					? Promise.resolve( { deleted: true } )
					: Promise.reject( { message: 'Refresh failed.' } )
			);

			await chooseMenuItem( 'Club nights', 'Delete' );
			await act( async () =>
				fireEvent.click(
					screen.getByRole( 'button', { name: 'Delete event feed' } )
				)
			);

			expect(
				await screen.findByText( 'Refresh failed.', NOTICE )
			).toBeInTheDocument();
			expect(
				screen.queryByRole( 'link', { name: 'Club nights' } )
			).not.toBeInTheDocument();
			expect(
				screen.getByRole( 'link', { name: 'Workshops' } )
			).toBeInTheDocument();
			expect(
				screen.getByRole( 'button', { name: 'Try again' } )
			).toBeInTheDocument();
		} );
	} );

	describe( 'WhatsApp summary column', () => {
		const WHATSAPP_FEEDS = [
			{
				...FEEDS[ 0 ],
				page_id: 7,
				weekly_summary_url:
					'https://example.test/fair-events-weekly-summary/club-nights/',
			},
			{
				id: 5,
				name: 'Jams',
				slug: 'jams',
				enabled: true,
				page_id: 8,
				data_sources: [],
				weekly_summary_url:
					'https://example.test/?fair_weekly_summary=jams',
			},
			{
				id: 6,
				name: 'Talks',
				slug: 'talks',
				enabled: true,
				page_id: null,
				data_sources: [],
				weekly_summary_url: null,
			},
			{
				...FEEDS[ 1 ],
				page_id: 9,
				weekly_summary_url:
					'https://example.test/fair-events-weekly-summary/workshops/',
			},
		];
		const row = ( name ) =>
			screen.getByRole( 'link', { name } ).closest( 'tr' );

		beforeEach( () => {
			apiFetch.mockImplementation( ( { path } ) =>
				Promise.resolve(
					path === '/fair-events/v1/sources' ? WHATSAPP_FEEDS : []
				)
			);
		} );

		it( 'links each enabled feed with a page to its own summary', async () => {
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Club nights' } );

			expect(
				screen.getByRole( 'columnheader', { name: 'WhatsApp' } )
			).toBeInTheDocument();
			expect(
				within( row( 'Club nights' ) ).getByRole( 'link', {
					name: 'Open WhatsApp summary',
				} )
			).toHaveAttribute(
				'href',
				'https://example.test/fair-events-weekly-summary/club-nights/'
			);
			expect(
				within( row( 'Jams' ) ).getByRole( 'link', {
					name: 'Open WhatsApp summary',
				} )
			).toHaveAttribute(
				'href',
				'https://example.test/?fair_weekly_summary=jams'
			);
		} );

		it( 'asks for a page when the feed has none', async () => {
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Talks' } );

			const talks = within( row( 'Talks' ) );
			expect(
				talks.getByText(
					'Choose a page to enable the WhatsApp summary.'
				)
			).toBeInTheDocument();
			expect(
				talks.queryByRole( 'link', { name: 'Open WhatsApp summary' } )
			).not.toBeInTheDocument();
		} );

		it( 'asks to enable a disabled feed instead of linking it', async () => {
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Workshops' } );

			const workshops = within( row( 'Workshops' ) );
			expect(
				workshops.getByText(
					'Enable this feed to use its WhatsApp summary.'
				)
			).toBeInTheDocument();
			expect(
				workshops.queryByRole( 'link', {
					name: 'Open WhatsApp summary',
				} )
			).not.toBeInTheDocument();
		} );
	} );

	describe( 'deleting an event feed', () => {
		const openDelete = async () => {
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Club nights' } );
			await chooseMenuItem( 'Club nights', 'Delete' );
			return screen.getByRole( 'dialog', {
				name: 'Delete event feed — Club nights',
			} );
		};
		it( 'names the feed and its URLs, and cancelling sends nothing', async () => {
			const dialog = await openDelete();

			expect(
				within( dialog ).getByText( /slug “club-nights”/ )
			).toBeInTheDocument();
			expect(
				within( dialog ).getByRole( 'button', {
					name: 'Delete event feed',
				} )
			).toHaveClass( 'is-destructive' );

			fireEvent.click(
				within( dialog ).getByRole( 'button', { name: 'Cancel' } )
			);

			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			expect( deleteCalls() ).toHaveLength( 0 );
		} );

		it( 'moves focus to the heading after deleting', async () => {
			let remaining = FEEDS;
			apiFetch.mockImplementation( ( { path, method } ) => {
				if ( method === 'DELETE' ) {
					remaining = FEEDS.slice( 1 );
					return Promise.resolve( { deleted: true } );
				}
				return Promise.resolve(
					path === '/fair-events/v1/sources' ? remaining : []
				);
			} );
			const dialog = await openDelete();
			await act( async () =>
				fireEvent.click(
					within( dialog ).getByRole( 'button', {
						name: 'Delete event feed',
					} )
				)
			);

			expect(
				screen.queryByRole( 'link', { name: 'Club nights' } )
			).not.toBeInTheDocument();
			expect(
				screen.getByRole( 'heading', { name: 'Event Feeds' } )
			).toHaveFocus();
		} );

		it( 'blocks cancelling and a second submission while pending', async () => {
			let finish;
			apiFetch.mockImplementation( ( { path, method } ) => {
				if ( method === 'DELETE' ) {
					return new Promise( ( resolve ) => {
						finish = resolve;
					} );
				}
				return Promise.resolve(
					path === '/fair-events/v1/sources' ? FEEDS : []
				);
			} );
			const dialog = await openDelete();
			const confirm = within( dialog ).getByRole( 'button', {
				name: 'Delete event feed',
			} );

			act( () => {
				fireEvent.click( confirm );
				fireEvent.click( confirm );
			} );
			fireEvent.click(
				within( dialog ).getByRole( 'button', { name: 'Cancel' } )
			);

			expect( deleteCalls() ).toHaveLength( 1 );
			expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
			expect(
				within( dialog ).getByText( 'Deleting…' )
			).toBeInTheDocument();

			await act( async () => finish( { deleted: true } ) );
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		} );

		it( 'keeps the dialog open on failure and retries', async () => {
			let failNext = true;
			apiFetch.mockImplementation( ( { path, method } ) => {
				if ( method === 'DELETE' ) {
					if ( failNext ) {
						failNext = false;
						return Promise.reject( {
							message: 'Event feed not found.',
						} );
					}
					return Promise.resolve( { deleted: true } );
				}
				return Promise.resolve(
					path === '/fair-events/v1/sources' ? FEEDS : []
				);
			} );
			const dialog = await openDelete();
			const confirm = within( dialog ).getByRole( 'button', {
				name: 'Delete event feed',
			} );

			await act( async () => fireEvent.click( confirm ) );

			expect(
				within( dialog ).getByText( 'Event feed not found.', {
					selector: '.components-notice__content',
				} )
			).toBeInTheDocument();

			await act( async () => fireEvent.click( confirm ) );

			expect( deleteCalls() ).toHaveLength( 2 );
			expect( deleteCalls()[ 1 ][ 0 ].path ).toBe(
				'/fair-events/v1/sources/3'
			);
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			expect(
				await screen.findByText( 'Event feed “Club nights” deleted.', {
					selector: '.components-notice__content',
				} )
			).toBeInTheDocument();
		} );
	} );
} );
