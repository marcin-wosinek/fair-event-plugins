/**
 * @jest-environment jsdom
 *
 * Signup answers in the Event Participants "Questions" column (#1609): each
 * ticket's answers are shown with that ticket, answers not attached to a
 * ticket stay with the participant.
 *
 * Removal and feedback on the page (#1775): removing asks in the popup of
 * the Audience tab, naming the event and its date as stored; adding, role
 * and invitation failures are shown beside their form, which keeps its
 * selection, instead of in a browser alert.
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
import { setSettings, getSettings } from '@wordpress/date';
import EventParticipants, {
	renderParticipantAnswers,
	countParticipantAnswers,
} from '../EventParticipants.js';

jest.mock( '@wordpress/api-fetch' );

const diet = ( value ) => ( {
	question_key: 'diet',
	question_text: 'Dietary needs?',
	question_type: 'short_text',
	answer_value: value,
} );

describe( 'renderParticipantAnswers', () => {
	it( 'shows each ticket’s answers under that ticket only', () => {
		const item = {
			questionnaire_answers: [],
			tickets: [
				{
					id: 71,
					position: 1,
					reference: 'AE2671B5',
					answers: [ diet( 'Vegan' ) ],
					answers_need_review: false,
				},
				{
					id: 72,
					position: 2,
					reference: 'C0FFEE12',
					answers: [],
					answers_need_review: false,
				},
			],
		};
		render( renderParticipantAnswers( item ) );

		expect( screen.getByText( 'Ticket 1 (AE2671B5)' ) ).toBeVisible();
		expect( screen.queryByText( 'Ticket 2 (C0FFEE12)' ) ).toBeNull();
		expect( screen.getAllByText( 'Vegan' ) ).toHaveLength( 1 );
		expect(
			screen.queryByText( 'Check which ticket these belong to' )
		).toBeNull();
		expect( countParticipantAnswers( item ) ).toBe( 1 );
	} );

	it( 'keeps answers without a ticket with the participant and flags a review', () => {
		const item = {
			questionnaire_answers: [ diet( 'Vegetarian' ) ],
			questionnaire_answers_need_review: true,
			tickets: [],
		};
		render( renderParticipantAnswers( item ) );

		expect( screen.getByText( 'Vegetarian' ) ).toBeVisible();
		expect(
			screen.getByText( 'Check which ticket these belong to' )
		).toBeVisible();
	} );

	it( 'renders nothing when there are no answers', () => {
		expect(
			renderParticipantAnswers( {
				questionnaire_answers: [],
				tickets: [
					{ id: 1, position: 1, reference: 'X', answers: [] },
				],
			} )
		).toBeNull();
	} );
} );

describe( 'EventParticipants — removal and feedback (#1775)', () => {
	const JANE = {
		id: 100,
		participant_id: 1,
		event_date_id: 5,
		is_series_pass: false,
		participant_name: 'Jane Doe',
		participant_email: 'jane@x.test',
		label: 'interested',
		tickets: [],
		questionnaire_answers: [],
		removal_blockers: [],
	};
	const PROFILES = [
		{ id: 1, name: 'Jane', surname: 'Doe', email: 'jane@x.test' },
		{ id: 2, name: 'John', surname: 'Roe', email: 'john@x.test' },
	];
	const EVENT = {
		title: 'Weekly class',
		event_date: '2036-05-10 18:00:00',
		manage_event_url:
			'admin.php?page=fair-events-manage-event&event_date_id=5',
		signed_up: 0,
		collaborators: 0,
	};
	const DATE = 'May 10, 2036 6:00 pm';
	let dateSettings;

	/**
	 * @param {Object}   answers
	 * @param {Function} [answers.rows]   Returns the rows of each list load.
	 * @param {Function} [answers.mutate] Answers a POST, PUT or DELETE.
	 */
	function mockApi( { rows = () => [ JANE ], mutate } = {} ) {
		apiFetch.mockImplementation( ( request ) => {
			const { path, method = 'GET' } = request;
			if ( method !== 'GET' ) {
				return mutate ? mutate( request ) : Promise.resolve( {} );
			}
			if ( path === '/fair-audience/v1/event-dates/5' ) {
				return Promise.resolve( EVENT );
			}
			if ( path === '/fair-audience/v1/event-dates/5/participants' ) {
				return Promise.resolve( rows() );
			}
			if ( path === '/fair-audience/v1/participants' ) {
				return Promise.resolve( PROFILES );
			}
			return Promise.resolve( [] );
		} );
	}

	const mutations = () =>
		apiFetch.mock.calls
			.map( ( [ request ] ) => request )
			.filter( ( request ) => request.method );

	const openRowAction = async ( action ) => {
		await screen.findByText( 'Jane Doe' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Actions' } ) );
		fireEvent.click( await screen.findByText( action ) );
	};

	beforeEach( () => {
		window.history.pushState(
			{},
			'',
			'/wp-admin/admin.php?page=fair-audience-event-participants&event_date_id=5'
		);
		jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
		jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		jest.spyOn( window, 'confirm' ).mockImplementation( () => true );
		jest.spyOn( window, 'alert' ).mockImplementation( () => {} );
		// A site ahead of UTC: the stored wall-clock time must not shift.
		dateSettings = getSettings();
		setSettings( {
			...dateSettings,
			timezone: { offset: 2, string: 'Europe/Madrid', abbr: 'CEST' },
		} );
	} );

	afterEach( () => {
		setSettings( dateSettings );
		jest.restoreAllMocks();
		jest.clearAllMocks();
	} );

	it( 'asks in a popup naming the participant, the event and its date', async () => {
		mockApi();
		render( <EventParticipants /> );

		await openRowAction( 'Remove' );

		const dialog = await screen.findByRole( 'dialog', {
			name: 'Remove participant — Jane Doe',
		} );
		expect( window.confirm ).not.toHaveBeenCalled();
		expect( dialog ).toHaveTextContent(
			`Remove Jane Doe from the audience of Weekly class on ${ DATE }?`
		);
		expect( dialog ).toHaveTextContent(
			'Their participant profile, their other events and dates, and all payment records are kept.'
		);
		// The page header shows the same wall-clock time.
		expect( screen.getByText( `Date: ${ DATE }` ) ).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Keep participant',
			} )
		);
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( mutations() ).toHaveLength( 0 );
	} );

	it( 'removes, refreshes the list and reports it', async () => {
		let listed = [ JANE ];
		mockApi( {
			rows: () => listed,
			mutate: () => {
				listed = [];
				return Promise.resolve( { removed: true } );
			},
		} );
		render( <EventParticipants /> );

		await openRowAction( 'Remove' );
		const dialog = await screen.findByRole( 'dialog' );
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Remove participant',
			} )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect(
			(
				await screen.findAllByText(
					'Jane Doe was removed from this date.'
				)
			).length
		).toBeGreaterThan( 0 );
		expect( mutations() ).toEqual( [
			{
				path: '/fair-audience/v1/event-dates/5/participants/1',
				method: 'DELETE',
			},
		] );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Actions' } )
			).not.toBeInTheDocument()
		);
	} );

	it( 'explains what blocks a removal and leads to the List tab of the event', async () => {
		mockApi( {
			rows: () => [
				{
					...JANE,
					removal_blockers: [
						{
							code: 'registration',
							message:
								'This participant has 1 registration for this date.',
						},
					],
				},
			],
		} );
		render( <EventParticipants /> );

		await openRowAction( 'Remove' );

		const dialog = await screen.findByRole( 'dialog' );
		expect( dialog ).toHaveTextContent(
			`Jane Doe cannot be removed from Weekly class on ${ DATE } yet.`
		);
		expect(
			within( dialog ).queryByRole( 'button', {
				name: 'Remove participant',
			} )
		).not.toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'link', { name: 'Open the List tab' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-manage-event&event_date_id=5&tab=list'
		);
	} );

	it( 'leaves an inherited series pass to its series date', async () => {
		mockApi( { rows: () => [ { ...JANE, is_series_pass: true } ] } );
		render( <EventParticipants /> );

		await screen.findByText( 'Jane Doe' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Actions' } ) );

		expect( await screen.findByText( 'Edit' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Remove' ) ).not.toBeInTheDocument();
	} );

	it( 'shows a failed role change in its popup and saves on retry', async () => {
		let fails = true;
		mockApi( {
			mutate: () =>
				fails
					? Promise.reject( { message: 'Role not allowed.' } )
					: Promise.resolve( {} ),
		} );
		render( <EventParticipants /> );

		await openRowAction( 'Edit' );
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Edit Participant',
		} );
		fireEvent.change( within( dialog ).getByLabelText( 'Label' ), {
			target: { value: 'collaborator' },
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Save' } )
		);

		expect(
			await within( dialog ).findByText( 'Role not allowed.' )
		).toBeInTheDocument();
		expect( window.alert ).not.toHaveBeenCalled();
		expect( within( dialog ).getByLabelText( 'Label' ) ).toHaveValue(
			'collaborator'
		);

		fails = false;
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Save' } )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect(
			( await screen.findAllByText( 'Role updated.' ) ).length
		).toBeGreaterThan( 0 );
	} );

	it( 'keeps the selection when adding fails, and reports the addition after a retry', async () => {
		let fails = true;
		mockApi( {
			mutate: () =>
				fails
					? Promise.reject( { message: 'Event date not found.' } )
					: Promise.resolve( { added: 1, skipped: 0, failed: 0 } ),
		} );
		render( <EventParticipants /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add Participants' } )
		);
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Add Participants',
		} );
		// Jane is already in the audience: only John is offered.
		expect(
			within( dialog ).queryByText( /Jane/ )
		).not.toBeInTheDocument();
		fireEvent.click( within( dialog ).getByRole( 'checkbox' ) );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Add 1 Selected' } )
		);

		expect(
			await within( dialog ).findByText( 'Event date not found.' )
		).toBeInTheDocument();
		expect( window.alert ).not.toHaveBeenCalled();
		expect( within( dialog ).getByRole( 'checkbox' ) ).toBeChecked();

		fails = false;
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Add 1 Selected' } )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect(
			( await screen.findAllByText( '1 participant added.' ) ).length
		).toBeGreaterThan( 0 );
		expect(
			mutations().map( ( request ) => request.data.participant_ids )
		).toEqual( [ [ 2 ], [ 2 ] ] );
	} );

	it( 'keeps the invitation selection when sending fails', async () => {
		mockApi( {
			mutate: () => Promise.reject( { message: 'Mail server is down.' } ),
		} );
		render( <EventParticipants /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Send Invitation' } )
		);
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Send Event Invitations',
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'By Participant' } )
		);
		fireEvent.click( within( dialog ).getAllByRole( 'checkbox' )[ 0 ] );
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Send to 1 Selected',
			} )
		);

		expect(
			await within( dialog ).findByText( 'Mail server is down.' )
		).toBeInTheDocument();
		expect( window.alert ).not.toHaveBeenCalled();
		expect(
			within( dialog ).getAllByRole( 'checkbox' )[ 0 ]
		).toBeChecked();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Send to 1 Selected',
			} )
		).toBeEnabled();
	} );
} );
