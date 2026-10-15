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
	act,
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

	const isPreview = ( { path } ) => path.endsWith( '/preview' );
	const isInvitationSend = ( { path, method } ) =>
		method === 'POST' && path.endsWith( '/event-invitations' );
	const PREVIEW = {
		event_id: 9,
		event_date_id: 5,
		event_title: 'Weekly class',
		group_membership_count: 0,
		candidate_count: 1,
		eligible_count: 1,
		eligible_participant_ids: [ 2 ],
		excluded: {
			already_signed_up: 0,
			unavailable: 0,
			invalid_email: 0,
			no_marketing_consent: 0,
		},
	};

	/**
	 * @param {Object}   answers
	 * @param {Function} [answers.preview] Answers a preview request.
	 * @param {Function} [answers.send]    Answers the send.
	 * @param {Array}    [answers.groups]  Groups offered.
	 */
	function mockInvitationApi( {
		preview = () => Promise.resolve( PREVIEW ),
		send = () =>
			Promise.resolve( {
				success: true,
				sent_count: 1,
				skipped_count: 0,
				failed: [],
			} ),
		groups = [],
	} = {} ) {
		mockApi( {
			mutate: ( request ) =>
				isPreview( request ) ? preview( request ) : send( request ),
		} );
		const base = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( request ) =>
			request.path === '/fair-audience/v1/groups'
				? Promise.resolve( groups )
				: base( request )
		);
	}

	const sends = () =>
		apiFetch.mock.calls
			.map( ( [ request ] ) => request )
			.filter( isInvitationSend );

	const openInvitation = async () => {
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Send Invitation' } )
		);
		return screen.findByRole( 'dialog', {
			name: 'Send Event Invitations',
		} );
	};

	const pickPerson = async ( dialog ) => {
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'By Participant' } )
		);
		// John Roe, the second profile. Let the preview the selection starts
		// settle inside act().
		await act( async () => {
			fireEvent.click( within( dialog ).getAllByRole( 'checkbox' )[ 1 ] );
		} );
	};

	it( 'summarizes the event, the person and who will receive it before sending', async () => {
		mockInvitationApi();
		render( <EventParticipants /> );

		const dialog = await openInvitation();
		expect(
			within( dialog ).getByText(
				'Select who should receive the invitation.'
			)
		).toBeInTheDocument();
		await pickPerson( dialog );

		const summary = await within( dialog ).findByRole( 'region', {
			name: 'Invitation summary',
		} );
		expect( summary ).toHaveTextContent(
			`Invitation to Weekly class on ${ DATE }`
		);
		expect( summary ).toHaveTextContent( '1 person selected:' );
		expect( summary ).toHaveTextContent( 'John Roe' );
		expect(
			await within( summary ).findByText(
				'1 person will receive this invitation.'
			)
		).toBeInTheDocument();
		expect(
			apiFetch.mock.calls
				.map( ( [ request ] ) => request )
				.filter( isPreview )
				.at( -1 ).data
		).toEqual( { participant_ids: [ 2 ] } );
	} );

	it( 'sends the reviewed recipients, not the groups, and reports the result', async () => {
		mockInvitationApi( {
			groups: [
				{ id: 7, name: 'Volunteers', member_count: 3 },
				{ id: 8, name: 'Readers', member_count: 4 },
			],
			preview: () =>
				Promise.resolve( {
					...PREVIEW,
					group_membership_count: 7,
					candidate_count: 5,
					eligible_count: 2,
					eligible_participant_ids: [ 11, 12 ],
					excluded: {
						already_signed_up: 1,
						unavailable: 0,
						invalid_email: 0,
						no_marketing_consent: 2,
					},
				} ),
			send: () =>
				Promise.resolve( {
					success: true,
					sent_count: 2,
					skipped_count: 0,
					failed: [],
				} ),
		} );
		render( <EventParticipants /> );

		const dialog = await openInvitation();
		fireEvent.click( within( dialog ).getByLabelText( /Volunteers/ ) );
		fireEvent.click( within( dialog ).getByLabelText( /Readers/ ) );

		const summary = within( dialog ).getByRole( 'region', {
			name: 'Invitation summary',
		} );
		expect(
			await within( summary ).findByText(
				'7 group memberships in total, 5 different people selected.'
			)
		).toBeInTheDocument();
		expect( summary ).toHaveTextContent(
			'2 people will receive this invitation.'
		);
		expect( summary ).toHaveTextContent(
			'1 is already signed up for this date.'
		);
		expect( summary ).toHaveTextContent(
			'2 have not confirmed they want marketing emails, or opted out.'
		);

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Send 2 invitations',
			} )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( sends().map( ( request ) => request.data ) ).toEqual( [
			{ participant_ids: [ 11, 12 ] },
		] );
		expect(
			(
				await screen.findAllByText(
					'Invitations sent to 2 participants'
				)
			).length
		).toBeGreaterThan( 0 );
	} );

	it( 'explains that nobody can be invited and offers no send', async () => {
		mockInvitationApi( {
			preview: () =>
				Promise.resolve( {
					...PREVIEW,
					eligible_count: 0,
					eligible_participant_ids: [],
					excluded: { ...PREVIEW.excluded, no_marketing_consent: 1 },
				} ),
		} );
		render( <EventParticipants /> );

		const dialog = await openInvitation();
		await pickPerson( dialog );

		expect(
			await within( dialog ).findByText(
				'Nobody selected can be invited, so nothing will be sent.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( 'Nobody selected can be invited.' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Send Invitations' } )
		).toBeDisabled();
	} );

	it( 'shows the summary of the latest selection only', async () => {
		let answerFirst;
		mockInvitationApi( {
			preview: ( request ) =>
				request.data.participant_ids.length === 1
					? new Promise( ( resolve ) => {
							answerFirst = resolve;
						} )
					: Promise.resolve( {
							...PREVIEW,
							candidate_count: 2,
							eligible_count: 2,
							eligible_participant_ids: [ 1, 2 ],
						} ),
		} );
		render( <EventParticipants /> );

		const dialog = await openInvitation();
		await pickPerson( dialog );
		fireEvent.click( within( dialog ).getAllByRole( 'checkbox' )[ 0 ] );

		expect(
			await within( dialog ).findByText(
				'2 people will receive this invitation.'
			)
		).toBeInTheDocument();
		// The answer for the earlier, one-person selection arrives late.
		answerFirst( PREVIEW );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		expect(
			within( dialog ).getByText(
				'2 people will receive this invitation.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Send 2 invitations',
			} )
		).toBeEnabled();
	} );

	it( 'sends nothing when cancelled', async () => {
		mockInvitationApi();
		render( <EventParticipants /> );

		const dialog = await openInvitation();
		await pickPerson( dialog );
		await within( dialog ).findByText(
			'1 person will receive this invitation.'
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( sends() ).toHaveLength( 0 );
	} );

	it( 'locks the selection while sending and sends once', async () => {
		let finishSend;
		mockInvitationApi( {
			send: () =>
				new Promise( ( resolve ) => {
					finishSend = resolve;
				} ),
		} );
		render( <EventParticipants /> );

		const dialog = await openInvitation();
		await pickPerson( dialog );
		const send = await within( dialog ).findByRole( 'button', {
			name: 'Send 1 invitation',
		} );
		fireEvent.click( send );
		fireEvent.click( send );

		const sending = within( dialog ).getByRole( 'button', {
			name: 'Sending…',
		} );
		expect( sending ).toBeDisabled();
		within( dialog )
			.getAllByRole( 'checkbox' )
			.forEach( ( box ) => expect( box ).toBeDisabled() );
		expect(
			within( dialog ).getByRole( 'button', { name: 'By Group' } )
		).toBeDisabled();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect( sends() ).toHaveLength( 1 );

		finishSend( {
			success: true,
			sent_count: 1,
			skipped_count: 0,
			failed: [],
		} );
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
	} );

	it( 'keeps the invitation selection when sending fails', async () => {
		mockInvitationApi( {
			send: () => Promise.reject( { message: 'Mail server is down.' } ),
		} );
		render( <EventParticipants /> );

		const dialog = await openInvitation();
		await pickPerson( dialog );
		fireEvent.click(
			await within( dialog ).findByRole( 'button', {
				name: 'Send 1 invitation',
			} )
		);

		expect(
			await within( dialog ).findByText( 'Mail server is down.' )
		).toBeInTheDocument();
		expect( window.alert ).not.toHaveBeenCalled();
		expect(
			within( dialog ).getAllByRole( 'checkbox' )[ 1 ]
		).toBeChecked();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Send 1 invitation',
			} )
		).toBeEnabled();
	} );
} );
