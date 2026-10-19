/**
 * Playwright API tests for the event-invitation preview (#1776).
 *
 * Exercises
 * POST /fair-audience/v1/event-dates/{event_date_id}/event-invitations/preview
 * and its parity with the send route against a live WordPress instance:
 *
 * - Permissions, input validation and event validation match the send.
 * - Overlapping groups and mixed selections count each person once; every
 *   person left out is counted under one reason; nobody eligible is a
 *   normal answer, not an error.
 * - Signups exclude people only for the invited occurrence of a series.
 * - The preview sends no mail; the send of the reviewed IDs mails exactly
 *   the people the preview counted, never someone added to a group since,
 *   and never someone who withdrew consent since.
 *
 * Fixtures (a weekly series of two dates, participants, groups) are created
 * through the admin REST API and removed afterwards. Mail is captured by
 * fair-e2e-support.php and read back through fair-e2e-fee-reminders.php.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const MAIL_PATH = '/wp-json/fair-e2e/v1/fee-reminders/mail';

test.describe( 'EventInvitationsController preview', () => {
	let api;
	let stamp;
	const created = { eventId: 0, seriesId: 0, participants: {}, groups: {} };
	let dateId;
	let siblingDateId;

	const post = async ( path, data ) => {
		const res = await api.post( `/wp-json${ path }`, {
			headers: authHeaders,
			data,
		} );
		expect( res.ok(), `${ path }: ${ await res.text() }` ).toBeTruthy();
		return res.json();
	};

	const preview = ( data, eventDateId = dateId ) =>
		api.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/event-invitations/preview`,
			{ headers: authHeaders, data }
		);

	const send = ( data, eventDateId = dateId ) =>
		api.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/event-invitations`,
			{ headers: authHeaders, data }
		);

	const ids = ( ...keys ) =>
		keys.map( ( key ) => created.participants[ key ].id );

	const capturedRecipients = async () => {
		const res = await api.get( MAIL_PATH, { headers: authHeaders } );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).flatMap( ( entry ) => entry.to );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		stamp = Date.now();

		created.eventId = (
			await post( '/wp/v2/fair_event', {
				title: `Invitation Preview ${ stamp }`,
				status: 'publish',
			} )
		).id;
		const series = await post( '/fair-events/v1/event-dates', {
			title: `Invitation Preview ${ stamp }`,
			start_date: '2037-05-02',
			start_time: '18:30:00',
			end_date: '2037-05-02',
			end_time: '20:30:00',
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		created.seriesId = series.id;
		dateId = series.id;
		siblingDateId = series.generated_occurrences[ 0 ].id;
		const link = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ dateId }`,
			{ headers: authHeaders, data: { event_id: created.eventId } }
		);
		expect( link.ok() ).toBeTruthy();

		const people = {
			ada: 'marketing',
			bo: 'marketing',
			cy: 'declined',
			di: 'marketing',
			ed: 'minimal',
			late: 'marketing',
			sib: 'marketing',
		};
		for ( const [ key, profile ] of Object.entries( people ) ) {
			const email = `invite-${ key }-${ stamp }@example.test`;
			const participant = await post( '/fair-audience/v1/participants', {
				name: `Invitee ${ key }`,
				surname: `${ stamp }`,
				email,
				email_profile: profile,
			} );
			created.participants[ key ] = { id: participant.id, email };
		}

		// Di is signed up to the invited date, Sib only to the sibling date.
		await post(
			`/fair-audience/v1/event-dates/${ dateId }/participants/batch`,
			{ participant_ids: ids( 'di' ), label: 'signed_up' }
		);
		await post(
			`/fair-audience/v1/event-dates/${ siblingDateId }/participants/batch`,
			{ participant_ids: ids( 'sib' ), label: 'signed_up' }
		);

		const groups = {
			volunteers: [ 'ada', 'bo', 'cy' ],
			readers: [ 'bo', 'cy', 'di', 'ed' ],
		};
		for ( const [ key, members ] of Object.entries( groups ) ) {
			const group = await post( '/fair-audience/v1/groups', {
				name: `Invite ${ key } ${ stamp }`,
			} );
			created.groups[ key ] = group.id;
			for ( const id of ids( ...members ) ) {
				await post(
					`/fair-audience/v1/groups/${ group.id }/participants`,
					{
						participant_id: id,
					}
				);
			}
		}
	} );

	test.afterAll( async () => {
		const remove = ( path ) =>
			api.delete( `/wp-json${ path }`, { headers: authHeaders } );
		for ( const id of Object.values( created.groups ) ) {
			await remove( `/fair-audience/v1/groups/${ id }` );
		}
		for ( const { id } of Object.values( created.participants ) ) {
			await remove( `/fair-audience/v1/participants/${ id }` );
		}
		if ( created.seriesId ) {
			await remove( `/fair-events/v1/event-dates/${ created.seriesId }` );
		}
		if ( created.eventId ) {
			await remove( `/wp/v2/fair_event/${ created.eventId }?force=true` );
		}
		await remove( '/fair-e2e/v1/fee-reminders/mail' );
		await api.dispose();
	} );

	test( 'requires an administrator', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ dateId }/event-invitations/preview`,
			{ data: { participant_ids: ids( 'ada' ) } }
		);
		expect( res.status() ).toBeGreaterThanOrEqual( 401 );
		expect( res.status() ).toBeLessThan( 404 );
	} );

	test( 'validates the event date and the selection like the send', async () => {
		for ( const call of [ preview, send ] ) {
			expect( ( await call( {} ) ).status() ).toBe( 400 );
			expect(
				( await call( { participant_ids: [ 'abc' ] } ) ).status()
			).toBe( 400 );
			expect( ( await call( { group_ids: 'everyone' } ) ).status() ).toBe(
				400
			);
			expect(
				(
					await call( { participant_ids: ids( 'ada' ) }, 999999999 )
				).status()
			).toBe( 404 );
		}
	} );

	test( 'counts overlapping groups once and explains every exclusion', async () => {
		const res = await preview( {
			group_ids: [ created.groups.volunteers, created.groups.readers ],
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.event_id ).toBe( created.eventId );
		expect( body.event_date_id ).toBe( dateId );
		expect( body.group_membership_count ).toBe( 7 );
		expect( body.candidate_count ).toBe( 5 );
		expect( body.eligible_count ).toBe( 2 );
		expect( body.eligible_participant_ids.sort() ).toEqual(
			ids( 'ada', 'bo' ).sort()
		);
		expect( body.excluded ).toEqual( {
			already_signed_up: 1,
			unavailable: 0,
			invalid_email: 0,
			no_marketing_consent: 2,
		} );
	} );

	test( 'counts a person picked directly and through a group once', async () => {
		const body = await (
			await preview( {
				participant_ids: ids( 'ada', 'late' ),
				group_ids: [ created.groups.volunteers ],
			} )
		).json();

		expect( body.candidate_count ).toBe( 4 );
		expect( body.eligible_participant_ids.sort() ).toEqual(
			ids( 'ada', 'bo', 'late' ).sort()
		);
		expect( body.excluded.no_marketing_consent ).toBe( 1 );
	} );

	test( 'answers nobody eligible without an error', async () => {
		const res = await preview( {
			participant_ids: [ ...ids( 'cy', 'di' ), 999999999 ],
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.eligible_count ).toBe( 0 );
		expect( body.eligible_participant_ids ).toEqual( [] );
		expect( body.excluded ).toEqual( {
			already_signed_up: 1,
			unavailable: 1,
			invalid_email: 0,
			no_marketing_consent: 1,
		} );
	} );

	test( 'excludes signups to the invited date only', async () => {
		const forDate = await (
			await preview( { participant_ids: ids( 'sib', 'di' ) } )
		).json();
		expect( forDate.eligible_participant_ids ).toEqual( ids( 'sib' ) );

		const forSibling = await (
			await preview(
				{ participant_ids: ids( 'sib', 'di' ) },
				siblingDateId
			)
		).json();
		expect( forSibling.event_date_id ).toBe( siblingDateId );
		expect( forSibling.eligible_participant_ids ).toEqual( ids( 'di' ) );
	} );

	test( 'sends the reviewed people only, rechecking each one', async () => {
		await api.delete( MAIL_PATH, { headers: authHeaders } );

		const reviewed = await (
			await preview( { group_ids: [ created.groups.volunteers ] } )
		).json();
		expect( reviewed.eligible_participant_ids.sort() ).toEqual(
			ids( 'ada', 'bo' ).sort()
		);
		expect( await capturedRecipients() ).toEqual( [] );

		// After the preview, someone joins the group and Bo withdraws consent.
		await post(
			`/fair-audience/v1/groups/${ created.groups.volunteers }/participants`,
			{ participant_id: ids( 'late' )[ 0 ] }
		);
		const withdraw = await api.put(
			`/wp-json/fair-audience/v1/participants/${ ids( 'bo' )[ 0 ] }`,
			{
				headers: authHeaders,
				data: {
					name: 'Invitee bo',
					surname: `${ stamp }`,
					email: created.participants.bo.email,
					email_profile: 'declined',
				},
			}
		);
		expect( withdraw.ok(), await withdraw.text() ).toBeTruthy();

		const res = await send( {
			participant_ids: reviewed.eligible_participant_ids,
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.sent ).toEqual( [ created.participants.ada.email ] );
		expect( body.skipped_count ).toBe( 1 );
		expect( body.skipped[ 0 ].email ).toBe( created.participants.bo.email );
		expect( body.failed ).toEqual( [] );
		expect( await capturedRecipients() ).toEqual( [
			created.participants.ada.email,
		] );
	} );
} );
