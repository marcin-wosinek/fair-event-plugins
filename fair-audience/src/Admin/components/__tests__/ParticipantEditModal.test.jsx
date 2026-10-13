/**
 * @jest-environment jsdom
 *
 * Saving a participant profile from the add/edit popup (#1775).
 *
 * Exercises:
 *   - A failed save is reported in the popup, not in a browser alert, and
 *     keeps what was typed.
 *   - A second click while saving sends nothing, and the popup stays open.
 *   - A profile created before a group change failed is updated, not added
 *     again, by the retry — which sends only the group change that failed.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ParticipantEditModal from '../ParticipantEditModal.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../../all-participants/UserLinkSection.js', () => () => null );

const GROUPS = [
	{ id: 11, name: 'Volunteers' },
	{ id: 12, name: 'Members' },
];

const requests = ( method ) =>
	apiFetch.mock.calls
		.map( ( [ request ] ) => request )
		.filter( ( request ) => ( request.method || 'GET' ) === method );

/**
 * @param {Object}   answers
 * @param {Function} [answers.save]  Answers the profile POST/PUT.
 * @param {Function} [answers.group] Answers a group membership change.
 */
function mockApi( { save, group } = {} ) {
	apiFetch.mockImplementation( ( request ) => {
		const { path, method = 'GET' } = request;
		if ( path === '/fair-audience/v1/groups' ) {
			return Promise.resolve( GROUPS );
		}
		if ( path.startsWith( '/fair-audience/v1/groups/' ) ) {
			return group ? group( request ) : Promise.resolve( {} );
		}
		if ( method === 'POST' || method === 'PUT' ) {
			return save ? save( request ) : Promise.resolve( { id: 77 } );
		}
		return Promise.resolve( {} );
	} );
}

function renderModal( props = {} ) {
	const onClose = jest.fn();
	const onSaved = jest.fn();
	render(
		<ParticipantEditModal
			isOpen
			participant={ null }
			onClose={ onClose }
			onSaved={ onSaved }
			{ ...props }
		/>
	);
	return { onClose, onSaved };
}

const typeName = ( value ) =>
	fireEvent.change( screen.getByLabelText( 'Name *' ), {
		target: { value },
	} );

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	jest.spyOn( window, 'alert' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'ParticipantEditModal', () => {
	it( 'shows a failed save in the popup and keeps the input', async () => {
		let fails = true;
		mockApi( {
			save: () =>
				fails
					? Promise.reject( { message: 'Email already exists.' } )
					: Promise.resolve( { id: 77 } ),
		} );
		const { onClose, onSaved } = renderModal();
		typeName( 'Jane' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );

		expect(
			await screen.findByText( 'Email already exists.' )
		).toBeInTheDocument();
		expect( window.alert ).not.toHaveBeenCalled();
		expect( screen.getByLabelText( 'Name *' ) ).toHaveValue( 'Jane' );
		expect( onClose ).not.toHaveBeenCalled();
		expect( onSaved ).not.toHaveBeenCalled();

		fails = false;
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );

		await waitFor( () => expect( onClose ).toHaveBeenCalledTimes( 1 ) );
		expect( onSaved ).toHaveBeenCalledWith(
			{ id: 77 },
			{ complete: true, created: true }
		);
		// Nothing was created by the failed attempt, so both are additions.
		expect( requests( 'POST' ) ).toHaveLength( 2 );
		expect( requests( 'PUT' ) ).toHaveLength( 0 );
	} );

	it( 'saves once, however often the button is clicked, and stays open meanwhile', async () => {
		let finish;
		mockApi( {
			save: () =>
				new Promise( ( resolve ) => {
					finish = () => resolve( { id: 77 } );
				} ),
		} );
		const { onClose } = renderModal();
		typeName( 'Jane' );

		const button = screen.getByRole( 'button', { name: 'Add' } );
		fireEvent.click( button );
		fireEvent.click( button );

		await waitFor( () => expect( button ).toBeDisabled() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		expect( onClose ).not.toHaveBeenCalled();

		finish();
		await waitFor( () => expect( onClose ).toHaveBeenCalledTimes( 1 ) );
		expect( requests( 'POST' ) ).toHaveLength( 1 );
	} );

	it( 'updates the profile it created when a group change failed, and retries only that change', async () => {
		let membersFail = true;
		mockApi( {
			group: ( { path } ) =>
				path.includes( '/groups/12/' ) && membersFail
					? Promise.reject( { message: 'Group is locked.' } )
					: Promise.resolve( {} ),
		} );
		const { onClose, onSaved } = renderModal();
		typeName( 'Jane' );
		fireEvent.click( await screen.findByLabelText( 'Volunteers' ) );
		fireEvent.click( screen.getByLabelText( 'Members' ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );

		expect(
			await screen.findByText(
				'The profile was saved, but 1 group change failed. Your selection is kept: save again to retry it.'
			)
		).toBeInTheDocument();
		expect( screen.getByText( 'Group is locked.' ) ).toBeInTheDocument();
		expect( onClose ).not.toHaveBeenCalled();
		expect( onSaved ).toHaveBeenCalledWith(
			{ id: 77 },
			{ complete: false, created: true }
		);
		expect( screen.getByLabelText( 'Name *' ) ).toHaveValue( 'Jane' );
		expect( screen.getByLabelText( 'Members' ) ).toBeChecked();

		membersFail = false;
		fireEvent.click( screen.getByRole( 'button', { name: 'Update' } ) );

		await waitFor( () => expect( onClose ).toHaveBeenCalledTimes( 1 ) );
		expect( onSaved ).toHaveBeenLastCalledWith( expect.anything(), {
			complete: true,
			created: true,
		} );

		// One profile was added; the retry updated it.
		const added = requests( 'POST' ).filter(
			( request ) => request.path === '/fair-audience/v1/participants'
		);
		expect( added ).toHaveLength( 1 );
		expect( requests( 'PUT' ).map( ( request ) => request.path ) ).toEqual(
			[ '/fair-audience/v1/participants/77' ]
		);
		// Volunteers went through the first time and is not sent again.
		const groupAdds = requests( 'POST' )
			.filter( ( request ) => request.path.includes( '/groups/' ) )
			.map( ( request ) => request.path );
		expect( groupAdds ).toEqual( [
			'/fair-audience/v1/groups/11/participants',
			'/fair-audience/v1/groups/12/participants',
			'/fair-audience/v1/groups/12/participants',
		] );
	} );

	it( 'keeps what was typed when the same participant is reloaded behind it', async () => {
		mockApi();
		const participant = { id: 5, name: 'Jane', surname: 'Doe', groups: [] };
		const { rerender } = render(
			<ParticipantEditModal
				isOpen
				participant={ participant }
				onClose={ () => {} }
			/>
		);
		typeName( 'Janet' );

		rerender(
			<ParticipantEditModal
				isOpen
				participant={ { ...participant } }
				onClose={ () => {} }
			/>
		);

		await waitFor( () =>
			expect( screen.getByLabelText( 'Name *' ) ).toHaveValue( 'Janet' )
		);
	} );
} );
