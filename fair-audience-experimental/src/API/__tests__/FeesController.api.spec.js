/**
 * Playwright API tests for the per-member payment reminder (#1770):
 *   POST /fair-audience/v1/fees/{id}/payments/{pid}/send-reminder
 *
 * Covers who may send, which payments can be reminded (pending only, checked
 * when the request is handled), the recipient checks, a mail failure, and
 * what a successful send records: one message to that member alone, the
 * payment's reminder date, and a `reminder_sent` audit entry by the organizer.
 *
 * Fixtures (a group, its members, and two fees) are created through the admin
 * REST API and torn down at the end of the suite. Outgoing mail is captured by
 * e2e/mu-plugins/fair-e2e-support.php into a log shared by every request,
 * including WP-Cron runs that deliver earlier specs' deferred mail (#2441).
 * Each reminder request here therefore carries its own capture token, and
 * e2e/mu-plugins/fair-e2e-fee-reminders.php records the mail attempted while
 * that request is handled. Its routes also put unrelated mail in the shared
 * log, make delivery to one address fail, and store an address the
 * participant routes would reject.
 *
 * Not covered here: a send that succeeds while recording it fails, which needs
 * a database fault this harness cannot inject.
 */

import { randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

function basicAuth( user, password ) {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
	};
}

const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

function uniqueEmail( prefix ) {
	return `${ prefix }+${ Date.now() }-${ Math.floor(
		Math.random() * 1e6
	) }@example.test`;
}

const MAIL_CAPTURE_HEADER = 'X-Fair-E2E-Mail-Capture';

/** The mail captured for one request held nothing. */
function expectNoMail( mail ) {
	expect( mail ).toEqual( [] );
}

/** The mail captured for one request is a single reminder to `email` alone. */
function expectOneReminderTo( mail, email ) {
	expect( mail ).toHaveLength( 1 );
	expect( mail[ 0 ].to ).toEqual( [ email ] );
	expect( mail[ 0 ].cc ).toEqual( [] );
	expect( mail[ 0 ].bcc ).toEqual( [] );
	expect( mail[ 0 ].subject ).toContain( 'Payment reminder' );
}

test.describe( 'FeesController: send a payment reminder to one member', () => {
	let api;
	let groupId;
	let feeId;
	let otherFeeId;
	const members = {};
	const payments = {};
	let otherFeePaymentId;

	const adminPost = async ( path, data ) => {
		const res = await api.post( `/wp-json${ path }`, {
			headers: adminHeaders,
			data,
		} );
		expect( res.ok(), `${ path }: ${ await res.text() }` ).toBeTruthy();
		return res.json();
	};

	const adminGet = async ( path ) => {
		const res = await api.get( `/wp-json${ path }`, {
			headers: adminHeaders,
		} );
		expect( res.ok(), `${ path }: ${ await res.text() }` ).toBeTruthy();
		return res.json();
	};

	// Tokens whose capture may still be stored, removed in afterAll.
	const captureTokens = new Set();

	/**
	 * Make one request with its own mail capture, and return the response
	 * with the mail attempted while it was handled. A capture that was never
	 * recorded fails the test rather than reading as "no mail".
	 */
	const withMailCapture = async ( send ) => {
		const token = randomUUID();
		captureTokens.add( token );
		const res = await send( { [ MAIL_CAPTURE_HEADER ]: token } );
		const result = { status: res.status(), body: await res.json() };

		const capture = await api.get(
			`/wp-json/fair-e2e/v1/fee-reminders/mail-capture/${ token }`,
			{ headers: adminHeaders }
		);
		expect(
			capture.status(),
			`mail capture: ${ await capture.text() }`
		).toBe( 200 );
		result.mail = ( await capture.json() ).mail;

		const removed = await api.delete(
			`/wp-json/fair-e2e/v1/fee-reminders/mail-capture/${ token }`,
			{ headers: adminHeaders }
		);
		expect( removed.ok() ).toBeTruthy();
		captureTokens.delete( token );

		return result;
	};

	const sendReminder = (
		paymentId,
		{ fee = feeId, headers = adminHeaders } = {}
	) =>
		withMailCapture( ( captureHeader ) =>
			api.post(
				`/wp-json/fair-audience/v1/fees/${ fee }/payments/${ paymentId }/send-reminder`,
				{ headers: { ...headers, ...captureHeader } }
			)
		);

	/**
	 * Send one message per address through wp_mail(), outside any reminder:
	 * into the shared log only, or captured when `captured` is set.
	 */
	const probeMail = ( to, { captured = false } = {} ) => {
		const data = { to, subject: 'Payment reminder (mail probe)' };
		if ( ! captured ) {
			return adminPost( '/fair-e2e/v1/fee-reminders/mail-probe', data );
		}
		return withMailCapture( ( captureHeader ) =>
			api.post( '/wp-json/fair-e2e/v1/fee-reminders/mail-probe', {
				headers: { ...adminHeaders, ...captureHeader },
				data,
			} )
		);
	};

	/**
	 * Put mail that no reminder sent into the shared log, addressed to a
	 * stranger and to each given member, and return the stranger's address.
	 */
	const seedUnrelatedMail = async ( ...memberEmails ) => {
		const stranger = uniqueEmail( 'reminder-unrelated' );
		await probeMail( [ stranger, ...memberEmails ] );
		return stranger;
	};

	const paymentRow = async ( paymentId ) => {
		const rows = await adminGet(
			`/fair-audience/v1/fees/${ feeId }/payments`
		);
		return rows.find( ( row ) => Number( row.id ) === paymentId );
	};

	const reminderLogEntries = async ( paymentId ) => {
		const entries = await adminGet(
			`/fair-audience/v1/fees/${ feeId }/payments/${ paymentId }/audit-log`
		);
		return entries.filter( ( entry ) => entry.action === 'reminder_sent' );
	};

	/** Mail to one address in the shared log, from any request. */
	const sharedMailTo = async ( email ) => {
		const res = await api.get( '/wp-json/fair-e2e/v1/fee-reminders/mail', {
			headers: adminHeaders,
			params: { to: email },
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	const failMailTo = async ( email ) => {
		await adminPost( '/fair-e2e/v1/fee-reminders/mail-failure', { email } );
	};

	/** Nothing was recorded on the payment and nobody was written to. */
	const expectNothingSent = async ( paymentId ) => {
		expect( ( await paymentRow( paymentId ) ).reminder_sent_at ).toBeNull();
		expect( await reminderLogEntries( paymentId ) ).toHaveLength( 0 );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const group = await adminPost( '/fair-audience/v1/groups', {
			name: `Fee Reminder Members ${ Date.now() }`,
		} );
		groupId = group.id;

		// `noEmail` is created without an address; `invalidEmail` gets a
		// malformed one written straight to the table further down.
		const roster = {
			target: uniqueEmail( 'reminder-target' ),
			bystander: uniqueEmail( 'reminder-bystander' ),
			paid: uniqueEmail( 'reminder-paid' ),
			canceled: uniqueEmail( 'reminder-canceled' ),
			noEmail: '',
			invalidEmail: uniqueEmail( 'reminder-invalid' ),
			removed: uniqueEmail( 'reminder-removed' ),
			undeliverable: uniqueEmail( 'reminder-undeliverable' ),
		};

		for ( const [ key, email ] of Object.entries( roster ) ) {
			const participant = await adminPost(
				'/fair-audience/v1/participants',
				{
					name: `Reminder ${ key }`,
					surname: 'Member',
					email,
					email_profile: 'minimal',
				}
			);
			members[ key ] = { id: participant.id, email };
			await adminPost(
				`/fair-audience/v1/groups/${ groupId }/participants`,
				{ participant_id: participant.id }
			);
		}

		feeId = (
			await adminPost( '/fair-audience/v1/fees', {
				name: `Reminder Fee ${ Date.now() }`,
				group_id: groupId,
				amount: 25,
			} )
		).id;
		otherFeeId = (
			await adminPost( '/fair-audience/v1/fees', {
				name: `Other Reminder Fee ${ Date.now() }`,
				group_id: groupId,
				amount: 10,
			} )
		).id;

		const rows = await adminGet(
			`/fair-audience/v1/fees/${ feeId }/payments`
		);
		for ( const [ key, member ] of Object.entries( members ) ) {
			payments[ key ] = Number(
				rows.find(
					( row ) => Number( row.participant_id ) === member.id
				).id
			);
		}
		otherFeePaymentId = Number(
			(
				await adminGet(
					`/fair-audience/v1/fees/${ otherFeeId }/payments`
				)
			)[ 0 ].id
		);

		await adminPost(
			`/fair-audience/v1/fees/${ feeId }/payments/${ payments.paid }/mark-paid`
		);
		await adminPost(
			`/fair-audience/v1/fees/${ feeId }/payments/${ payments.canceled }/cancel`
		);
		await adminPost( '/fair-e2e/v1/fee-reminders/participant-email', {
			participant_id: members.invalidEmail.id,
			email: 'not-an-address',
		} );

		// Leaves the payment behind without its member.
		const removed = await api.delete(
			`/wp-json/fair-audience/v1/participants/${ members.removed.id }`,
			{ headers: adminHeaders }
		);
		expect( removed.ok() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		await failMailTo( '' );
		for ( const token of captureTokens ) {
			await api.delete(
				`/wp-json/fair-e2e/v1/fee-reminders/mail-capture/${ token }`,
				{ headers: adminHeaders }
			);
		}
		for ( const id of [ feeId, otherFeeId ] ) {
			if ( id ) {
				await api.delete( `/wp-json/fair-audience/v1/fees/${ id }`, {
					headers: adminHeaders,
				} );
			}
		}
		for ( const member of Object.values( members ) ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ member.id }`,
				{ headers: adminHeaders }
			);
		}
		if ( groupId ) {
			await api.delete( `/wp-json/fair-audience/v1/groups/${ groupId }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'only an administrator can send a reminder', async () => {
		const anonymous = await sendReminder( payments.target, {
			headers: {},
		} );
		expect( anonymous.status ).toBe( 401 );
		expectNoMail( anonymous.mail );

		const username = `fee-reminder-subscriber-${ Date.now() }`;
		const password = 'Fee-reminder-test-1770!';
		const user = await adminPost( '/wp/v2/users', {
			username,
			password,
			email: `${ username }@example.test`,
			roles: [ 'subscriber' ],
		} );
		const forbidden = await sendReminder( payments.target, {
			headers: basicAuth( username, password ),
		} );
		await api.delete(
			`/wp-json/wp/v2/users/${ user.id }?force=true&reassign=1`,
			{ headers: adminHeaders }
		);
		expect( forbidden.status ).toBe( 403 );
		expectNoMail( forbidden.mail );

		await expectNothingSent( payments.target );
	} );

	test( 'a missing fee, a missing payment, and a payment of another fee are not found', async () => {
		const missingFee = await sendReminder( payments.target, {
			fee: 999999999,
		} );
		expect( missingFee.status ).toBe( 404 );
		expect( missingFee.body.code ).toBe( 'fee_not_found' );
		expectNoMail( missingFee.mail );

		const missingPayment = await sendReminder( 999999999 );
		expect( missingPayment.status ).toBe( 404 );
		expect( missingPayment.body.code ).toBe( 'payment_not_found' );
		expectNoMail( missingPayment.mail );

		// A real pending payment, addressed through the wrong fee.
		const mismatched = await sendReminder( otherFeePaymentId );
		expect( mismatched.status ).toBe( 404 );
		expect( mismatched.body.code ).toBe( 'payment_not_found' );
		expectNoMail( mismatched.mail );
	} );

	test( 'paid and canceled payments are refused', async () => {
		for ( const key of [ 'paid', 'canceled' ] ) {
			const res = await sendReminder( payments[ key ] );
			expect( res.status, key ).toBe( 409 );
			expect( res.body.code, key ).toBe( 'payment_not_pending' );
			expectNoMail( res.mail );
			await expectNothingSent( payments[ key ] );
		}
	} );

	test( 'a member without a usable email address is refused', async () => {
		// Mail no reminder sent, including to another member of the fee.
		const stranger = await seedUnrelatedMail( members.target.email );

		for ( const key of [ 'noEmail', 'invalidEmail' ] ) {
			const res = await sendReminder( payments[ key ] );
			expect( res.status, key ).toBe( 400 );
			expect( res.body.code, key ).toBe( 'invalid_recipient_email' );
			expectNoMail( res.mail );
			await expectNothingSent( payments[ key ] );
		}

		// The unrelated mail is still in the shared log, outside the capture.
		expect( await sharedMailTo( stranger ) ).toHaveLength( 1 );
	} );

	test( 'a payment whose member no longer exists is refused', async () => {
		const res = await sendReminder( payments.removed );
		expect( res.status ).toBe( 404 );
		expect( res.body.code ).toBe( 'participant_not_found' );
		expectNoMail( res.mail );
		expect( await reminderLogEntries( payments.removed ) ).toHaveLength(
			0
		);
	} );

	test( 'a mail failure is reported and records nothing', async () => {
		await failMailTo( members.undeliverable.email );
		const res = await sendReminder( payments.undeliverable );
		await failMailTo( '' );

		expect( res.status ).toBe( 500 );
		expect( res.body.code ).toBe( 'reminder_send_failed' );
		// The one attempt was made, and delivery refused it.
		expectOneReminderTo( res.mail, members.undeliverable.email );
		await expectNothingSent( payments.undeliverable );
	} );

	test( 'a pending payment gets one reminder, sent to that member only', async () => {
		// Mail no reminder sent, including to the member about to be reminded.
		const sharedBefore = ( await sharedMailTo( members.target.email ) )
			.length;
		const stranger = await seedUnrelatedMail( members.target.email );

		const res = await sendReminder( payments.target );
		expect( res.status ).toBe( 200 );
		expect( res.body.sent ).toBe( true );
		expect( res.body.recorded ).toBe( true );
		expect( res.body.email ).toBe( members.target.email );
		expect( res.body.reminder_sent_at ).toBeTruthy();

		// Exactly one message left, and it went to the chosen member.
		expectOneReminderTo( res.mail, members.target.email );

		// The seeded mail stays in the shared log, next to the reminder.
		expect( await sharedMailTo( stranger ) ).toHaveLength( 1 );
		expect( await sharedMailTo( members.target.email ) ).toHaveLength(
			sharedBefore + 2
		);

		// The reminder date and the audit entry land on that payment.
		const row = await paymentRow( payments.target );
		expect( row.reminder_sent_at ).toBe( res.body.reminder_sent_at );
		expect( row.status ).toBe( 'pending' );
		const logged = await reminderLogEntries( payments.target );
		expect( logged ).toHaveLength( 1 );
		expect( logged[ 0 ].performed_by_name ).toBeTruthy();

		// The other pending member is untouched.
		await expectNothingSent( payments.bystander );
		expect( await sharedMailTo( members.bystander.email ) ).toHaveLength(
			0
		);
	} );

	test( 'a payment settled after the page loaded is refused when the request arrives', async () => {
		await adminPost(
			`/fair-audience/v1/fees/${ feeId }/payments/${ payments.bystander }/mark-paid`
		);
		// Mail no reminder sent, including to the member whose payment settled.
		const stranger = await seedUnrelatedMail( members.bystander.email );

		const res = await sendReminder( payments.bystander );
		expect( res.status ).toBe( 409 );
		expect( res.body.code ).toBe( 'payment_not_pending' );
		expectNoMail( res.mail );
		await expectNothingSent( payments.bystander );

		expect( await sharedMailTo( stranger ) ).toHaveLength( 1 );
	} );

	test( 'the captured-mail checks catch duplicate and misaddressed reminders', async () => {
		const target = members.target.email;

		// One message to the member passes.
		const single = await probeMail( [ target ], { captured: true } );
		expectOneReminderTo( single.mail, target );
		expect( () => expectNoMail( single.mail ) ).toThrow();

		// A second copy fails.
		const duplicate = await probeMail( [ target, target ], {
			captured: true,
		} );
		expect( duplicate.mail ).toHaveLength( 2 );
		expect( () => expectOneReminderTo( duplicate.mail, target ) ).toThrow();

		// A message to another member fails.
		const misaddressed = await probeMail( [ members.bystander.email ], {
			captured: true,
		} );
		expect( () =>
			expectOneReminderTo( misaddressed.mail, target )
		).toThrow();
	} );
} );
