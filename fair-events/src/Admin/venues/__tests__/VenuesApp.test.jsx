/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
	).toHaveLength( 2 );
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
	).toHaveLength( 2 );
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

	expect( screen.getAllByText( /must be numbers/i ) ).toHaveLength( 2 );
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
		).toHaveLength( 2 )
	);
	expect(
		screen.getByRole( 'button', { name: /Update Venue/i } )
	).toBeDisabled();
} );
