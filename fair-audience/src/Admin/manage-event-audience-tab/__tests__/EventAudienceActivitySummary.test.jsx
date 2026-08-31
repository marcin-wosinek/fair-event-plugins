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
		participant_name: 'Alex',
		label: 'signed_up',
		ticket_option_ids: [ 101, 102 ],
		ticket_option_names: [],
		payment_expires_at: null,
	},
	{
		id: 2,
		participant_id: 11,
		participant_name: 'Blair',
		label: 'signed_up',
		ticket_option_ids: [ 101 ],
		ticket_option_names: [],
		payment_expires_at: null,
	},
];

const TICKET_OPTIONS = [
	{ id: 101, name: 'Full Yoga Workshop', short_name: 'Yoga' },
	{ id: 102, name: 'Full Dance Workshop', short_name: '' },
];

beforeEach( () => {
	Object.defineProperty( navigator, 'clipboard', {
		configurable: true,
		value: { writeText: jest.fn().mockResolvedValue() },
	} );

	apiFetch.mockImplementation( ( { path } ) => {
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( PARTICIPANTS );
		}
		if ( path.includes( '/tickets' ) ) {
			return Promise.resolve( {
				options: TICKET_OPTIONS,
				ticket_types: [],
			} );
		}
		return Promise.resolve( [] );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

it( 'copies activity short names with full-name fallback and seat counts', async () => {
	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Workshop day"
		/>
	);

	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Activity summary' } )
	);

	await waitFor( () => {
		expect( navigator.clipboard.writeText ).toHaveBeenCalledWith(
			'- Yoga: 2\n- Full Dance Workshop: 1'
		);
	} );
} );
