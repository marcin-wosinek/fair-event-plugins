import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * E2E: the Payment history page (#2139, stage 3 of #2111). After the
 * migration ran over synthetic history, an administrator splits a shared
 * payment between two purchases, removes one of those links again, and,
 * on a phone-sized screen, marks an orphaned payment as reviewed. Every
 * decision names the payment and purchases, needs a note, and is
 * confirmed next to what it changed.
 *
 * The history comes from the payment-history-backfill.php fixture shared
 * with PaymentHistoryBackfill.api.spec.js: T13b is a €24 payment for two
 * sessions recorded as one line (example 21), T10 a €15 payment naming a
 * purchase that no longer exists (example 14).
 */

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASSWORD || 'password';
const PAGE = '/wp-admin/admin.php?page=fair-events-payment-history';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ WP_ADMIN_USER }:${ WP_ADMIN_PASS }` ).toString(
			'base64'
		),
};

async function backfill( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/payment-history-backfill.php',
			action,
			JSON.stringify( data ),
		],
		{
			cwd: new URL( '../../', import.meta.url ),
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
		}
	);
	const match = stdout.match( /E2E_PAYMENT_BACKFILL:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_PAYMENT_BACKFILL output, got:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

// The visible notice only: its text is mirrored in a screen-reader region.
const notice = ( scope, text ) =>
	scope.locator( '.components-notice' ).filter( { hasText: text } );

async function choosePurchase( dialog, label, signupId ) {
	const combobox = dialog.getByRole( 'combobox', { name: label } );
	await combobox.click();
	await combobox.fill( String( signupId ) );
	await dialog
		.getByRole( 'option', {
			name: new RegExp( `Purchase #${ signupId } —` ),
		} )
		.click();
}

test.describe.serial( 'Payment history reconciliation', () => {
	test.setTimeout( 300_000 );

	let api;
	let eventId;
	const dates = {};
	let seed;
	let purchases;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const title = `Reconcile ${ Date.now() }`;
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( post.ok() ).toBeTruthy();
		eventId = ( await post.json() ).id;

		for ( const [ letter, day ] of [
			[ 'A', '10' ],
			[ 'B', '11' ],
			[ 'C', '12' ],
		] ) {
			const date = await api.post(
				'/wp-json/fair-events/v1/event-dates',
				{
					headers: adminHeaders,
					data: {
						title: `${ title } ${ letter }`,
						link_type: 'post',
						start_date: `2036-02-${ day }`,
						start_time: '19:00:00',
						end_date: `2036-02-${ day }`,
						end_time: '21:00:00',
					},
				}
			);
			const body = await date.json();
			expect( date.ok(), JSON.stringify( body ) ).toBeTruthy();
			dates[ letter ] = body.id;
		}

		seed = await backfill( 'seed', {
			eventId,
			dateA: dates.A,
			dateB: dates.B,
			dateC: dates.C,
		} );
		expect( seed.blockers ).toEqual( [] );
		await backfill( 'dry-run' );
		await backfill( 'start', { backupConfirmed: true } );
		expect(
			( await backfill( 'run', { batchSize: 50 } ) ).run.last_error
		).toBeNull();

		const current = await backfill( 'state', {
			relationshipIds: [
				seed.relationships.R21A,
				seed.relationships.R21B,
			],
		} );
		purchases = {
			a: Number( current.purchases[ seed.relationships.R21A ][ 0 ].id ),
			b: Number( current.purchases[ seed.relationships.R21B ][ 0 ].id ),
		};
	} );

	test.afterAll( async () => {
		if ( seed ) {
			await backfill( 'cleanup', { seed } );
		}
		for ( const id of Object.values( dates ) ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( eventId ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: adminHeaders,
				params: { force: true },
			} );
		}
		await api?.dispose();
	} );

	test( 'filters records by an expired payment and test/live mode (#2219)', async ( {
		page,
	} ) => {
		const t10 = seed.transactions.T10;
		const { previous } = await backfill( 'set-transactions', {
			transactions: { [ t10 ]: { status: 'expired' } },
		} );
		try {
			await login( page );
			await page.goto( PAGE );
			const expiry = page.getByLabel( 'Expired transaction', {
				exact: true,
			} );
			const paymentMode = page.getByLabel( 'Payment mode', {
				exact: true,
			} );
			await expect( expiry ).toHaveValue( 'all' );
			await expect( paymentMode ).toHaveValue( 'all' );
			const count = page.getByText( /^\d+ records?$/ );
			await expect( count ).toBeVisible();
			const unfiltered = await count.textContent();
			const t10Button = page.getByRole( 'button', {
				name: `Open Payment without a purchase — Payment #${ t10 }, 15.00 EUR`,
			} );

			await expiry.selectOption( 'expired' );
			await expect( t10Button ).toBeVisible();
			await expect( count ).toHaveText( '1 record' );

			// Every seeded payment is a test one: nothing is live.
			await paymentMode.selectOption( 'live' );
			await expect(
				page.getByText( 'No records match these filters.' )
			).toBeVisible();
			await expect( t10Button ).toHaveCount( 0 );

			await page.getByRole( 'button', { name: 'Clear filters' } ).click();
			await expect( expiry ).toHaveValue( 'all' );
			await expect( paymentMode ).toHaveValue( 'all' );
			await expect( count ).toHaveText( unfiltered );
			await expect(
				page.getByText( 'No records match these filters.' )
			).toHaveCount( 0 );
		} finally {
			await backfill( 'set-transactions', { transactions: previous } );
		}
	} );

	test( 'splits a shared payment, then removes one of its links', async ( {
		page,
	} ) => {
		await login( page );
		await page.goto( PAGE );
		await expect(
			page.getByRole( 'heading', { name: 'Payment history', level: 1 } )
		).toBeVisible();
		await expect(
			page.getByRole( 'heading', { name: 'Records to review' } )
		).toBeVisible();

		await page
			.getByLabel( 'Event', { exact: true } )
			.selectOption( String( dates.A ) );
		await page
			.getByLabel( 'Reason', { exact: true } )
			.selectOption( 'allocation_mismatch' );
		const t13b = seed.transactions.T13b;
		await page
			.getByRole( 'button', {
				name: `Open Shared payment doesn’t add up — Payment #${ t13b }, 24.00 EUR`,
			} )
			.click();

		const dialog = page.getByRole( 'dialog', {
			name: 'Review record — Shared payment doesn’t add up',
		} );
		await expect( dialog ).toContainText( `#${ t13b } — 24.00 EUR, Paid` );
		await expect( dialog ).toContainText(
			'Linked: 0.00 EUR of 24.00 EUR. Left: 24.00 EUR.'
		);

		await choosePurchase( dialog, 'Purchase 1', purchases.a );
		await dialog.getByLabel( 'Amount (EUR)' ).first().fill( '12' );
		await dialog
			.getByRole( 'button', { name: 'Add another purchase' } )
			.click();
		await choosePurchase( dialog, 'Purchase 2', purchases.b );
		await dialog.getByLabel( 'Amount (EUR)' ).nth( 1 ).fill( '13' );

		// Too much for the payment: the reason is shown and linking waits.
		await expect( dialog ).toContainText(
			'The amounts add up to 25.00 EUR, more than the 24.00 EUR left on this payment.'
		);
		const linkButton = dialog.getByRole( 'button', {
			name: 'Link payment',
		} );
		await expect( linkButton ).toHaveAttribute( 'aria-disabled', 'true' );

		await dialog.getByLabel( 'Amount (EUR)' ).nth( 1 ).fill( '12' );
		await dialog
			.getByLabel( 'Note for the audit log (required)' )
			.fill(
				'One line for two sessions; the organizer confirmed half each.'
			);
		await linkButton.click();

		await expect( dialog ).toBeHidden();
		await expect(
			notice( page, `Payment #${ t13b } was linked.` )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', {
				name: new RegExp( `Payment #${ t13b }, ` ),
			} )
		).toHaveCount( 0 );

		// Decided records stay visible under their own filter.
		await page
			.getByLabel( 'Status', { exact: true } )
			.selectOption( 'decided' );
		await page
			.getByRole( 'button', {
				name: `Open Shared payment doesn’t add up — Payment #${ t13b }, 24.00 EUR`,
			} )
			.click();
		await expect( dialog ).toContainText(
			'Linked: 24.00 EUR of 24.00 EUR. Left: 0.00 EUR.'
		);
		await expect( dialog ).toContainText(
			'One line for two sessions; the organizer confirmed half each.'
		);

		await dialog
			.getByRole( 'button', { name: 'Remove link' } )
			.first()
			.click();
		await expect(
			dialog.getByRole( 'heading', {
				name: new RegExp(
					`Remove the link to Purchase #${ purchases.a } —`
				),
			} )
		).toBeVisible();
		await expect( dialog ).toContainText(
			`12.00 EUR of payment #${ t13b } will no longer count for this purchase. The payment itself isn’t changed or refunded.`
		);
		await dialog
			.getByLabel( 'Why are you removing it? (required)' )
			.fill( 'Ana’s half was assigned by mistake.' );
		await dialog
			.getByRole( 'button', { name: 'Remove link' } )
			.last()
			.click();

		await expect( notice( dialog, /was removed\.$/ ) ).toBeVisible();
		await expect( dialog ).toContainText(
			'Linked: 12.00 EUR of 24.00 EUR. Left: 12.00 EUR.'
		);
		await expect(
			dialog.getByRole( 'button', { name: 'Remove link' } )
		).toHaveCount( 1 );
	} );

	test( 'on a phone, marks an orphaned payment as reviewed', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 375, height: 812 } );
		await login( page );
		await page.goto( PAGE );

		await page
			.getByLabel( 'Event', { exact: true } )
			.selectOption( String( dates.A ) );
		await page
			.getByLabel( 'Reason', { exact: true } )
			.selectOption( 'no_evidence' );
		const t10 = seed.transactions.T10;
		await page
			.getByRole( 'button', {
				name: `Open Payment without a purchase — Payment #${ t10 }, 15.00 EUR`,
			} )
			.click();

		const dialog = page.getByRole( 'dialog', {
			name: 'Review record — Payment without a purchase',
		} );
		await expect( dialog ).toContainText( `purchases #999999999` );

		// Nothing in the dialog is wider than the screen.
		const overflow = await page.evaluate( () => {
			const content = document.querySelector(
				'.fair-events-payment-history__modal .components-modal__content'
			);
			return content.scrollWidth - content.clientWidth;
		} );
		expect( overflow ).toBeLessThanOrEqual( 0 );

		const review = dialog.getByRole( 'button', {
			name: 'Mark as reviewed, no link',
		} );
		await expect( review ).toHaveAttribute( 'aria-disabled', 'true' );
		await dialog
			.getByLabel( 'Note for the audit log (required)' )
			.fill( 'A test payment made while setting up Mollie.' );
		await review.click();

		await expect( dialog ).toBeHidden();
		await expect(
			notice(
				page,
				'“Payment without a purchase” was marked as reviewed. It won’t be reported again.'
			)
		).toBeVisible();
	} );
} );
