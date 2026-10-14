/**
 * Playwright API tests for QuestionnaireResponsesController (#1774).
 *
 * The admin delete/edit dialogs identify a submission by its form, so both
 * list routes expose `title` and `form_title` (stored form title, legacy title
 * as fallback). Permissions are unchanged, and deleting a submission removes
 * only that submission — a repeated submission by the same participant stays.
 *
 * Each payload carries its own unique email answer so the FairFormController
 * rate limiter keys per-email instead of on the shared IP.
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

test.describe( 'QuestionnaireResponsesController — dialog identity and deletion (#1774)', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	const postId = Date.now();
	const formId = `api-spec-form-${ postId }`;
	const formTitle = 'API spec feedback form';
	const email = `responses-${ postId }-${ Math.floor(
		Math.random() * 1e6
	) }@example.test`;

	async function submit( answer ) {
		const res = await api.post( '/wp-json/fair-form/v1/fair-form-submit', {
			data: {
				post_id: postId,
				form_id: formId,
				form_title: formTitle,
				questionnaire_answers: [
					{
						question_key: 'email',
						question_text: 'Email?',
						question_type: 'email',
						answer_value: email,
						display_order: 0,
					},
					{
						question_key: 'note',
						question_text: 'Anything else?',
						question_type: 'short_text',
						answer_value: answer,
						display_order: 1,
					},
				],
			},
		} );
		expect( res.ok() ).toBeTruthy();
	}

	async function listForForm() {
		const res = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses',
			{ headers: adminHeaders, params: { form_id: formId } }
		);
		expect( res.status() ).toBe( 200 );
		return res.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await submit( 'first' );
		await submit( 'second' );
	} );

	test.afterAll( async () => {
		const remaining = await listForForm();
		for ( const submission of remaining ) {
			await api.delete(
				`/wp-json/fair-form/v1/questionnaire-responses/${ submission.id }`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'filtered list includes the stored form title and legacy title', async () => {
		const submissions = await listForForm();

		expect( submissions ).toHaveLength( 2 );
		for ( const submission of submissions ) {
			expect( submission.form_title ).toBe( formTitle );
			expect( submission.title ).toBe( 'Fair Form' );
		}
	} );

	test( '/all includes the form title for each submission', async () => {
		const res = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses/all',
			{ headers: adminHeaders }
		);
		expect( res.status() ).toBe( 200 );
		const ours = ( await res.json() ).filter(
			( s ) => s.post_id === postId || Number( s.post_id ) === postId
		);

		expect( ours ).toHaveLength( 2 );
		for ( const submission of ours ) {
			expect( submission.form_title ).toBe( formTitle );
		}
	} );

	test( 'anonymous requests are still rejected', async () => {
		const [ first ] = await listForForm();

		const list = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses',
			{ params: { form_id: formId } }
		);
		expect( list.status() ).toBe( 401 );

		const all = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses/all'
		);
		expect( all.status() ).toBe( 401 );

		const del = await api.delete(
			`/wp-json/fair-form/v1/questionnaire-responses/${ first.id }`
		);
		expect( del.status() ).toBe( 401 );
		expect( await listForForm() ).toHaveLength( 2 );
	} );

	test( 'deleting a submission keeps the repeated submission and its answers', async () => {
		const before = await listForForm();
		const target = before.find( ( s ) =>
			s.answers.some( ( a ) => a.answer_value === 'first' )
		);
		const sibling = before.find( ( s ) => s.id !== target.id );

		const res = await api.delete(
			`/wp-json/fair-form/v1/questionnaire-responses/${ target.id }`,
			{ headers: adminHeaders }
		);
		expect( res.status() ).toBe( 204 );

		const gone = await api.get(
			`/wp-json/fair-form/v1/questionnaire-responses/${ target.id }`,
			{ headers: adminHeaders }
		);
		expect( gone.status() ).toBe( 404 );

		const after = await listForForm();
		expect( after.map( ( s ) => s.id ) ).toEqual( [ sibling.id ] );
		expect( after[ 0 ].answers ).toEqual( sibling.answers );
		expect( after[ 0 ].participant_id ).toBe( sibling.participant_id );
		expect( after[ 0 ].participant_email ).toBe(
			sibling.participant_email
		);
	} );
} );
