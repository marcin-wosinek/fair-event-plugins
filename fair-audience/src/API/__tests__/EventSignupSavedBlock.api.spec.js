/**
 * Playwright API tests for content saved with the removed
 * fair-audience/event-signup block (#1701).
 *
 * The block's editor, frontend script, styles and form are gone. Its name is
 * still registered as a render-only alias, so a published page that names it
 * shows the fair-events Event Signup form instead of nothing. Rendering goes
 * through a test-only route (fair-e2e-event-signup.php) that runs the stored
 * markup the way an event page would, and can take the fair-events block
 * away for one request to show what a site without it gets.
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

const QUESTIONS = [
	'<!-- wp:fair-audience/fair-form-short-text {"questionKey":"first_question","questionText":"First question"} /-->',
	'<!-- wp:fair-audience/fair-form-conditional {"conditionQuestionKey":"first_question","conditionOperator":"equals","conditionValue":"yes"} -->',
	'<!-- wp:fair-audience/fair-form-short-text {"questionKey":"second_question","questionText":"Second question"} /-->',
	'<!-- /wp:fair-audience/fair-form-conditional -->',
	'<!-- wp:fair-audience/fair-form-long-text {"questionKey":"third_question","questionText":"Third question"} /-->',
].join( '\n' );

function savedBlock( attributes, inner ) {
	const attrs = attributes ? ` ${ JSON.stringify( attributes ) }` : '';
	return inner
		? `<!-- wp:fair-audience/event-signup${ attrs } -->\n${ inner }\n<!-- /wp:fair-audience/event-signup -->`
		: `<!-- wp:fair-audience/event-signup${ attrs } /-->`;
}

function submitLabel( html ) {
	const match = html.match(
		/<button type="submit"[^>]*>([\s\S]*?)<\/button>/
	);
	return match ? match[ 1 ].trim() : null;
}

test.describe( 'Content saved with the removed fair-audience signup block', () => {
	let api;
	let eventId;

	async function render( content, options = {} ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/event-signup/render',
			{
				headers: authHeaders,
				data: { post_id: eventId, content, ...options },
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const res = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: authHeaders,
			data: {
				title: `Saved Signup Block ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		eventId = ( await res.json() ).id;
	} );

	test.afterAll( async () => {
		if ( eventId ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: authHeaders,
				params: { force: 'true' },
			} );
		}
		await api.dispose();
	} );

	test( 'the alias cannot be inserted and carries no editor, script or style', async () => {
		const { alias } = await render( savedBlock() );
		expect( alias ).toBeTruthy();
		expect( alias.inserter ).toBe( false );
		expect( alias.editor_scripts ).toEqual( [] );
		expect( alias.view_scripts ).toEqual( [] );
		expect( alias.scripts ).toEqual( [] );
		expect( alias.styles ).toEqual( [] );
		expect( alias.editor_styles ).toEqual( [] );
	} );

	test( 'renders the Event Signup form with the old default button text', async () => {
		const { html } = await render( savedBlock() );
		expect( html ).toContain( 'wp-block-fair-events-event-signup' );
		expect( html ).toContain( 'fair-events-get-tickets-form' );
		expect( html ).not.toContain( 'wp:fair-audience' );
		expect( submitLabel( html ) ).toBe( 'Sign Up' );
	} );

	test( 'carries customized button text over', async () => {
		const { html } = await render(
			savedBlock( { signupButtonText: 'Join the retreat' } )
		);
		expect( submitLabel( html ) ).toBe( 'Join the retreat' );
	} );

	test( 'keeps nested questions, including a conditional section, in their saved order', async () => {
		const { html } = await render(
			savedBlock( { signupButtonText: 'Join' }, QUESTIONS )
		);
		const positions = [
			'data-question-key="first_question"',
			'data-fair-form-conditional',
			'data-question-key="second_question"',
			'data-question-key="third_question"',
			'<button type="submit"',
		].map( ( needle ) => html.indexOf( needle ) );

		expect( positions.every( ( position ) => position > -1 ) ).toBe( true );
		expect( [ ...positions ].sort( ( a, b ) => a - b ) ).toEqual(
			positions
		);
		expect( submitLabel( html ) ).toBe( 'Join' );
	} );

	test( 'a form with a file-upload question shows an unavailable message, never an upload', async () => {
		for ( const upload of [
			'<!-- wp:fair-audience/fair-form-file-upload {"questionKey":"cv","questionText":"Your CV"} /-->',
			// Nested in a conditional section.
			[
				'<!-- wp:fair-audience/fair-form-conditional {"conditionQuestionKey":"first_question","conditionValue":"yes"} -->',
				'<!-- wp:fair-audience/fair-form-file-upload {"questionKey":"cv","questionText":"Your CV"} /-->',
				'<!-- /wp:fair-audience/fair-form-conditional -->',
			].join( '\n' ),
		] ) {
			const { html } = await render(
				savedBlock( null, `${ QUESTIONS }\n${ upload }` )
			);
			expect( html ).toContain(
				'This form is temporarily unavailable. Please contact the organizer.'
			);
			expect( html ).not.toContain( 'type="file"' );
			expect( html ).not.toContain( '<form' );
			expect( html ).not.toContain( 'first_question' );
			expect( html ).not.toContain( 'wp:fair-audience' );
		}
	} );

	test( 'renders nothing when the fair-events Event Signup block is not available', async () => {
		for ( const content of [
			savedBlock(),
			savedBlock( { signupButtonText: 'Join' }, QUESTIONS ),
		] ) {
			const { html } = await render( content, {
				without_unified: true,
			} );
			expect( html.trim() ).toBe( '' );
		}
	} );
} );
