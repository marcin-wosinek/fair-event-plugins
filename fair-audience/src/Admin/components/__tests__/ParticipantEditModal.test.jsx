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
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
	act,
} from '@testing-library/react';
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

		// The popup, not the screen-reader live region, shows the reason.
		expect(
			await within( screen.getByRole( 'dialog' ) ).findByText(
				'Email already exists.'
			)
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

/**
 * Weekly summary and event feed preferences in the edit popup (#2135).
 *
 * The saved preferences come from the participant itself, not the list
 * row; only changed preferences are sent, so anything the popup could not
 * load or show stays as stored.
 */
describe( 'ParticipantEditModal — weekly preferences', () => {
	const FEEDS = [
		{ id: 1, name: 'Workshops' },
		{ id: 2, name: 'Concerts' },
	];
	const SAVED = {
		id: 5,
		status: 'confirmed',
		email_profile: 'marketing',
		weekly_summary_opt_out: false,
		weekly_feed_mode: 'selected',
		weekly_feed_ids: [ 1, 3 ],
		weekly_feed_summary: {
			available: true,
			selected: [ FEEDS[ 0 ] ],
			unavailable: [ { id: 3, name: 'Archive' } ],
			deleted: 0,
		},
	};
	// A list row: no weekly preferences at all.
	const ROW = {
		id: 5,
		name: 'Jane',
		surname: 'Doe',
		email: 'jane@example.com',
		email_profile: 'marketing',
		groups: [],
	};

	/**
	 * @param {Object}   answers
	 * @param {Function} [answers.detail] Answers the participant GET.
	 * @param {Function} [answers.feeds]  Answers the feed list GET.
	 * @param {Function} [answers.save]   Answers the PUT.
	 */
	function mockPreferences( { detail, feeds, save } = {} ) {
		apiFetch.mockImplementation( ( request ) => {
			const { path, method = 'GET' } = request;
			if ( path === '/fair-audience/v1/groups' ) {
				return Promise.resolve( [] );
			}
			if ( path === '/fair-audience/v1/mailing-signup/weekly-feeds' ) {
				return feeds
					? feeds()
					: Promise.resolve( { available: true, feeds: FEEDS } );
			}
			if ( method === 'PUT' ) {
				return save ? save( request ) : Promise.resolve( { id: 5 } );
			}
			if ( path.startsWith( '/fair-audience/v1/participants/' ) ) {
				return detail ? detail( request ) : Promise.resolve( SAVED );
			}
			return Promise.resolve( {} );
		} );
	}

	const openFor = ( participant = ROW ) => renderModal( { participant } );
	const sent = () => requests( 'PUT' ).map( ( request ) => request.data );
	const update = () =>
		fireEvent.click( screen.getByRole( 'button', { name: 'Update' } ) );

	it( 'shows the saved preferences read from the participant, not the list row', async () => {
		mockPreferences();
		openFor();

		expect(
			await screen.findByLabelText( 'Send the weekly events summary' )
		).toBeChecked();
		expect(
			await screen.findByLabelText( 'Selected event feeds' )
		).toBeChecked();
		expect( screen.getByLabelText( 'Workshops' ) ).toBeChecked();
		expect( screen.getByLabelText( 'Concerts' ) ).not.toBeChecked();
		expect(
			screen.getByText( 'Archive (not available right now)' )
		).toBeInTheDocument();
		expect(
			requests( 'GET' ).map( ( request ) => request.path )
		).toContain( '/fair-audience/v1/participants/5' );
	} );

	it( 'sends no preference when none changed', async () => {
		mockPreferences();
		const { onClose } = openFor();
		await screen.findByLabelText( 'Workshops' );

		update();

		await waitFor( () => expect( onClose ).toHaveBeenCalled() );
		expect( sent()[ 0 ] ).not.toHaveProperty( 'weekly_summary_opt_out' );
		expect( sent()[ 0 ] ).not.toHaveProperty( 'weekly_feed_mode' );
		expect( sent()[ 0 ] ).not.toHaveProperty( 'weekly_feed_ids' );
	} );

	it.each( [
		[
			'chosen feeds',
			() => fireEvent.click( screen.getByLabelText( 'Concerts' ) ),
			{ weekly_feed_mode: 'selected', weekly_feed_ids: [ 1, 2 ] },
		],
		[
			'no feeds',
			() => fireEvent.click( screen.getByLabelText( 'No event feeds' ) ),
			{ weekly_feed_mode: 'none' },
		],
		[
			'a weekly opt-out',
			() =>
				fireEvent.click(
					screen.getByLabelText( 'Send the weekly events summary' )
				),
			{ weekly_summary_opt_out: true },
		],
	] )( 'saves %s with the profile', async ( _, change, expected ) => {
		mockPreferences();
		const { onClose, onSaved } = openFor();
		await screen.findByLabelText( 'Workshops' );

		change();
		update();

		await waitFor( () => expect( onClose ).toHaveBeenCalled() );
		const data = sent()[ 0 ];
		expect( data ).toMatchObject( { name: 'Jane', ...expected } );
		// The unavailable Archive feed is never sent: the server keeps it.
		expect( data.weekly_feed_ids || [] ).not.toContain( 3 );
		if ( ! ( 'weekly_feed_ids' in expected ) ) {
			expect( data ).not.toHaveProperty( 'weekly_feed_ids' );
		}
		expect( onSaved ).toHaveBeenCalledWith( { id: 5 }, expect.anything() );
	} );

	it( 'keeps the feed choice when the summary or email profile changes', async () => {
		mockPreferences();
		openFor();
		await screen.findByLabelText( 'Workshops' );
		fireEvent.click( screen.getByLabelText( 'Concerts' ) );

		fireEvent.click(
			screen.getByLabelText( 'Send the weekly events summary' )
		);
		fireEvent.change( screen.getByLabelText( 'Email Profile' ), {
			target: { value: 'declined' },
		} );

		expect( screen.getByLabelText( 'Selected event feeds' ) ).toBeChecked();
		expect( screen.getByLabelText( 'Concerts' ) ).toBeChecked();
		expect( screen.getByLabelText( 'Workshops' ) ).toBeChecked();
		// Feeds do not depend on the email profile: no delivery caveat.
		expect(
			screen.queryByText( /Saved preference only/ )
		).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText( 'All event feeds' )
		).not.toBeInTheDocument();

		update();

		await waitFor( () => expect( sent() ).toHaveLength( 1 ) );
		expect( sent()[ 0 ] ).toMatchObject( {
			email_profile: 'declined',
			weekly_summary_opt_out: true,
			weekly_feed_mode: 'selected',
			weekly_feed_ids: [ 1, 2 ],
		} );
	} );

	it( 'explains delivery for a participant awaiting confirmation', async () => {
		mockPreferences( {
			detail: () => Promise.resolve( { ...SAVED, status: 'pending' } ),
		} );
		openFor();

		expect(
			await screen.findByText(
				'Saved preference only: weekly summaries go to participants who confirmed their email address.'
			)
		).toBeInTheDocument();
	} );

	it( 'cancels without saving', async () => {
		mockPreferences();
		const { onClose } = openFor();
		await screen.findByLabelText( 'Workshops' );
		fireEvent.click( screen.getByLabelText( 'No event feeds' ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( onClose ).toHaveBeenCalledTimes( 1 );
		expect( requests( 'PUT' ) ).toHaveLength( 0 );
	} );

	it( 'keeps every edit when saving fails', async () => {
		mockPreferences( {
			save: () =>
				Promise.reject( {
					message:
						'One of the chosen event feeds is not available. Please review your choice and try again.',
				} ),
		} );
		const { onClose } = openFor();
		await screen.findByLabelText( 'Workshops' );
		fireEvent.click( screen.getByLabelText( 'Concerts' ) );

		update();

		expect(
			await within( screen.getByRole( 'dialog' ) ).findByText(
				'One of the chosen event feeds is not available. Please review your choice and try again.',
				{ selector: '.components-notice__content p' }
			)
		).toBeInTheDocument();
		expect( onClose ).not.toHaveBeenCalled();
		expect( screen.getByLabelText( 'Concerts' ) ).toBeChecked();
		expect( screen.getByLabelText( 'Selected event feeds' ) ).toBeChecked();
	} );

	it( 'saves contact edits without preferences it could not load, and retries loading', async () => {
		let detailFails = true;
		mockPreferences( {
			detail: () =>
				detailFails
					? Promise.reject( { message: 'Server error' } )
					: Promise.resolve( SAVED ),
		} );
		const { onClose } = openFor();

		expect(
			await screen.findByText(
				'Weekly summary preferences could not be loaded. Saving now keeps them unchanged.'
			)
		).toBeInTheDocument();
		typeName( 'Janet' );

		detailFails = false;
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		expect(
			await screen.findByLabelText( 'Send the weekly events summary' )
		).toBeChecked();
		expect( screen.getByLabelText( 'Name *' ) ).toHaveValue( 'Janet' );

		detailFails = true;
		fireEvent.click(
			screen.getByLabelText( 'Send the weekly events summary' )
		);
		update();
		await waitFor( () => expect( onClose ).toHaveBeenCalled() );
		expect( sent()[ 0 ] ).toMatchObject( {
			name: 'Janet',
			weekly_summary_opt_out: true,
		} );
	} );

	it( 'leaves the feed choice out while the feed list cannot be read', async () => {
		let feedsFail = true;
		mockPreferences( {
			feeds: () =>
				feedsFail
					? Promise.reject( { message: 'Server error' } )
					: Promise.resolve( { available: true, feeds: FEEDS } ),
		} );
		const { onClose } = openFor();

		expect(
			await screen.findByText(
				'Event feeds cannot be listed right now. Saving now keeps the feed choice unchanged.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByLabelText( 'No event feeds' )
		).not.toBeInTheDocument();
		typeName( 'Janet' );

		feedsFail = false;
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		expect( await screen.findByLabelText( 'Workshops' ) ).toBeChecked();
		expect( screen.getByLabelText( 'Name *' ) ).toHaveValue( 'Janet' );
		fireEvent.click( screen.getByLabelText( 'No event feeds' ) );

		update();
		await waitFor( () => expect( onClose ).toHaveBeenCalled() );
		expect( sent()[ 0 ] ).toMatchObject( {
			name: 'Janet',
			weekly_feed_mode: 'none',
		} );
	} );

	it( 'sends no feed change when Fair Events cannot offer feeds', async () => {
		mockPreferences( {
			feeds: () => Promise.resolve( { available: false, feeds: [] } ),
		} );
		const { onClose } = openFor();
		await screen.findByText(
			'Event feeds cannot be listed right now. Saving now keeps the feed choice unchanged.'
		);

		update();

		await waitFor( () => expect( onClose ).toHaveBeenCalled() );
		expect( sent()[ 0 ] ).not.toHaveProperty( 'weekly_feed_mode' );
	} );

	it( 'ignores a late answer for another participant', async () => {
		let answerFirst;
		mockPreferences( {
			detail: ( { path } ) =>
				path.endsWith( '/5' )
					? new Promise( ( resolve ) => {
							answerFirst = () =>
								resolve( {
									...SAVED,
									weekly_feed_ids: [],
								} );
						} )
					: Promise.resolve( { ...SAVED, id: 6 } ),
		} );
		const { rerender } = render(
			<ParticipantEditModal
				isOpen
				participant={ ROW }
				onClose={ () => {} }
			/>
		);
		rerender(
			<ParticipantEditModal
				isOpen
				participant={ { ...ROW, id: 6 } }
				onClose={ () => {} }
			/>
		);
		expect(
			await screen.findByLabelText( 'Selected event feeds' )
		).toBeChecked();

		await act( async () => {
			answerFirst();
		} );

		expect( screen.getByLabelText( 'Selected event feeds' ) ).toBeChecked();
		expect( screen.getByLabelText( 'No event feeds' ) ).not.toBeChecked();
	} );

	it( 'leaves preferences out when adding a participant', async () => {
		mockPreferences();
		renderModal();
		await screen.findByLabelText( 'Name *' );

		expect(
			screen.queryByText( 'Weekly summary' )
		).not.toBeInTheDocument();
		expect(
			requests( 'GET' ).map( ( request ) => request.path )
		).not.toContain( '/fair-audience/v1/mailing-signup/weekly-feeds' );
	} );
} );
