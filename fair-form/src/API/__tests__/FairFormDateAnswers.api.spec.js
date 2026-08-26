/**
 * Playwright API tests for Date-question validation in
 * FairFormController::create_item() / QuestionnaireService::sanitize_answers()
 * (#1350): a well-formed `YYYY-MM-DD` value is accepted and stored unchanged,
 * an out-of-range or malformed value is rejected with the same error shape
 * used by other typed fields (e.g. `invalid_email`/`invalid_url`), and an
 * empty, non-required answer is accepted.
 *
 * Every accept-case payload carries its own unique email answer so the
 * FairFormController rate limiter (3/hour, keyed on email when present) keys
 * per-submission instead of falling back to the shared IP key.
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
	question_text: 'Email?',
	question_type: 'email',
	answer_value: value,
	display_order: 0,
} );

const dateQuestion = ( value ) => ( {
	question_key: 'visit_date',
	question_text: 'Preferred visit date?',
	question_type: 'date',
	answer_value: value,
	display_order: 1,
} );

const ACCEPT_CASES = [ '2026-09-01', '2000-02-29' ];

const REJECT_CASES = [ '2026-02-30', 'not-a-date', '2026/09/01' ];

test.describe( 'FairFormController — Date question validation (#1350)', () => {
	let api;
	let fairAudienceActive = false;
	const postId = Date.now();

	async function findSubmissionByEmail( email ) {
		const res = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses',
			{
				headers: adminHeaders,
				params: { post_id: postId, title: 'Fair Form' },
			}
		);
		expect( res.ok() ).toBeTruthy();
		const submissions = await res.json();
		return submissions.find( ( s ) =>
			s.answers.some( ( a ) => a.answer_value === email )
		);
	}

	async function ensureParticipant( email ) {
		if ( ! fairAudienceActive ) {
			return;
		}
		await api.post( '/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data: { name: 'Date Test', email },
		} );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const pluginsRes = await api.get( '/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		} );
		if ( pluginsRes.ok() ) {
			const plugins = await pluginsRes.json();
			fairAudienceActive = plugins.some(
				( p ) =>
					p.plugin?.includes( 'fair-audience' ) &&
					p.status === 'active'
			);
		}
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	for ( const value of ACCEPT_CASES ) {
		test( `accepts and stores ${ JSON.stringify( value ) }`, async () => {
			const email = uniqueEmail( 'date-accept' );
			await ensureParticipant( email );
			const res = await api.post(
				'/wp-json/fair-form/v1/fair-form-submit',
				{
					data: {
						post_id: postId,
						questionnaire_answers: [
							emailQuestion( email ),
							dateQuestion( value ),
						],
					},
				}
			);
			expect( res.ok() ).toBeTruthy();

			const submission = await findSubmissionByEmail( email );
			expect( submission ).toBeTruthy();
			const dateAnswer = submission.answers.find(
				( a ) => a.question_key === 'visit_date'
			);
			expect( dateAnswer.answer_value ).toBe( value );
		} );
	}

	test( 'accepts an empty, non-required date answer', async () => {
		const email = uniqueEmail( 'date-empty' );
		await ensureParticipant( email );
		const res = await api.post( '/wp-json/fair-form/v1/fair-form-submit', {
			data: {
				post_id: postId,
				questionnaire_answers: [
					emailQuestion( email ),
					dateQuestion( '' ),
				],
			},
		} );
		expect( res.ok() ).toBeTruthy();

		const submission = await findSubmissionByEmail( email );
		expect( submission ).toBeTruthy();
		const dateAnswer = submission.answers.find(
			( a ) => a.question_key === 'visit_date'
		);
		expect( dateAnswer.answer_value ).toBe( '' );
	} );

	for ( const value of REJECT_CASES ) {
		test( `rejects ${ JSON.stringify( value ) }`, async () => {
			const email = uniqueEmail( 'date-reject' );
			const res = await api.post(
				'/wp-json/fair-form/v1/fair-form-submit',
				{
					data: {
						post_id: postId,
						questionnaire_answers: [
							emailQuestion( email ),
							dateQuestion( value ),
						],
					},
				}
			);
			expect( res.status() ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'invalid_date' );
		} );
	}
} );
