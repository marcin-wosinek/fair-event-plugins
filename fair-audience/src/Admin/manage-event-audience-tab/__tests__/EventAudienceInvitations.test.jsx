/**
 * @jest-environment jsdom
 *
 * Component tests for "Send Invitations" on the Audience tab (#1776).
 *
 * Exercises:
 *   - The popup names the event, its date and the invited groups, keeps
 *     group membership apart from the people who will receive the
 *     invitation, and says why the others will not.
 *   - Sending posts the reviewed recipients, once, and reports the result.
 *   - Nobody eligible: the popup says so and offers no send.
 *   - Cancel sends nothing; a failure stays in the popup and can be retried.
 *   - A failed check of the recipients can be repeated.
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

const GROUPS = [
	{ id: 7, name: 'Volunteers', member_count: 3 },
	{ id: 8, name: 'Readers', member_count: 4 },
	{ id: 9, name: 'Not invited', member_count: 10 },
];

const PREVIEW = {
	event_id: 1,
	event_date_id: 5,
	event_title: 'Weekly class',
	group_membership_count: 7,
	candidate_count: 5,
	eligible_count: 2,
	eligible_participant_ids: [ 11, 12 ],
	excluded: {
		already_signed_up: 1,
		unavailable: 0,
		invalid_email: 1,
		no_marketing_consent: 1,
	},
};

const isPreview = ( { path } ) => path.endsWith( '/event-invitations/preview' );
const isSend = ( { path, method } ) =>
	method === 'POST' && path.endsWith( '/event-invitations' );

/**
 * @param {Object}   answers
 * @param {Function} [answers.preview] Answers a preview request.
 * @param {Function} [answers.send]    Answers the send.
 */
function mockApiFetchFor( {
	preview = () => Promise.resolve( PREVIEW ),
	send = () =>
		Promise.resolve( {
			success: true,
			sent_count: 2,
			skipped_count: 0,
			failed: [],
		} ),
} = {} ) {
	apiFetch.mockImplementation( ( request ) => {
		const { path } = request;
		if ( isPreview( request ) ) {
			return preview( request );
		}
		if ( isSend( request ) ) {
			return send( request );
		}
		if ( path.includes( '/group-permission-rules' ) ) {
			return Promise.resolve( [
				{ id: 1, group_id: 7, permission_type: 'invited' },
				{ id: 2, group_id: 8, permission_type: 'invited' },
				{ id: 3, group_id: 9, permission_type: 'view_signups' },
			] );
		}
		if ( path === '/fair-audience/v1/groups' ) {
			return Promise.resolve( GROUPS );
		}
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( [] );
		}
		if ( path.includes( '/siblings' ) ) {
			return Promise.resolve( SIBLINGS );
		}
		if ( path.includes( '/tickets' ) ) {
			return Promise.resolve( { options: [], ticket_types: [] } );
		}
		return Promise.resolve( [] );
	} );
}

const requests = ( match ) =>
	apiFetch.mock.calls.map( ( [ request ] ) => request ).filter( match );

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

async function openInvitations() {
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Send Invitations' } )
	);
	return screen.findByRole( 'dialog', { name: 'Send Invitations' } );
}

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'EventAudience — Send Invitations (#1776)', () => {
	it( 'summarizes the event, the groups and who will receive it', async () => {
		mockApiFetchFor();
		renderAudience();

		const dialog = await openInvitations();
		const summary = within( dialog ).getByRole( 'region', {
			name: 'Invitation summary',
		} );

		expect(
			await within( summary ).findByText(
				'2 people will receive this invitation.'
			)
		).toBeInTheDocument();
		expect( summary ).toHaveTextContent(
			`Invitation to Weekly class on ${ DATE_LABEL }`
		);
		expect( summary ).toHaveTextContent( 'Volunteers — 3 members' );
		expect( summary ).toHaveTextContent( 'Readers — 4 members' );
		expect( summary ).not.toHaveTextContent( 'Not invited —' );
		expect( summary ).toHaveTextContent(
			'7 group memberships in total, 5 different people selected.'
		);
		expect( summary ).toHaveTextContent(
			'1 is already signed up for this date.'
		);
		expect( summary ).toHaveTextContent( '1 has no valid email address.' );
		expect( summary ).toHaveTextContent(
			'1 has not confirmed they want marketing emails, or opted out.'
		);
		expect( requests( isPreview ).map( ( r ) => r.data ) ).toEqual( [
			{ group_ids: [ 7, 8 ] },
		] );
	} );

	it( 'sends the reviewed recipients once and reports the result', async () => {
		let finishSend;
		mockApiFetchFor( {
			send: () =>
				new Promise( ( resolve ) => {
					finishSend = resolve;
				} ),
		} );
		renderAudience();

		const dialog = await openInvitations();
		const send = await within( dialog ).findByRole( 'button', {
			name: 'Send 2 invitations',
		} );
		fireEvent.click( send );
		fireEvent.click( send );

		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect( requests( isSend ).map( ( r ) => r.data ) ).toEqual( [
			{ participant_ids: [ 11, 12 ] },
		] );

		finishSend( {
			success: true,
			sent_count: 2,
			skipped_count: 1,
			failed: [],
		} );
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect(
			await screen.findByText( '2 invitations sent. 1 skipped.' )
		).toBeInTheDocument();
	} );

	it( 'says when nobody can be invited and offers no send', async () => {
		mockApiFetchFor( {
			preview: () =>
				Promise.resolve( {
					...PREVIEW,
					eligible_count: 0,
					eligible_participant_ids: [],
				} ),
		} );
		renderAudience();

		const dialog = await openInvitations();

		expect(
			await within( dialog ).findByText(
				'Nobody selected can be invited, so nothing will be sent.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Send Invitations' } )
		).toBeDisabled();
		expect(
			within( dialog ).getByText( 'Nobody selected can be invited.' )
		).toBeInTheDocument();
	} );

	it( 'sends nothing when cancelled', async () => {
		mockApiFetchFor();
		renderAudience();

		const dialog = await openInvitations();
		await within( dialog ).findByRole( 'button', {
			name: 'Send 2 invitations',
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( requests( isSend ) ).toHaveLength( 0 );
	} );

	it( 'keeps the popup open with the error when sending fails', async () => {
		mockApiFetchFor( {
			send: () => Promise.reject( { message: 'Mail server is down.' } ),
		} );
		renderAudience();

		const dialog = await openInvitations();
		fireEvent.click(
			await within( dialog ).findByRole( 'button', {
				name: 'Send 2 invitations',
			} )
		);

		expect(
			await within( dialog ).findByText( 'Mail server is down.' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Send 2 invitations',
			} )
		).toBeEnabled();
	} );

	it( 'lets the organizer check the recipients again after a failure', async () => {
		let failPreview = true;
		mockApiFetchFor( {
			preview: () =>
				failPreview
					? Promise.reject( { message: 'Timeout.' } )
					: Promise.resolve( PREVIEW ),
		} );
		renderAudience();

		const dialog = await openInvitations();
		expect(
			await within( dialog ).findByText(
				'Who can be invited could not be checked: Timeout.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Send Invitations' } )
		).toBeDisabled();

		failPreview = false;
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Check again' } )
		);

		expect(
			await within( dialog ).findByRole( 'button', {
				name: 'Send 2 invitations',
			} )
		).toBeEnabled();
	} );
} );
