/**
 * @jest-environment jsdom
 *
 * The participant-deletion popup shared by the participants list and the
 * participant page (#1775).
 *
 * Exercises:
 *   - One participant is named; several are counted and listed, people of
 *     the same name told apart.
 *   - The wording says what deletion does and does not do.
 *   - Cancelling sends nothing; a second click while deleting sends nothing.
 *   - A failure keeps the participant in the popup with the reason, and a
 *     retry sends only what failed.
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
import DeleteParticipantsModal from '../DeleteParticipantsModal.js';

jest.mock( '@wordpress/api-fetch' );

const JANE = { id: 1, name: 'Jane', surname: 'Doe', email: 'jane@x.test' };
const JANE_TOO = { id: 2, name: 'Jane', surname: 'Doe', email: 'other@x.test' };
const JOHN = { id: 3, name: 'John', surname: 'Roe', email: 'john@x.test' };

const deletedIds = () =>
	apiFetch.mock.calls
		.map( ( [ request ] ) => request )
		.filter( ( request ) => request.method === 'DELETE' )
		.map( ( request ) => Number( request.path.split( '/' ).pop() ) );

function renderModal( participants, handlers = {} ) {
	const onClose = handlers.onClose || jest.fn();
	const onDeleted = handlers.onDeleted || jest.fn();
	render(
		<DeleteParticipantsModal
			participants={ participants }
			onClose={ onClose }
			onDeleted={ onDeleted }
		/>
	);
	return { onClose, onDeleted };
}

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	apiFetch.mockResolvedValue( { message: 'deleted' } );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'DeleteParticipantsModal', () => {
	it( 'names one participant and says what deletion does and does not do', () => {
		renderModal( [ JANE ] );

		const dialog = screen.getByRole( 'dialog', {
			name: 'Delete participant — Jane Doe',
		} );
		expect( dialog ).toHaveTextContent(
			'Permanently delete the participant profile of Jane Doe?'
		);
		expect( dialog ).toHaveTextContent( 'This cannot be undone.' );
		expect( dialog ).toHaveTextContent(
			'Deleting a profile does not cancel tickets, delete event registrations or refund payments.'
		);
		expect( dialog ).toHaveTextContent(
			'remove them from that event instead'
		);
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Delete participant',
			} )
		).toBeEnabled();
	} );

	it( 'names a participant without a name by email', () => {
		renderModal( [ { id: 9, name: '', surname: '', email: 'n@x.test' } ] );

		expect(
			screen.getByRole( 'dialog', {
				name: 'Delete participant — n@x.test',
			} )
		).toBeInTheDocument();
	} );

	it( 'counts and lists several participants, telling same names apart', () => {
		renderModal( [ JANE, JANE_TOO, JOHN ] );

		const dialog = screen.getByRole( 'dialog', {
			name: 'Delete participant profiles',
		} );
		expect( dialog ).toHaveTextContent(
			'Permanently delete the profiles of 3 participants?'
		);

		const list = within( dialog ).getByRole( 'list', {
			name: 'Participants to delete',
		} );
		const rows = within( list ).getAllByRole( 'listitem' );
		expect( rows.map( ( row ) => row.textContent ) ).toEqual( [
			'Jane Doe (jane@x.test)',
			'Jane Doe (other@x.test)',
			'John Roe',
		] );
		// Scrolls with the keyboard once the selection is long.
		expect( list ).toHaveAttribute( 'tabindex', '0' );
		expect( list ).toHaveStyle( { overflowY: 'auto' } );
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Delete 3 participants',
			} )
		).toBeEnabled();
	} );

	it( 'sends nothing when cancelled', () => {
		const { onClose, onDeleted } = renderModal( [ JANE, JOHN ] );

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( onClose ).toHaveBeenCalledTimes( 1 );
		expect( onDeleted ).not.toHaveBeenCalled();
		expect( deletedIds() ).toEqual( [] );
	} );

	it( 'deletes once, however often the button is clicked', async () => {
		let finish;
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finish = () => resolve( {} );
				} )
		);
		const { onClose, onDeleted } = renderModal( [ JANE ] );

		const button = screen.getByRole( 'button', {
			name: 'Delete participant',
		} );
		fireEvent.click( button );
		fireEvent.click( button );

		const busy = await screen.findByRole( 'button', {
			name: 'Deleting…',
		} );
		expect( busy ).toBeDisabled();
		// Nothing closes the popup while the result is unknown.
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		expect( onClose ).not.toHaveBeenCalled();

		finish();
		await waitFor( () =>
			expect( onDeleted ).toHaveBeenCalledWith( [ JANE ], [] )
		);
		expect( deletedIds() ).toEqual( [ 1 ] );
	} );

	it( 'keeps what failed, with the reason, and retries only that', async () => {
		let johnFails = true;
		apiFetch.mockImplementation( ( { path } ) =>
			path.endsWith( '/3' ) && johnFails
				? Promise.reject( { message: 'Database is busy.' } )
				: Promise.resolve( {} )
		);
		const { onDeleted } = renderModal( [ JANE, JANE_TOO, JOHN ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete 3 participants' } )
		);

		const dialog = screen.getByRole( 'dialog' );
		await waitFor( () =>
			expect( dialog ).toHaveTextContent(
				'2 participant profiles were deleted.'
			)
		);
		expect( dialog ).toHaveTextContent(
			'1 participant profile could not be deleted and was kept. Try again:'
		);
		const failed = within( dialog ).getByRole( 'list', {
			name: 'Profiles that could not be deleted',
		} );
		expect( failed ).toHaveTextContent( 'John Roe' );
		expect( failed ).toHaveTextContent( 'Database is busy.' );
		expect( failed ).not.toHaveTextContent( 'Jane Doe' );
		expect( onDeleted ).toHaveBeenCalledWith(
			[ JANE, JANE_TOO ],
			[ JOHN ]
		);

		johnFails = false;
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete 1 participant',
			} )
		);

		await waitFor( () =>
			expect( onDeleted ).toHaveBeenLastCalledWith( [ JOHN ], [] )
		);
		expect( deletedIds() ).toEqual( [ 1, 2, 3, 3 ] );
	} );

	it( 'reports nothing as deleted when every deletion fails', async () => {
		apiFetch.mockRejectedValue( {
			message: 'Failed to delete participant.',
		} );
		const { onDeleted } = renderModal( [ JANE ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete participant' } )
		);

		const dialog = screen.getByRole( 'dialog' );
		await waitFor( () =>
			expect( dialog ).toHaveTextContent(
				'Failed to delete participant.'
			)
		);
		expect( onDeleted ).not.toHaveBeenCalled();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Delete participant',
			} )
		).toBeEnabled();
	} );

	it( 'treats a profile that is already gone as deleted', async () => {
		apiFetch.mockRejectedValue( {
			code: 'participant_not_found',
			message: 'Participant not found.',
		} );
		const { onDeleted } = renderModal( [ JANE ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete participant' } )
		);

		await waitFor( () =>
			expect( onDeleted ).toHaveBeenCalledWith( [ JANE ], [] )
		);
	} );
} );
