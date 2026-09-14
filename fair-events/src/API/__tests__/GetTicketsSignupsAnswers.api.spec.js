/**
 * Playwright API tests for GetTicketsController's opt-in `include_answers`
 * param on the admin signups list (#1568): the Signups tab export popup's
 * Fair Form answer columns.
 *
 * Covers:
 *   - the admin route still requires authentication regardless of the param.
 *   - the response shape is unchanged when `include_answers` is absent.
 *   - answers are associated to the right participant's signup.
 *   - a signup with no participant_id gets an empty `answers` array.
 *   - a standalone-form submission (non-empty form_id) on the same event
 *     date is excluded from the match.
 *
 * Skips the fair-form-dependent cases gracefully when fair-form is not
 * active in the test environment (the last two tests run regardless).
 *
 * Anonymous requests (signups, form submissions) each use their own fresh
 * request context instead of the shared admin `api` context. fair-audience
 * recognizes a returning browser via a session cookie
 * (GroupSignupPricing::resolve_viewer_identity()) and links a same-session
 * signup to the already-known participant even under a different submitted
 * email — correct behavior for a real companion-ticket purchase, but it
 * would silently merge these tests' otherwise-independent signups onto one
 * shared participant if they reused a single cookie jar.
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

const emailQuestion = ( value ) => ( {
	question_key: 'email',
	question_text: 'Email address',
	question_type: 'email',
	answer_value: value,
	display_order: 0,
} );

const dietQuestion = ( value ) => ( {
	question_key: 'diet',
	question_text: 'Dietary needs?',
	question_type: 'short_text',
	answer_value: value,
	display_order: 1,
} );

/**
 * POST as an independent, cookie-isolated anonymous visitor.
 *
 * @param {string} path Request path.
 * @param {Object} data JSON body.
 * @return {Promise<{ok: boolean, status: number, json: Object}>}
 */
async function anonymousPost( path, data ) {
	const context = await request.newContext( { baseURL: BASE_URL } );
	const res = await context.post( path, { data } );
	const ok = res.ok();
	const status = res.status();
	const json = ok ? await res.json() : null;
	await context.dispose();
	return { ok, status, json };
}

test.describe( 'GetTicketsController — include_answers', () => {
	let api;
	let fairFormActive = false;
	let fairAudienceActive = false;
	let eventPostId;
	let eventDateId;

	async function getSignups( params = {} ) {
		return api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId, ...params },
		} );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const pluginsRes = await api.get( '/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		} );
		if ( pluginsRes.ok() ) {
			const plugins = await pluginsRes.json();
			fairFormActive = plugins.some(
				( p ) =>
					p.plugin?.includes( 'fair-form' ) && p.status === 'active'
			);
			fairAudienceActive = plugins.some(
				( p ) =>
					p.plugin?.includes( 'fair-audience' ) &&
					p.status === 'active'
			);
		}

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets include_answers test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets include_answers test ${ Date.now() }`,
				link_type: 'post',
				start_datetime: '2035-07-01 10:00:00',
				end_datetime: '2035-07-01 12:00:00',
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
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'requires authentication regardless of include_answers', async () => {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			params: { event_date: eventDateId, include_answers: 'true' },
		} );
		expect( res.status() ).toBe( 401 );
	} );

	test( 'response shape is unchanged when include_answers is absent', async () => {
		const email = uniqueEmail( 'shape' );
		const signup = await anonymousPost(
			'/wp-json/fair-events/v1/get-tickets',
			{
				event_date_id: eventDateId,
				name: 'Shape Tester',
				email,
				quantity: 1,
			}
		);
		expect( signup.ok ).toBeTruthy();

		const res = await getSignups();
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		const row = signups.find( ( s ) => s.email === email );
		expect( row ).toBeTruthy();
		expect( row ).not.toHaveProperty( 'answers' );
	} );

	test( 'answers are associated to the right participant’s signup', async () => {
		test.skip( ! fairFormActive, 'fair-form not active' );

		const emailA = uniqueEmail( 'assoc-a' );
		const emailB = uniqueEmail( 'assoc-b' );

		const signupA = await anonymousPost(
			'/wp-json/fair-events/v1/get-tickets',
			{
				event_date_id: eventDateId,
				name: 'Answers Tester A',
				email: emailA,
				quantity: 1,
				questionnaire_answers: [ dietQuestion( 'Vegetarian' ) ],
			}
		);
		expect( signupA.ok ).toBeTruthy();

		const signupB = await anonymousPost(
			'/wp-json/fair-events/v1/get-tickets',
			{
				event_date_id: eventDateId,
				name: 'Answers Tester B',
				email: emailB,
				quantity: 1,
				questionnaire_answers: [ dietQuestion( 'Vegan' ) ],
			}
		);
		expect( signupB.ok ).toBeTruthy();

		const res = await getSignups( { include_answers: 'true' } );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();

		const rowA = signups.find( ( s ) => s.email === emailA );
		const rowB = signups.find( ( s ) => s.email === emailB );
		expect( rowA ).toBeTruthy();
		expect( rowB ).toBeTruthy();

		expect(
			rowA.answers.find( ( a ) => a.question_key === 'diet' )
				?.answer_value
		).toBe( 'Vegetarian' );
		expect(
			rowB.answers.find( ( a ) => a.question_key === 'diet' )
				?.answer_value
		).toBe( 'Vegan' );
	} );

	test( 'a signup with no participant_id gets an empty answers array', async () => {
		test.skip( ! fairFormActive, 'fair-form not active' );
		test.skip(
			fairAudienceActive,
			'fair-audience active — signups always resolve a participant_id'
		);

		const email = uniqueEmail( 'no-participant' );
		const signup = await anonymousPost(
			'/wp-json/fair-events/v1/get-tickets',
			{
				event_date_id: eventDateId,
				name: 'No Participant Tester',
				email,
				quantity: 1,
				questionnaire_answers: [ dietQuestion( 'Vegetarian' ) ],
			}
		);
		expect( signup.ok ).toBeTruthy();

		const res = await getSignups( { include_answers: 'true' } );
		expect( res.ok() ).toBeTruthy();
		const row = ( await res.json() ).find( ( s ) => s.email === email );
		expect( row ).toBeTruthy();
		expect( row.answers ).toEqual( [] );
	} );

	test( 'a standalone-form submission on the same event date is excluded', async () => {
		test.skip( ! fairFormActive, 'fair-form not active' );
		test.skip(
			! fairAudienceActive,
			'fair-audience not active — cannot link submission and signup to the same participant'
		);

		const email = uniqueEmail( 'standalone' );

		// The signup itself carries no questionnaire answers.
		const signup = await anonymousPost(
			'/wp-json/fair-events/v1/get-tickets',
			{
				event_date_id: eventDateId,
				name: 'Standalone Form Tester',
				email,
				quantity: 1,
			}
		);
		expect( signup.ok ).toBeTruthy();

		// A standalone Fair Form submission for the same email/event date,
		// carrying a non-empty form_id — must not be picked up as the
		// signup's answers. Matched to the same participant purely by
		// submitted email, independent of the signup's own session.
		const form = await anonymousPost(
			'/wp-json/fair-form/v1/fair-form-submit',
			{
				event_date_id: eventDateId,
				form_id: 'standalone-form-1568',
				form_title: 'Standalone Form',
				questionnaire_answers: [
					emailQuestion( email ),
					dietQuestion( 'Should not appear' ),
				],
			}
		);
		expect( form.ok ).toBeTruthy();

		const res = await getSignups( { include_answers: 'true' } );
		expect( res.ok() ).toBeTruthy();
		const row = ( await res.json() ).find( ( s ) => s.email === email );
		expect( row ).toBeTruthy();
		expect( row.answers ).toEqual( [] );
	} );
} );
