/**
 * @jest-environment jsdom
 *
 * Removing several participants from an event date at once (#1775), with
 * the popup the Audience tab uses for one participant (#1820).
 *
 * Exercises:
 *   - The confirmation counts and lists who is removed, names the event and
 *     the date, and says the profiles are kept.
 *   - Participants with blockers are listed with what to resolve and are
 *     not sent; the others can still be removed.
 *   - The batch route answers with removals and refusals side by side: the
 *     removed are reported, the refused stay with the reason.
 *   - A request that failed as a whole changes nothing and can be retried;
 *     a second click while removing sends nothing.
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
import RemoveParticipantModal from '../RemoveParticipantModal.js';

jest.mock( '@wordpress/api-fetch' );

const row = ( id, name, extra = {} ) => ( {
	id: id * 10,
	participant_id: id,
	participant_name: name,
	participant_email: `p${ id }@x.test`,
	removal_blockers: [],
	...extra,
} );

const REGISTRATION_BLOCKER = {
	code: 'registration',
	message:
		'This participant has 1 registration for this date. Delete it on the List tab first; its tickets are deleted with it.',
};

const JANE = row( 1, 'Jane Doe' );
const JOHN = row( 2, 'John Roe' );
const BUYER = row( 3, 'Bo Buyer', {
	removal_blockers: [ REGISTRATION_BLOCKER ],
} );

const batchCalls = () =>
	apiFetch.mock.calls
		.map( ( [ request ] ) => request )
		.filter( ( request ) => request.method === 'DELETE' );

function renderModal( participants, props = {} ) {
	const handlers = {
		onClose: jest.fn(),
		onRemoved: jest.fn(),
		onRefused: jest.fn(),
	};
	render(
		<RemoveParticipantModal
			eventDateId={ 5 }
			participants={ participants }
			eventTitle="Weekly class"
			dateLabel="May 10, 2036 6:00 pm"
			{ ...handlers }
			{ ...props }
		/>
	);
	return handlers;
}

const dialog = () =>
	screen.getByRole( 'dialog', {
		name: 'Remove participants from this event',
	} );

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	apiFetch.mockResolvedValue( {
		removed: 2,
		failed: 0,
		errors: [],
		failures: [],
	} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'RemoveParticipantModal — several participants', () => {
	it( 'counts and lists them, names the event and date, and keeps their profiles', () => {
		const { onClose } = renderModal( [ JANE, JOHN ] );

		expect( dialog() ).toHaveTextContent(
			'Remove 2 participants from the audience of Weekly class on May 10, 2036 6:00 pm?'
		);
		const list = within( dialog() ).getByRole( 'list', {
			name: 'Participants to remove',
		} );
		expect(
			within( list )
				.getAllByRole( 'listitem' )
				.map( ( item ) => item.textContent )
		).toEqual( [ 'Jane Doe', 'John Roe' ] );
		expect( dialog() ).toHaveTextContent(
			'Only their place in the audience of this date is removed'
		);
		expect( dialog() ).toHaveTextContent(
			'Their participant profiles, their other events and dates, and all payment records are kept.'
		);

		fireEvent.click(
			within( dialog() ).getByRole( 'button', {
				name: 'Keep participants',
			} )
		);
		expect( onClose ).toHaveBeenCalledTimes( 1 );
		expect( batchCalls() ).toHaveLength( 0 );
	} );

	it( 'tells people of the same name apart by email', () => {
		renderModal( [ JANE, row( 4, 'Jane Doe' ) ] );

		const list = within( dialog() ).getByRole( 'list', {
			name: 'Participants to remove',
		} );
		expect( list ).toHaveTextContent( 'Jane Doe (p1@x.test)' );
		expect( list ).toHaveTextContent( 'Jane Doe (p4@x.test)' );
	} );

	it( 'removes everyone in one request and hands the result on', async () => {
		const { onRemoved } = renderModal( [ JANE, JOHN ] );

		const button = within( dialog() ).getByRole( 'button', {
			name: 'Remove 2 participants',
		} );
		fireEvent.click( button );
		fireEvent.click( button );

		await waitFor( () =>
			expect( onRemoved ).toHaveBeenCalledWith( [ JANE, JOHN ], [] )
		);
		expect( batchCalls() ).toEqual( [
			{
				path: '/fair-audience/v1/event-dates/5/participants/batch',
				method: 'DELETE',
				data: { participant_ids: [ 1, 2 ] },
			},
		] );
	} );

	it( 'lists who cannot be removed yet, with what to do, and does not send them', async () => {
		const { onRemoved } = renderModal( [ JANE, BUYER ], {
			listUrl: 'admin.php?page=fair-events-manage-event&tab=list',
		} );

		expect( dialog() ).toHaveTextContent(
			'Remove 1 participant from the audience of Weekly class on May 10, 2036 6:00 pm?'
		);
		expect( dialog() ).toHaveTextContent(
			'1 participant cannot be removed from Weekly class on May 10, 2036 6:00 pm yet and stays in the audience:'
		);
		const kept = within( dialog() ).getByRole( 'list', {
			name: 'Participants who cannot be removed yet',
		} );
		expect( kept ).toHaveTextContent( 'Bo Buyer' );
		expect( kept ).toHaveTextContent( REGISTRATION_BLOCKER.message );
		expect( dialog() ).toHaveTextContent(
			'Tickets are never cancelled, registrations never deleted and payments never refunded for you'
		);
		expect(
			within( dialog() ).getByRole( 'link', {
				name: 'Open the List tab',
			} )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-manage-event&tab=list'
		);

		apiFetch.mockResolvedValue( {
			removed: 1,
			failed: 0,
			errors: [],
			failures: [],
		} );
		fireEvent.click(
			within( dialog() ).getByRole( 'button', {
				name: 'Remove 1 participant',
			} )
		);

		await waitFor( () =>
			expect( onRemoved ).toHaveBeenCalledWith( [ JANE ], [ BUYER ] )
		);
		expect( batchCalls()[ 0 ].data ).toEqual( { participant_ids: [ 1 ] } );

		// Nothing is left to remove: only the guidance stays.
		expect( dialog() ).toHaveTextContent(
			'1 participant was removed from this date.'
		);
		expect(
			within( dialog() ).queryByRole( 'button', { name: /^Remove/ } )
		).not.toBeInTheDocument();
		expect(
			within( dialog() ).getByRole( 'button', {
				name: 'Back to the audience',
			} )
		).toBeEnabled();
	} );

	it( 'reports removals and refusals that came back together', async () => {
		apiFetch.mockResolvedValue( {
			removed: 1,
			failed: 1,
			errors: [ 'Failed to remove participant ID 2: …' ],
			failures: [
				{
					participant_id: 2,
					code: 'removal_blocked',
					message: REGISTRATION_BLOCKER.message,
					blockers: [ REGISTRATION_BLOCKER ],
				},
			],
		} );
		const { onRemoved, onRefused } = renderModal( [ JANE, JOHN ] );

		fireEvent.click(
			within( dialog() ).getByRole( 'button', {
				name: 'Remove 2 participants',
			} )
		);

		await waitFor( () =>
			expect( onRemoved ).toHaveBeenCalledWith( [ JANE ], [ JOHN ] )
		);
		expect( onRefused ).not.toHaveBeenCalled();
		expect( dialog() ).toHaveTextContent(
			'1 participant was removed from this date.'
		);
		const kept = within( dialog() ).getByRole( 'list', {
			name: 'Participants who cannot be removed yet',
		} );
		expect( kept ).toHaveTextContent( 'John Roe' );
		expect( kept ).toHaveTextContent( REGISTRATION_BLOCKER.message );
		expect( kept ).not.toHaveTextContent( 'Jane Doe' );
		expect(
			within( dialog() ).queryByRole( 'button', { name: /^Remove/ } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps a participant whose removal failed for a retry', async () => {
		apiFetch.mockResolvedValueOnce( {
			removed: 1,
			failed: 1,
			errors: [],
			failures: [
				{
					participant_id: 2,
					code: 'removal_failed',
					message:
						'The participant could not be removed. Nothing was changed; try again.',
					blockers: [],
				},
			],
		} );
		const { onRemoved } = renderModal( [ JANE, JOHN ] );

		fireEvent.click(
			within( dialog() ).getByRole( 'button', {
				name: 'Remove 2 participants',
			} )
		);

		await waitFor( () =>
			expect( dialog() ).toHaveTextContent(
				'1 participant could not be removed and is still in the audience.'
			)
		);
		const list = within( dialog() ).getByRole( 'list', {
			name: 'Participants to remove',
		} );
		expect( list ).toHaveTextContent( 'John Roe' );
		expect( list ).toHaveTextContent( 'Nothing was changed; try again.' );

		apiFetch.mockResolvedValueOnce( {
			removed: 1,
			failed: 0,
			errors: [],
			failures: [],
		} );
		fireEvent.click(
			within( dialog() ).getByRole( 'button', {
				name: 'Remove 1 participant',
			} )
		);

		await waitFor( () =>
			expect( onRemoved ).toHaveBeenLastCalledWith( [ JOHN ], [] )
		);
		expect( batchCalls().map( ( call ) => call.data ) ).toEqual( [
			{ participant_ids: [ 1, 2 ] },
			{ participant_ids: [ 2 ] },
		] );
	} );

	it( 'changes nothing when the request fails, and can be retried', async () => {
		apiFetch.mockRejectedValueOnce( { message: 'Event date not found.' } );
		const { onRemoved, onRefused } = renderModal( [ JANE, JOHN ] );

		fireEvent.click(
			within( dialog() ).getByRole( 'button', {
				name: 'Remove 2 participants',
			} )
		);

		await waitFor( () =>
			expect( dialog() ).toHaveTextContent( 'Event date not found.' )
		);
		expect( onRemoved ).not.toHaveBeenCalled();
		expect( onRefused ).toHaveBeenCalledTimes( 1 );
		expect(
			within( dialog() ).getByRole( 'list', {
				name: 'Participants to remove',
			} )
		).toHaveTextContent( 'Jane Doe' );

		fireEvent.click(
			within( dialog() ).getByRole( 'button', {
				name: 'Remove 2 participants',
			} )
		);
		await waitFor( () =>
			expect( onRemoved ).toHaveBeenCalledWith( [ JANE, JOHN ], [] )
		);
	} );
} );

describe( 'RemoveParticipantModal — one participant', () => {
	it( 'uses the single removal route and names the participant', async () => {
		apiFetch.mockResolvedValue( { removed: true } );
		const { onRemoved } = renderModal( [ JANE ] );

		const single = screen.getByRole( 'dialog', {
			name: 'Remove participant — Jane Doe',
		} );
		expect( single ).toHaveTextContent(
			'Remove Jane Doe from the audience of Weekly class on May 10, 2036 6:00 pm?'
		);
		fireEvent.click(
			within( single ).getByRole( 'button', {
				name: 'Remove participant',
			} )
		);

		await waitFor( () =>
			expect( onRemoved ).toHaveBeenCalledWith( [ JANE ], [] )
		);
		expect( batchCalls()[ 0 ].path ).toBe(
			'/fair-audience/v1/event-dates/5/participants/1'
		);
	} );
} );
