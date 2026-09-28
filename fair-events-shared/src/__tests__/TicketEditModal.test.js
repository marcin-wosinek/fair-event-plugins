/**
 * @jest-environment jsdom
 *
 * Component tests for the shared ticket editor (#1709), opened from both the
 * List tab and the Audience tab.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import TicketEditModal, { activityRuleProblem } from '../TicketEditModal.js';

jest.mock( '@wordpress/api-fetch' );

// jsdom has no layout engine; @wordpress/components' Flex uses matchMedia
// for responsive values, which jsdom doesn't implement.
beforeAll( () => {
	window.matchMedia =
		window.matchMedia ||
		function () {
			return {
				matches: false,
				addListener: () => {},
				removeListener: () => {},
			};
		};
} );

const PATH = '/fair-audience/v1/event-dates/5/tickets/12';

const TYPES = [
	{
		id: 1,
		label: 'Regular',
		current: true,
		capacity: 20,
		remaining: 15,
		activities_enabled: true,
		minimum_activities: 0,
		maximum_activities: 2,
	},
	{
		id: 2,
		label: 'Reduced',
		current: false,
		capacity: 3,
		remaining: 0,
		activities_enabled: true,
		minimum_activities: 0,
		maximum_activities: 1,
	},
	{
		id: 3,
		label: 'Standing',
		current: false,
		capacity: null,
		remaining: null,
		activities_enabled: false,
		minimum_activities: 0,
		maximum_activities: null,
	},
];

function response( ticket = {} ) {
	return {
		ticket: {
			id: 12,
			position: 2,
			reference: 'AE2671B5',
			signup_id: 4,
			ticket_type_id: 1,
			ticket_type_name: 'Regular',
			status: 'confirmed',
			attended_at: null,
			activity_ids: [ 7 ],
			over_capacity_activity_ids: [],
			participant_name: 'Alex Demo',
			editable: true,
			...ticket,
		},
		ticket_types: TYPES,
		activities: [
			{ id: 7, name: 'Pottery', capacity: 2, remaining: 0 },
			{ id: 8, name: 'Dinner', capacity: null, remaining: null },
		],
	};
}

/**
 * Route apiFetch: GET returns the ticket, each PUT takes the next result.
 *
 * @param {Object} data       GET response.
 * @param {Array}  putResults PUT responses in call order; Errors reject.
 */
function mockApi( data = response(), putResults = [ { id: 12 } ] ) {
	const puts = [ ...putResults ];
	apiFetch.mockImplementation( ( { method } ) => {
		if ( method === 'PUT' ) {
			const result = puts.shift();
			return result instanceof Error
				? Promise.reject( result )
				: Promise.resolve( result );
		}
		return Promise.resolve( data );
	} );
}

function puts() {
	return apiFetch.mock.calls
		.map( ( [ args ] ) => args )
		.filter( ( args ) => args.method === 'PUT' );
}

async function renderModal( props = {} ) {
	const onClose = jest.fn();
	const onSaved = jest.fn();
	render(
		<TicketEditModal
			eventDateId={ 5 }
			ticketId={ 12 }
			onClose={ onClose }
			onSaved={ onSaved }
			{ ...props }
		/>
	);
	const modal = await screen.findByRole( 'dialog', {
		name: 'Edit ticket — Alex Demo',
	} );
	return { modal, onClose, onSaved };
}

function capacityError() {
	const error = new Error( 'Reduced would have 4 of 3 places taken.' );
	error.code = 'capacity_exceeded';
	const typeProjection = {
		scope: 'ticket_type',
		id: 2,
		label: 'Reduced',
		taken: 3,
		capacity: 3,
		after: 4,
	};
	error.data = {
		status: 409,
		projection: typeProjection,
		projections: [
			typeProjection,
			{
				scope: 'ticket_option',
				id: 8,
				event_date_id: 5,
				label: 'Dinner',
				taken: 10,
				capacity: 10,
				after: 11,
			},
		],
	};
	return error;
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'TicketEditModal', () => {
	it( 'shows the participant, the ticket label, and its current state', async () => {
		mockApi();
		const { modal } = await renderModal();

		expect( apiFetch ).toHaveBeenCalledWith( { path: PATH } );
		expect(
			within( modal ).getByText( 'Ticket 2 (AE2671B5)' )
		).toBeInTheDocument();
		expect(
			within( modal ).getByText( 'Status: Confirmed' )
		).toBeInTheDocument();
		expect(
			within( modal ).getByRole( 'combobox', { name: 'Ticket type' } )
		).toHaveValue( '1' );
		expect(
			within( modal ).getByRole( 'option', { name: 'Regular (current)' } )
		).toBeInTheDocument();
		expect(
			within( modal ).getByRole( 'option', { name: 'Reduced — Full' } )
		).toBeInTheDocument();
		expect(
			within( modal ).getByRole( 'checkbox', { name: 'Pottery' } )
		).toBeChecked();
		expect(
			within( modal ).getByRole( 'checkbox', { name: 'Dinner' } )
		).not.toBeChecked();
		expect(
			within( modal ).getByRole( 'checkbox', { name: 'Checked in' } )
		).not.toBeChecked();
		expect(
			within( modal ).getByText(
				'The amount paid stays the same: no charge or refund is made for a price difference.'
			)
		).toBeInTheDocument();
		expect(
			within( modal ).getByRole( 'button', { name: 'Save ticket' } )
		).toBeDisabled();
		expect(
			within( modal ).getByText( 'No unsaved changes.' )
		).toBeInTheDocument();
	} );

	it( 'saves the type, activities and check-in in one request', async () => {
		mockApi();
		const { modal, onSaved } = await renderModal();

		fireEvent.change(
			within( modal ).getByRole( 'combobox', { name: 'Ticket type' } ),
			{ target: { value: '2' } }
		);
		fireEvent.click(
			within( modal ).getByRole( 'checkbox', { name: 'Pottery' } )
		);
		fireEvent.click(
			within( modal ).getByRole( 'checkbox', { name: 'Dinner' } )
		);
		fireEvent.click(
			within( modal ).getByRole( 'checkbox', { name: 'Checked in' } )
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Save ticket' } )
		);

		await waitFor( () =>
			expect( onSaved ).toHaveBeenCalledWith( { id: 12 } )
		);
		expect( puts() ).toEqual( [
			{
				path: PATH,
				method: 'PUT',
				data: {
					ticket_type_id: 2,
					activity_ids: [ 8 ],
					attended: true,
				},
			},
		] );
	} );

	it( 'shows every projected excess and requires a reason before going over capacity', async () => {
		mockApi( response(), [ capacityError(), { id: 12 } ] );
		const { modal, onSaved } = await renderModal();

		fireEvent.change(
			within( modal ).getByRole( 'combobox', { name: 'Ticket type' } ),
			{ target: { value: '2' } }
		);
		fireEvent.click(
			within( modal ).getByRole( 'checkbox', { name: 'Pottery' } )
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Save ticket' } )
		);

		expect(
			await within( modal ).findByText(
				'Reduced would have 4 of 3 places taken.'
			)
		).toBeInTheDocument();
		expect(
			within( modal ).getByText(
				'Dinner would have 11 of 10 places taken.'
			)
		).toBeInTheDocument();
		expect( onSaved ).not.toHaveBeenCalled();
		// The administrator's edits stay in place.
		expect(
			within( modal ).getByRole( 'combobox', { name: 'Ticket type' } )
		).toHaveValue( '2' );

		const override = within( modal ).getByRole( 'button', {
			name: 'Save over capacity',
		} );
		expect( override ).toBeDisabled();
		expect(
			within( modal ).getByText( 'Enter a reason to go over capacity.' )
		).toBeInTheDocument();

		fireEvent.change(
			within( modal ).getByRole( 'textbox', {
				name: 'Reason for going over capacity',
			} ),
			{ target: { value: 'Speaker guest' } }
		);
		fireEvent.click( override );

		await waitFor( () => expect( onSaved ).toHaveBeenCalled() );
		expect( puts()[ 1 ].data ).toEqual( {
			ticket_type_id: 2,
			activity_ids: [],
			override_reason: 'Speaker guest',
		} );
	} );

	it( 'keeps the popup open with the edits and an error when saving fails', async () => {
		mockApi( response(), [ new Error( 'Failed to update the ticket.' ) ] );
		const { modal, onSaved, onClose } = await renderModal();

		fireEvent.click(
			within( modal ).getByRole( 'checkbox', { name: 'Dinner' } )
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Save ticket' } )
		);

		expect(
			await within( modal ).findByText( 'Failed to update the ticket.' )
		).toBeInTheDocument();
		expect(
			within( modal ).getByRole( 'checkbox', { name: 'Dinner' } )
		).toBeChecked();
		expect( onSaved ).not.toHaveBeenCalled();
		expect( onClose ).not.toHaveBeenCalled();
	} );

	it( 'explains why saving is unavailable when the activities break the chosen type’s rules', async () => {
		mockApi();
		const { modal } = await renderModal();

		fireEvent.change(
			within( modal ).getByRole( 'combobox', { name: 'Ticket type' } ),
			{ target: { value: '3' } }
		);

		expect(
			within( modal ).getByText(
				'The chosen ticket type does not include activities. Clear them to save.'
			)
		).toBeInTheDocument();
		expect(
			within( modal ).getByRole( 'button', { name: 'Save ticket' } )
		).toBeDisabled();
		// Only activities already chosen can still be changed.
		expect(
			within( modal ).getByRole( 'checkbox', { name: 'Dinner' } )
		).toBeDisabled();

		fireEvent.click(
			within( modal ).getByRole( 'checkbox', { name: 'Pottery' } )
		);
		expect(
			within( modal ).getByRole( 'button', { name: 'Save ticket' } )
		).toBeEnabled();
	} );

	it( 'shows a ticket awaiting payment read-only', async () => {
		mockApi(
			response( {
				status: 'pending_payment',
				editable: false,
			} )
		);
		const { modal, onClose } = await renderModal();

		expect(
			within( modal ).getByText( 'Status: Awaiting payment' )
		).toBeInTheDocument();
		expect(
			within( modal ).getByText(
				'This ticket is awaiting payment. It can be edited once the payment is complete.'
			)
		).toBeInTheDocument();
		expect( within( modal ).queryByRole( 'combobox' ) ).toBeNull();
		expect( within( modal ).queryByRole( 'checkbox' ) ).toBeNull();
		expect(
			within( modal ).queryByRole( 'button', { name: 'Save ticket' } )
		).toBeNull();

		fireEvent.click(
			within( modal ).getByText( 'Close', { selector: 'button' } )
		);
		expect( onClose ).toHaveBeenCalled();
	} );

	it( 'closes without saving on Cancel', async () => {
		mockApi();
		const { modal, onClose } = await renderModal();

		fireEvent.click(
			within( modal ).getByRole( 'checkbox', { name: 'Dinner' } )
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( onClose ).toHaveBeenCalled();
		expect( puts() ).toEqual( [] );
	} );

	it( 'shows a load failure', async () => {
		apiFetch.mockRejectedValue(
			new Error( 'Ticket not found for this event date.' )
		);
		render(
			<TicketEditModal
				eventDateId={ 5 }
				ticketId={ 12 }
				onClose={ jest.fn() }
				onSaved={ jest.fn() }
			/>
		);

		expect(
			await screen.findByText( 'Ticket not found for this event date.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
	} );
} );

describe( 'activityRuleProblem', () => {
	it( 'checks the minimum and maximum of the chosen type', () => {
		const type = {
			activities_enabled: true,
			minimum_activities: 1,
			maximum_activities: 2,
		};
		expect( activityRuleProblem( type, 0 ) ).toBe(
			'Choose at least 1 activity for this ticket type.'
		);
		expect( activityRuleProblem( type, 1 ) ).toBeNull();
		expect( activityRuleProblem( type, 3 ) ).toBe(
			'Choose at most 2 activities for this ticket type.'
		);
		expect( activityRuleProblem( undefined, 5 ) ).toBeNull();
	} );
} );
