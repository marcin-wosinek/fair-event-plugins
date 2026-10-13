/**
 * E2E: a subscriber deleting their own data from the public
 * manage-subscription page (#1777).
 *
 * The page asks for confirmation in a dialog that names the profile and
 * says what is deleted and what is kept. Opening, cancelling or dismissing
 * it changes nothing; only a confirmed request carrying the proof issued
 * with the page deletes. Without scripting the same confirmation is a page.
 * Fixtures are created through the admin REST API and the test-only
 * `fair-e2e/v1/data-deletion` routes, and removed afterwards.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const FIXTURES_PATH = '/wp-json/fair-e2e/v1/data-deletion';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

function uniqueEmail( prefix ) {
	return `${ prefix }+${ Date.now() }-${ Math.floor(
		Math.random() * 1e6
	) }@example.test`;
}

const proofIn = ( html ) =>
	html.match( /name="delete_confirmation" value="([^"]+)"/ )?.[ 1 ];

test.describe( 'Manage-subscription page — delete my data', () => {
	let api;
	let visitor;
	const subscribers = [];

	async function createSubscriber( { withEmail = true } = {} ) {
		const email = withEmail ? uniqueEmail( 'delete-my-data' ) : '';
		const createRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Synthetic',
					surname: 'Subscriber',
					email,
					phone: '+34 600 000 000',
					instagram: 'synthetic_subscriber',
					email_profile: 'marketing',
				},
			}
		);
		expect( createRes.ok() ).toBeTruthy();
		const id = ( await createRes.json() ).id;

		const urlRes = await api.get(
			`/wp-json/fair-audience/v1/participants/${ id }/subscription-url`,
			{ headers: authHeaders }
		);
		expect( urlRes.ok() ).toBeTruthy();

		const relatedRes = await api.post(
			`${ FIXTURES_PATH }/related-records`,
			{
				headers: authHeaders,
				data: { participant_id: id, email },
			}
		);
		expect( relatedRes.ok() ).toBeTruthy();

		const subscriber = {
			id,
			email,
			url: ( await urlRes.json() ).url,
			...( await relatedRes.json() ),
		};
		subscribers.push( subscriber );
		return subscriber;
	}

	async function records( subscriber ) {
		const res = await api.get( `${ FIXTURES_PATH }/records`, {
			headers: authHeaders,
			params: {
				participant_id: subscriber.id,
				signup_id: subscriber.signup_id,
				ticket_id: subscriber.ticket_id,
			},
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function expectUntouched( subscriber ) {
		const stored = await records( subscriber );
		expect( stored.participant.name ).toBe( 'Synthetic' );
		expect( stored.participant.email ).toBe( subscriber.email );
		expect( stored.categories ).toBe( 1 );
		expect( Number( stored.signup.participant_id ) ).toBe( subscriber.id );
	}

	async function expectDeleted( subscriber ) {
		const stored = await records( subscriber );

		// Cleared on the profile.
		expect( stored.participant ).toMatchObject( {
			name: 'Deleted',
			surname: '',
			email: null,
			phone: '',
			instagram: '',
			email_profile: 'minimal',
			wp_user_id: null,
		} );
		expect( stored.categories ).toBe( 0 );

		// Kept, with the signup and ticket detached from the profile.
		expect( stored.attendance ).toBe( 1 );
		expect( stored.consent_log ).toBe( 1 );
		expect( stored.signup ).toMatchObject( {
			name: '',
			email: '',
			participant_id: null,
		} );
		expect( Number( stored.signup.mailing_opt_in ) ).toBe( 0 );
		expect( stored.ticket ).toEqual( {
			purchaser_participant_id: null,
			holder_participant_id: null,
		} );
	}

	async function setDeletionFails( enabled ) {
		const res = await api.post( `${ FIXTURES_PATH }/fail`, {
			headers: authHeaders,
			data: { enabled },
		} );
		expect( res.ok() ).toBeTruthy();
	}

	const openDialog = async ( page ) => {
		await page
			.locator( '.fair-audience-subscription-delete-button' )
			.click();
		const dialog = page.getByRole( 'dialog', { name: 'Delete My Data' } );
		await expect( dialog ).toBeVisible();
		return dialog;
	};

	// Deletion requests the page sends, as opposed to the page views.
	const trackPosts = ( page ) => {
		const posts = [];
		page.on( 'request', ( req ) => {
			if ( req.method() === 'POST' ) {
				posts.push( req.postData() );
			}
		} );
		return posts;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		visitor = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		await setDeletionFails( false );
	} );

	test.afterAll( async () => {
		for ( const subscriber of subscribers ) {
			await api.delete( `${ FIXTURES_PATH }/related-records`, {
				headers: authHeaders,
				params: {
					participant_id: subscriber.id,
					signup_id: subscriber.signup_id,
					ticket_id: subscriber.ticket_id,
				},
			} );
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ subscriber.id }`,
				{ headers: authHeaders }
			);
		}
		await api.dispose();
		await visitor.dispose();
	} );

	test( 'opening the dialog names the profile and the scope without deleting', async ( {
		page,
	} ) => {
		const subscriber = await createSubscriber();
		const posts = trackPosts( page );
		const nativeDialogs = [];
		page.on( 'dialog', ( nativeDialog ) => {
			nativeDialogs.push( nativeDialog.message() );
			nativeDialog.dismiss();
		} );

		await page.goto( subscriber.url );
		const dialog = await openDialog( page );

		await expect( dialog ).toContainText(
			`Delete the personal data stored for ${ subscriber.email }?`
		);
		await expect( dialog ).toContainText(
			'Your name, email address, phone number and Instagram handle are deleted from your profile.'
		);
		await expect( dialog ).toContainText(
			'Your event signups and tickets are kept, but are no longer connected to your profile.'
		);
		await expect( dialog ).toContainText(
			'your consent history and payment records are kept'
		);
		await expect( dialog ).toContainText( 'This cannot be undone.' );
		await expect(
			dialog.getByRole( 'button', { name: 'Cancel' } )
		).toBeFocused();

		expect( nativeDialogs ).toEqual( [] );
		expect( posts ).toEqual( [] );
		await expectUntouched( subscriber );
	} );

	test( 'Cancel and Escape close the dialog, return focus and delete nothing', async ( {
		page,
	} ) => {
		const subscriber = await createSubscriber();
		const posts = trackPosts( page );
		const trigger = page.locator(
			'.fair-audience-subscription-delete-button'
		);

		await page.goto( subscriber.url );

		let dialog = await openDialog( page );
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		await expect( trigger ).toBeFocused();

		dialog = await openDialog( page );
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		await expect( trigger ).toBeFocused();

		// Opened from the keyboard, focus stays among the dialog's two actions.
		await page.keyboard.press( 'Enter' );
		await expect( dialog ).toBeVisible();
		const cancel = dialog.getByRole( 'button', { name: 'Cancel' } );
		const confirm = dialog.getByRole( 'button', {
			name: 'Delete My Data',
		} );
		await expect( cancel ).toBeFocused();
		await page.keyboard.press( 'Tab' );
		await expect( confirm ).toBeFocused();
		await page.keyboard.press( 'Shift+Tab' );
		await expect( cancel ).toBeFocused();
		await page.keyboard.press( 'Escape' );
		await expect( trigger ).toBeFocused();

		expect( posts ).toEqual( [] );
		await expectUntouched( subscriber );
	} );

	test( 'the profile without an email is named neutrally', async ( {
		page,
	} ) => {
		const subscriber = await createSubscriber( { withEmail: false } );

		await page.goto( subscriber.url );
		const dialog = await openDialog( page );

		await expect( dialog ).toContainText(
			'Delete the personal data stored for this profile?'
		);
	} );

	test( 'confirming deletes once, however often it is activated', async ( {
		page,
	} ) => {
		const subscriber = await createSubscriber();
		const posts = trackPosts( page );

		// Hold the deletion response so a second activation has time to land.
		let release;
		const held = new Promise( ( resolve ) => {
			release = resolve;
		} );
		await page.route( '**/*manage_subscription=*', async ( route ) => {
			if ( route.request().method() === 'POST' ) {
				await held;
			}
			await route.continue();
		} );

		await page.goto( subscriber.url );
		const dialog = await openDialog( page );
		const confirm = dialog.locator(
			'.fair-audience-delete-confirmation-submit'
		);

		// The held response keeps the navigation pending, and locators wait
		// for navigations: read and poke the page directly meanwhile.
		await confirm.click( { noWaitAfter: true } );
		const whileSending = await page.evaluate( () => {
			const element = document.querySelector(
				'[data-fair-audience-delete-dialog]'
			);
			const submit = element.querySelector( 'button[type="submit"]' );
			const state = {
				submitDisabled: submit.disabled,
				submitLabel: submit.textContent.trim(),
				cancelDisabled: element.querySelector(
					'[data-fair-audience-delete-cancel]'
				).disabled,
			};

			// A second click, a keyboard submission and Escape.
			submit.click();
			element.querySelector( 'form' ).requestSubmit();
			element.dispatchEvent(
				new Event( 'cancel', { cancelable: true } )
			);

			return { ...state, open: element.open };
		} );
		expect( whileSending ).toEqual( {
			submitDisabled: true,
			submitLabel: 'Deleting…',
			cancelDisabled: true,
			open: true,
		} );

		release();

		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toContainText(
			'Your personal data has been deleted from your profile.'
		);
		expect( posts ).toHaveLength( 1 );
		await expect(
			page.locator( '.fair-audience-subscription-delete-button' )
		).toHaveCount( 0 );
		await expectDeleted( subscriber );

		// The outcome page is a plain view: reloading sends nothing again.
		await page.reload();
		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toBeVisible();
		expect( posts ).toHaveLength( 1 );
	} );

	test( 'a failed deletion is shown and can be retried', async ( {
		page,
	} ) => {
		const subscriber = await createSubscriber();

		await setDeletionFails( true );
		await page.goto( subscriber.url );
		let dialog = await openDialog( page );
		await dialog
			.locator( '.fair-audience-delete-confirmation-submit' )
			.click();

		await expect(
			page.locator( '.fair-audience-subscription-message.error' )
		).toContainText(
			'Your data could not be deleted and nothing was changed.'
		);
		await expectUntouched( subscriber );

		await setDeletionFails( false );
		dialog = await openDialog( page );
		await dialog
			.locator( '.fair-audience-delete-confirmation-submit' )
			.click();

		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toBeVisible();
		await expectDeleted( subscriber );
	} );

	test( 'without scripting the confirmation is a page of its own', async ( {
		browser,
	} ) => {
		const subscriber = await createSubscriber();
		const context = await browser.newContext( {
			javaScriptEnabled: false,
		} );
		const page = await context.newPage();

		await page.goto( subscriber.url );
		await page
			.locator( '.fair-audience-subscription-delete-button' )
			.click();

		const confirmation = page.locator(
			'.fair-audience-delete-confirmation'
		);
		await expect( confirmation ).toContainText(
			`Delete the personal data stored for ${ subscriber.email }?`
		);
		await expect( confirmation ).toContainText(
			'Your event signups and tickets are kept, but are no longer connected to your profile.'
		);
		await expect( confirmation ).toContainText( 'This cannot be undone.' );
		await expectUntouched( subscriber );

		// Cancel goes back to the preferences without deleting.
		await confirmation.getByRole( 'link', { name: 'Cancel' } ).click();
		await expect(
			page.locator( '.fair-audience-subscription-submit' )
		).toBeVisible();
		await expectUntouched( subscriber );

		await page
			.locator( '.fair-audience-subscription-delete-button' )
			.click();
		await page
			.locator( '.fair-audience-delete-confirmation-submit' )
			.click();

		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toBeVisible();
		await expectDeleted( subscriber );

		await context.close();
	} );

	test( 'requests without a valid link or confirmation proof delete nothing', async () => {
		const subscriber = await createSubscriber();
		const other = await createSubscriber();
		const proof = proofIn(
			await ( await visitor.get( subscriber.url ) ).text()
		);
		const otherProof = proofIn(
			await ( await visitor.get( other.url ) ).text()
		);
		expect( proof ).toBeTruthy();
		expect( otherProof ).toBeTruthy();

		const confirmed = ( url, form ) =>
			visitor.post( url, {
				form: { confirm_delete_my_data: '1', ...form },
				maxRedirects: 0,
			} );

		// A link that is not signed for this participant, even with a real proof.
		const token = new URL( subscriber.url ).searchParams.get(
			'manage_subscription'
		);
		const otherToken = new URL( other.url ).searchParams.get(
			'manage_subscription'
		);
		const [ , otherSignature ] = Buffer.from( otherToken, 'base64url' )
			.toString()
			.split( ':' );
		const forged = Buffer.from(
			`${ subscriber.id }:${ otherSignature }`
		).toString( 'base64url' );

		for ( const badToken of [ 'not-a-token', `${ token }x`, forged ] ) {
			const res = await confirmed(
				`/?manage_subscription=${ badToken }`,
				{
					delete_confirmation: proof,
				}
			);
			expect( await res.text() ).toContain( 'Invalid Link' );
		}

		// A valid link without a proof, with a made-up one, or with another
		// participant's.
		for ( const form of [
			{},
			{ delete_confirmation: '' },
			{ delete_confirmation: `${ Date.now() }.${ 'a'.repeat( 64 ) }` },
			{ delete_confirmation: otherProof },
		] ) {
			const res = await confirmed( subscriber.url, form );
			expect( res.status() ).toBe( 400 );
			expect( await res.text() ).toContain(
				'Your data was not deleted because the confirmation was missing or has expired.'
			);
		}

		// The first step alone only shows the confirmation.
		const opened = await visitor.post( subscriber.url, {
			form: { delete_my_data: '1' },
			maxRedirects: 0,
		} );
		expect( opened.status() ).toBe( 200 );

		await expectUntouched( subscriber );
		await expectUntouched( other );

		// The real request deletes; repeating it changes nothing further.
		const deleted = await confirmed( subscriber.url, {
			delete_confirmation: proof,
		} );
		expect( deleted.status() ).toBe( 303 );
		expect( deleted.headers().location ).toBe( subscriber.url );
		await expectDeleted( subscriber );

		// A failing write would surface as a 500 if the repeat reached it.
		await setDeletionFails( true );
		const repeated = await confirmed( subscriber.url, {
			delete_confirmation: proof,
		} );
		expect( repeated.status() ).toBe( 303 );
		await expectDeleted( subscriber );
		await expectUntouched( other );
	} );
} );
