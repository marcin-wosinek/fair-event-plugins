/**
 * @jest-environment jsdom
 *
 * Component tests for the questionnaire responses' "Add participants to
 * group" popup (#1935): it lists who is added and who is left out, reports
 * each participant's outcome, keeps only failed participants for a retry
 * against the same group, and blocks dismissal while requests run.
 */
import '@testing-library/jest-dom';
import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import AddToGroupModal, {
	collectParticipants,
	identifyParticipants,
} from '../AddToGroupModal.js';

jest.mock( '@wordpress/api-fetch' );

const GROUPS = [ { id: 5, name: 'Volunteers', member_count: 3 } ];

const PARTICIPANTS = [
	{ id: 1, name: 'Ana Ruiz', email: 'ana@example.com' },
	{ id: 2, name: 'Ben Ito', email: 'ben@example.com' },
	{ id: 3, name: 'Cleo Park', email: 'cleo@example.com' },
];

const noticeText = ( text ) =>
	screen.getByText( text, { selector: '.components-notice__content p' } );

const listItems = ( name ) =>
	within( screen.getByRole( 'list', { name } ) )
		.getAllByRole( 'listitem' )
		.map( ( li ) => li.textContent );

/**
 * Mock apiFetch: groups list, group creation and per-participant outcomes.
 *
 * @param {Object} options
 * @param {Object} options.outcomes    participant ID → array of results per call ('ok', 'member', or an error message).
 * @param {Array}  options.createSteps Results per group creation call ('ok' or an error message).
 */
function mockApi( { outcomes = {}, createSteps = [ 'ok' ] } = {} ) {
	const calls = { assign: {}, create: 0 };
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( path.startsWith( '/fair-audience/v1/groups?' ) ) {
			return Promise.resolve( GROUPS );
		}
		if ( path === '/fair-audience/v1/groups' && method === 'POST' ) {
			const step = createSteps[ calls.create++ ] || 'ok';
			return step === 'ok'
				? Promise.resolve( { id: 42 } )
				: Promise.reject( { code: 'name_exists', message: step } );
		}
		const match = path.match( /groups\/(\d+)\/participants$/ );
		if ( match ) {
			const pid = data.participant_id;
			calls.assign[ pid ] = calls.assign[ pid ] || [];
			const steps = outcomes[ pid ] || [ 'ok' ];
			const step =
				steps[ calls.assign[ pid ].length ] ||
				steps[ steps.length - 1 ];
			calls.assign[ pid ].push( Number( match[ 1 ] ) );
			if ( step === 'ok' ) {
				return Promise.resolve( { message: 'added' } );
			}
			if ( step === 'member' ) {
				return Promise.reject( {
					code: 'already_member',
					message: 'Participant is already a member of this group.',
				} );
			}
			return Promise.reject( { code: 'db_error', message: step } );
		}
		return Promise.resolve( [] );
	} );
	return calls;
}

function renderModal( props = {} ) {
	const onClose = jest.fn();
	render(
		<AddToGroupModal
			participants={ PARTICIPANTS }
			unlinkedCount={ 0 }
			duplicateCount={ 0 }
			onClose={ onClose }
			{ ...props }
		/>
	);
	return onClose;
}

async function chooseExistingGroup() {
	const select = await screen.findByRole( 'combobox', { name: 'Group' } );
	await waitFor( () =>
		expect(
			within( select ).getByRole( 'option', { name: 'Volunteers (3)' } )
		).toBeInTheDocument()
	);
	fireEvent.change( select, { target: { value: '5' } } );
}

async function click( name ) {
	await act( async () => {
		fireEvent.click( screen.getByRole( 'button', { name } ) );
	} );
}

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'collectParticipants', () => {
	it( 'deduplicates by participant ID and counts left-out responses', () => {
		const snapshot = collectParticipants( [
			{
				participant_id: 7,
				participant_name: 'Ana',
				participant_email: 'a@x',
			},
			{
				participant_id: '7',
				participant_name: 'Ana',
				participant_email: 'a@x',
			},
			{ participant_id: 0, participant_name: '', participant_email: '' },
			{ participant_id: null },
			{
				participant_id: 9,
				participant_name: ' Ben ',
				participant_email: '',
			},
		] );
		expect( snapshot.participants ).toEqual( [
			{ id: 7, name: 'Ana', email: 'a@x' },
			{ id: 9, name: 'Ben', email: '' },
		] );
		expect( snapshot.unlinkedCount ).toBe( 2 );
		expect( snapshot.duplicateCount ).toBe( 1 );
	} );
} );

describe( 'identifyParticipants', () => {
	it( 'adds email and ID only where the name is shared or missing', () => {
		expect(
			identifyParticipants( [
				{ id: 1, name: 'Ana', email: 'a1@x' },
				{ id: 2, name: 'ana', email: 'a2@x' },
				{ id: 3, name: 'Ben', email: 'b@x' },
				{ id: 4, name: '', email: 'c@x' },
				{ id: 5, name: '', email: '' },
			] )
		).toEqual( [
			{ id: 1, label: 'Ana', detail: 'a1@x, ID 1' },
			{ id: 2, label: 'ana', detail: 'a2@x, ID 2' },
			{ id: 3, label: 'Ben', detail: '' },
			{ id: 4, label: 'c@x', detail: 'ID 4' },
			{ id: 5, label: 'Participant #5', detail: '' },
		] );
	} );
} );

describe( 'AddToGroupModal', () => {
	it( 'lists the participants and explains exclusions before submitting', async () => {
		mockApi();
		renderModal( { unlinkedCount: 2, duplicateCount: 1 } );

		expect(
			screen.getByText( '3 participants will be added:' )
		).toBeInTheDocument();
		expect( listItems( 'Participants to add' ) ).toEqual( [
			'Ana Ruiz',
			'Ben Ito',
			'Cleo Park',
		] );
		expect(
			screen.getByText(
				'2 responses are not linked to a participant and are left out.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( /1 more response comes from a participant/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( /already in the group are skipped/ )
		).toBeInTheDocument();

		// Submission is blocked with a stated reason until a group is chosen.
		expect(
			screen.getByText( 'Select a group to add the participants to.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Add to group' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		await chooseExistingGroup();
		expect(
			screen.queryByText( 'Select a group to add the participants to.' )
		).not.toBeInTheDocument();
	} );

	it( 'closes with the totals when everyone is added or skipped', async () => {
		const calls = mockApi( { outcomes: { 2: [ 'member' ] } } );
		const onClose = renderModal();
		await chooseExistingGroup();
		await click( 'Add to group' );

		await waitFor( () =>
			expect( onClose ).toHaveBeenCalledWith( {
				groupName: 'Volunteers',
				added: 2,
				skipped: 1,
				failed: 0,
			} )
		);
		expect( calls.assign ).toEqual( { 1: [ 5 ], 2: [ 5 ], 3: [ 5 ] } );
	} );

	it( 'reports mixed outcomes and retries only the failed participants', async () => {
		const calls = mockApi( {
			outcomes: { 2: [ 'member' ], 3: [ 'Database is busy.', 'ok' ] },
		} );
		const onClose = renderModal();
		await chooseExistingGroup();
		await click( 'Add to group' );

		await screen.findByText(
			'1 participant could not be added. Try again:'
		);
		expect(
			noticeText( '1 participant was added to the group.' )
		).toBeVisible();
		expect(
			noticeText(
				'1 participant was already in the group and was skipped.'
			)
		).toBeVisible();
		expect( listItems( 'Participants already handled' ) ).toEqual( [
			'Ana RuizAdded',
			'Ben ItoAlready in the group — skipped',
		] );
		expect( listItems( 'Participants that could not be added' ) ).toEqual( [
			'Cleo ParkDatabase is busy.',
		] );
		// The target is locked to the group the first attempt used.
		expect( screen.getByText( 'Target group: Volunteers' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'combobox', { name: 'Group' } )
		).not.toBeInTheDocument();

		await click( 'Try again for 1 participant' );

		await waitFor( () =>
			expect( onClose ).toHaveBeenCalledWith( {
				groupName: 'Volunteers',
				added: 2,
				skipped: 1,
				failed: 0,
			} )
		);
		// Successful writes were not repeated.
		expect( calls.assign ).toEqual( { 1: [ 5 ], 2: [ 5 ], 3: [ 5, 5 ] } );
	} );

	it( 'keeps the input after a group-creation failure and clears the error on retry', async () => {
		const calls = mockApi( {
			createSteps: [ 'A group with this name already exists.', 'ok' ],
		} );
		const onClose = renderModal();
		fireEvent.click( screen.getByLabelText( 'Create new group' ) );
		fireEvent.change( screen.getByLabelText( 'Name' ), {
			target: { value: 'Autumn helpers' },
		} );
		await click( 'Create group and add' );

		expect(
			await screen.findByText( 'A group with this name already exists.', {
				selector: '.components-notice__content',
			} )
		).toBeVisible();
		expect( screen.getByLabelText( 'Name' ) ).toHaveValue(
			'Autumn helpers'
		);
		expect( calls.assign ).toEqual( {} );

		await click( 'Create group and add' );
		await waitFor( () =>
			expect( onClose ).toHaveBeenCalledWith( {
				groupName: 'Autumn helpers',
				added: 3,
				skipped: 0,
				failed: 0,
			} )
		);
		expect( calls.create ).toBe( 2 );
		expect( calls.assign ).toEqual( { 1: [ 42 ], 2: [ 42 ], 3: [ 42 ] } );
	} );

	it( 'reuses a newly created group when retrying failed assignments', async () => {
		const calls = mockApi( { outcomes: { 1: [ 'Timeout.', 'ok' ] } } );
		const onClose = renderModal();
		fireEvent.click( screen.getByLabelText( 'Create new group' ) );
		fireEvent.change( screen.getByLabelText( 'Name' ), {
			target: { value: 'Autumn helpers' },
		} );
		await click( 'Create group and add' );

		await screen.findByText(
			'1 participant could not be added. Try again:'
		);
		expect(
			screen.getByText( 'Target group: Autumn helpers' )
		).toBeVisible();

		await click( 'Try again for 1 participant' );
		await waitFor( () => expect( onClose ).toHaveBeenCalled() );
		expect( calls.create ).toBe( 1 );
		expect( calls.assign ).toEqual( {
			1: [ 42, 42 ],
			2: [ 42 ],
			3: [ 42 ],
		} );
	} );

	it( 'blocks duplicate submission and every dismissal while pending', async () => {
		mockApi();
		let release;
		const pending = new Promise( ( resolve ) => {
			release = resolve;
		} );
		const base = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( options ) =>
			options.path.endsWith( '/participants' )
				? pending.then( () => ( {} ) )
				: base( options )
		);

		const onClose = renderModal();
		await chooseExistingGroup();
		const submit = screen.getByRole( 'button', { name: 'Add to group' } );
		await act( async () => {
			fireEvent.click( submit );
			fireEvent.click( submit );
		} );

		const participantCalls = () =>
			apiFetch.mock.calls.filter( ( [ o ] ) =>
				o.path.endsWith( '/participants' )
			).length;
		expect( participantCalls() ).toBe( 3 );
		expect(
			screen.getByRole( 'button', { name: 'Adding…' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect(
			screen.queryByRole( 'button', { name: 'Close' } )
		).not.toBeInTheDocument();

		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		expect( onClose ).not.toHaveBeenCalled();

		await act( async () => {
			release();
		} );
		await waitFor( () => expect( onClose ).toHaveBeenCalledTimes( 1 ) );
		expect( participantCalls() ).toBe( 3 );
	} );

	it( 'reports partial progress when closed with failures left', async () => {
		mockApi( { outcomes: { 3: [ 'Nope.' ] } } );
		const onClose = renderModal();
		await chooseExistingGroup();
		await click( 'Add to group' );
		await screen.findByText(
			'1 participant could not be added. Try again:'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( onClose ).toHaveBeenCalledWith( {
			groupName: 'Volunteers',
			added: 2,
			skipped: 0,
			failed: 1,
		} );
	} );

	it( 'shows a group-loading failure with a retry', async () => {
		let fail = true;
		apiFetch.mockImplementation( () =>
			fail
				? Promise.reject( new Error( 'x' ) )
				: Promise.resolve( GROUPS )
		);
		renderModal();

		expect(
			await screen.findByText( 'The groups could not be loaded.', {
				selector: '.components-notice__content',
			} )
		).toBeVisible();
		fail = false;
		await click( 'Try again' );
		await chooseExistingGroup();
	} );
} );
