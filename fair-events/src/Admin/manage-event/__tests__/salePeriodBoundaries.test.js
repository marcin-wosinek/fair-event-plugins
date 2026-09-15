/**
 * Tests for the position-aware sale-period boundary helper (#1582).
 *
 * Mirrors TicketAvailabilityTest.php's coverage of resolve_periods() so the
 * admin display and the backend authority never disagree about what an
 * unset boundary currently means.
 */
import {
	resolveEffectiveSalePeriods,
	hasUsableSalePeriodRange,
	resolveFinalOccurrenceDatetime,
} from '../salePeriodBoundaries.js';

describe( 'resolveEffectiveSalePeriods', () => {
	it( "infers the first period's missing start as site-local today, while today precedes its end", () => {
		const [ resolved ] = resolveEffectiveSalePeriods(
			[ { sale_start: '', sale_end: '2026-06-01' } ],
			'2026-01-15',
			null
		);
		expect( resolved.effectiveStart ).toBe( '2026-01-15' );
		expect( resolved.isAutomaticStart ).toBe( true );
	} );

	it( "does not infer a start once today reaches the period's end", () => {
		const [ resolved ] = resolveEffectiveSalePeriods(
			[ { sale_start: '', sale_end: '2026-06-01' } ],
			'2026-06-01',
			null
		);
		expect( resolved.effectiveStart ).toBeNull();
		expect( resolved.isAutomaticStart ).toBe( false );
	} );

	it( "infers the last period's missing end from finalOccurrenceEnd", () => {
		const [ resolved ] = resolveEffectiveSalePeriods(
			[ { sale_start: '2026-01-01', sale_end: '' } ],
			'2026-01-15',
			'2026-08-22'
		);
		expect( resolved.effectiveEnd ).toBe( '2026-08-22' );
		expect( resolved.isAutomaticEnd ).toBe( true );
	} );

	it( 'leaves the end unresolved when no default is available', () => {
		const [ resolved ] = resolveEffectiveSalePeriods(
			[ { sale_start: '2026-01-01', sale_end: '' } ],
			'2026-01-15',
			null
		);
		expect( resolved.effectiveEnd ).toBeNull();
	} );

	it( 'leaves explicit boundaries untouched and not marked automatic', () => {
		const [ resolved ] = resolveEffectiveSalePeriods(
			[ { sale_start: '2026-01-01', sale_end: '2026-02-01' } ],
			'2026-01-15',
			'2026-09-01'
		);
		expect( resolved.effectiveStart ).toBe( '2026-01-01' );
		expect( resolved.effectiveEnd ).toBe( '2026-02-01' );
		expect( resolved.isAutomaticStart ).toBe( false );
		expect( resolved.isAutomaticEnd ).toBe( false );
	} );

	it( 'never infers a missing boundary on an interior period', () => {
		const periods = [
			{ sale_start: '2026-01-01', sale_end: '2026-02-01' },
			{ sale_start: '', sale_end: '' },
			{ sale_start: '2026-03-01', sale_end: '2026-04-01' },
		];
		const [ , interior ] = resolveEffectiveSalePeriods(
			periods,
			'2026-01-15',
			'2026-09-01'
		);
		expect( interior.effectiveStart ).toBeNull();
		expect( interior.effectiveEnd ).toBeNull();
	} );

	it( 'only resolves the outer boundaries of a multi-period sequence', () => {
		const periods = [
			{ sale_start: '', sale_end: '2026-02-01' },
			{ sale_start: '2026-02-01', sale_end: '2026-03-01' },
			{ sale_start: '2026-03-01', sale_end: '' },
		];
		const resolved = resolveEffectiveSalePeriods(
			periods,
			'2026-01-10',
			'2026-04-01'
		);
		expect( resolved[ 0 ].effectiveStart ).toBe( '2026-01-10' );
		expect( resolved[ 1 ].effectiveStart ).toBe( '2026-02-01' );
		expect( resolved[ 1 ].effectiveEnd ).toBe( '2026-03-01' );
		expect( resolved[ 2 ].effectiveEnd ).toBe( '2026-04-01' );
	} );
} );

describe( 'hasUsableSalePeriodRange', () => {
	it( 'is false for an empty list', () => {
		expect( hasUsableSalePeriodRange( [] ) ).toBe( false );
	} );

	it( 'is false when any period has an unresolved boundary', () => {
		const resolved = resolveEffectiveSalePeriods(
			[ { sale_start: '', sale_end: '' } ],
			'2026-01-15',
			null
		);
		expect( hasUsableSalePeriodRange( resolved ) ).toBe( false );
	} );

	it( 'is true once every period resolves both boundaries', () => {
		const resolved = resolveEffectiveSalePeriods(
			[ { sale_start: '', sale_end: '' } ],
			'2026-01-15',
			'2026-06-01'
		);
		expect( hasUsableSalePeriodRange( resolved ) ).toBe( true );
	} );
} );

describe( 'resolveFinalOccurrenceDatetime', () => {
	it( 'returns null for a null event date', () => {
		expect( resolveFinalOccurrenceDatetime( null ) ).toBeNull();
	} );

	it( "uses the event's own end when there are no generated occurrences", () => {
		const eventDate = {
			start_datetime: '2026-01-01 10:00:00',
			end_datetime: '2026-01-01 12:00:00',
			generated_occurrences: [],
		};
		expect( resolveFinalOccurrenceDatetime( eventDate ) ).toBe(
			'2026-01-01 12:00:00'
		);
	} );

	it( 'falls back to the start when the final occurrence has no end', () => {
		const eventDate = {
			start_datetime: '2026-01-01 10:00:00',
			end_datetime: '2026-01-01 12:00:00',
			generated_occurrences: [
				{
					start_datetime: '2026-02-01 10:00:00',
					end_datetime: null,
					status: 'active',
				},
			],
		};
		expect( resolveFinalOccurrenceDatetime( eventDate ) ).toBe(
			'2026-02-01 10:00:00'
		);
	} );

	it( 'picks the chronologically final active occurrence, not the last end in the list', () => {
		const eventDate = {
			start_datetime: '2026-01-01 10:00:00',
			end_datetime: '2026-01-01 12:00:00',
			generated_occurrences: [
				{
					start_datetime: '2026-03-01 10:00:00',
					end_datetime: '2026-03-01 12:00:00',
					status: 'active',
				},
				{
					start_datetime: '2026-02-01 10:00:00',
					end_datetime: '2026-02-01 12:00:00',
					status: 'active',
				},
			],
		};
		expect( resolveFinalOccurrenceDatetime( eventDate ) ).toBe(
			'2026-03-01 12:00:00'
		);
	} );

	it( 'ignores cancelled occurrences', () => {
		const eventDate = {
			start_datetime: '2026-01-01 10:00:00',
			end_datetime: '2026-01-01 12:00:00',
			generated_occurrences: [
				{
					start_datetime: '2026-03-01 10:00:00',
					end_datetime: '2026-03-01 12:00:00',
					status: 'cancelled',
				},
				{
					start_datetime: '2026-02-01 10:00:00',
					end_datetime: '2026-02-01 12:00:00',
					status: 'active',
				},
			],
		};
		expect( resolveFinalOccurrenceDatetime( eventDate ) ).toBe(
			'2026-02-01 12:00:00'
		);
	} );
} );
