/**
 * @jest-environment jsdom
 *
 * Tests for the public marketing asset pages (#2430): the index, an
 * occurrence's assets with exact text, member and label filters and
 * clearing them, text copying and its fallback, image downloads, and the
 * loading, empty, filtered-empty and error states.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	act,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import App from '../App.js';

jest.mock( '@wordpress/api-fetch' );

const ANA = { key: '0123456789abcdef', name: 'Ana', surname: 'Ruiz' };
const ANA_TWIN = { key: 'fedcba9876543210', name: 'Ana', surname: 'Ruiz' };
const EXACT_TEXT =
	'  Ven al taller 🎉\n\tPlazas: 20  \n\n<b>not bold</b> &amp;\n';

const asset = ( overrides = {} ) => ( {
	id: 1,
	label: 'Instagram post',
	text: EXACT_TEXT,
	image: null,
	image_unavailable: false,
	members: [],
	...overrides,
} );

const occurrence = ( items, overrides = {} ) => ( {
	event_date_id: 7,
	title: null,
	url: 'http://localhost/?fair_marketing_assets=7',
	index_url: 'http://localhost/?fair_marketing_assets=all',
	filters: {
		members: [ ANA, ANA_TWIN ],
		labels: [ 'Instagram post', 'WhatsApp status' ],
	},
	items,
	total: items.length,
	page: 1,
	per_page: 50,
	total_pages: 1,
	...overrides,
} );

function setClipboard( writeText ) {
	Object.defineProperty( window.navigator, 'clipboard', {
		value: writeText ? { writeText } : undefined,
		configurable: true,
	} );
}

afterEach( () => {
	jest.resetAllMocks();
	setClipboard( undefined );
} );

describe( 'public marketing assets', () => {
	it( 'lists every event, named by title or ID, and loads more', async () => {
		apiFetch
			.mockResolvedValueOnce( {
				items: [
					{
						event_date_id: 9,
						title: 'Rock & Roll',
						url: 'http://localhost/?fair_marketing_assets=9',
					},
					{
						event_date_id: 8,
						title: null,
						url: 'http://localhost/?fair_marketing_assets=8',
					},
				],
				total: 3,
				page: 1,
			} )
			.mockResolvedValueOnce( {
				items: [
					{
						event_date_id: 2,
						title: null,
						url: 'http://localhost/?fair_marketing_assets=2',
					},
				],
				total: 3,
				page: 2,
			} );
		render( <App view="index" /> );

		expect( screen.getByText( 'Loading events…' ) ).toBeInTheDocument();
		expect(
			await screen.findByRole( 'link', { name: 'Rock & Roll' } )
		).toHaveAttribute(
			'href',
			'http://localhost/?fair_marketing_assets=9'
		);
		expect(
			screen.getByRole( 'link', { name: 'Event #8' } )
		).toBeInTheDocument();
		expect( screen.getByText( '3 events' ) ).toBeInTheDocument();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Show more' } )
			);
		} );
		expect(
			await screen.findByRole( 'link', { name: 'Event #2' } )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events/v1/marketing-assets?per_page=50&page=2',
		} );
		expect(
			screen.queryByRole( 'button', { name: 'Show more' } )
		).toBeNull();
	} );

	it( 'shows text exactly as stored and copies it unchanged', async () => {
		const writeText = jest.fn().mockResolvedValue();
		setClipboard( writeText );
		apiFetch.mockResolvedValue( occurrence( [ asset() ] ) );
		const { container } = render(
			<App view="occurrence" eventDateId={ 7 } />
		);

		await screen.findByRole( 'heading', { name: 'Instagram post' } );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/marketing-assets/7?per_page=50&page=1',
		} );
		const shown = container.querySelector( '.fair-marketing-assets__text' );
		expect( shown.textContent ).toBe( EXACT_TEXT );
		// Markup-like text stays text.
		expect( shown.querySelector( 'b' ) ).toBeNull();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Copy text' } )
			);
		} );
		expect( writeText ).toHaveBeenCalledWith( EXACT_TEXT );
		expect( screen.getByText( 'Text copied.' ) ).toBeInTheDocument();
	} );

	it( 'selects the text when the clipboard cannot be written', async () => {
		setClipboard( jest.fn().mockRejectedValue( new Error( 'Denied' ) ) );
		apiFetch.mockResolvedValue( occurrence( [ asset() ] ) );
		render( <App view="occurrence" eventDateId={ 7 } /> );

		const copy = await screen.findByRole( 'button', { name: 'Copy text' } );
		await act( async () => {
			fireEvent.click( copy );
		} );
		expect(
			await screen.findByText( /Couldn’t copy automatically/ )
		).toBeInTheDocument();
		expect( document.getSelection().toString() ).toBe( EXACT_TEXT );
	} );

	it( 'downloads images, opens cross-origin ones and flags missing ones', async () => {
		apiFetch.mockResolvedValue(
			occurrence( [
				asset( {
					id: 1,
					label: 'Poster',
					text: '',
					image: {
						url: 'http://localhost/wp-content/uploads/poster.png',
						mime_type: 'image/png',
						alt: 'Poster with dates',
					},
				} ),
				asset( {
					id: 2,
					label: 'Story',
					text: '',
					image: {
						url: 'https://cdn.example.net/story.jpg',
						mime_type: 'image/jpeg',
						alt: null,
					},
				} ),
				asset( {
					id: 3,
					label: 'Gone',
					image_unavailable: true,
				} ),
			] )
		);
		render( <App view="occurrence" eventDateId={ 7 } /> );

		const download = await screen.findByRole( 'link', {
			name: 'Download image',
		} );
		expect( download ).toHaveAttribute(
			'href',
			'http://localhost/wp-content/uploads/poster.png'
		);
		expect( download ).toHaveAttribute( 'download', 'poster.png' );
		expect(
			screen.getByRole( 'img', { name: 'Poster with dates' } )
		).toBeInTheDocument();

		const open = screen.getByRole( 'link', { name: 'Open image' } );
		expect( open ).not.toHaveAttribute( 'download' );
		expect( open ).toHaveAttribute( 'target', '_blank' );
		expect(
			screen.getByRole( 'img', { name: 'Image for Story' } )
		).toBeInTheDocument();

		expect(
			screen.getByText(
				'The image of this asset is no longer available.'
			)
		).toBeInTheDocument();
		// Text-free assets offer no copy.
		expect(
			screen.getAllByRole( 'button', { name: 'Copy text' } )
		).toHaveLength( 1 );
	} );

	it( 'filters by member and use case, and clears the filters', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.includes( 'member=' ) && path.includes( 'label=' ) ) {
				return Promise.resolve( occurrence( [] ) );
			}
			if ( path.includes( 'member=' ) ) {
				return Promise.resolve(
					occurrence( [
						asset( {
							id: 2,
							label: 'Duo',
							members: [ ANA, ANA_TWIN ],
						} ),
					] )
				);
			}
			return Promise.resolve(
				occurrence( [
					asset( { id: 1 } ),
					asset( {
						id: 2,
						label: 'Duo',
						members: [ ANA, ANA_TWIN ],
					} ),
				] )
			);
		} );
		render( <App view="occurrence" eventDateId={ 7 } /> );

		await screen.findByText( '2 assets' );
		expect(
			screen.getByText( 'With Ana Ruiz, Ana Ruiz' )
		).toBeInTheDocument();
		const member = screen.getByLabelText( 'Team member' );
		// Two people with the same name are separate choices.
		expect(
			Array.from( member.options ).map( ( option ) => option.value )
		).toEqual( [ '', ANA.key, ANA_TWIN.key ] );

		await act( async () => {
			fireEvent.change( member, { target: { value: ANA_TWIN.key } } );
		} );
		expect(
			await screen.findByText( '1 asset matches the filters.' )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: `/fair-events/v1/marketing-assets/7?per_page=50&page=1&member=${ ANA_TWIN.key }`,
		} );

		await act( async () => {
			fireEvent.change( screen.getByLabelText( 'Use case' ), {
				target: { value: 'WhatsApp status' },
			} );
		} );
		expect(
			await screen.findByText( 'No assets match these filters.' )
		).toBeInTheDocument();

		const clears = screen.getAllByRole( 'button', {
			name: 'Clear filters',
		} );
		await act( async () => {
			fireEvent.click( clears[ 0 ] );
		} );
		expect( await screen.findByText( '2 assets' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Team member' ) ).toHaveValue( '' );
		expect( screen.getByLabelText( 'Use case' ) ).toHaveValue( '' );
	} );

	it( 'shows the empty state of an event without assets', async () => {
		apiFetch.mockResolvedValue(
			occurrence( [], { filters: { members: [], labels: [] } } )
		);
		render( <App view="occurrence" eventDateId={ 7 } /> );
		expect(
			await screen.findByText(
				'There are no marketing assets for this event yet. Check again later.'
			)
		).toBeInTheDocument();
		expect( screen.queryByLabelText( 'Team member' ) ).toBeNull();
	} );

	it( 'shows a load error with a retry', async () => {
		apiFetch
			.mockRejectedValueOnce( {
				message: 'This event has no marketing assets page.',
			} )
			.mockResolvedValueOnce( occurrence( [ asset() ] ) );
		render( <App view="occurrence" eventDateId={ 7 } /> );

		expect(
			await screen.findByText(
				'This event has no marketing assets page.'
			)
		).toBeInTheDocument();
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Try again' } )
			);
		} );
		await waitFor( () =>
			expect(
				screen.getByRole( 'heading', { name: 'Instagram post' } )
			).toBeInTheDocument()
		);
	} );
} );
