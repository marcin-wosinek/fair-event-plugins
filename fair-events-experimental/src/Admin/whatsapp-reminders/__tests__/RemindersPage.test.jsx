/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import RemindersPage from '../RemindersPage.js';

jest.mock( '@wordpress/api-fetch' );

const URL = 'https://example.test/fair-events-weekly-summary/valencia/';

function feedFixture( overrides ) {
	return {
		source_id: 7,
		name: 'Valencia',
		slug: 'valencia',
		feed_enabled: true,
		has_page: true,
		summary_url: URL,
		reminder: null,
		next_run: null,
		...overrides,
	};
}

function page( overrides ) {
	return {
		feeds: [ feedFixture() ],
		connection: {
			ready: true,
			whatsapp_url: '/wp-admin/admin.php?page=fair-events-whatsapp',
		},
		team_members_available: true,
		team_members: [ { id: 2, name: 'Bea Demo', number: '+34600000402' } ],
		history: [],
		retention_days: 90,
		...overrides,
	};
}

const TEMPLATES = [
	{
		name: 'valencia_summary',
		language: 'es_ES',
		category: 'UTILITY',
		button_urls: [ URL ],
	},
	{
		name: 'hello_world',
		language: 'en_US',
		category: 'UTILITY',
		button_urls: [],
	},
];

/** Answer apiFetch calls by path and method. */
function serve( { data = page(), saved } = {} ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path.endsWith( '/whatsapp/templates' ) ) {
			return Promise.resolve( TEMPLATES );
		}
		if ( 'PUT' === method ) {
			return saved
				? saved()
				: Promise.reject( { message: 'Not expected' } );
		}
		return Promise.resolve( data );
	} );
}

async function flush() {
	await act( async () => {} );
}

async function renderPage() {
	render(
		<RemindersPage
			notificationsUrl="/wp-admin/admin.php?page=fair-events-event-notifications"
			teamMembersUrl={ null }
			sourcesUrl={ null }
		/>
	);
	await flush();
	await flush();
}

beforeEach( () => {
	apiFetch.mockReset();
} );

it( 'lists each feed with its status and links back to Event notifications', async () => {
	serve();
	await renderPage();
	expect(
		screen.getByRole( 'link', { name: '← Event notifications' } )
	).toHaveAttribute(
		'href',
		'/wp-admin/admin.php?page=fair-events-event-notifications'
	);
	expect( screen.getByText( 'Valencia' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Not set up' ) ).toBeInTheDocument();
	expect(
		screen.getByText( 'No reminder has run yet.' )
	).toBeInTheDocument();
} );

it( 'saves a collaborator only after consent, with a template for the feed', async () => {
	let body;
	serve( {
		saved: () => Promise.resolve( feedFixture() ),
	} );
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path.endsWith( '/whatsapp/templates' ) ) {
			return Promise.resolve( TEMPLATES );
		}
		if ( 'PUT' === options.method ) {
			body = options.data;
			return Promise.resolve(
				feedFixture( {
					reminder: {
						enabled: true,
						day_of_week: 1,
						time_of_day: '10:00',
						recipient: {
							kind: 'member',
							member_id: 2,
							name: 'Bea Demo',
							number: '+34600000402',
						},
						destination_status: 'ok',
						consent_confirmed: true,
						template: {
							name: 'valencia_summary',
							language: 'es_ES',
							url: URL,
							matches_feed: true,
						},
					},
				} )
			);
		}
		return Promise.resolve( page() );
	} );
	await renderPage();

	fireEvent.click(
		screen.getByRole( 'button', { name: 'Edit the reminder for Valencia' } )
	);
	await flush();
	await flush();

	// Only templates opening this feed's page are offered.
	const template = screen.getByLabelText( 'Template' );
	expect(
		within( template ).getByRole( 'option', {
			name: 'valencia_summary (es_ES)',
		} )
	).toBeInTheDocument();
	expect(
		within( template ).queryByRole( 'option', {
			name: 'hello_world (en_US)',
		} )
	).not.toBeInTheDocument();

	fireEvent.click( screen.getByLabelText( 'Send the weekly reminder' ) );
	fireEvent.click( screen.getByLabelText( 'A team member' ) );
	fireEvent.change( screen.getByLabelText( 'Team member' ), {
		target: { value: '2' },
	} );
	fireEvent.change( template, {
		target: { value: 'valencia_summary|es_ES' },
	} );

	const save = screen.getByRole( 'button', { name: 'Save reminder' } );
	expect( save ).toBeDisabled();
	expect(
		screen.getByText(
			'Confirm that the collaborator agreed to receive these reminders at this number.'
		)
	).toBeInTheDocument();

	fireEvent.click(
		screen.getByLabelText(
			'Bea Demo agreed to receive these weekly WhatsApp reminders at +34600000402.'
		)
	);
	expect( save ).toBeEnabled();
	await act( async () => {
		fireEvent.click( save );
	} );
	await flush();

	expect( body ).toEqual( {
		enabled: true,
		day_of_week: 1,
		time_of_day: '10:00',
		recipient: { kind: 'member', member_id: 2 },
		consent: true,
		template: { name: 'valencia_summary', language: 'es_ES' },
	} );
	expect(
		screen.getByText( 'Reminder saved.', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
} );

it( 'keeps the form and shows the error when saving fails', async () => {
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path.endsWith( '/whatsapp/templates' ) ) {
			return Promise.resolve( TEMPLATES );
		}
		if ( 'PUT' === options.method ) {
			return Promise.reject( {
				message: 'This template is not an approved template.',
			} );
		}
		return Promise.resolve( page() );
	} );
	await renderPage();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Edit the reminder for Valencia' } )
	);
	await flush();
	fireEvent.click( screen.getByLabelText( 'Someone else' ) );
	fireEvent.change( screen.getByLabelText( 'Name' ), {
		target: { value: 'Ana' },
	} );
	fireEvent.change( screen.getByLabelText( 'WhatsApp number' ), {
		target: { value: '+34 600 000 401' },
	} );
	fireEvent.click(
		screen.getByLabelText(
			'Ana agreed to receive these weekly WhatsApp reminders at +34 600 000 401.'
		)
	);
	await act( async () => {
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save reminder' } )
		);
	} );
	await flush();

	expect(
		screen.getByText( 'This template is not an approved template.', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
	expect( screen.getByLabelText( 'Name' ) ).toHaveValue( 'Ana' );
	expect( screen.getAllByText( 'Unsaved changes' ).length ).toBeGreaterThan(
		0
	);
} );

it( 'warns that an enabled reminder is not sending, and names the history outcome', async () => {
	serve( {
		data: page( {
			connection: { ready: false, whatsapp_url: '/wa' },
			feeds: [
				feedFixture( {
					reminder: {
						enabled: true,
						day_of_week: 1,
						time_of_day: '10:00',
						recipient: null,
						destination_status: 'none',
						consent_confirmed: false,
						template: null,
					},
				} ),
			],
			history: [
				{
					id: 1,
					source_id: 7,
					feed_name: 'Valencia',
					send_week: '2037-W10',
					state: 'skipped',
					reason: 'empty_week',
					message:
						'Not sent: the feed has no public events this week.',
					recipient: '',
					template: null,
					created_at_local: 'March 4, 2037 9:30 am',
					delivery: null,
				},
			],
		} ),
	} );
	await renderPage();
	expect( screen.getByText( 'On, not sending' ) ).toBeInTheDocument();
	expect(
		screen.getByText( 'No collaborator is designated.' )
	).toBeInTheDocument();
	expect(
		screen.getByText(
			'The WhatsApp connection is not validated, so no reminder is sent. Validate it first.',
			{ exact: false, selector: '.components-notice__content' }
		)
	).toBeInTheDocument();
	expect( screen.getByText( 'Skipped' ) ).toBeInTheDocument();
	expect(
		screen.getByText( 'Not sent: the feed has no public events this week.' )
	).toBeInTheDocument();
} );

it( 'confirms before removing the collaborator', async () => {
	const saved = {
		enabled: true,
		day_of_week: 2,
		time_of_day: '09:00',
		recipient: {
			kind: 'standalone',
			member_id: null,
			name: 'Ana',
			number: '+34600000401',
		},
		destination_status: 'ok',
		consent_confirmed: true,
		template: null,
	};
	let body;
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path.endsWith( '/whatsapp/templates' ) ) {
			return Promise.resolve( TEMPLATES );
		}
		if ( 'PUT' === options.method ) {
			body = options.data;
			return Promise.resolve(
				feedFixture( {
					reminder: {
						...saved,
						recipient: null,
						destination_status: 'none',
						consent_confirmed: false,
					},
				} )
			);
		}
		return Promise.resolve(
			page( { feeds: [ feedFixture( { reminder: saved } ) ] } )
		);
	} );
	await renderPage();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Edit the reminder for Valencia' } )
	);
	await flush();
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Remove collaborator' } )
	);
	const dialog = screen.getByRole( 'dialog' );
	expect( dialog ).toHaveTextContent( 'Ana will no longer get' );
	await act( async () => {
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Remove collaborator',
			} )
		);
	} );
	await flush();
	expect( body ).toMatchObject( {
		enabled: true,
		day_of_week: 2,
		time_of_day: '09:00',
		recipient: null,
	} );
	expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
} );
