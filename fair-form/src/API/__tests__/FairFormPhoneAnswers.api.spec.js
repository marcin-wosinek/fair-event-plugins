/**
 * Playwright API tests for phone-question normalization in
 * FairFormController::create_item() / QuestionnaireService::sanitize_answers()
 * (#1267): separators (spaces incl. NBSP, dots, parens, hyphens) are accepted
 * on submission and stripped before the answer is stored, while anything that
 * still fails the E.164-style rule after stripping is rejected.
 *
 * Every accept-case payload carries its own unique email answer so the
 * FairFormController rate limiter (3/hour, keyed on email when present) keys
 * per-submission instead of falling back to the shared IP key.
 *
 * When fair-audience is active, FairFormController opportunistically creates
 * a Participant from that email — but Participant::save() requires a
 * non-empty `name`, which the controller never supplies. Pre-creating each
 * accept case's participant via the admin API (name + email) sidesteps that
 * pre-existing gap so this spec stays focused on phone normalization; reject
 * cases never reach participant creation (sanitize_answers() fails first).
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

const phoneQuestion = ( value ) => ( {
	question_key: 'mobile',
	question_text: 'Mobile?',
	question_type: 'phone',
	answer_value: value,
	display_order: 1,
} );

// Every accepted variant below normalizes to this same canonical value.
const NORMALIZED = '+491701234567';

const ACCEPT_CASES = [
	'+491701234567',
	'+49 170 123 45 67',
	'+49-170-123-45-67',
	'+49.170.123.4567',
	'+49 (170) 1234567',
	'+49 170 123 45 67', // NBSP
	'+49 170 1234567', // narrow NBSP
];

const REJECT_CASES = [
	'49 170 1234567', // no leading +
	'+49 17a 1234', // letters
	'++49 1701234', // second +
	'+ - . ( )', // separator-only
	'+0491701234567', // leading zero
	'+491234', // 6 digits, below the 7-digit minimum
	'+4912345678901234567', // 16 digits, above the 15-digit maximum
];

test.describe( 'FairFormController — phone question normalization (#1267)', () => {
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
			data: { name: 'Phone Test', email },
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
		test( `normalizes ${ JSON.stringify(
			value
		) } to ${ NORMALIZED }`, async () => {
			const email = uniqueEmail( 'phone-accept' );
			await ensureParticipant( email );
			const res = await api.post(
				'/wp-json/fair-form/v1/fair-form-submit',
				{
					data: {
						post_id: postId,
						questionnaire_answers: [
							emailQuestion( email ),
							phoneQuestion( value ),
						],
					},
				}
			);
			expect( res.ok() ).toBeTruthy();

			const submission = await findSubmissionByEmail( email );
			expect( submission ).toBeTruthy();
			const phoneAnswer = submission.answers.find(
				( a ) => a.question_key === 'mobile'
			);
			expect( phoneAnswer.answer_value ).toBe( NORMALIZED );
		} );
	}

	for ( const value of REJECT_CASES ) {
		test( `rejects ${ JSON.stringify( value ) }`, async () => {
			const email = uniqueEmail( 'phone-reject' );
			const res = await api.post(
				'/wp-json/fair-form/v1/fair-form-submit',
				{
					data: {
						post_id: postId,
						questionnaire_answers: [
							emailQuestion( email ),
							phoneQuestion( value ),
						],
					},
				}
			);
			expect( res.status() ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'invalid_phone' );
		} );
	}
} );
