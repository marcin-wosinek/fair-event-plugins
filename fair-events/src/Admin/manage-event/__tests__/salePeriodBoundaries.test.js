/**
 * Tests for the position-aware sale-period boundary helper (#1582).
 *
 * Mirrors TicketAvailabilityTest.php's coverage of resolve_periods() so the
 * admin display and the backend authority never disagree about what an
 * unset boundary currently means.
 */
import {
	resolveDefaultSaleStart,
	resolveEffectiveSalePeriods,
	hasUsableSalePeriodRange,
	resolveFinalOccurrenceDate,
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

describe( 'resolveDefaultSaleStart (#1841)', () => {
	it( 'uses a creation day before today', () => {
		expect( resolveDefaultSaleStart( '2026-07-15', '2026-06-01' ) ).toBe(
			'2026-06-01'
		);
	} );

	it( 'uses today when the event was created today or later', () => {
		expect( resolveDefaultSaleStart( '2026-07-15', '2026-07-15' ) ).toBe(
			'2026-07-15'
		);
		expect( resolveDefaultSaleStart( '2026-07-15', '2026-07-16' ) ).toBe(
			'2026-07-15'
		);
	} );

	it( 'falls back to today for a missing or malformed creation day', () => {
		expect( resolveDefaultSaleStart( '2026-07-15', null ) ).toBe(
			'2026-07-15'
		);
		expect( resolveDefaultSaleStart( '2026-07-15', 'yesterday' ) ).toBe(
			'2026-07-15'
		);
	} );

	it( 'returns an empty string without a site today', () => {
		expect( resolveDefaultSaleStart( '', '2026-06-01' ) ).toBe( '' );
	} );
} );

describe( 'resolveEffectiveSalePeriods with a creation day (#1841)', () => {
	it( 'infers the first missing start as the creation day', () => {
		const [ resolved ] = resolveEffectiveSalePeriods(
			[ { sale_start: '', sale_end: '2026-08-01' } ],
			'2026-07-15',
			null,
			'2026-06-01'
		);
		expect( resolved.effectiveStart ).toBe( '2026-06-01' );
		expect( resolved.isAutomaticStart ).toBe( true );
	} );

	it( 'does not move the start forward as today advances', () => {
		[ '2026-06-01', '2026-07-01', '2026-07-31' ].forEach( ( today ) => {
			const [ resolved ] = resolveEffectiveSalePeriods(
				[ { sale_start: '', sale_end: '2026-08-01' } ],
				today,
				null,
				'2026-06-01'
			);
			expect( resolved.effectiveStart ).toBe( '2026-06-01' );
		} );
	} );

	it( 'keeps the inferred start of a period that has already ended', () => {
		const [ resolved ] = resolveEffectiveSalePeriods(
			[ { sale_start: '', sale_end: '2026-08-01' } ],
			'2026-09-01',
			null,
			'2026-06-01'
		);
		expect( resolved.effectiveStart ).toBe( '2026-06-01' );
		expect( resolved.effectiveEnd ).toBe( '2026-08-01' );
	} );

	it( 'leaves the start unresolved when the creation day is not before the end', () => {
		const [ resolved ] = resolveEffectiveSalePeriods(
			[ { sale_start: '', sale_end: '2026-06-01' } ],
			'2026-07-15',
			null,
			'2026-06-01'
		);
		expect( resolved.effectiveStart ).toBeNull();
	} );

	it( 'leaves explicit starts and later periods untouched', () => {
		const resolved = resolveEffectiveSalePeriods(
			[
				{ sale_start: '2026-06-10', sale_end: '2026-07-01' },
				{ sale_start: '', sale_end: '2026-08-01' },
			],
			'2026-07-15',
			null,
			'2026-06-01'
		);
		expect( resolved[ 0 ].effectiveStart ).toBe( '2026-06-10' );
		expect( resolved[ 0 ].isAutomaticStart ).toBe( false );
		expect( resolved[ 1 ].effectiveStart ).toBeNull();
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

describe( 'resolveFinalOccurrenceDate', () => {
	it( 'returns null for a null event date', () => {
		expect( resolveFinalOccurrenceDate( null ) ).toBeNull();
	} );

	it( "uses the event's own end date when there are no generated occurrences", () => {
		const eventDate = {
			start_date: '2026-01-01',
			start_time: '10:00:00',
			end_date: '2026-01-01',
			end_time: '12:00:00',
			generated_occurrences: [],
		};
		expect( resolveFinalOccurrenceDate( eventDate ) ).toBe( '2026-01-01' );
	} );

	it( 'falls back to the start date when the final occurrence has no end date', () => {
		const eventDate = {
			start_date: '2026-01-01',
			start_time: '10:00:00',
			end_date: '2026-01-01',
			end_time: '12:00:00',
			generated_occurrences: [
				{
					start_date: '2026-02-01',
					start_time: '10:00:00',
					end_date: null,
					end_time: null,
					status: 'active',
				},
			],
		};
		expect( resolveFinalOccurrenceDate( eventDate ) ).toBe( '2026-02-01' );
	} );

	it( 'orders a date without a start time by its date', () => {
		const eventDate = {
			start_date: '2026-01-01',
			start_time: '10:00:00',
			end_date: '2026-01-01',
			end_time: '12:00:00',
			generated_occurrences: [
				{
					start_date: '2026-02-03',
					start_time: null,
					end_date: '2026-02-04',
					end_time: null,
					status: 'active',
				},
				{
					start_date: '2026-02-01',
					start_time: '10:00:00',
					end_date: '2026-02-01',
					end_time: '12:00:00',
					status: 'active',
				},
			],
		};
		expect( resolveFinalOccurrenceDate( eventDate ) ).toBe( '2026-02-04' );
	} );

	it( 'picks the chronologically final active occurrence, not the last end in the list', () => {
		const eventDate = {
			start_date: '2026-01-01',
			start_time: '10:00:00',
			end_date: '2026-01-01',
			end_time: '12:00:00',
			generated_occurrences: [
				{
					start_date: '2026-03-01',
					start_time: '10:00:00',
					end_date: '2026-03-01',
					end_time: '12:00:00',
					status: 'active',
				},
				{
					start_date: '2026-02-01',
					start_time: '10:00:00',
					end_date: '2026-02-01',
					end_time: '12:00:00',
					status: 'active',
				},
			],
		};
		expect( resolveFinalOccurrenceDate( eventDate ) ).toBe( '2026-03-01' );
	} );

	it( 'ignores cancelled occurrences', () => {
		const eventDate = {
			start_date: '2026-01-01',
			start_time: '10:00:00',
			end_date: '2026-01-01',
			end_time: '12:00:00',
			generated_occurrences: [
				{
					start_date: '2026-03-01',
					start_time: '10:00:00',
					end_date: '2026-03-01',
					end_time: '12:00:00',
					status: 'cancelled',
				},
				{
					start_date: '2026-02-01',
					start_time: '10:00:00',
					end_date: '2026-02-01',
					end_time: '12:00:00',
					status: 'active',
				},
			],
		};
		expect( resolveFinalOccurrenceDate( eventDate ) ).toBe( '2026-02-01' );
	} );
} );
