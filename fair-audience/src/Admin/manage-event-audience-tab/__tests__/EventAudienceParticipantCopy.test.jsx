/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventAudience from '../EventAudience.js';

jest.mock( '@wordpress/api-fetch' );

const PARTICIPANTS = [
	{
		id: 1,
		participant_id: 10,
		participant_name: 'Alex Paid',
		label: 'signed_up',
		ticket_type_name: 'Paid ticket',
		ticket_option_ids: [],
		ticket_option_names: [],
		payment_expires_at: null,
	},
	{
		id: 2,
		participant_id: 11,
		participant_name: 'Blair Free',
		label: 'signed_up',
		ticket_type_name: 'Free ticket',
		ticket_option_ids: [],
		ticket_option_names: [],
		payment_expires_at: null,
	},
	{
		id: 3,
		participant_id: 12,
		participant_name: 'Casey Manual',
		label: 'signed_up',
		ticket_type_name: null,
		admin_comment: 'Added by staff',
		ticket_option_ids: [],
		ticket_option_names: [],
		payment_expires_at: null,
	},
	{
		id: 4,
		participant_id: 13,
		participant_name: 'Drew Interested',
		label: 'interested',
		ticket_type_name: null,
		ticket_option_ids: [],
		ticket_option_names: [],
		payment_expires_at: null,
	},
	{
		id: 5,
		participant_id: 14,
		participant_name: 'Eli Helper',
		label: 'collaborator',
		ticket_type_name: null,
		ticket_option_ids: [],
		ticket_option_names: [],
		payment_expires_at: null,
	},
	{
		id: 6,
		participant_id: 15,
		participant_name: 'Frankie SeriesPass',
		label: 'signed_up',
		is_series_pass: true,
		ticket_type_name: 'Full series pass',
		ticket_option_ids: [],
		ticket_option_names: [],
		payment_expires_at: null,
	},
];

const mockApiFetch = ( participants ) => {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( participants );
		}
		if ( path.includes( '/tickets' ) ) {
			return Promise.resolve( { options: [], ticket_types: [] } );
		}
		return Promise.resolve( [] );
	} );
};

beforeEach( () => {
	Object.defineProperty( navigator, 'clipboard', {
		configurable: true,
		value: { writeText: jest.fn().mockResolvedValue() },
	} );
	mockApiFetch( PARTICIPANTS );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

it( 'copies only signed-up participants, including paid, free, manually added, and series-pass rows', async () => {
	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Workshop day"
		/>
	);

	const button = await screen.findByRole( 'button', {
		name: 'Participant',
	} );
	expect( button ).not.toBeDisabled();
	fireEvent.click( button );

	await waitFor( () => {
		const copied = navigator.clipboard.writeText.mock.calls[ 0 ][ 0 ];
		expect( copied ).toContain( 'Alex Paid' );
		expect( copied ).toContain( 'Blair Free' );
		expect( copied ).toContain( 'Casey Manual' );
		expect( copied ).toContain( 'Frankie SeriesPass' );
		expect( copied ).not.toContain( 'Drew Interested' );
		expect( copied ).not.toContain( 'Eli Helper' );
	} );
} );

it( 'keeps excluding interested and collaborator rows when a search matches them', async () => {
	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Workshop day"
		/>
	);

	fireEvent.change( await screen.findByLabelText( 'Search' ), {
		target: { value: 'e' },
	} );

	const button = await screen.findByRole( 'button', {
		name: 'Participant',
	} );
	fireEvent.click( button );

	await waitFor( () => {
		const copied = navigator.clipboard.writeText.mock.calls[ 0 ][ 0 ];
		expect( copied ).toContain( 'Alex Paid' );
		expect( copied ).toContain( 'Frankie SeriesPass' );
		expect( copied ).not.toContain( 'Drew Interested' );
		expect( copied ).not.toContain( 'Eli Helper' );
	} );
} );

it( 'disables the Participant button once the role filter excludes every signed-up row', async () => {
	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Workshop day"
		/>
	);

	const button = await screen.findByRole( 'button', {
		name: 'Participant',
	} );
	expect( button ).not.toBeDisabled();

	fireEvent.change( screen.getByLabelText( 'Role' ), {
		target: { value: 'interested' },
	} );

	await waitFor( () => expect( button ).toBeDisabled() );
} );

it( 'disables the Participant button when there are no signed-up participants at all', async () => {
	mockApiFetch( PARTICIPANTS.filter( ( p ) => p.label !== 'signed_up' ) );

	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Workshop day"
		/>
	);

	const button = await screen.findByRole( 'button', {
		name: 'Participant',
	} );
	await waitFor( () => expect( button ).toBeDisabled() );
} );
