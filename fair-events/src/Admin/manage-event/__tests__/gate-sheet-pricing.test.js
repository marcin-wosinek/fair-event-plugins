/**
 * Price selection of the printable gate sheet (#2212): prices apply at the
 * selected event's start, period starts are inclusive and ends exclusive,
 * automatic boundaries match the Prices tab, the last period never
 * continues past its end, and a missing price is never free.
 */
import {
	resolveGatePricing,
	eventStartMoment,
	extraPriceForPeriod,
	isTicketTypeEnabledAt,
	dayAfter,
	GATE_PRICING_RESOLVED,
	GATE_PRICING_NEEDS_PERIOD,
	GATE_PRICING_NO_PERIODS,
} from '../gate-sheet-pricing.js';

const periods = [
	{
		id: 1,
		name: 'Advance',
		sale_start: '2036-01-01 00:00:00',
		sale_end: '2036-06-20 00:00:00',
	},
	{ id: 2, name: 'Day of event', sale_start: '2036-06-20', sale_end: null },
];

const ticketTypes = [
	{ id: 10, name: 'General', disabled: false, disable_at: null },
	{ id: 11, name: 'Volunteer', disabled: false, disable_at: null },
	{ id: 12, name: 'Reduced', disabled: false, disable_at: null },
];

const prices = [
	{ ticket_type_id: 10, sale_period_id: 1, price: '20.00' },
	{ ticket_type_id: 10, sale_period_id: 2, price: '25.00' },
	{ ticket_type_id: 11, sale_period_id: 1, price: '0.00' },
	{ ticket_type_id: 11, sale_period_id: 2, price: '0.00' },
	{ ticket_type_id: 12, sale_period_id: 1, price: '12.00' },
];

const options = [
	{
		id: 20,
		name: 'Dinner',
		price: '14.50',
		derive_price_from_sale_period: false,
	},
	{
		id: 21,
		name: 'Workshop',
		price: '0.00',
		derive_price_from_sale_period: true,
		period_prices: [
			{ sale_period_id: 1, price: '8.00' },
			{ sale_period_id: 2, price: '10.00' },
		],
	},
	{
		id: 22,
		name: 'T-shirt',
		price: '0.00',
		derive_price_from_sale_period: true,
		period_prices: [ { sale_period_id: 1, price: '18.00' } ],
	},
];

function resolve( { config = {}, ...overrides } = {} ) {
	return resolveGatePricing( {
		eventTiming: {
			start_date: '2036-06-20',
			start_time: '18:00:00',
			all_day: false,
		},
		siteToday: '2036-01-15',
		finalOccurrenceDate: '2036-06-20',
		...overrides,
		config: {
			ticketTypes,
			options,
			salePeriods: periods,
			prices,
			createdDate: '2035-12-01',
			...config,
		},
	} );
}

describe( 'resolveGatePricing', () => {
	it( 'uses the period covering the event start, not today', () => {
		const pricing = resolve();
		expect( pricing.status ).toBe( GATE_PRICING_RESOLVED );
		expect( pricing.period.id ).toBe( 2 );
		expect( pricing.isManualPeriod ).toBe( false );
		expect( pricing.tickets[ 0 ] ).toMatchObject( {
			name: 'General',
			price: 25,
			isAvailable: true,
		} );
	} );

	it( 'treats a period end as exclusive and a start as inclusive', () => {
		const dayBefore = resolve( {
			eventTiming: { start_date: '2036-06-19', start_time: '23:30' },
		} );
		expect( dayBefore.period.id ).toBe( 1 );
		const startDay = resolve( {
			eventTiming: { start_date: '2036-06-20', start_time: '00:00' },
		} );
		expect( startDay.period.id ).toBe( 2 );
	} );

	it( 'uses the start day of a date without a time', () => {
		const pricing = resolve( {
			eventTiming: {
				start_date: '2036-06-20',
				start_time: '18:00',
				all_day: true,
			},
		} );
		expect( pricing.period.id ).toBe( 2 );
	} );

	it( 'bounds an open last period by the day after the final occurrence', () => {
		// The event itself starts on its last day: still covered.
		expect(
			resolve( { finalOccurrenceDate: '2036-06-20' } ).period.id
		).toBe( 2 );
		// A date after the series' final date is not covered, and the last
		// period does not continue past its end.
		const later = resolve( {
			eventTiming: { start_date: '2036-06-22' },
			finalOccurrenceDate: '2036-06-20',
		} );
		expect( later.status ).toBe( GATE_PRICING_NEEDS_PERIOD );
		expect( later.period ).toBeNull();
	} );

	it( 'infers an empty first start from the creation day', () => {
		const pricing = resolve( {
			config: {
				salePeriods: [
					{ ...periods[ 0 ], sale_start: null },
					periods[ 1 ],
				],
			},
			eventTiming: { start_date: '2035-12-10' },
		} );
		expect( pricing.period.id ).toBe( 1 );
	} );

	it( 'asks for a period when none covers the event start', () => {
		const pricing = resolve( {
			eventTiming: { start_date: '2035-06-01' },
		} );
		expect( pricing.status ).toBe( GATE_PRICING_NEEDS_PERIOD );
		expect( pricing.periods.map( ( p ) => p.id ) ).toEqual( [ 1, 2 ] );
		expect( pricing.tickets.every( ( t ) => t.price === null ) ).toBe(
			true
		);
	} );

	it( 'asks for a period when several cover the event start', () => {
		const pricing = resolve( {
			config: {
				salePeriods: [
					periods[ 0 ],
					{ ...periods[ 1 ], sale_start: '2036-01-01' },
				],
			},
			eventTiming: { start_date: '2036-03-01' },
		} );
		expect( pricing.status ).toBe( GATE_PRICING_NEEDS_PERIOD );
	} );

	it( 'uses a period chosen by the organizer and says so', () => {
		const pricing = resolve( {
			eventTiming: { start_date: '2035-06-01' },
			selectedPeriodId: 1,
		} );
		expect( pricing.status ).toBe( GATE_PRICING_RESOLVED );
		expect( pricing.period.id ).toBe( 1 );
		expect( pricing.isManualPeriod ).toBe( true );
		expect( pricing.tickets[ 0 ].price ).toBe( 20 );
	} );

	it( 'reports no periods, with no ticket prices', () => {
		const pricing = resolve( { config: { salePeriods: [] } } );
		expect( pricing.status ).toBe( GATE_PRICING_NO_PERIODS );
		expect( pricing.tickets.every( ( t ) => t.price === null ) ).toBe(
			true
		);
		expect( pricing.hasMissingPrice ).toBe( true );
	} );

	it( 'keeps an explicit zero and marks an absent price as missing', () => {
		const pricing = resolve();
		const byName = Object.fromEntries(
			pricing.tickets.map( ( t ) => [ t.name, t.price ] )
		);
		expect( byName.Volunteer ).toBe( 0 );
		expect( byName.Reduced ).toBeNull();
		expect( pricing.hasMissingPrice ).toBe( true );
	} );

	it( 'prices fixed and period-priced extras', () => {
		const pricing = resolve();
		expect( pricing.extras.map( ( e ) => e.price ) ).toEqual( [
			14.5,
			10,
			null,
		] );
		const advance = resolve( {
			eventTiming: { start_date: '2036-03-01' },
		} );
		expect( advance.extras.map( ( e ) => e.price ) ).toEqual( [
			14.5, 8, 18,
		] );
	} );

	it( 'marks ticket types switched off or cut off by the event start', () => {
		const pricing = resolve( {
			config: {
				ticketTypes: [
					{ id: 10, name: 'General', disabled: true },
					{
						id: 11,
						name: 'Volunteer',
						disable_at: '2036-06-20 18:00:00',
					},
					{
						id: 12,
						name: 'Reduced',
						disable_at: '2036-06-20 18:00:01',
					},
				],
			},
		} );
		expect( pricing.tickets.map( ( t ) => t.isAvailable ) ).toEqual( [
			false,
			false,
			true,
		] );
	} );
} );

describe( 'gate pricing helpers', () => {
	it( 'builds a comparable start moment', () => {
		expect(
			eventStartMoment( {
				start_date: '2036-06-20',
				start_time: '18:00',
			} )
		).toBe( '2036-06-20 18:00:00' );
		expect( eventStartMoment( { start_date: '2036-06-20' } ) ).toBe(
			'2036-06-20 00:00:00'
		);
		expect( eventStartMoment( null ) ).toBe( '' );
	} );

	it( 'moves to the next day across month and year ends', () => {
		expect( dayAfter( '2036-02-29' ) ).toBe( '2036-03-01' );
		expect( dayAfter( '2036-12-31' ) ).toBe( '2037-01-01' );
	} );

	it( 'never prices a period-priced extra without a period', () => {
		expect( extraPriceForPeriod( options[ 1 ], null ) ).toBeNull();
		expect( extraPriceForPeriod( options[ 0 ], null ) ).toBe( 14.5 );
	} );

	it( 'compares cutoffs with the event start', () => {
		expect(
			isTicketTypeEnabledAt(
				{ disable_at: '2036-06-21 00:00:00' },
				'2036-06-20 18:00:00'
			)
		).toBe( true );
	} );
} );
