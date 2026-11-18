/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import OrganizersPage from '../OrganizersPage.js';
import {
	createOrganizer,
	loadOrganizers,
	loadSiteDefaults,
	updateOrganizer,
} from '../organizers-api.js';
import { loadAttachmentUrl } from 'fair-events/src/Admin/settings/settings-api.js';

jest.mock( '../organizers-api.js', () => ( {
	...jest.requireActual( '../organizers-api.js' ),
	createOrganizer: jest.fn(),
	loadOrganizers: jest.fn(),
	loadSiteDefaults: jest.fn(),
	updateOrganizer: jest.fn(),
} ) );
jest.mock( 'fair-events/src/Admin/settings/settings-api.js' );

const record = ( overrides ) => ( {
	id: 'default',
	is_default: true,
	name: '',
	type: 'Organization',
	street_address: '',
	address_locality: '',
	address_region: '',
	postal_code: '',
	address_country: '',
	same_as: [],
	logo_id: 0,
	website: '',
	contact_email: '',
	contact_phone: '',
	notification_emails: [],
	...overrides,
} );

const NORTH_ID = '11111111-1111-4111-8111-111111111111';

beforeEach( () => {
	loadOrganizers.mockResolvedValue( [
		record( { notification_emails: [ 'board@example.com' ] } ),
		record( {
			id: NORTH_ID,
			is_default: false,
			name: 'North Club',
			notification_emails: [ 'a@example.com', 'b@example.com' ],
		} ),
	] );
	loadSiteDefaults.mockResolvedValue( {
		name: 'Test Site',
		website: 'https://example.com',
		logoId: 0,
	} );
	loadAttachmentUrl.mockResolvedValue( '' );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

async function renderTab() {
	render( <OrganizersPage /> );
	await screen.findByRole( 'table' );
}

const saveButton = () =>
	screen.getByRole( 'button', { name: /Save organizer/i } );

async function openEditor( name ) {
	fireEvent.click( screen.getByRole( 'button', { name } ) );
	await act( async () => {} );
}

test( 'lists the default first, marked, with each recipient count', async () => {
	await renderTab();

	const rows = within( screen.getByRole( 'table' ) ).getAllByRole( 'row' );
	expect( rows ).toHaveLength( 3 );
	expect( rows[ 1 ] ).toHaveTextContent( 'Test Site' );
	expect( rows[ 1 ] ).toHaveTextContent(
		'Default — used for the whole site'
	);
	expect( rows[ 1 ] ).toHaveTextContent( '1 address' );
	expect( rows[ 2 ] ).toHaveTextContent( 'North Club' );
	expect( rows[ 2 ] ).not.toHaveTextContent( 'Default' );
	expect( rows[ 2 ] ).toHaveTextContent( '2 addresses' );
	expect(
		screen.getByRole( 'button', { name: 'Edit “North Club”' } )
	).toBeInTheDocument();
} );

test( 'a failed load is reported with a retry', async () => {
	loadOrganizers.mockRejectedValueOnce( { message: 'Server down.' } );
	render( <OrganizersPage /> );

	expect(
		await screen.findByText( 'Server down.', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
	expect( await screen.findByRole( 'table' ) ).toBeInTheDocument();
} );

test( 'adds an organizer that starts blank and requires a name', async () => {
	createOrganizer.mockResolvedValue(
		record( {
			id: '22222222-2222-4222-8222-222222222222',
			is_default: false,
			name: 'South Club',
			notification_emails: [ 'south@example.com' ],
		} )
	);
	await renderTab();

	await openEditor( 'Add organizer' );
	expect(
		screen.getByRole( 'heading', { name: 'Add organizer' } )
	).toHaveFocus();
	const name = screen.getByLabelText( 'Name (required)' );
	expect( name ).toHaveValue( '' );
	expect( name ).toHaveAttribute( 'placeholder', '' );
	expect( saveButton() ).toBeDisabled();

	fireEvent.change( name, { target: { value: 'South Club' } } );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Add email address' } )
	);
	fireEvent.change( screen.getByLabelText( 'Notification email address' ), {
		target: { value: ' south@example.com ' },
	} );
	fireEvent.click( saveButton() );

	expect(
		await screen.findByText( 'Organizer added.', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
	expect( createOrganizer ).toHaveBeenCalledWith(
		expect.objectContaining( {
			name: 'South Club',
			website: '',
			notification_emails: [ 'south@example.com' ],
		} )
	);
	expect(
		screen.getByRole( 'heading', { name: 'Edit organizer: South Club' } )
	).toBeInTheDocument();

	fireEvent.click(
		screen.getByRole( 'button', { name: '← All organizers' } )
	);
	const rows = within( screen.getByRole( 'table' ) ).getAllByRole( 'row' );
	expect( rows ).toHaveLength( 4 );
	expect( rows[ 3 ] ).toHaveTextContent( 'South Club' );
} );

test( 'editing the default keeps site fallbacks and reloads normalized values', async () => {
	updateOrganizer.mockResolvedValue(
		record( { notification_emails: [ 'team@example.com' ] } )
	);
	await renderTab();

	await openEditor( 'Edit “Test Site”' );
	expect(
		screen.getByRole( 'heading', { name: 'Edit default organizer' } )
	).toBeInTheDocument();
	expect( screen.getByLabelText( 'Name' ) ).toHaveAttribute(
		'placeholder',
		'Test Site'
	);
	expect( saveButton() ).toBeEnabled();

	fireEvent.change( screen.getByLabelText( 'Notification email address' ), {
		target: { value: 'team@example.com' },
	} );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Add email address' } )
	);
	fireEvent.change(
		screen.getAllByLabelText( 'Notification email address' )[ 1 ],
		{ target: { value: 'TEAM@example.com' } }
	);
	fireEvent.click( saveButton() );

	await screen.findByText( 'Organizer saved.', {
		selector: '.components-notice__content',
	} );
	expect( updateOrganizer ).toHaveBeenCalledWith(
		'default',
		expect.objectContaining( {
			notification_emails: [ 'team@example.com', 'TEAM@example.com' ],
		} )
	);
	expect(
		screen.getAllByLabelText( 'Notification email address' )
	).toHaveLength( 1 );
	expect( screen.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
} );

test( 'a server error keeps the entered values and shows its message', async () => {
	updateOrganizer.mockRejectedValue( {
		message: 'Invalid parameter(s): website',
		data: {
			params: { website: 'Enter the website as a full URL.' },
		},
	} );
	await renderTab();

	await openEditor( 'Edit “North Club”' );
	fireEvent.change( screen.getByLabelText( 'Name (required)' ), {
		target: { value: 'North Club Renamed' },
	} );
	fireEvent.click( saveButton() );

	expect(
		await screen.findByText(
			'The organizer was not saved: Enter the website as a full URL.',
			{ selector: '.components-notice__content' }
		)
	).toBeInTheDocument();
	expect( screen.getByLabelText( 'Name (required)' ) ).toHaveValue(
		'North Club Renamed'
	);
	expect( screen.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
	expect( saveButton() ).toBeEnabled();
} );

test( 'leaving a record with unsaved changes asks first', async () => {
	await renderTab();

	await openEditor( 'Edit “North Club”' );
	fireEvent.change( screen.getByLabelText( 'Name (required)' ), {
		target: { value: 'Changed' },
	} );
	expect( screen.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

	fireEvent.click(
		screen.getByRole( 'button', { name: '← All organizers' } )
	);
	expect(
		screen.getByText(
			'Discard your unsaved changes to “North Club”? The saved organizer stays as it was.'
		)
	).toBeInTheDocument();

	fireEvent.click( screen.getByRole( 'button', { name: 'Keep editing' } ) );
	expect( screen.getByLabelText( 'Name (required)' ) ).toHaveValue(
		'Changed'
	);

	fireEvent.click(
		screen.getByRole( 'button', { name: '← All organizers' } )
	);
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Discard changes' } )
	);
	await waitFor( () =>
		expect( screen.getByRole( 'table' ) ).toBeInTheDocument()
	);
	expect( screen.getByRole( 'table' ) ).toHaveTextContent( 'North Club' );
	expect( updateOrganizer ).not.toHaveBeenCalled();
} );

test( 'leaving without changes needs no confirmation', async () => {
	await renderTab();

	await openEditor( 'Edit “North Club”' );
	fireEvent.click(
		screen.getByRole( 'button', { name: '← All organizers' } )
	);

	expect( screen.getByRole( 'table' ) ).toBeInTheDocument();
	expect(
		screen.queryByRole( 'button', { name: 'Discard changes' } )
	).not.toBeInTheDocument();
	expect(
		screen.getByRole( 'heading', { level: 1, name: 'Organizers' } )
	).toHaveFocus();
} );
