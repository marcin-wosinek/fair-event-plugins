import {
	draftFromReminder,
	draftProblem,
	feedStatus,
	numberDigits,
	payloadFromDraft,
	runTone,
	sameUrl,
	templatesForFeed,
	updateDraft,
} from '../model.js';

const URL = 'https://example.test/fair-events-weekly-summary/valencia/';

function reminder( overrides ) {
	return {
		enabled: true,
		day_of_week: 3,
		time_of_day: '09:30',
		recipient: {
			kind: 'standalone',
			member_id: null,
			name: 'Ana',
			number: '+34600000401',
		},
		destination_status: 'ok',
		consent_confirmed: true,
		template: {
			name: 'valencia_summary',
			language: 'es_ES',
			url: URL,
			matches_feed: true,
		},
		...overrides,
	};
}

function feed( overrides ) {
	return {
		source_id: 1,
		name: 'Valencia',
		feed_enabled: true,
		has_page: true,
		summary_url: URL,
		reminder: reminder(),
		...overrides,
	};
}

describe( 'numberDigits and sameUrl', () => {
	it( 'accepts international numbers only', () => {
		expect( numberDigits( '+34 600 000 401' ) ).toBe( '34600000401' );
		expect( numberDigits( '600' ) ).toBe( '' );
		expect( numberDigits( 'call me' ) ).toBe( '' );
	} );

	it( 'ignores a trailing slash only', () => {
		expect( sameUrl( URL, URL.slice( 0, -1 ) ) ).toBe( true );
		expect( sameUrl( URL, `${ URL }x` ) ).toBe( false );
		expect( sameUrl( '', '' ) ).toBe( false );
	} );
} );

describe( 'drafts', () => {
	it( 'round-trips a saved reminder into the request body', () => {
		const draft = draftFromReminder( reminder() );
		expect( payloadFromDraft( draft ) ).toEqual( {
			enabled: true,
			day_of_week: 3,
			time_of_day: '09:30',
			recipient: {
				kind: 'standalone',
				name: 'Ana',
				number: '+34600000401',
			},
			consent: true,
			template: { name: 'valencia_summary', language: 'es_ES' },
		} );
	} );

	it( 'starts a new reminder off, without a collaborator', () => {
		expect( payloadFromDraft( draftFromReminder( null ) ) ).toEqual( {
			enabled: false,
			day_of_week: 1,
			time_of_day: '10:00',
			recipient: null,
			consent: false,
			template: null,
		} );
	} );

	it( 'asks for consent again when the destination changes', () => {
		const draft = draftFromReminder( reminder() );
		expect(
			updateDraft( draft, 'number', '+34 600 000 402' ).consent
		).toBe( false );
		expect( updateDraft( draft, 'kind', 'member' ).consent ).toBe( false );
		expect( updateDraft( draft, 'name', 'Ana R.' ).consent ).toBe( true );
		expect( updateDraft( draft, 'time_of_day', '11:00' ).consent ).toBe(
			true
		);
	} );

	it( 'explains what blocks saving', () => {
		const members = [
			{ id: 2, name: 'Bea', number: '+34600000402' },
			{ id: 3, name: 'Sam', number: '' },
		];
		const base = draftFromReminder( null );
		expect( draftProblem( base, members ) ).toBeNull();
		expect(
			draftProblem( { ...base, kind: 'member' }, members )
		).toContain( 'Choose a team member' );
		expect(
			draftProblem( { ...base, kind: 'member', member_id: '3' }, members )
		).toContain( 'no phone number' );
		expect(
			draftProblem( { ...base, kind: 'member', member_id: '2' }, members )
		).toContain( 'agreed' );
		expect(
			draftProblem(
				{ ...base, kind: 'standalone', name: 'Ana', number: '12' },
				members
			)
		).toContain( 'international format' );
		expect(
			draftProblem(
				{
					...base,
					kind: 'member',
					member_id: '2',
					consent: true,
				},
				members
			)
		).toBeNull();
	} );
} );

describe( 'templatesForFeed', () => {
	it( 'keeps templates whose button opens the feed page', () => {
		const templates = [
			{ name: 'a', language: 'es_ES', button_urls: [ URL ] },
			{ name: 'b', language: 'es_ES', button_urls: [ `${ URL }x/` ] },
			{ name: 'c', language: 'es_ES', button_urls: [] },
		];
		expect(
			templatesForFeed( templates, URL ).map( ( { name } ) => name )
		).toEqual( [ 'a' ] );
	} );
} );

describe( 'feedStatus', () => {
	it( 'is on only when everything is in place', () => {
		expect( feedStatus( feed(), true ) ).toMatchObject( {
			tone: 'success',
			label: 'On',
		} );
		expect( feedStatus( feed( { reminder: null } ), true ).label ).toBe(
			'Not set up'
		);
		expect(
			feedStatus(
				feed( { reminder: reminder( { enabled: false } ) } ),
				true
			).label
		).toBe( 'Paused' );
	} );

	it( 'names what keeps an enabled reminder from sending', () => {
		const cases = [
			[ feed(), false, 'not validated' ],
			[ feed( { feed_enabled: false } ), true, 'disabled' ],
			[
				feed( {
					reminder: reminder( {
						recipient: null,
						destination_status: 'none',
					} ),
				} ),
				true,
				'No collaborator',
			],
			[
				feed( {
					reminder: reminder( {
						destination_status: 'needs_confirmation',
					} ),
				} ),
				true,
				'Confirm their agreement',
			],
			[
				feed( {
					reminder: reminder( {
						template: {
							...reminder().template,
							matches_feed: false,
						},
					} ),
				} ),
				true,
				'link changed',
			],
		];
		for ( const [ shown, ready, text ] of cases ) {
			const status = feedStatus( shown, ready );
			expect( status.tone ).toBe( 'warning' );
			expect( status.detail ).toContain( text );
		}
	} );
} );

describe( 'runTone', () => {
	it( 'tells skips, failures and deliveries apart', () => {
		expect( runTone( { state: 'skipped' } ) ).toBe( 'neutral' );
		expect( runTone( { state: 'failed' } ) ).toBe( 'error' );
		expect( runTone( { state: 'uncertain' } ) ).toBe( 'warning' );
		expect( runTone( { state: 'accepted', delivery: null } ) ).toBe(
			'info'
		);
		expect(
			runTone( {
				state: 'accepted',
				delivery: { outcome: 'delivered' },
			} )
		).toBe( 'success' );
		expect(
			runTone( { state: 'accepted', delivery: { outcome: 'failed' } } )
		).toBe( 'error' );
	} );
} );
