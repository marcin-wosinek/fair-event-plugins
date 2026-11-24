/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import OrganizerTab from '../OrganizerTab.js';
import {
	loadOrganizerSettings,
	loadAttachmentUrl,
	saveSettings,
} from '../settings-api.js';

jest.mock( '../settings-api.js' );
jest.mock( '@wordpress/api-fetch' );

const baseOrganizer = {
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
	defaults: { name: 'Test Site', website: 'https://example.com', logoId: 0 },
};

beforeEach( () => {
	loadOrganizerSettings.mockResolvedValue( { ...baseOrganizer } );
	loadAttachmentUrl.mockResolvedValue( '' );
	saveSettings.mockResolvedValue( {} );
	// The sales summary and Telegram cards keep loading unless a test resolves them.
	apiFetch.mockReturnValue( new Promise( () => {} ) );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const nameField = () => screen.getByLabelText( 'Name' );
const saveButton = () =>
	screen.getByRole( 'button', { name: /Save organizer/i } );

test( 'renders and populates fields from loaded settings', async () => {
	loadOrganizerSettings.mockResolvedValue( {
		...baseOrganizer,
		name: 'Acme Club',
		type: 'SportsClub',
	} );

	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toHaveValue( 'Acme Club' ) );
	expect( screen.getByLabelText( 'Organizer type' ) ).toHaveValue(
		'SportsClub'
	);
} );

test( 'offers every organizer type, keeping the existing ones', async () => {
	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	const select = screen.getByLabelText( 'Organizer type' );
	expect( select ).toHaveValue( 'Organization' );
	expect(
		Array.from( select.options ).map( ( option ) => [
			option.value,
			option.textContent,
		] )
	).toEqual( [
		[ 'Organization', 'Organization' ],
		[ 'Person', 'Individual person' ],
		[ 'Corporation', 'Company' ],
		[ 'NGO', 'NGO' ],
		[ 'SportsClub', 'Sports club' ],
	] );
} );

test.each( [ 'Person', 'Corporation', 'NGO' ] )(
	'save sends the chosen %s type',
	async ( type ) => {
		render( <OrganizerTab onNotice={ jest.fn() } /> );

		await waitFor( () => expect( nameField() ).toBeInTheDocument() );

		fireEvent.change( screen.getByLabelText( 'Organizer type' ), {
			target: { value: type },
		} );
		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveSettings ).toHaveBeenCalledTimes( 1 )
		);
		expect( saveSettings ).toHaveBeenCalledWith( {
			fair_events_organizer: expect.objectContaining( { type } ),
		} );
	}
);

test( 'adding a link renders a new row, removing it takes it away', async () => {
	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	fireEvent.click( screen.getByRole( 'button', { name: /Add link/i } ) );
	expect( screen.getAllByLabelText( 'Profile URL' ) ).toHaveLength( 1 );

	fireEvent.click( screen.getByRole( 'button', { name: /Remove/i } ) );
	expect( screen.queryAllByLabelText( 'Profile URL' ) ).toHaveLength( 0 );
} );

test( 'an invalid URL blocks save and shows a message', async () => {
	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	fireEvent.click( screen.getByRole( 'button', { name: /Add link/i } ) );
	fireEvent.change( screen.getByLabelText( 'Profile URL' ), {
		target: { value: 'not a url' },
	} );

	expect( screen.getByText( /Enter a valid URL/i ) ).toBeInTheDocument();
	expect( saveButton() ).toBeDisabled();
} );

test( 'save sends fair_events_organizer with the edited values', async () => {
	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	fireEvent.change( nameField(), { target: { value: 'Acme Club' } } );
	fireEvent.click( saveButton() );

	await waitFor( () => expect( saveSettings ).toHaveBeenCalledTimes( 1 ) );
	expect( saveSettings ).toHaveBeenCalledWith( {
		fair_events_organizer: expect.objectContaining( { name: 'Acme Club' } ),
	} );
} );

test( 'save payload excludes the read-only site defaults', async () => {
	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	fireEvent.change( nameField(), { target: { value: 'Acme Club' } } );
	fireEvent.click( saveButton() );

	await waitFor( () => expect( saveSettings ).toHaveBeenCalledTimes( 1 ) );
	expect(
		saveSettings.mock.calls[ 0 ][ 0 ].fair_events_organizer
	).not.toHaveProperty( 'defaults' );
} );

test( 'shows the site defaults as placeholders when fields are blank', async () => {
	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	expect( nameField() ).toHaveAttribute( 'placeholder', 'Test Site' );
	expect( screen.getByLabelText( 'Website' ) ).toHaveAttribute(
		'placeholder',
		'https://example.com'
	);
} );

test( 'an invalid website URL blocks save', async () => {
	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	fireEvent.change( screen.getByLabelText( 'Website' ), {
		target: { value: 'not a url' },
	} );

	expect( screen.getByText( /Enter a valid URL/i ) ).toBeInTheDocument();
	expect( saveButton() ).toBeDisabled();
} );

test( 'save sends the contact point fields', async () => {
	render( <OrganizerTab onNotice={ jest.fn() } /> );

	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	fireEvent.change( screen.getByLabelText( 'Contact email' ), {
		target: { value: 'info@example.com' },
	} );
	fireEvent.change( screen.getByLabelText( 'Contact phone' ), {
		target: { value: '+34 600 000 000' },
	} );
	fireEvent.click( saveButton() );

	await waitFor( () => expect( saveSettings ).toHaveBeenCalledTimes( 1 ) );
	expect( saveSettings ).toHaveBeenCalledWith( {
		fair_events_organizer: expect.objectContaining( {
			contact_email: 'info@example.com',
			contact_phone: '+34 600 000 000',
		} ),
	} );
} );

test( 'picking a logo stores its attachment id and shows a preview; removing it reverts', async () => {
	const handlers = {};
	const frame = {
		on: ( event, cb ) => {
			handlers[ event ] = cb;
		},
		open: () => handlers.select(),
		state: () => ( {
			get: () => ( {
				first: () => ( {
					toJSON: () => ( {
						id: 42,
						url: 'https://example.com/logo.png',
					} ),
				} ),
			} ),
		} ),
	};
	global.wp = { ...global.wp, media: jest.fn( () => frame ) };

	render( <OrganizerTab onNotice={ jest.fn() } /> );
	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	fireEvent.click( screen.getByRole( 'button', { name: /Change image/i } ) );

	await waitFor( () =>
		expect( screen.getByAltText( '' ) ).toHaveAttribute(
			'src',
			'https://example.com/logo.png'
		)
	);
	const removeButton = screen.getByRole( 'button', { name: /^Remove$/i } );
	expect( removeButton ).toBeInTheDocument();

	fireEvent.click( removeButton );

	const confirmButton = await screen.findByRole( 'button', {
		name: /Remove logo/i,
	} );
	fireEvent.click( confirmButton );

	await waitFor( () =>
		expect(
			screen.queryByRole( 'button', { name: /^Remove$/i } )
		).not.toBeInTheDocument()
	);
} );

test( 'cancelling the remove-logo dialog leaves the override untouched', async () => {
	const handlers = {};
	const frame = {
		on: ( event, cb ) => {
			handlers[ event ] = cb;
		},
		open: () => handlers.select(),
		state: () => ( {
			get: () => ( {
				first: () => ( {
					toJSON: () => ( {
						id: 42,
						url: 'https://example.com/logo.png',
					} ),
				} ),
			} ),
		} ),
	};
	global.wp = { ...global.wp, media: jest.fn( () => frame ) };

	render( <OrganizerTab onNotice={ jest.fn() } /> );
	await waitFor( () => expect( nameField() ).toBeInTheDocument() );

	fireEvent.click( screen.getByRole( 'button', { name: /Change image/i } ) );

	await waitFor( () =>
		expect( screen.getByAltText( '' ) ).toHaveAttribute(
			'src',
			'https://example.com/logo.png'
		)
	);

	fireEvent.click( screen.getByRole( 'button', { name: /^Remove$/i } ) );

	const cancelButton = await screen.findByRole( 'button', {
		name: /Cancel/i,
	} );
	fireEvent.click( cancelButton );

	expect(
		screen.getByRole( 'button', { name: /^Remove$/i } )
	).toBeInTheDocument();
} );

describe( 'remove-logo confirmation (#1772)', () => {
	const openDialog = async ( settings ) => {
		loadOrganizerSettings.mockResolvedValue( {
			...baseOrganizer,
			logo_id: 42,
			...settings,
		} );
		render( <OrganizerTab onNotice={ jest.fn() } /> );
		fireEvent.click(
			await screen.findByRole( 'button', { name: /^Remove$/i } )
		);
		return screen.findByRole( 'dialog', {
			name: 'Remove organizer logo?',
		} );
	};

	test( 'names the organizer and explains the fallback, the save and the media file', async () => {
		const dialog = await openDialog( {
			name: 'Demo Collective',
			defaults: { ...baseOrganizer.defaults, logoId: 7 },
		} );

		expect( dialog ).toHaveTextContent(
			'Remove the logo chosen for the organizer Demo Collective?'
		);
		expect( dialog ).toHaveTextContent(
			"The organizer will use the site's logo instead. The image you remove here stays in the Media Library."
		);
		expect( dialog ).toHaveTextContent(
			'Nothing is saved until you select Save organizer.'
		);
		expect(
			screen.getByRole( 'button', { name: 'Remove logo' } )
		).toHaveClass( 'is-destructive' );
	} );

	test( 'falls back to the site name and says when the site has no logo', async () => {
		const dialog = await openDialog( {} );

		expect( dialog ).toHaveTextContent(
			'Remove the logo chosen for the organizer Test Site?'
		);
		expect( dialog ).toHaveTextContent(
			'The site has no logo of its own, so the organizer will have no logo. The image you remove here stays in the Media Library.'
		);
	} );

	test( 'confirming changes only the form: saving is still a separate step', async () => {
		await openDialog( { name: 'Demo Collective' } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Remove logo' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( saveSettings ).not.toHaveBeenCalled();

		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveSettings ).toHaveBeenCalledWith( {
				fair_events_organizer: expect.objectContaining( {
					logo_id: 0,
				} ),
			} )
		);
	} );

	test( 'cancelling keeps the logo and saves nothing', async () => {
		await openDialog( { name: 'Demo Collective' } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: /^Remove$/i } )
		).toBeInTheDocument();
		expect( saveSettings ).not.toHaveBeenCalled();
	} );
} );

describe( 'notification email addresses (#2303)', () => {
	const emailFields = () =>
		screen.queryAllByLabelText( 'Notification email address' );
	const addEmailButton = () =>
		screen.getByRole( 'button', { name: 'Add email address' } );

	test( 'explains that the addresses are private', async () => {
		render( <OrganizerTab onNotice={ jest.fn() } /> );

		expect(
			await screen.findByText( /never shown on the site/i )
		).toBeInTheDocument();
	} );

	test( 'adding and removing rows', async () => {
		loadOrganizerSettings.mockResolvedValue( {
			...baseOrganizer,
			notification_emails: [ 'team@example.com' ],
		} );
		render( <OrganizerTab onNotice={ jest.fn() } /> );

		await waitFor( () => expect( emailFields() ).toHaveLength( 1 ) );
		expect( emailFields()[ 0 ] ).toHaveValue( 'team@example.com' );

		fireEvent.click( addEmailButton() );
		expect( emailFields() ).toHaveLength( 2 );

		fireEvent.click(
			screen.getAllByRole( 'button', {
				name: 'Remove email address',
			} )[ 0 ]
		);
		expect( emailFields() ).toHaveLength( 1 );
		expect( emailFields()[ 0 ] ).toHaveValue( '' );
	} );

	test( 'an invalid address blocks save and says why', async () => {
		render( <OrganizerTab onNotice={ jest.fn() } /> );
		await waitFor( () => expect( nameField() ).toBeInTheDocument() );

		fireEvent.click( addEmailButton() );
		fireEvent.change( emailFields()[ 0 ], {
			target: { value: 'not an email' },
		} );

		expect(
			screen.getByText( /Enter a valid email address/i )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Fix the invalid notification email address(es) above before saving.'
			)
		).toBeInTheDocument();
		expect( saveButton() ).toBeDisabled();
	} );

	test( 'save trims addresses, ignores empty rows and keeps identity fields', async () => {
		loadOrganizerSettings.mockResolvedValue( {
			...baseOrganizer,
			name: 'Acme Club',
			contact_email: 'info@example.com',
		} );
		render( <OrganizerTab onNotice={ jest.fn() } /> );
		await waitFor( () => expect( nameField() ).toHaveValue( 'Acme Club' ) );

		fireEvent.click( addEmailButton() );
		fireEvent.click( addEmailButton() );
		fireEvent.change( emailFields()[ 0 ], {
			target: { value: '  team@example.com ' },
		} );
		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveSettings ).toHaveBeenCalledTimes( 1 )
		);
		expect( saveSettings ).toHaveBeenCalledWith( {
			fair_events_organizer: expect.objectContaining( {
				name: 'Acme Club',
				contact_email: 'info@example.com',
				notification_emails: [ 'team@example.com' ],
			} ),
		} );
	} );

	test( 'removing every row clears the list on save', async () => {
		loadOrganizerSettings.mockResolvedValue( {
			...baseOrganizer,
			notification_emails: [ 'team@example.com' ],
		} );
		render( <OrganizerTab onNotice={ jest.fn() } /> );
		await waitFor( () => expect( emailFields() ).toHaveLength( 1 ) );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Remove email address' } )
		);
		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveSettings ).toHaveBeenCalledTimes( 1 )
		);
		expect( saveSettings ).toHaveBeenCalledWith( {
			fair_events_organizer: expect.objectContaining( {
				notification_emails: [],
			} ),
		} );
	} );

	test( 'reloads the normalized list after saving', async () => {
		loadOrganizerSettings
			.mockResolvedValueOnce( { ...baseOrganizer } )
			.mockResolvedValueOnce( {
				...baseOrganizer,
				notification_emails: [ 'Team@example.com' ],
			} );
		const onNotice = jest.fn();
		render( <OrganizerTab onNotice={ onNotice } /> );
		await waitFor( () => expect( nameField() ).toBeInTheDocument() );

		fireEvent.click( addEmailButton() );
		fireEvent.click( addEmailButton() );
		fireEvent.change( emailFields()[ 0 ], {
			target: { value: 'Team@example.com' },
		} );
		fireEvent.change( emailFields()[ 1 ], {
			target: { value: 'team@example.com' },
		} );
		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith(
				expect.objectContaining( { status: 'success' } )
			)
		);
		expect( emailFields() ).toHaveLength( 1 );
		expect( emailFields()[ 0 ] ).toHaveValue( 'Team@example.com' );
	} );

	test( 'a server error keeps the entered values and shows its message', async () => {
		saveSettings.mockRejectedValue( {
			code: 'rest_invalid_param',
			message: 'Invalid parameter(s): fair_events_organizer',
			data: {
				params: {
					fair_events_organizer: 'Invalid email address.',
				},
			},
		} );
		const onNotice = jest.fn();
		render( <OrganizerTab onNotice={ onNotice } /> );
		await waitFor( () => expect( nameField() ).toBeInTheDocument() );

		fireEvent.click( addEmailButton() );
		fireEvent.change( emailFields()[ 0 ], {
			target: { value: 'team@example.com' },
		} );
		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'error',
				message:
					'Failed to save organizer settings: Invalid email address.',
			} )
		);
		expect( emailFields()[ 0 ] ).toHaveValue( 'team@example.com' );
		expect( saveButton() ).toBeEnabled();
		expect( loadOrganizerSettings ).toHaveBeenCalledTimes( 1 );
	} );
} );

test( 'holds the sitewide organizer’s Telegram ticket sales while the Organizers page is off', async () => {
	apiFetch.mockImplementation( ( { path } ) =>
		'/fair-events/v1/sale-alerts' === path
			? Promise.resolve( {
					organizers: [
						{
							id: 'default',
							name: 'Test Site',
							sitewide: true,
							settings: {
								enabled: false,
								chat_id: '@site_sales',
								frequency: 'daily',
								time_of_day: '07:30',
								day_of_week: 1,
							},
							next_digest: null,
							pending: 0,
						},
					],
					organizer_resolution_available: false,
					credential_problem: '',
					connectors_url: '/wp-admin/options-connectors.php',
					notifications_url:
						'/wp-admin/admin.php?page=fair-events-event-notifications',
					settings_url:
						'/wp-admin/admin.php?page=fair-events-settings&tab=organizer',
					timezone: 'UTC',
					recent: [],
				} )
			: new Promise( () => {} )
	);

	render( <OrganizerTab onNotice={ jest.fn() } /> );

	expect(
		await screen.findByRole( 'textbox', { name: 'Chat or channel' } )
	).toHaveValue( '@site_sales' );
	expect( screen.getByLabelText( 'Delivery time' ) ).toHaveValue( '07:30' );
	expect(
		screen.getByRole( 'checkbox', { name: 'Send this organizer’s sales' } )
	).not.toBeChecked();
} );
