/**
 * @jest-environment jsdom
 *
 * Component tests for one ticket's editor (#1697): adding an activity past
 * its limit is refused until the administrator gives a reason, and an
 * activity that went over capacity is labelled as such.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import TicketEditor from '../TicketEditor.js';

jest.mock( '@wordpress/api-fetch' );

const OPTIONS = [
	{ id: 7, name: 'Morning workshop' },
	{ id: 8, name: 'Masterclass' },
];

const TICKET = {
	id: 101,
	reference: 'AAAA1111',
	signup_id: 40,
	ticket_type_name: 'Regular',
	status: 'confirmed',
	attended_at: null,
	activity_ids: [ 7 ],
	activity_names: [ 'Morning workshop' ],
	confirmed_activity_ids: [ 7 ],
	over_capacity_activity_ids: [],
};

function renderEditor( ticket = TICKET ) {
	const onSaved = jest.fn();
	const onError = jest.fn();
	render(
		<TicketEditor
			ticket={ ticket }
			position={ 1 }
			ticketOptions={ OPTIONS }
			eventDateId={ 5 }
			onSaved={ onSaved }
			onError={ onError }
		/>
	);
	return { onSaved, onError };
}

beforeEach( () => {
	apiFetch.mockReset();
} );

test( 'asks for a reason when an activity would go over capacity, then saves with it', async () => {
	const conflict = {
		code: 'capacity_exceeded',
		message: 'Masterclass would have 3 of 2 places taken.',
		data: {
			status: 409,
			projection: {
				id: 8,
				event_date_id: 5,
				label: 'Masterclass',
				taken: 2,
				capacity: 2,
				after: 3,
			},
		},
	};
	apiFetch
		.mockRejectedValueOnce( conflict )
		.mockResolvedValueOnce( { ...TICKET, activity_ids: [ 7, 8 ] } );
	const { onSaved, onError } = renderEditor();

	fireEvent.click( screen.getByLabelText( 'Masterclass' ) );
	fireEvent.click( screen.getByRole( 'button', { name: /Save Ticket 1/ } ) );

	expect(
		await screen.findByText( 'Masterclass would have 3 of 2 places taken.' )
	).toBeInTheDocument();
	expect( onError ).not.toHaveBeenCalled();
	const saveAnyway = screen.getByRole( 'button', { name: /Save Ticket 1/ } );
	expect( saveAnyway ).toHaveTextContent( 'Save over capacity' );
	expect( saveAnyway ).toBeDisabled();

	fireEvent.change(
		screen.getByLabelText( 'Reason for going over capacity' ),
		{ target: { value: 'Speaker agreed to one more' } }
	);
	fireEvent.click( saveAnyway );

	await waitFor( () => expect( onSaved ).toHaveBeenCalled() );
	expect( apiFetch.mock.calls[ 1 ][ 0 ].data ).toEqual( {
		activity_ids: [ 7, 8 ],
		attended: false,
		override_reason: 'Speaker agreed to one more',
	} );
} );

test( 'labels an activity that went over capacity', () => {
	renderEditor( {
		...TICKET,
		activity_ids: [ 7, 8 ],
		over_capacity_activity_ids: [ 8 ],
	} );

	expect(
		screen.getByLabelText( 'Masterclass — over capacity' )
	).toBeChecked();
} );
