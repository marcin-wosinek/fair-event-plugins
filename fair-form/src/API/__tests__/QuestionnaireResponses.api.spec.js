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

test.describe( 'QuestionnaireResponsesController — source form and page (#1324)', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	const run = `${ Date.now() }-${ Math.floor( Math.random() * 1e6 ) }`;
	const pages = {};
	const submissionIds = [];

	async function createPage( status ) {
		const res = await api.post( '/wp-json/wp/v2/pages', {
			headers: adminHeaders,
			data: { title: `Source page ${ status } ${ run }`, status },
		} );
		expect( res.status() ).toBe( 201 );
		return ( await res.json() ).id;
	}

	// Submits one answer set and returns the new submission's ID, found by
	// the unique answer it carries.
	async function submit( key, fields ) {
		const marker = `source-${ key }-${ run }`;
		const res = await api.post( '/wp-json/fair-form/v1/fair-form-submit', {
			data: {
				...fields,
				questionnaire_answers: [
					{
						question_key: 'email',
						question_text: 'Email?',
						question_type: 'email',
						answer_value: `${ marker }@example.test`,
						display_order: 0,
					},
				],
			},
		} );
		expect( res.ok() ).toBeTruthy();

		const list = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses',
			{
				headers: adminHeaders,
				params: fields.post_id ? { post_id: fields.post_id } : {},
			}
		);
		expect( list.status() ).toBe( 200 );
		const match = ( await list.json() ).find( ( s ) =>
			s.answers.some(
				( a ) => a.answer_value === `${ marker }@example.test`
			)
		);
		expect( match ).toBeTruthy();
		submissionIds.push( match.id );
		return match.id;
	}

	async function getSubmission( id ) {
		const res = await api.get(
			`/wp-json/fair-form/v1/questionnaire-responses/${ id }`,
			{ headers: adminHeaders }
		);
		expect( res.status() ).toBe( 200 );
		return res.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		for ( const status of [ 'publish', 'draft', 'private' ] ) {
			pages[ status ] = await createPage( status );
		}

		pages.trash = await createPage( 'publish' );
		pages.deleted = await createPage( 'publish' );
	} );

	test.afterAll( async () => {
		for ( const id of submissionIds ) {
			await api.delete(
				`/wp-json/fair-form/v1/questionnaire-responses/${ id }`,
				{ headers: adminHeaders }
			);
		}
		for ( const id of Object.values( pages ) ) {
			await api.delete( `/wp-json/wp/v2/pages/${ id }`, {
				headers: adminHeaders,
				params: { force: true },
			} );
		}
		await api.dispose();
	} );

	test( 'a titled form on a published page carries its title and a permalink', async () => {
		const id = await submit( 'titled', {
			post_id: pages.publish,
			form_id: `ff-titled-${ run }`,
			form_title: 'Workshop feedback',
		} );
		const submission = await getSubmission( id );

		expect( submission.form_id ).toBe( `ff-titled-${ run }` );
		expect( submission.source_form_title ).toBe( 'Workshop feedback' );
		// Existing fields keep their meaning for current consumers.
		expect( submission.title ).toBe( 'Fair Form' );
		expect( submission.source_page ).toEqual( {
			id: pages.publish,
			label: `Source page publish ${ run }`,
			url: expect.stringMatching( /^https?:\/\// ),
		} );

		const all = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses/all',
			{ headers: adminHeaders }
		);
		const row = ( await all.json() ).find( ( s ) => s.id === id );
		expect( row.form_id ).toBe( `ff-titled-${ run }` );
		expect( row.source_form_title ).toBe( 'Workshop feedback' );
		expect( row.form_title ).toBe( 'Workshop feedback' );
	} );

	test( 'an untitled form reports its identifier and no title', async () => {
		const id = await submit( 'untitled', {
			post_id: pages.publish,
			form_id: `ff-untitled-${ run }`,
		} );
		const submission = await getSubmission( id );

		expect( submission.form_id ).toBe( `ff-untitled-${ run }` );
		expect( submission.source_form_title ).toBeNull();
	} );

	test( 'a legacy submission without form identity or page has explicit empty states', async () => {
		const id = await submit( 'legacy', {} );
		const submission = await getSubmission( id );

		expect( submission.form_id ).toBeNull();
		expect( submission.source_form_title ).toBeNull();
		expect( submission.source_page ).toBeNull();
	} );

	test( 'draft and private pages are named but not linked', async () => {
		for ( const status of [ 'draft', 'private' ] ) {
			const id = await submit( status, {
				post_id: pages[ status ],
				form_id: `ff-${ status }-${ run }`,
			} );
			const { source_page: page } = await getSubmission( id );

			expect( page ).toEqual( {
				id: pages[ status ],
				label: `Source page ${ status } ${ run }`,
				url: null,
			} );
		}
	} );

	test( 'trashed and deleted pages are not linked', async () => {
		const trashedId = await submit( 'trash', {
			post_id: pages.trash,
			form_id: `ff-trash-${ run }`,
		} );
		const deletedId = await submit( 'deleted', {
			post_id: pages.deleted,
			form_id: `ff-deleted-${ run }`,
		} );

		await api.delete( `/wp-json/wp/v2/pages/${ pages.trash }`, {
			headers: adminHeaders,
		} );
		const removed = await api.delete(
			`/wp-json/wp/v2/pages/${ pages.deleted }`,
			{ headers: adminHeaders, params: { force: true } }
		);
		expect( removed.status() ).toBe( 200 );

		const trashed = ( await getSubmission( trashedId ) ).source_page;
		expect( trashed.id ).toBe( pages.trash );
		expect( trashed.url ).toBeNull();

		expect( ( await getSubmission( deletedId ) ).source_page ).toEqual( {
			id: pages.deleted,
			label: `Post #${ pages.deleted }`,
			url: null,
		} );
	} );

	test( 'anonymous requests for a single submission are rejected', async () => {
		const res = await api.get(
			`/wp-json/fair-form/v1/questionnaire-responses/${ submissionIds[ 0 ] }`
		);
		expect( res.status() ).toBe( 401 );
	} );
} );
