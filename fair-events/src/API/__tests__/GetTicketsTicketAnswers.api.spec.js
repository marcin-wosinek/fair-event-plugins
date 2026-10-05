/**
 * Playwright API tests for Fair Form answers attached to the ticket they
 * were collected for (#1609).
 *
 * Covers:
 *   - a signup's answers are recorded on its ticket.
 *   - a multi-ticket purchase's one answer set goes to its first ticket only.
 *   - a second purchase by the same participant on the same date gets its
 *     own submission instead of replacing the first one's answers.
 *   - a standalone Fair Form submission gets no ticket.
 *   - the admin signups list, the ticket editor's endpoint and the
 *     participants list show answers with their ticket; all stay protected.
 *   - the legacy backfill: earliest signup's first ticket, marked inferred
 *     and flagged for review; no match stays unresolved at participant
 *     scope; standalone submissions are left alone; reruns change nothing.
 *   - removing a linked ticket keeps the answers, clears the link and flags
 *     them for review.
 *
 * Needs fair-form and fair-audience active (skips otherwise) and the
 * e2e/mu-plugins/fair-e2e-submission-tickets.php test routes. Anonymous
 * requests each use their own request context, so fair-audience's session
 * cookie cannot merge unrelated signups onto one participant.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

function uniqueEmail( prefix ) {
	return `${ prefix }-${ Date.now() }-${ Math.floor(
		Math.random() * 1e6
	) }@example.test`;
}

const dietQuestion = ( value ) => ( {
	question_key: 'diet',
	question_text: 'Dietary needs?',
	question_type: 'short_text',
	answer_value: value,
	display_order: 0,
} );

// One browser per buyer (email): separate buyers stay cookie-isolated, and a
// returning buyer keeps the session fair-audience recognises them by — a
// purchase typed with a known email from an unseen browser is held back.
const visitors = new Map();

/**
 * POST as a visitor, one per buyer.
 *
 * @param {string} path Request path.
 * @param {Object} data JSON body.
 * @return {Promise<{ok: boolean, status: number}>}
 */
async function anonymousPost( path, data ) {
	const key = data.email || '';
	if ( ! visitors.has( key ) ) {
		visitors.set( key, await request.newContext( { baseURL: BASE_URL } ) );
	}
	const res = await visitors.get( key ).post( path, { data } );
	return { ok: res.ok(), status: res.status() };
}

test.describe( 'Fair Form answers per ticket', () => {
	let api;
	let active = false;
	let eventPostId;
	let eventDateId;

	async function signups() {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId, include_answers: 'true' },
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function buy( email, quantity, answers ) {
		const before = new Set(
			( await signups() ).map( ( signup ) => signup.id )
		);
		const data = {
			event_date_id: eventDateId,
			name: `Answers ${ email }`,
			email,
			quantity,
		};
		if ( answers ) {
			data.questionnaire_answers = answers;
		}
		const res = await anonymousPost(
			'/wp-json/fair-events/v1/get-tickets',
			data
		);
		expect( res.ok ).toBeTruthy();
		return ( await signups() ).find(
			( signup ) => signup.email === email && ! before.has( signup.id )
		);
	}

	async function submissionsByTicket() {
		const res = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses',
			{ headers: adminHeaders, params: { event_date_id: eventDateId } }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function state( ids ) {
		const query = ids.map( ( id ) => `ids[]=${ id }` ).join( '&' );
		const res = await api.get(
			`/wp-json/fair-e2e/v1/submission-tickets/state?${ query }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function seedLegacy( data ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/submission-tickets/legacy',
			{
				headers: adminHeaders,
				data: { event_date_id: eventDateId, ...data },
			}
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).id;
	}

	async function backfill( restart ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/submission-tickets/backfill',
			{ headers: adminHeaders, data: { restart } }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const pluginsRes = await api.get( '/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		} );
		if ( pluginsRes.ok() ) {
			const plugins = await pluginsRes.json();
			const isActive = ( slug ) =>
				plugins.some(
					( p ) =>
						p.plugin?.startsWith( `${ slug }/` ) &&
						p.status === 'active'
				);
			active = isActive( 'fair-form' ) && isActive( 'fair-audience' );
		}

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Ticket answers test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Ticket answers test ${ Date.now() }`,
				link_type: 'post',
				start_datetime: '2036-03-01 10:00:00',
				end_datetime: '2036-03-01 12:00:00',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		eventDateId = ( await edRes.json() ).id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventPostId } }
		);
		expect( linkRes.ok() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		for ( const visitor of visitors.values() ) {
			await visitor.dispose();
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'a multi-ticket purchase records its answers on its first ticket only', async () => {
		test.skip( ! active, 'fair-form or fair-audience not active' );

		const signup = await buy( uniqueEmail( 'multi' ), 3, [
			dietQuestion( 'Vegan' ),
		] );
		const [ first, second, third ] = signup.tickets;

		const linked = ( await submissionsByTicket() ).filter( ( s ) =>
			[ first.id, second.id, third.id ].includes( s.ticket_id )
		);
		expect( linked ).toHaveLength( 1 );
		expect( linked[ 0 ] ).toMatchObject( {
			ticket_id: first.id,
			ticket_link: 'direct',
			needs_review: false,
		} );

		expect( signup.answers_ticket_id ).toBe( first.id );
		expect( signup.answers[ 0 ].answer_value ).toBe( 'Vegan' );
		expect( first.answers[ 0 ].answer_value ).toBe( 'Vegan' );
		expect( second.answers ).toEqual( [] );
		expect( third.answers ).toEqual( [] );
	} );

	test( 'a repeat purchase by the same participant keeps both answer sets', async () => {
		test.skip( ! active, 'fair-form or fair-audience not active' );

		const email = uniqueEmail( 'repeat' );
		const firstPurchase = await buy( email, 1, [
			dietQuestion( 'Vegan' ),
		] );
		const secondPurchase = await buy( email, 1, [
			dietQuestion( 'Vegetarian' ),
		] );
		expect( secondPurchase.participant_id ).toBe(
			firstPurchase.participant_id
		);

		const rows = ( await signups() ).filter( ( s ) => s.email === email );
		const byId = Object.fromEntries( rows.map( ( s ) => [ s.id, s ] ) );
		expect( byId[ firstPurchase.id ].answers[ 0 ].answer_value ).toBe(
			'Vegan'
		);
		expect( byId[ secondPurchase.id ].answers[ 0 ].answer_value ).toBe(
			'Vegetarian'
		);
		expect( byId[ firstPurchase.id ].answers_ticket_id ).toBe(
			firstPurchase.tickets[ 0 ].id
		);
		expect( byId[ secondPurchase.id ].answers_ticket_id ).toBe(
			secondPurchase.tickets[ 0 ].id
		);
	} );

	test( 'a standalone Fair Form submission gets no ticket', async () => {
		test.skip( ! active, 'fair-form or fair-audience not active' );

		const formId = `standalone-1609-${ Date.now() }`;
		const res = await anonymousPost(
			'/wp-json/fair-form/v1/fair-form-submit',
			{
				event_date_id: eventDateId,
				form_id: formId,
				form_title: 'Standalone Form',
				// An email keys the form's rate limit on it rather than on
				// the test runner's IP.
				questionnaire_answers: [
					{
						question_key: 'email',
						question_text: 'Email address',
						question_type: 'email',
						answer_value: uniqueEmail( 'standalone' ),
						display_order: 1,
					},
					dietQuestion( 'None' ),
				],
			}
		);
		expect( res.ok ).toBeTruthy();

		const standalone = (
			await (
				await api.get(
					'/wp-json/fair-form/v1/questionnaire-responses',
					{
						headers: adminHeaders,
						params: { event_date_id: eventDateId, form_id: formId },
					}
				)
			).json()
		)[ 0 ];
		expect( standalone ).toMatchObject( {
			ticket_id: null,
			ticket_link: null,
			needs_review: false,
		} );
	} );

	test( 'the ticket editor and participants list show answers with their ticket', async () => {
		test.skip( ! active, 'fair-form or fair-audience not active' );

		const signup = await buy( uniqueEmail( 'views' ), 2, [
			dietQuestion( 'Gluten-free' ),
		] );
		const [ first, second ] = signup.tickets;

		const ticketPath = ( id ) =>
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ id }`;
		const firstRes = await api.get( ticketPath( first.id ), {
			headers: adminHeaders,
		} );
		expect( firstRes.ok() ).toBeTruthy();
		const firstTicket = ( await firstRes.json() ).ticket;
		expect( firstTicket.answers[ 0 ].answer_value ).toBe( 'Gluten-free' );
		expect( firstTicket.answers_need_review ).toBe( false );

		const secondTicket = (
			await (
				await api.get( ticketPath( second.id ), {
					headers: adminHeaders,
				} )
			).json()
		).ticket;
		expect( secondTicket.answers ).toEqual( [] );

		const participants = await (
			await api.get(
				`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
				{ headers: adminHeaders }
			)
		).json();
		const participant = participants.find(
			( p ) =>
				Number( p.participant_id ) === Number( signup.participant_id )
		);
		const ticketAnswers = participant.tickets
			.filter( ( t ) => [ first.id, second.id ].includes( t.id ) )
			.map( ( t ) => t.answers.map( ( a ) => a.answer_value ) );
		expect( ticketAnswers ).toEqual( [ [ 'Gluten-free' ], [] ] );
		expect( participant.questionnaire_answers ).toEqual( [] );

		// Still admin-only.
		expect( ( await api.get( ticketPath( first.id ) ) ).status() ).toBe(
			401
		);
		expect(
			(
				await api.get( '/wp-json/fair-events/v1/get-tickets', {
					params: {
						event_date: eventDateId,
						include_answers: 'true',
					},
				} )
			).status()
		).toBe( 401 );
		expect(
			(
				await api.get(
					'/wp-json/fair-form/v1/questionnaire-responses',
					{
						params: { event_date_id: eventDateId },
					}
				)
			).status()
		).toBe( 401 );
	} );

	test( 'legacy submissions go to the earliest signup’s first ticket, flagged for review', async () => {
		test.skip( ! active, 'fair-form or fair-audience not active' );

		// Two purchases collected before answers named their ticket.
		const email = uniqueEmail( 'legacy' );
		const earliest = await buy( email, 2 );
		await buy( email, 1 );

		const legacyId = await seedLegacy( {
			participant_id: earliest.participant_id,
			answer: 'Legacy answer',
		} );
		// A participant with no signup on this date.
		const orphanId = await seedLegacy( {
			participant_id: 99999999,
			answer: 'Orphan answer',
		} );
		const standaloneId = await seedLegacy( {
			participant_id: earliest.participant_id,
			title: 'Fair Form',
			form_id: 'legacy-standalone',
			answer: 'Standalone answer',
		} );

		const result = await backfill( true );
		expect( result.done ).toBe( true );

		const byId = Object.fromEntries(
			( await state( [ legacyId, orphanId, standaloneId ] ) ).map(
				( s ) => [ s.id, s ]
			)
		);
		expect( byId[ legacyId ] ).toMatchObject( {
			ticket_id: earliest.tickets[ 0 ].id,
			ticket_link: 'inferred',
		} );
		expect( byId[ orphanId ] ).toMatchObject( {
			ticket_id: null,
			ticket_link: 'unresolved',
		} );
		expect( byId[ standaloneId ] ).toMatchObject( {
			ticket_id: null,
			ticket_link: null,
		} );

		const signup = ( await signups() ).find(
			( s ) => s.id === earliest.id
		);
		expect( signup.answers[ 0 ].answer_value ).toBe( 'Legacy answer' );
		expect( signup.answers_need_review ).toBe( true );
		expect( signup.tickets[ 0 ].answers_need_review ).toBe( true );

		// A rerun leaves every examined link as it is.
		await backfill( false );
		await backfill( true );
		expect( await state( [ legacyId, orphanId, standaloneId ] ) ).toEqual(
			Object.values( byId )
		);
	} );

	test( 'removing a linked ticket keeps its answers at participant scope, flagged', async () => {
		test.skip( ! active, 'fair-form or fair-audience not active' );

		const signup = await buy( uniqueEmail( 'removed' ), 2, [
			dietQuestion( 'Pescatarian' ),
		] );
		const [ first, second ] = signup.tickets;
		const submission = ( await submissionsByTicket() ).find(
			( s ) => s.ticket_id === first.id
		);

		// Reducing the quantity removes the second ticket; the first keeps
		// its answers.
		const reduceRes = await api.post(
			'/wp-json/fair-e2e/v1/submission-tickets/reduce',
			{
				headers: adminHeaders,
				data: { signup_id: signup.id, quantity: 1 },
			}
		);
		expect( reduceRes.ok() ).toBeTruthy();
		expect( ( await reduceRes.json() ).map( ( t ) => t.id ) ).toEqual( [
			String( first.id ),
		] );
		expect( ( await state( [ submission.id ] ) )[ 0 ] ).toMatchObject( {
			ticket_id: first.id,
			ticket_link: 'direct',
		} );
		expect( second.id ).not.toBe( first.id );

		// Deleting the signup removes the linked ticket.
		const deleteRes = await api.delete(
			`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
			{ headers: adminHeaders }
		);
		expect( deleteRes.ok() ).toBeTruthy();

		expect( ( await state( [ submission.id ] ) )[ 0 ] ).toMatchObject( {
			ticket_id: null,
			ticket_link: 'ticket_removed',
		} );
		const detail = await (
			await api.get(
				`/wp-json/fair-form/v1/questionnaire-responses/${ submission.id }`,
				{ headers: adminHeaders }
			)
		).json();
		expect( detail.answers[ 0 ].answer_value ).toBe( 'Pescatarian' );
		expect( detail.needs_review ).toBe( true );

		// The participant still sees the answers, now without a ticket.
		const participants = await (
			await api.get(
				`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
				{ headers: adminHeaders }
			)
		).json();
		const participant = participants.find(
			( p ) =>
				Number( p.participant_id ) === Number( signup.participant_id )
		);
		if ( participant ) {
			expect( participant.questionnaire_answers[ 0 ].answer_value ).toBe(
				'Pescatarian'
			);
			expect( participant.questionnaire_answers_need_review ).toBe(
				true
			);
		}
	} );
} );
