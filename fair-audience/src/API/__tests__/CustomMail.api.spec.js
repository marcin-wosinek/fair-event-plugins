/**
 * Playwright API tests for CustomMailController (#1784).
 *
 * Exercises /fair-audience/v1/custom-mail against a live WordPress instance:
 * permissions, input validation, occurrence-scoped recipient selection,
 * label filters and exclusions, consent and invalid addresses, transport
 * failures, mail history, and the rules that apply when the experimental
 * messaging and groups features are off (standalone Fair Audience).
 *
 * Outgoing mail is captured, never sent, by the test-only mu-plugins in
 * `e2e/mu-plugins/` (see e2e/README.md § Capturing email).
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );

const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

const RUN = `${ Date.now() }-${ Math.floor( Math.random() * 1e6 ) }`;
const FEATURES_OPTION = 'fair_audience_experimental_features';

test.describe.configure( { mode: 'serial' } );

test.describe( 'CustomMailController', () => {
	let api;
	let eventPostId;
	let occurrenceA;
	let occurrenceB;
	let companionActive = false;
	const people = {};
	const subjects = [];

	const adminPost = async ( path, data ) => {
		const res = await api.post( `/wp-json${ path }`, {
			headers: adminHeaders,
			data,
		} );
		expect( res.ok(), `${ path }: ${ await res.text() }` ).toBeTruthy();
		return res.json();
	};

	/** A subject unique to one test, remembered so its history is cleaned up. */
	const subjectFor = ( name ) => {
		const subject = `Custom mail ${ name } ${ RUN }`;
		subjects.push( subject );
		return subject;
	};

	/** POST to a custom-mail route; returns status and parsed body. */
	const post = async ( path, data, headers = adminHeaders ) => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/custom-mail${ path }`,
			{ headers, data }
		);
		return { status: res.status(), body: await res.json() };
	};

	const send = ( data, headers ) =>
		post(
			'',
			{ content: '<p>Hello from the test.</p>', ...data },
			headers
		);

	const preview = ( data, headers ) => post( '/preview', data, headers );

	/** Captured mail with the given subject, as recipient addresses. */
	const deliveredTo = async ( subject ) => {
		const res = await api.get( '/wp-json/fair-e2e/v1/fee-reminders/mail', {
			headers: adminHeaders,
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() )
			.filter( ( entry ) => entry.subject === subject )
			.flatMap( ( entry ) => entry.to );
	};

	const history = async () => {
		const res = await api.get( '/wp-json/fair-audience/v1/custom-mail', {
			headers: adminHeaders,
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	const setFeatures = ( map ) =>
		adminPost( '/wp/v2/settings', { [ FEATURES_OPTION ]: map } );

	const addPerson = async ( key, { profile, occurrence, label } ) => {
		const email = `custom-mail-${ key }-${ RUN }@example.test`;
		const participant = await adminPost( '/fair-audience/v1/participants', {
			name: `Mail ${ key }`,
			email,
			email_profile: profile,
		} );
		await adminPost(
			`/fair-audience/v1/event-dates/${ occurrence }/participants/batch`,
			{ participant_ids: [ participant.id ], label }
		);
		people[ key ] = { id: participant.id, email };
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const settings = await api.get( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
		} );
		expect( settings.ok() ).toBeTruthy();
		companionActive = FEATURES_OPTION in ( await settings.json() );

		const event = await adminPost( '/wp/v2/fair_event', {
			title: `Custom mail event ${ RUN }`,
			status: 'publish',
		} );
		eventPostId = event.id;

		// One event, two occurrences: recipients must not leak between them.
		const series = await adminPost( '/fair-events/v1/event-dates', {
			title: `Custom mail event ${ RUN }`,
			start_datetime: '2037-03-01 10:00:00',
			end_datetime: '2037-03-01 12:00:00',
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		occurrenceA = series.id;
		occurrenceB = series.generated_occurrences[ 0 ].id;

		// The create endpoint doesn't link the post; a PUT does (same quirk
		// as EventParticipantsMove.api.spec.js).
		const link = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ occurrenceA }`,
			{ headers: adminHeaders, data: { event_id: eventPostId } }
		);
		expect( link.ok() ).toBeTruthy();

		const onA = { occurrence: occurrenceA, label: 'signed_up' };
		await addPerson( 'ana', { profile: 'marketing', ...onA } );
		await addPerson( 'bruno', { profile: 'marketing', ...onA } );
		await addPerson( 'carla', { profile: 'minimal', ...onA } );
		await addPerson( 'dario', { profile: 'marketing', ...onA } );
		await addPerson( 'elena', {
			profile: 'marketing',
			occurrence: occurrenceA,
			label: 'interested',
		} );
		await addPerson( 'felix', {
			profile: 'marketing',
			occurrence: occurrenceB,
			label: 'signed_up',
		} );

		// An address the participant routes would have rejected, as legacy
		// or imported data can hold.
		people.dario.email = 'not-an-email';
		await adminPost( '/fair-e2e/v1/fee-reminders/participant-email', {
			participant_id: people.dario.id,
			email: people.dario.email,
		} );
	} );

	test.afterAll( async () => {
		await adminPost( '/fair-e2e/v1/fee-reminders/mail-failure', {
			email: '',
		} );
		if ( companionActive ) {
			await setFeatures( {
				messaging: true,
				groups: true,
			} );
		}
		for ( const mail of await history() ) {
			if ( subjects.includes( mail.subject ) ) {
				await api.delete(
					`/wp-json/fair-audience/v1/custom-mail/${ mail.id }`,
					{ headers: adminHeaders }
				);
			}
		}
		for ( const person of Object.values( people ) ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ person.id }`,
				{ headers: adminHeaders }
			);
		}
		if ( occurrenceA ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ occurrenceA }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventPostId ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventPostId }`, {
				headers: adminHeaders,
				params: { force: 'true' },
			} );
		}
		await api.dispose();
	} );

	test( 'anonymous and non-admin requests are rejected and send nothing', async () => {
		const subject = subjectFor( 'unauthorized' );
		const message = { subject, event_date_id: occurrenceA };

		expect( ( await send( message, {} ) ).status ).toBe( 401 );
		expect(
			( await preview( { event_date_id: occurrenceA }, {} ) ).status
		).toBe( 401 );
		const anonymousList = await api.get(
			'/wp-json/fair-audience/v1/custom-mail',
			{ headers: {} }
		);
		expect( anonymousList.status() ).toBe( 401 );

		const username = `custom-mail-subscriber-${ RUN }`;
		const password = 'Custom-mail-test-1784!';
		const user = await adminPost( '/wp/v2/users', {
			username,
			password,
			email: `${ username }@example.test`,
			roles: [ 'subscriber' ],
		} );
		const subscriber = basicAuth( username, password );
		const forbiddenSend = await send( message, subscriber );
		const forbiddenPreview = await preview(
			{ event_date_id: occurrenceA },
			subscriber
		);
		const forbiddenDelete = await api.delete(
			'/wp-json/fair-audience/v1/custom-mail/1',
			{ headers: subscriber }
		);
		await api.delete(
			`/wp-json/wp/v2/users/${ user.id }?force=true&reassign=1`,
			{ headers: adminHeaders }
		);

		expect( forbiddenSend.status ).toBe( 403 );
		expect( forbiddenPreview.status ).toBe( 403 );
		expect( forbiddenDelete.status() ).toBe( 403 );
		expect( await deliveredTo( subject ) ).toHaveLength( 0 );
	} );

	test( 'the preview lists one occurrence’s participants, by audience type', async () => {
		const forA = await preview( {
			event_date_id: occurrenceA,
			labels: [ 'signed_up' ],
		} );
		expect( forA.status ).toBe( 200 );

		const byId = Object.fromEntries(
			forA.body.map( ( row ) => [ row.participant_id, row ] )
		);
		expect( Object.keys( byId ).map( Number ).sort() ).toEqual(
			[
				people.ana.id,
				people.bruno.id,
				people.carla.id,
				people.dario.id,
			].sort()
		);
		expect( byId[ people.ana.id ] ).toMatchObject( {
			has_valid_email: true,
			would_skip_marketing: false,
		} );
		expect( byId[ people.carla.id ].would_skip_marketing ).toBe( true );
		expect( byId[ people.dario.id ].has_valid_email ).toBe( false );

		const interested = await preview( {
			event_date_id: occurrenceA,
			labels: [ 'interested' ],
		} );
		expect( interested.body.map( ( row ) => row.participant_id ) ).toEqual(
			[ people.elena.id ]
		);

		const forB = await preview( {
			event_date_id: occurrenceB,
			labels: [ 'signed_up', 'collaborator', 'interested' ],
		} );
		expect( forB.body.map( ( row ) => row.participant_id ) ).toEqual( [
			people.felix.id,
		] );
	} );

	test( 'a send reaches only eligible participants of the occurrence', async () => {
		const subject = subjectFor( 'occurrence' );
		const { status, body } = await send( {
			subject,
			event_date_id: occurrenceA,
			is_marketing: true,
			labels: [ 'signed_up' ],
			skip_participant_ids: [ people.bruno.id ],
		} );
		expect( status ).toBe( 200 );

		expect( body.sent ).toEqual( [ people.ana.email ] );
		expect( body.history_saved ).toBe( true );

		const skipped = Object.fromEntries(
			body.skipped.map( ( entry ) => [ entry.email, entry.reason ] )
		);
		expect( Object.keys( skipped ).sort() ).toEqual(
			[ people.bruno.email, people.carla.email ].sort()
		);
		expect( skipped[ people.bruno.email ] ).toBe( 'Manually skipped.' );

		// The malformed address is reported, not handed to the mailer. It
		// reads back empty: the participant model drops what is not an email.
		expect( body.failed ).toEqual( [
			{
				name: 'Mail dario',
				email: '',
				reason: 'Participant has no valid email address.',
			},
		] );
		expect( body ).toMatchObject( {
			sent_count: 1,
			skipped_count: 2,
			failed_count: 1,
		} );

		// Exactly one delivery: nobody from the other occurrence, no other
		// audience type, no one excluded or without consent.
		expect( await deliveredTo( subject ) ).toEqual( [ people.ana.email ] );
	} );

	test( 'a non-marketing email also reaches participants without marketing consent', async () => {
		const subject = subjectFor( 'minimal' );
		const { status, body } = await send( {
			subject,
			event_date_id: occurrenceA,
			is_marketing: false,
			labels: [ 'signed_up' ],
		} );
		expect( status ).toBe( 200 );
		expect( body.skipped ).toEqual( [] );
		expect( ( await deliveredTo( subject ) ).sort() ).toEqual(
			[ people.ana.email, people.bruno.email, people.carla.email ].sort()
		);
	} );

	test( 'a transport failure is reported for that recipient only', async () => {
		const subject = subjectFor( 'transport' );
		await adminPost( '/fair-e2e/v1/fee-reminders/mail-failure', {
			email: people.bruno.email,
		} );

		const { status, body } = await send( {
			subject,
			event_date_id: occurrenceA,
			labels: [ 'signed_up' ],
			skip_participant_ids: [ people.dario.id ],
		} );
		await adminPost( '/fair-e2e/v1/fee-reminders/mail-failure', {
			email: '',
		} );

		expect( status ).toBe( 200 );
		expect( body.sent ).toEqual( [ people.ana.email ] );
		expect( body.failed ).toEqual( [
			{
				name: 'Mail bruno',
				email: people.bruno.email,
				reason: 'wp_mail() failed to send.',
			},
		] );

		const record = ( await history() ).find(
			( mail ) => mail.subject === subject
		);
		expect( record ).toMatchObject( {
			event_date_id: occurrenceA,
			event_id: eventPostId,
			sent_count: 1,
			failed_count: 1,
			skipped_count: 2,
			is_marketing: true,
		} );
	} );

	test( 'empty input and unknown occurrences are rejected without sending', async () => {
		const subject = subjectFor( 'invalid' );
		const valid = {
			subject,
			event_date_id: occurrenceA,
			labels: [ 'signed_up' ],
		};

		const blankSubject = await send( { ...valid, subject: '   ' } );
		expect( blankSubject.status ).toBe( 400 );
		expect( blankSubject.body.code ).toBe( 'empty_subject' );

		for ( const content of [ '', '   ', '<p>&nbsp;</p>', '<p><br></p>' ] ) {
			const emptyBody = await send( { ...valid, content } );
			expect( emptyBody.status, JSON.stringify( content ) ).toBe( 400 );
			expect( emptyBody.body.code ).toBe( 'empty_content' );
		}

		const noAudience = await send( { ...valid, labels: [] } );
		expect( noAudience.status ).toBe( 400 );
		expect( noAudience.body.code ).toBe( 'no_audience_selected' );

		// An occurrence that does not exist is an error — it must not fall
		// back to the whole audience.
		const unknown = await send( { ...valid, event_date_id: 999999999 } );
		expect( unknown.status ).toBe( 404 );
		expect( unknown.body.code ).toBe( 'invalid_event_date' );
		expect( ( await preview( { event_date_id: 999999999 } ) ).status ).toBe(
			404
		);

		expect( await deliveredTo( subject ) ).toHaveLength( 0 );
		expect(
			( await history() ).filter( ( mail ) => mail.subject === subject )
		).toHaveLength( 0 );
	} );

	test( 'history keeps earlier records and deletes one on request', async () => {
		const subject = subjectFor( 'history' );
		await send( {
			subject,
			event_date_id: occurrenceB,
			labels: [ 'signed_up' ],
		} );

		const records = await history();
		const record = records.find( ( mail ) => mail.subject === subject );
		expect( record ).toMatchObject( {
			content: '<p>Hello from the test.</p>',
			event_date_id: occurrenceB,
			event_id: eventPostId,
			event_title: `Custom mail event ${ RUN }`,
			sent_count: 1,
		} );
		expect( record.created_at ).toMatch( /^\d{4}-\d{2}-\d{2} / );

		// Records of the earlier sends are still there, newest first.
		const earlier = records.find(
			( mail ) => mail.subject === `Custom mail occurrence ${ RUN }`
		);
		expect( earlier ).toBeTruthy();
		expect( records.indexOf( record ) ).toBeLessThan(
			records.indexOf( earlier )
		);

		const missing = await api.delete(
			'/wp-json/fair-audience/v1/custom-mail/999999999',
			{ headers: adminHeaders }
		);
		expect( missing.status() ).toBe( 404 );

		const deleted = await api.delete(
			`/wp-json/fair-audience/v1/custom-mail/${ record.id }`,
			{ headers: adminHeaders }
		);
		expect( deleted.ok() ).toBeTruthy();
		expect(
			( await history() ).some( ( mail ) => mail.id === record.id )
		).toBe( false );
	} );

	test( 'the event list offers each occurrence of a published event', async () => {
		const res = await api.get(
			'/wp-json/fair-audience/v1/custom-mail/events',
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const ours = ( await res.json() ).filter(
			( row ) => row.event_id === eventPostId
		);
		expect( ours.map( ( row ) => row.id ).sort() ).toEqual(
			[ occurrenceA, occurrenceB ].sort()
		);
		for ( const row of ours ) {
			expect( row.display_label ).toContain(
				`Custom mail event ${ RUN }`
			);
		}
	} );

	test( 'without the experimental features, only event emails are possible', async () => {
		if ( companionActive ) {
			await setFeatures( {
				messaging: false,
				groups: false,
			} );
		}
		const subject = subjectFor( 'standalone' );

		// No occurrence: refused instead of mailing the whole audience.
		const allAudience = await send( { subject } );
		expect( allAudience.status ).toBe( 400 );
		expect( allAudience.body.code ).toBe( 'event_date_required' );
		const allAudiencePreview = await preview( {} );
		expect( allAudiencePreview.status ).toBe( 400 );
		expect( allAudiencePreview.body.code ).toBe( 'event_date_required' );

		const scoped = {
			subject,
			event_date_id: occurrenceB,
			labels: [ 'signed_up' ],
		};

		const groupFilter = await send( { ...scoped, group_ids: [ 1 ] } );
		expect( groupFilter.status ).toBe( 400 );
		expect( groupFilter.body.code ).toBe( 'groups_unavailable' );

		// The retired photo upload link (#1689) is dropped when sending, so
		// a message holding nothing else is empty.
		const photoLink = await send( {
			...scoped,
			content: '<p><a href="{photo_upload_url}">Upload</a></p>',
		} );
		expect( photoLink.status ).toBe( 400 );
		expect( photoLink.body.code ).toBe( 'empty_content' );

		const groups = await api.get(
			'/wp-json/fair-audience/v1/custom-mail/groups',
			{ headers: adminHeaders }
		);
		expect( await groups.json() ).toEqual( [] );

		expect( await deliveredTo( subject ) ).toHaveLength( 0 );

		// The event email itself needs none of them.
		const sent = await send( scoped );
		expect( sent.status ).toBe( 200 );
		expect( sent.body.sent ).toEqual( [ people.felix.email ] );
		expect( await deliveredTo( subject ) ).toEqual( [
			people.felix.email,
		] );

		// History from before is still listed.
		expect(
			( await history() ).some(
				( mail ) => mail.subject === `Custom mail occurrence ${ RUN }`
			)
		).toBe( true );
	} );

	test( 'the experimental messaging feature allows an all-audience send', async () => {
		test.skip(
			! companionActive,
			'fair-audience-experimental is not active on this site'
		);
		await setFeatures( { messaging: true, groups: true } );

		const everyone = await preview( { is_marketing: true } );
		expect( everyone.status ).toBe( 200 );
		const ids = everyone.body.map( ( row ) => row.participant_id );
		expect( ids ).toEqual(
			expect.arrayContaining( [ people.ana.id, people.felix.id ] )
		);
	} );
} );
