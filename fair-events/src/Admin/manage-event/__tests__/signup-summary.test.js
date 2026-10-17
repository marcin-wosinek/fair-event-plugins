/**
 * Unit tests for the List's copied summary (#1839): totals per ticket and
 * per add-on, configured order with zero counts, test purchases counted in
 * their own section, and refusal while any count could be wrong.
 */
import { expandTicketRows } from '../EventSignups.js';
import {
	buildSignupSummary,
	formatSignupSummary,
	signupSummaryErrorMessage,
	SUMMARY_TICKETS_PENDING,
	SUMMARY_UNKNOWN_ADDON,
	SUMMARY_UNKNOWN_PAYMENT_MODE,
	SUMMARY_UNKNOWN_TICKET_TYPE,
} from '../signup-summary.js';

const ticketTypes = [
	{ id: 4, name: 'Full pass' },
	{ id: 3, name: 'Single activity' },
];

const options = [
	{ id: 9, name: 'Emuná Yoga', short_name: '' },
	{ id: 7, name: 'Danza Fusion con Sayil', short_name: 'Danza Fusion' },
	{ id: 8, name: 'Tai Chi', short_name: null },
];

function ticket( id, overrides = {} ) {
	return {
		id,
		position: 1,
		reference: `REF${ id }`,
		ticket_type_id: 4,
		ticket_type_name: 'Full pass',
		status: 'confirmed',
		confirmed_activity_ids: [],
		...overrides,
	};
}

function signup( id, tickets, overrides = {} ) {
	return {
		id,
		name: `Buyer ${ id }`,
		email: `buyer-${ id }@example.com`,
		status: 'confirmed',
		is_test_payment: false,
		tickets,
		...overrides,
	};
}

function summaryText( signups, config = {} ) {
	const summary = buildSignupSummary( {
		rows: expandTicketRows( signups ),
		ticketTypes,
		options,
		...config,
	} );
	return formatSignupSummary( summary );
}

describe( 'buildSignupSummary / formatSignupSummary', () => {
	it( 'counts every ticket of a registration, by type and add-on, in configured order', () => {
		const text = summaryText( [
			signup( 1, [
				ticket( 11, { confirmed_activity_ids: [ 7, 8 ] } ),
				ticket( 12, { confirmed_activity_ids: [ 7 ] } ),
				ticket( 13 ),
			] ),
			signup( 2, [
				ticket( 21, {
					ticket_type_id: 3,
					ticket_type_name: 'Single activity',
					confirmed_activity_ids: [ 7 ],
				} ),
			] ),
		] );

		expect( text ).toBe(
			[
				'Total tickets: 4',
				'',
				'Ticket types:',
				'- Full pass: 3',
				'- Single activity: 1',
				'',
				'Add-ons:',
				'- Emuná Yoga: 0',
				'- Danza Fusion: 3',
				'- Tai Chi: 1',
			].join( '\n' )
		);
	} );

	it( 'copies zero counts for every configured entry when nothing is sold', () => {
		expect( summaryText( [] ) ).toBe(
			[
				'Total tickets: 0',
				'',
				'Ticket types:',
				'- Full pass: 0',
				'- Single activity: 0',
				'',
				'Add-ons:',
				'- Emuná Yoga: 0',
				'- Danza Fusion: 0',
				'- Tai Chi: 0',
			].join( '\n' )
		);
	} );

	it( 'says "none" for a list with nothing configured or sold', () => {
		expect( summaryText( [], { ticketTypes: [], options: [] } ) ).toBe(
			[
				'Total tickets: 0',
				'',
				'Ticket types:',
				'- none',
				'',
				'Add-ons:',
				'- none',
			].join( '\n' )
		);
	} );

	it( 'counts each ticket by its own type after an individual type change', () => {
		const text = summaryText( [
			signup(
				1,
				[
					ticket( 11 ),
					ticket( 12, {
						ticket_type_id: 3,
						ticket_type_name: 'Single activity',
					} ),
				],
				{ ticket_type_id: 4 }
			),
		] );

		expect( text ).toContain( '- Full pass: 1\n- Single activity: 1' );
	} );

	it( 'counts only the tickets listed on this date of a purchase split over dates', () => {
		const text = summaryText( [
			signup(
				1,
				[
					ticket( 11, { confirmed_activity_ids: [ 9 ] } ),
					ticket( 12, { confirmed_activity_ids: [ 9 ] } ),
				],
				{ listed_ticket_ids: [ 12 ] }
			),
		] );

		expect( text ).toContain( 'Total tickets: 1' );
		expect( text ).toContain( '- Emuná Yoga: 1' );
	} );

	it( 'appends ticket types used outside the configuration by ID, after the configured ones', () => {
		const text = summaryText( [
			signup( 1, [
				ticket( 11, {
					ticket_type_id: 40,
					ticket_type_name: 'Moved-in pass',
				} ),
				ticket( 12, {
					ticket_type_id: 30,
					ticket_type_name: 'Early pass',
				} ),
			] ),
		] );

		expect( text ).toContain(
			[
				'Ticket types:',
				'- Full pass: 0',
				'- Single activity: 0',
				'- Early pass: 1',
				'- Moved-in pass: 1',
			].join( '\n' )
		);
	} );

	it( 'counts tickets without a type on their own line', () => {
		const text = summaryText( [
			signup( 1, [
				ticket( 11, { ticket_type_id: null, ticket_type_name: null } ),
			] ),
		] );

		expect( text ).toContain( 'Total tickets: 1' );
		expect( text ).toContain( '- Single activity: 0\n- No ticket type: 1' );
	} );

	it( 'counts confirmed test purchases only in their own section', () => {
		const text = summaryText( [
			signup( 1, [ ticket( 11, { confirmed_activity_ids: [ 7 ] } ) ] ),
			signup(
				2,
				[
					ticket( 21, { confirmed_activity_ids: [ 7, 9 ] } ),
					ticket( 22, {
						ticket_type_id: 3,
						ticket_type_name: 'Single activity',
						confirmed_activity_ids: [ 9 ],
					} ),
				],
				{ is_test_payment: true }
			),
		] );

		expect( text ).toBe(
			[
				'Total tickets: 1',
				'',
				'Ticket types:',
				'- Full pass: 1',
				'- Single activity: 0',
				'',
				'Add-ons:',
				'- Emuná Yoga: 0',
				'- Danza Fusion: 1',
				'- Tai Chi: 0',
				'',
				'Test payments — excluded from operational totals',
				'',
				'Total tickets: 2',
				'',
				'Ticket types:',
				'- Full pass: 1',
				'- Single activity: 1',
				'',
				'Add-ons:',
				'- Emuná Yoga: 2',
				'- Danza Fusion: 1',
				'- Tai Chi: 0',
			].join( '\n' )
		);
	} );

	it( 'leaves out the test section when there are no test purchases', () => {
		expect(
			summaryText( [ signup( 1, [ ticket( 11 ) ] ) ] )
		).not.toContain( 'Test payments' );
	} );

	it( 'copies names and counts only, never participant details', () => {
		const text = summaryText( [
			signup( 1, [ ticket( 11 ) ], {
				name: 'Ada Lovelace',
				email: 'ada@example.com',
			} ),
		] );

		expect( text ).not.toContain( 'Ada' );
		expect( text ).not.toContain( 'example.com' );
		expect( text ).not.toContain( 'REF11' );
	} );

	it.each( [
		[
			'a registration whose tickets are not created yet',
			[ signup( 1, [] ) ],
			SUMMARY_TICKETS_PENDING,
		],
		[
			'a purchase whose payment mode is unknown',
			[ signup( 1, [ ticket( 11 ) ], { is_test_payment: null } ) ],
			SUMMARY_UNKNOWN_PAYMENT_MODE,
		],
		[
			'a ticket type whose name cannot be found',
			[
				signup( 1, [
					ticket( 11, {
						ticket_type_id: 99,
						ticket_type_name: null,
					} ),
				] ),
			],
			SUMMARY_UNKNOWN_TICKET_TYPE,
		],
		[
			'an add-on outside the configuration',
			[
				signup( 1, [
					ticket( 11, { confirmed_activity_ids: [ 99 ] } ),
				] ),
			],
			SUMMARY_UNKNOWN_ADDON,
		],
	] )( 'refuses a summary with %s', ( _, signups, error ) => {
		const summary = buildSignupSummary( {
			rows: expandTicketRows( signups ),
			ticketTypes,
			options,
		} );

		expect( summary ).toEqual( { error } );
		expect( signupSummaryErrorMessage( error ) ).toMatch(
			/^The summary is unavailable/
		);
	} );
} );
