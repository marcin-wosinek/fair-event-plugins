/**
 * @jest-environment jsdom
 *
 * Component tests for the guarded "Remove participant" action on the
 * Audience tab (#1820).
 *
 * Exercises:
 *   - The action is offered on every row of this date, also when the event
 *     has no activities, and not on an inherited series-pass row.
 *   - The confirmation names the participant, the event and the date;
 *     keeping the participant sends nothing.
 *   - Confirming calls the DELETE endpoint once, reloads the list and
 *     reports the removal; a second click while it runs sends nothing.
 *   - A failure is shown in the popup, the participant stays listed and the
 *     removal can be retried.
 *   - A participant with blockers gets guidance instead of a removal, and a
 *     refusal from the server for something that changed is shown the same
 *     way.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	within,
	waitFor,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import { formatTimingStart } from 'fair-events-shared';
import EventAudience from '../EventAudience.js';

jest.mock( '@wordpress/api-fetch' );

const PARTICIPANT = {
	id: 1,
	participant_id: 10,
	event_date_id: 5,
	is_series_pass: false,
	participant_name: 'Jane Doe',
	name: 'Jane',
	surname: 'Doe',
	participant_email: 'jane@example.com',
	email_profile: 'marketing',
	label: 'interested',
	ticket_type_id: null,
	ticket_type_name: null,
	attended_at: null,
	created_at: '2026-01-01 10:00:00',
	payment_expires_at: null,
	ticket_option_names: [],
	ticket_option_ids: [],
	admin_comment: '',
	removal_blockers: [],
};

const REGISTRATION_BLOCKER = {
	code: 'registration',
	message:
		'This participant has 1 registration for this date. Delete it on the List tab first; its tickets are deleted with it.',
};

const SIBLINGS = [
	{
		id: 5,
		start_date: '2026-01-01',
		start_time: '10:00:00',
		occurrence_type: 'single',
	},
];

// The date as the site formats it, with its start time.
const DATE_LABEL = formatTimingStart( {
	start_date: '2026-01-01',
	start_time: '10:00:00',
} );

const isRemoval = ( { path, method } ) =>
	method === 'DELETE' && path.endsWith( '/participants/10' );

/**
 * @param {Object}   options
 * @param {Function} options.participants Returns the rows of each list load.
 * @param {Function} [options.remove]     Answers the DELETE request.
 * @param {Array}    [options.ticketOptions]
 */
function mockApiFetchFor( { participants, remove, ticketOptions = [] } ) {
	apiFetch.mockImplementation( ( request ) => {
		const { path } = request;
		if ( isRemoval( request ) ) {
			return remove
				? remove()
				: Promise.resolve( { removed: true, message: 'removed' } );
		}
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( participants() );
		}
		if ( path.includes( '/siblings' ) ) {
			return Promise.resolve( SIBLINGS );
		}
		if ( path.includes( '/tickets' ) ) {
			return Promise.resolve( {
				options: ticketOptions,
				ticket_types: [],
			} );
		}
		return Promise.resolve( [] );
	} );
}

const removalCalls = () =>
	apiFetch.mock.calls.filter( ( [ request ] ) => isRemoval( request ) );

function renderAudience() {
	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Weekly class"
		/>
	);
}

async function openRemoval() {
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Remove participant' } )
	);
	return screen.findByRole( 'dialog', {
		name: 'Remove participant — Jane Doe',
	} );
}

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'EventAudience — Remove participant (#1820)', () => {
	it( 'offers the action on an event without activities', async () => {
		mockApiFetchFor( { participants: () => [ PARTICIPANT ] } );
		renderAudience();

		expect(
			await screen.findByRole( 'button', { name: 'Remove participant' } )
		).toBeInTheDocument();
		// Without activities there is nothing to edit on the participant.
		expect(
			screen.queryByRole( 'button', { name: 'Edit participant' } )
		).not.toBeInTheDocument();
	} );

	it( 'offers the action beside Edit participant', async () => {
		mockApiFetchFor( {
			participants: () => [ PARTICIPANT ],
			ticketOptions: [ { id: 3, name: 'Pottery' } ],
		} );
		renderAudience();

		const edit = await screen.findByRole( 'button', {
			name: 'Edit participant',
		} );
		expect(
			within( edit.closest( 'td' ) ).getByRole( 'button', {
				name: 'Remove participant',
			} )
		).toBeInTheDocument();
	} );

	it( 'leaves an inherited series pass to its series date', async () => {
		mockApiFetchFor( {
			participants: () => [
				{ ...PARTICIPANT, event_date_id: 4, is_series_pass: true },
			],
		} );
		renderAudience();

		expect(
			await screen.findByText( 'Managed on series date' )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Remove participant' } )
		).not.toBeInTheDocument();
	} );

	it( 'names the participant, the event and the date, and changes nothing when kept', async () => {
		mockApiFetchFor( { participants: () => [ PARTICIPANT ] } );
		renderAudience();

		const dialog = await openRemoval();
		expect(
			within( dialog ).getByText(
				`Remove Jane Doe from the audience of Weekly class on ${ DATE_LABEL }?`
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( /Their participant profile/ )
		).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Keep participant' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( removalCalls() ).toHaveLength( 0 );
		expect( screen.getByText( 'Jane Doe' ) ).toBeInTheDocument();
	} );

	it( 'removes once, reloads the list and reports it', async () => {
		let listed = [ PARTICIPANT ];
		let finishRemoval;
		mockApiFetchFor( {
			participants: () => listed,
			remove: () =>
				new Promise( ( resolve ) => {
					finishRemoval = () => {
						listed = [];
						resolve( { removed: true, message: 'removed' } );
					};
				} ),
		} );
		renderAudience();

		const dialog = await openRemoval();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Remove participant',
		} );
		fireEvent.click( confirm );
		// A second click while the request runs sends nothing more.
		fireEvent.click( confirm );

		const busy = await within( dialog ).findByRole( 'button', {
			name: 'Removing…',
		} );
		expect( busy ).toBeDisabled();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Keep participant' } )
		).toBeDisabled();
		fireEvent.click( busy );
		expect( removalCalls() ).toHaveLength( 1 );
		expect( removalCalls()[ 0 ][ 0 ].path ).toBe(
			'/fair-audience/v1/event-dates/5/participants/10'
		);

		finishRemoval();

		expect(
			await screen.findByText( 'Jane Doe was removed from this date.' )
		).toBeInTheDocument();
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		await waitFor( () =>
			expect(
				screen.queryByRole( 'link', { name: 'Jane Doe' } )
			).not.toBeInTheDocument()
		);
		expect( removalCalls() ).toHaveLength( 1 );
	} );

	it( 'shows a failure, keeps the participant and allows a retry', async () => {
		let attempts = 0;
		mockApiFetchFor( {
			participants: () => [ PARTICIPANT ],
			remove: () => {
				attempts += 1;
				return attempts === 1
					? Promise.reject( {
							code: 'removal_failed',
							message:
								'The participant could not be removed. Nothing was changed; try again.',
						} )
					: Promise.resolve( { removed: true, message: 'removed' } );
			},
		} );
		renderAudience();

		const dialog = await openRemoval();
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Remove participant',
			} )
		);

		expect(
			await within( dialog ).findByText(
				'The participant could not be removed. Nothing was changed; try again.'
			)
		).toBeInTheDocument();
		// Behind the popup, which hides the rest of the page from queries.
		expect(
			screen.getByRole( 'link', { name: 'Jane Doe', hidden: true } )
		).toBeInTheDocument();

		const retry = within( dialog ).getByRole( 'button', {
			name: 'Remove participant',
		} );
		expect( retry ).toBeEnabled();
		fireEvent.click( retry );

		expect(
			await screen.findByText( 'Jane Doe was removed from this date.' )
		).toBeInTheDocument();
		expect( removalCalls() ).toHaveLength( 2 );
	} );

	it( 'explains what to resolve first instead of removing', async () => {
		mockApiFetchFor( {
			participants: () => [
				{
					...PARTICIPANT,
					label: 'signed_up',
					removal_blockers: [ REGISTRATION_BLOCKER ],
				},
			],
		} );
		renderAudience();

		const dialog = await openRemoval();
		expect(
			within( dialog ).getByText(
				`Jane Doe cannot be removed from Weekly class on ${ DATE_LABEL } yet.`
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( REGISTRATION_BLOCKER.message )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'link', { name: 'Open the List tab' } )
		).toHaveAttribute( 'href', expect.stringContaining( 'tab=list' ) );
		expect(
			within( dialog ).queryByRole( 'button', {
				name: 'Remove participant',
			} )
		).not.toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Back to the audience',
			} )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( removalCalls() ).toHaveLength( 0 );
	} );

	it( 'shows a refusal for something that changed after the list was loaded', async () => {
		const blocker = {
			code: 'tickets',
			message:
				'This participant holds 1 ticket for this date. Assign it to someone else, or cancel and then delete it, with the ticket’s actions.',
		};
		let loads = 0;
		mockApiFetchFor( {
			participants: () => {
				loads += 1;
				return [ PARTICIPANT ];
			},
			remove: () =>
				Promise.reject( {
					code: 'removal_blocked',
					message: blocker.message,
					data: { status: 409, blockers: [ blocker ] },
				} ),
		} );
		renderAudience();

		const dialog = await openRemoval();
		const loadsBefore = loads;
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Remove participant',
			} )
		);

		expect(
			await within( dialog ).findByText( blocker.message )
		).toBeInTheDocument();
		expect(
			within( dialog ).queryByRole( 'button', {
				name: 'Remove participant',
			} )
		).not.toBeInTheDocument();
		// The list is reloaded so it shows what the server found.
		await waitFor( () => expect( loads ).toBeGreaterThan( loadsBefore ) );
		// Behind the popup, which hides the rest of the page from queries.
		expect(
			screen.getByRole( 'link', { name: 'Jane Doe', hidden: true } )
		).toBeInTheDocument();
	} );
} );
