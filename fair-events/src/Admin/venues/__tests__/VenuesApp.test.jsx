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
import VenuesApp from '../VenuesApp.js';

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
