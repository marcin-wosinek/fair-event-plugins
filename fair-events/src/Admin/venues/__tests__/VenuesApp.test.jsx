/**
 * @jest-environment jsdom
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
import VenuesApp, { filterVenues } from '../VenuesApp.js';

jest.mock( '@wordpress/api-fetch' );

const existingVenue = {
	id: 1,
	name: 'Existing Venue',
	address: 'Gran Via 1, Valencia',
	latitude: '200',
	longitude: '-0.3613204',
	facebook_page_link: '',
	instagram_handle: '',
	website_url: '',
};

beforeEach( () => {
	apiFetch.mockResolvedValue( [] );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const openCreateForm = async () => {
	render( <VenuesApp /> );
	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: /Add New Venue/i } )
		).toBeInTheDocument()
	);
	fireEvent.click( screen.getByRole( 'button', { name: /Add New Venue/i } ) );
};

const saveButton = () =>
	screen.getByRole( 'button', { name: /Create Venue/i } );

test( 'both coordinates blank is valid and does not disable save', async () => {
	await openCreateForm();

	fireEvent.change( screen.getByLabelText( 'Name' ), {
		target: { value: 'New Venue' },
	} );

	expect( saveButton() ).not.toBeDisabled();
} );

test( 'filling only latitude shows an inline error and disables save', async () => {
	await openCreateForm();

	fireEvent.change( screen.getByLabelText( 'Name' ), {
		target: { value: 'New Venue' },
	} );
	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: '39.4878023' },
	} );

	expect(
		screen.getAllByText( /Enter both latitude and longitude/i )
	).toHaveLength( 3 );
	expect( saveButton() ).toBeDisabled();
} );

test( 'an out-of-range latitude shows an inline error and disables save', async () => {
	await openCreateForm();

	fireEvent.change( screen.getByLabelText( 'Name' ), {
		target: { value: 'New Venue' },
	} );
	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: '200' },
	} );
	fireEvent.change( screen.getByLabelText( 'Longitude' ), {
		target: { value: '0' },
	} );

	expect(
		screen.getAllByText( /Latitude must be between -90 and 90/i )
	).toHaveLength( 3 );
	expect( saveButton() ).toBeDisabled();
} );

test( 'a non-numeric coordinate shows an inline error and disables save', async () => {
	await openCreateForm();

	fireEvent.change( screen.getByLabelText( 'Name' ), {
		target: { value: 'New Venue' },
	} );
	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: 'not-a-number' },
	} );
	fireEvent.change( screen.getByLabelText( 'Longitude' ), {
		target: { value: '0' },
	} );

	expect( screen.getAllByText( /must be numbers/i ) ).toHaveLength( 3 );
	expect( saveButton() ).toBeDisabled();
} );

test( 'pasting a "lat, lng" pair into latitude splits it across both fields', async () => {
	await openCreateForm();

	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: '39.4878023, -0.3613204' },
	} );

	expect( screen.getByLabelText( 'Latitude' ) ).toHaveValue( '39.4878023' );
	expect( screen.getByLabelText( 'Longitude' ) ).toHaveValue( '-0.3613204' );
} );

test( 'pasting a high-precision pair replaces both existing coordinates', async () => {
	apiFetch.mockResolvedValue( [
		{
			...existingVenue,
			latitude: '39.48',
			longitude: '-0.36',
		},
	] );

	render( <VenuesApp /> );
	await screen.findByText( 'Existing Venue' );
	fireEvent.click( screen.getByRole( 'button', { name: /Edit/i } ) );
	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: '39.48696092635874, -0.364167730043781' },
	} );

	expect( screen.getByLabelText( 'Latitude' ) ).toHaveValue(
		'39.48696092635874'
	);
	expect( screen.getByLabelText( 'Longitude' ) ).toHaveValue(
		'-0.364167730043781'
	);
	expect(
		screen.queryByText( /must be between|must be numbers|Enter both/i )
	).not.toBeInTheDocument();
} );

test.each( [ '39.48,-0.36', '39,48, -0,36', 'coordinates unavailable' ] )(
	'does not silently split ambiguous or malformed latitude input: %s',
	async ( value ) => {
		await openCreateForm();

		fireEvent.change( screen.getByLabelText( 'Latitude' ), {
			target: { value },
		} );

		expect( screen.getByLabelText( 'Latitude' ) ).toHaveValue( value );
		expect( screen.getByLabelText( 'Longitude' ) ).toHaveValue( '' );
	}
);

test( 'a decimal comma is accepted (no inline error)', async () => {
	await openCreateForm();

	fireEvent.change( screen.getByLabelText( 'Name' ), {
		target: { value: 'New Venue' },
	} );
	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: '39,48' },
	} );
	fireEvent.change( screen.getByLabelText( 'Longitude' ), {
		target: { value: '-0,36' },
	} );

	expect(
		screen.queryByText( /must be between|must be numbers|Enter both/i )
	).not.toBeInTheDocument();
	expect( saveButton() ).not.toBeDisabled();
} );

test( 'opening a venue with pre-existing invalid coordinates shows the error immediately', async () => {
	apiFetch.mockResolvedValue( [ existingVenue ] );

	render( <VenuesApp /> );

	await waitFor( () =>
		expect( screen.getByText( 'Existing Venue' ) ).toBeInTheDocument()
	);
	fireEvent.click( screen.getByRole( 'button', { name: /Edit/i } ) );

	await waitFor( () =>
		expect(
			screen.getAllByText( /Latitude must be between -90 and 90/i )
		).toHaveLength( 3 )
	);
	expect(
		screen.getByRole( 'button', { name: /Update Venue/i } )
	).toBeDisabled();
} );

describe( 'venue deletion visibility (#1621)', () => {
	test( 'hides the Delete action for an event editor (canDeleteVenues=false)', async () => {
		apiFetch.mockResolvedValue( [ existingVenue ] );

		render( <VenuesApp canDeleteVenues={ false } /> );

		await screen.findByText( 'Existing Venue' );
		expect(
			screen.getByRole( 'button', { name: /Edit/i } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /Delete/i } )
		).not.toBeInTheDocument();
	} );

	test( 'shows the Delete action for an administrator (canDeleteVenues=true)', async () => {
		apiFetch.mockResolvedValue( [ existingVenue ] );

		render( <VenuesApp canDeleteVenues /> );

		await screen.findByText( 'Existing Venue' );
		expect(
			screen.getByRole( 'button', { name: /Delete/i } )
		).toBeInTheDocument();
	} );

	test( 'defaults to hiding the Delete action when the prop is omitted', async () => {
		apiFetch.mockResolvedValue( [ existingVenue ] );

		render( <VenuesApp /> );

		await screen.findByText( 'Existing Venue' );
		expect(
			screen.queryByRole( 'button', { name: /Delete/i } )
		).not.toBeInTheDocument();
	} );

	test( 'lets an event editor without delete access still create and edit venues', async () => {
		apiFetch.mockResolvedValue( [ existingVenue ] );

		render( <VenuesApp canDeleteVenues={ false } /> );

		await screen.findByText( 'Existing Venue' );
		expect(
			screen.getByRole( 'button', { name: /Add New Venue/i } )
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: /Edit/i } ) );
		expect( screen.getByLabelText( 'Name' ) ).toHaveValue(
			existingVenue.name
		);
		expect(
			screen.getByRole( 'button', { name: /Update Venue/i } )
		).toBeInTheDocument();
	} );
} );

test( 'renders usable venue map URLs as accessible secure new-tab links', async () => {
	apiFetch.mockResolvedValue( [
		{
			...existingVenue,
			name: 'Coordinate Venue',
			maps_url: 'https://www.google.com/maps/search/?api=1&query=0%2C0',
		},
		{
			...existingVenue,
			id: 2,
			name: 'Address Venue',
			maps_url:
				'https://www.google.com/maps/search/?api=1&query=Gran%20Via',
		},
		{ ...existingVenue, id: 3, name: 'No Map Venue', maps_url: null },
	] );

	render( <VenuesApp /> );

	const coordinateLink = await screen.findByRole( 'link', {
		name: /Coordinate Venue.*opens in a new tab/i,
	} );
	expect( coordinateLink ).toHaveAttribute( 'target', '_blank' );
	expect( coordinateLink ).toHaveAttribute( 'rel', 'noopener noreferrer' );
	expect(
		screen.getByRole( 'link', { name: /Address Venue.*new tab/i } )
	).toHaveAttribute( 'href', expect.stringContaining( 'Gran%20Via' ) );
	expect(
		screen.queryByRole( 'link', { name: /No Map Venue/i } )
	).not.toBeInTheDocument();
} );

test( 'updates the preview from unsaved values and gives coordinates precedence', async () => {
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path === '/fair-events/v1/venues/maps-url' ) {
			const query = options.data.latitude
				? `${ options.data.latitude }%2C${ options.data.longitude }`
				: encodeURIComponent( options.data.address );
			return Promise.resolve( {
				maps_url: `https://www.google.com/maps/search/?api=1&query=${ query }`,
			} );
		}
		return Promise.resolve( [] );
	} );

	await openCreateForm();
	const testLink = () =>
		screen.getByRole( 'link', { name: 'Test Google Maps link' } );

	fireEvent.change( screen.getByLabelText( 'Address' ), {
		target: { value: 'Unsaved address' },
	} );
	await waitFor( () =>
		expect( testLink() ).toHaveAttribute(
			'href',
			expect.stringContaining( 'Unsaved%20address' )
		)
	);

	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: '0' },
	} );
	fireEvent.change( screen.getByLabelText( 'Longitude' ), {
		target: { value: '0' },
	} );
	await waitFor( () =>
		expect( testLink() ).toHaveAttribute(
			'href',
			expect.stringContaining( '0%2C0' )
		)
	);
	expect( testLink() ).toHaveAttribute( 'target', '_blank' );
	expect( testLink() ).toHaveAttribute( 'rel', 'noopener noreferrer' );
} );

test( 'places the preview after both fields and uses a pasted pair', async () => {
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path === '/fair-events/v1/venues/maps-url' ) {
			return Promise.resolve( {
				maps_url: `https://www.google.com/maps/search/?api=1&query=${ options.data.latitude }%2C${ options.data.longitude }`,
			} );
		}
		return Promise.resolve( [] );
	} );

	await openCreateForm();
	const longitude = screen.getByLabelText( 'Longitude' );
	const previewButton = screen.getByRole( 'button', {
		name: 'Test Google Maps link',
	} );
	expect(
		longitude.compareDocumentPosition( previewButton ) &
			Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();

	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: '39.48696092635874, -0.364167730043781' },
	} );

	await waitFor( () =>
		expect(
			screen.getByRole( 'link', { name: 'Test Google Maps link' } )
		).toHaveAttribute(
			'href',
			'https://www.google.com/maps/search/?api=1&query=39.48696092635874%2C-0.364167730043781'
		)
	);
} );

test( 'explains empty, incomplete, invalid, and loading preview states', async () => {
	let resolvePreview;
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path === '/fair-events/v1/venues/maps-url' ) {
			return new Promise( ( resolve ) => {
				resolvePreview = resolve;
			} );
		}
		return Promise.resolve( [] );
	} );

	await openCreateForm();
	expect(
		screen.getByText( /Enter an address or coordinates to test/i )
	).toBeInTheDocument();

	fireEvent.change( screen.getByLabelText( 'Latitude' ), {
		target: { value: '39' },
	} );
	expect(
		screen.getAllByText( /Enter both latitude and longitude/i )
	).toHaveLength( 3 );

	fireEvent.change( screen.getByLabelText( 'Longitude' ), {
		target: { value: '200' },
	} );
	expect( screen.getAllByText( /Longitude must be between/i ) ).toHaveLength(
		3
	);

	fireEvent.change( screen.getByLabelText( 'Longitude' ), {
		target: { value: '0' },
	} );
	await waitFor( () =>
		expect(
			screen.getByText( /Generating the Google Maps link/i )
		).toBeInTheDocument()
	);
	await waitFor( () =>
		expect( resolvePreview ).toEqual( expect.any( Function ) )
	);
	expect(
		screen.getByRole( 'button', { name: 'Test Google Maps link' } )
	).toBeDisabled();
	await act( async () => {
		resolvePreview( { maps_url: 'https://example.com/maps' } );
	} );
} );

test( 'ignores a stale preview response', async () => {
	const pending = [];
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path === '/fair-events/v1/venues/maps-url' ) {
			return new Promise( ( resolve ) => pending.push( resolve ) );
		}
		return Promise.resolve( [] );
	} );

	await openCreateForm();
	fireEvent.change( screen.getByLabelText( 'Address' ), {
		target: { value: 'First address' },
	} );
	await waitFor( () => expect( pending ).toHaveLength( 1 ) );
	fireEvent.change( screen.getByLabelText( 'Address' ), {
		target: { value: 'Second address' },
	} );
	await waitFor( () => expect( pending ).toHaveLength( 2 ) );

	pending[ 1 ]( { maps_url: 'https://example.com/second' } );
	await waitFor( () =>
		expect(
			screen.getByRole( 'link', { name: 'Test Google Maps link' } )
		).toHaveAttribute( 'href', 'https://example.com/second' )
	);
	pending[ 0 ]( { maps_url: 'https://example.com/first' } );
	expect(
		screen.getByRole( 'link', { name: 'Test Google Maps link' } )
	).toHaveAttribute( 'href', 'https://example.com/second' );
} );

describe( 'venue deletion confirmation (#1772)', () => {
	const otherVenue = { ...existingVenue, id: 2, name: 'Other Venue' };
	let confirmSpy;

	const mockVenues = ( { list = [ existingVenue ], onDelete } = {} ) => {
		apiFetch.mockImplementation( ( options ) => {
			if ( options.method === 'DELETE' ) {
				return onDelete( options );
			}
			return Promise.resolve(
				typeof list === 'function' ? list() : list
			);
		} );
	};

	// Scoped to the notice itself: the speak region that announces it
	// outlives the test that rendered it.
	const expectSuccessNotice = ( text ) =>
		waitFor( () =>
			expect(
				document.querySelector( '.components-notice.is-success' )
			).toHaveTextContent( text )
		);

	const deleteCalls = () =>
		apiFetch.mock.calls.filter( ( [ o ] ) => o.method === 'DELETE' );

	const openDeleteDialog = async () => {
		render( <VenuesApp canDeleteVenues /> );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Delete' } )
		);
		return screen.findByRole( 'dialog', { name: 'Delete venue?' } );
	};

	beforeEach( () => {
		confirmSpy = jest.spyOn( window, 'confirm' );
	} );

	afterEach( () => {
		confirmSpy.mockRestore();
	} );

	test( 'names the venue and explains what happens to its events', async () => {
		mockVenues( { onDelete: () => Promise.resolve( {} ) } );

		const dialog = await openDeleteDialog();

		expect( confirmSpy ).not.toHaveBeenCalled();
		expect( dialog ).toHaveTextContent(
			'Delete the venue Existing Venue (Gran Via 1, Valencia)?'
		);
		expect( dialog ).toHaveTextContent(
			'Event dates that use this venue will be left without a venue. The events themselves and all their other details are kept.'
		);
		expect( dialog ).toHaveTextContent( 'This cannot be undone.' );
		expect(
			screen.getByRole( 'button', { name: 'Delete venue' } )
		).toHaveClass( 'is-destructive' );
	} );

	test( 'says so when the venue has no address', async () => {
		mockVenues( {
			list: [ { ...existingVenue, address: '' } ],
			onDelete: () => Promise.resolve( {} ),
		} );

		const dialog = await openDeleteDialog();

		expect( dialog ).toHaveTextContent(
			'Delete the venue Existing Venue? It has no address.'
		);
	} );

	test( 'cancelling deletes nothing', async () => {
		mockVenues( { onDelete: () => Promise.resolve( {} ) } );

		await openDeleteDialog();
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( deleteCalls() ).toHaveLength( 0 );
		expect( screen.getByText( 'Existing Venue' ) ).toBeInTheDocument();
	} );

	test( 'confirming deletes once, shows progress and names the venue afterwards', async () => {
		let finishDelete;
		let list = [ existingVenue, otherVenue ];
		mockVenues( {
			list: () => list,
			onDelete: () =>
				new Promise( ( resolve ) => {
					finishDelete = resolve;
				} ),
		} );

		render( <VenuesApp canDeleteVenues /> );
		fireEvent.click(
			( await screen.findAllByRole( 'button', { name: 'Delete' } ) )[ 0 ]
		);
		const confirm = await screen.findByRole( 'button', {
			name: 'Delete venue',
		} );
		fireEvent.click( confirm );
		fireEvent.click( confirm );

		const busy = await screen.findByRole( 'button', { name: 'Deleting…' } );
		expect( busy ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect( deleteCalls() ).toHaveLength( 1 );
		expect( deleteCalls()[ 0 ][ 0 ].path ).toBe(
			'/fair-events/v1/venues/1'
		);

		list = [ otherVenue ];
		await act( async () => finishDelete( { deleted: true } ) );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		await expectSuccessNotice( 'Venue Existing Venue deleted.' );
		expect( deleteCalls() ).toHaveLength( 1 );
	} );

	test( 'a failure keeps the dialog open with a contextual error and allows a retry', async () => {
		const onDelete = jest
			.fn()
			.mockRejectedValueOnce( { message: 'Failed to delete venue.' } )
			.mockResolvedValueOnce( { deleted: true } );
		mockVenues( { onDelete } );

		const dialog = await openDeleteDialog();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete venue' } )
		);

		await waitFor( () =>
			expect( dialog ).toHaveTextContent(
				'Existing Venue was not deleted: Failed to delete venue. It is still in the list, but event dates may already have lost it as their venue — check them before trying again.'
			)
		);
		expect( dialog ).toHaveTextContent( 'Delete the venue Existing Venue' );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete venue' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( onDelete ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'a failure whose venue is gone on reload is reported as deleted', async () => {
		let list = [ existingVenue ];
		mockVenues( {
			list: () => list,
			onDelete: () => {
				list = [];
				return Promise.reject( { message: 'Timed out.' } );
			},
		} );

		await openDeleteDialog();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete venue' } )
		);

		await expectSuccessNotice( 'Venue Existing Venue deleted.' );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	test( 'withholds another attempt when the outcome cannot be confirmed', async () => {
		let failing = false;
		apiFetch.mockImplementation( ( options ) => {
			if ( options.method === 'DELETE' ) {
				failing = true;
				return Promise.reject( { message: 'Offline.' } );
			}
			return failing
				? Promise.reject( { message: 'Offline.' } )
				: Promise.resolve( [ existingVenue ] );
		} );

		const dialog = await openDeleteDialog();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete venue' } )
		);

		await waitFor( () =>
			expect( dialog ).toHaveTextContent(
				'Could not confirm whether Existing Venue was deleted. Reload the page to see the current venues before trying again.'
			)
		);
		expect(
			screen.getByRole( 'button', { name: 'Delete venue' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).not.toBeDisabled();
	} );
} );

describe( 'filterVenues', () => {
	const venues = [
		{ id: 1, name: 'Árboles Botella', address: 'Calle Mayor 3' },
		{ id: 2, name: 'La Mutable', address: 'Carrer de Sueca 12' },
		{ id: 3, name: 'Sin Dirección', address: null },
	];
	const ids = ( list ) => list.map( ( v ) => v.id );

	test.each( [
		[ 'arboles', [ 1 ] ],
		[ 'ÁRBOL', [ 1 ] ],
		[ 'mutab', [ 2 ] ],
		[ 'sueca', [ 2 ] ],
		[ 'direccion', [ 3 ] ],
		[ '  calle mayor  ', [ 1 ] ],
		[ 'nowhere', [] ],
	] )( '%p matches %p', ( query, expected ) => {
		expect( ids( filterVenues( venues, query ) ) ).toEqual( expected );
	} );

	test.each( [ '', '   ' ] )(
		'blank query %p returns every venue in order',
		( query ) => {
			expect( ids( filterVenues( venues, query ) ) ).toEqual( [
				1, 2, 3,
			] );
		}
	);
} );

describe( 'venue search (#2123)', () => {
	const venues = [
		{
			...existingVenue,
			id: 1,
			name: 'Árboles Botella',
			address: 'Calle Mayor 3',
		},
		{
			...existingVenue,
			id: 2,
			name: 'La Mutable',
			address: 'Carrer de Sueca 12',
		},
		{ ...existingVenue, id: 3, name: 'Plaza Redonda', address: '' },
	];

	const search = ( value ) =>
		fireEvent.change( screen.getByLabelText( 'Search venues' ), {
			target: { value },
		} );
	const rowNames = () =>
		screen
			.queryAllByRole( 'row' )
			.slice( 1 )
			.map( ( row ) => row.querySelector( 'strong' ).textContent );
	const rowCheckbox = ( name ) =>
		screen
			.getByText( name )
			.closest( 'tr' )
			.querySelector( 'input[type="checkbox"]' );
	const selectAll = () =>
		screen.getByRole( 'checkbox', { name: 'Select all matching venues' } );

	const renderList = async ( props = {} ) => {
		apiFetch.mockImplementation( ( options ) =>
			options.method === 'DELETE'
				? Promise.resolve( {} )
				: Promise.resolve( venues )
		);
		render( <VenuesApp { ...props } /> );
		await screen.findByText( 'La Mutable' );
	};

	test( 'filters by partial, accent-insensitive name and address', async () => {
		await renderList();

		expect( screen.getByText( 'Search by name or address' ) ).toBeVisible();

		search( 'arboles' );
		expect( rowNames() ).toEqual( [ 'Árboles Botella' ] );

		search( 'SUECA' );
		expect( rowNames() ).toEqual( [ 'La Mutable' ] );
	} );

	test( 'whitespace-only and cleared queries show every venue', async () => {
		await renderList();

		search( '   ' );
		expect( rowNames() ).toHaveLength( 3 );

		search( 'redonda' );
		expect( rowNames() ).toEqual( [ 'Plaza Redonda' ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Reset search' } )
		);
		expect( screen.getByLabelText( 'Search venues' ) ).toHaveValue( '' );
		expect( rowNames() ).toHaveLength( 3 );
	} );

	test( 'no matches shows a distinct message and keeps search available', async () => {
		await renderList();

		search( 'nowhere' );

		expect( screen.getByText( 'No matching venues.' ) ).toBeVisible();
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( /No venues found/ )
		).not.toBeInTheDocument();
		expect( screen.getByLabelText( 'Search venues' ) ).toBeEnabled();
	} );

	test( 'an empty database keeps its own message', async () => {
		apiFetch.mockResolvedValue( [] );
		render( <VenuesApp /> );

		expect( await screen.findByText( /No venues found/ ) ).toBeVisible();
		expect( screen.queryByText( 'No matching venues.' ) ).toBeNull();
	} );

	test( 'changing or clearing the search clears the selection', async () => {
		await renderList();

		fireEvent.click( rowCheckbox( 'La Mutable' ) );
		expect(
			screen.getByRole( 'button', { name: 'Export Selected' } )
		).toBeVisible();

		search( 'la' );
		expect( rowCheckbox( 'La Mutable' ) ).not.toBeChecked();
		expect(
			screen.queryByRole( 'button', { name: 'Export Selected' } )
		).toBeNull();

		fireEvent.click( rowCheckbox( 'La Mutable' ) );
		search( '' );
		expect( rowCheckbox( 'La Mutable' ) ).not.toBeChecked();
	} );

	test( 'select all selects and exports only matching venues', async () => {
		await renderList();
		const blobParts = [];
		const OriginalBlob = global.Blob;
		global.Blob = jest.fn( ( parts ) => {
			blobParts.push( parts.join( '' ) );
			return {};
		} );
		URL.createObjectURL = jest.fn( () => 'blob:venues' );
		URL.revokeObjectURL = jest.fn();
		const clickSpy = jest
			.spyOn( HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( () => {} );

		try {
			search( 'ca' );
			expect( rowNames() ).toEqual( [ 'Árboles Botella', 'La Mutable' ] );

			fireEvent.click( selectAll() );
			expect( selectAll() ).toBeChecked();
			expect( rowCheckbox( 'Árboles Botella' ) ).toBeChecked();

			fireEvent.click(
				screen.getByRole( 'button', { name: 'Export Selected' } )
			);

			const exported = JSON.parse( blobParts[ 0 ] );
			expect( exported.map( ( v ) => v.name ) ).toEqual( [
				'Árboles Botella',
				'La Mutable',
			] );

			search( '' );
			expect( selectAll() ).not.toBeChecked();
			expect( rowCheckbox( 'Plaza Redonda' ) ).not.toBeChecked();
		} finally {
			global.Blob = OriginalBlob;
			clickSpy.mockRestore();
		}
	} );

	test( 'edits the matching venue while filtered', async () => {
		await renderList();

		search( 'mutable' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Edit' } ) );

		expect( screen.getByLabelText( 'Name' ) ).toHaveValue( 'La Mutable' );
	} );

	test( 'deletes the matching venue and keeps the query', async () => {
		await renderList( { canDeleteVenues: true } );

		search( 'redonda' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Delete' } ) );
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Delete venue?',
		} );
		expect( dialog ).toHaveTextContent( 'Plaza Redonda' );

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Delete venue' } )
			);
		} );

		await waitFor( () =>
			expect(
				apiFetch.mock.calls.filter( ( [ o ] ) => o.method === 'DELETE' )
			).toEqual( [
				[ { path: '/fair-events/v1/venues/3', method: 'DELETE' } ],
			] )
		);
		expect( screen.getByLabelText( 'Search venues' ) ).toHaveValue(
			'redonda'
		);
	} );
} );
