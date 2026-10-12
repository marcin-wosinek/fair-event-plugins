/**
 * Tests for the sale-period availability helper (#1840).
 *
 * Mirrors the backend purchase rules (TicketAvailability::
 * is_ticket_type_enabled() and TicketPricing::resolve_unit_price()) and the
 * ticket editor's save serialization, so the warning never disagrees with
 * what the public booking form will offer after saving.
 */
import {
	firstUnavailableDate,
	hasPriceRow,
	findUnavailableSaleDates,
} from '../salePeriodAvailability.js';

const period = ( effectiveStart, effectiveEnd, extra = {} ) => ( {
	effectiveStart,
	effectiveEnd,
	...extra,
} );

const priced = { price: '10', capacity: '', enabled: true };
const empty = { price: '', capacity: '', enabled: true };

// Cells keyed by `${ type.key }-${ periodIndex }`; anything else is empty.
const find = ( { ticketTypes, periods, cells = {}, multiple = true } ) =>
	findUnavailableSaleDates( {
		ticketTypes,
		periods,
		getPriceCell: ( type, periodIndex ) =>
			cells[ `${ type.key }-${ periodIndex }` ] || empty,
		respectAvailableFlag: multiple,
	} );

describe( 'firstUnavailableDate', () => {
	it( 'returns null without a cutoff', () => {
		expect( firstUnavailableDate( null ) ).toBeNull();
		expect( firstUnavailableDate( '' ) ).toBeNull();
	} );

	it( 'keeps the cutoff date available when the type disables during the day', () => {
		expect( firstUnavailableDate( '2026-10-10 15:00:00' ) ).toBe(
			'2026-10-11'
		);
		expect( firstUnavailableDate( '2026-10-10T00:01' ) ).toBe(
			'2026-10-11'
		);
	} );

	it( 'flags the cutoff date itself for a midnight cutoff', () => {
		expect( firstUnavailableDate( '2026-10-10 00:00:00' ) ).toBe(
			'2026-10-10'
		);
		expect( firstUnavailableDate( '2026-10-10 00:00' ) ).toBe(
			'2026-10-10'
		);
	} );

	it( 'crosses month and year boundaries', () => {
		expect( firstUnavailableDate( '2026-12-31 18:00' ) ).toBe(
			'2027-01-01'
		);
	} );
} );

describe( 'hasPriceRow', () => {
	it( 'counts a stored zero price as a price row', () => {
		expect(
			hasPriceRow( { price: '0', capacity: '', enabled: true }, true )
		).toBe( true );
	} );

	it( 'treats a wholly empty cell as missing', () => {
		expect( hasPriceRow( empty, true ) ).toBe( false );
		expect( hasPriceRow( undefined, true ) ).toBe( false );
	} );

	it( 'treats a blank price with a capacity as a free ticket, as saving does', () => {
		expect(
			hasPriceRow( { price: '', capacity: '20', enabled: true }, true )
		).toBe( true );
	} );

	it( 'ignores a cell whose "Available" checkbox is unticked in multiple-periods mode only', () => {
		const unticked = { price: '10', capacity: '', enabled: false };
		expect( hasPriceRow( unticked, true ) ).toBe( false );
		expect( hasPriceRow( unticked, false ) ).toBe( true );
	} );
} );

describe( 'findUnavailableSaleDates', () => {
	const periods = [
		period( '2026-08-01', '2026-08-15' ),
		period( '2026-08-15', '2026-09-01' ),
	];

	it( 'reports nothing when every period has an available ticket', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a' } ],
				periods,
				cells: { 'a-0': priced, 'a-1': priced },
			} )
		).toEqual( [] );
	} );

	it( 'reports the whole period when no ticket has a price in it', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a' } ],
				periods,
				cells: { 'a-0': priced },
			} )
		).toEqual( [
			{ periodIndex: 1, start: '2026-08-15', end: '2026-08-31' },
		] );
	} );

	it( 'does not flag a period whose only ticket is free', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a' } ],
				periods,
				cells: {
					'a-0': { price: '0', capacity: '', enabled: true },
					'a-1': { price: '', capacity: '5', enabled: true },
				},
			} )
		).toEqual( [] );
	} );

	it( 'reports a period whose only priced ticket is manually disabled', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a', disabled: true } ],
				periods: [ periods[ 0 ] ],
				cells: { 'a-0': priced },
			} )
		).toEqual( [
			{ periodIndex: 0, start: '2026-08-01', end: '2026-08-14' },
		] );
	} );

	it( 'reports a period whose price cell is not marked available', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a' } ],
				periods: [ periods[ 0 ] ],
				cells: {
					'a-0': { price: '10', capacity: '', enabled: false },
				},
			} )
		).toEqual( [
			{ periodIndex: 0, start: '2026-08-01', end: '2026-08-14' },
		] );
	} );

	it( 'highlights only the dates after a scheduled cutoff', () => {
		expect(
			find( {
				ticketTypes: [
					{ key: 'a', disable_at: '2026-08-10 15:00:00' },
				],
				periods: [ periods[ 0 ] ],
				cells: { 'a-0': priced },
			} )
		).toEqual( [
			{ periodIndex: 0, start: '2026-08-11', end: '2026-08-14' },
		] );
	} );

	it( 'includes the cutoff date for a midnight cutoff', () => {
		expect(
			find( {
				ticketTypes: [
					{ key: 'a', disable_at: '2026-08-10 00:00:00' },
				],
				periods: [ periods[ 0 ] ],
				cells: { 'a-0': priced },
			} )
		).toEqual( [
			{ periodIndex: 0, start: '2026-08-10', end: '2026-08-14' },
		] );
	} );

	it( 'reports the whole period when the cutoff precedes it, and nothing when it follows it', () => {
		const ticketTypes = [ { key: 'a', disable_at: '2026-08-14 12:00' } ];
		expect(
			find( {
				ticketTypes,
				periods,
				cells: { 'a-0': priced, 'a-1': priced },
			} )
		).toEqual( [
			{ periodIndex: 1, start: '2026-08-15', end: '2026-08-31' },
		] );
	} );

	it( 'uses the latest cutoff across several ticket types', () => {
		expect(
			find( {
				ticketTypes: [
					{ key: 'a', disable_at: '2026-08-05 10:00' },
					{ key: 'b', disable_at: '2026-08-12 10:00' },
					{ key: 'c', disable_at: '2026-08-13 10:00' },
				],
				periods: [ periods[ 0 ] ],
				// "c" has no price here, so its later cutoff is irrelevant.
				cells: { 'a-0': priced, 'b-0': priced },
			} )
		).toEqual( [
			{ periodIndex: 0, start: '2026-08-13', end: '2026-08-14' },
		] );
	} );

	it( 'reports nothing while one priced ticket never disables', () => {
		expect(
			find( {
				ticketTypes: [
					{ key: 'a', disable_at: '2026-08-05 10:00' },
					{ key: 'b' },
				],
				periods: [ periods[ 0 ] ],
				cells: { 'a-0': priced, 'b-0': priced },
			} )
		).toEqual( [] );
	} );

	it( 'reports a single-day gap with equal start and end', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a' } ],
				periods: [ period( '2026-10-10', '2026-10-11' ) ],
			} )
		).toEqual( [
			{ periodIndex: 0, start: '2026-10-10', end: '2026-10-10' },
		] );
	} );

	it( 'uses automatically resolved boundaries', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a' } ],
				periods: [
					period( '2026-08-01', '2026-08-22', {
						sale_start: '',
						sale_end: '',
						isAutomaticStart: true,
						isAutomaticEnd: true,
					} ),
				],
			} )
		).toEqual( [
			{ periodIndex: 0, start: '2026-08-01', end: '2026-08-21' },
		] );
	} );

	it( 'skips periods with an unresolved boundary instead of inventing dates', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a' } ],
				periods: [
					period( null, '2026-08-15' ),
					period( '2026-08-15', null ),
				],
			} )
		).toEqual( [] );
	} );

	it( 'reports nothing for an event without ticket types', () => {
		expect( find( { ticketTypes: [], periods } ) ).toEqual( [] );
	} );

	it( 'ignores the "Available" checkbox in single-period mode', () => {
		expect(
			find( {
				ticketTypes: [ { key: 'a' } ],
				periods: [ periods[ 0 ] ],
				cells: {
					'a-0': { price: '10', capacity: '', enabled: false },
				},
				multiple: false,
			} )
		).toEqual( [] );
	} );
} );
