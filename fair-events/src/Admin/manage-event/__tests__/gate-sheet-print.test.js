/**
 * @jest-environment jsdom
 *
 * Document of the printable gate sheet (#2212): event heading, the price
 * reference with currency and warnings, and blank registration pages with
 * all eight fields and unchecked mailing boxes.
 */
import {
	buildGateSheetHtml,
	gatePricingWarnings,
	gatePriceText,
	gateSheetColumns,
} from '../gate-sheet-print.js';

const resolvedPricing = {
	status: 'resolved',
	period: { id: 2, name: 'Day of event' },
	isManualPeriod: false,
	periods: [],
	tickets: [
		{ id: 10, name: 'General', price: 25, isAvailable: true },
		{ id: 11, name: 'Volunteer', price: 0, isAvailable: true },
		{ id: 12, name: 'Reduced', price: null, isAvailable: true },
		{ id: 13, name: 'Early bird', price: 15, isAvailable: false },
	],
	extras: [
		{ id: 20, name: 'Dinner', price: 14.5 },
		{ id: 21, name: 'T-shirt', price: null },
	],
	hasMissingPrice: true,
};

function parse( pricing = resolvedPricing, overrides = {} ) {
	const html = buildGateSheetHtml( {
		title: 'Summer Fest',
		dateLabel: 'June 20, 2036, 6:00 pm',
		currency: 'EUR',
		pricing,
		warnings: gatePricingWarnings( pricing ),
		...overrides,
	} );
	return new DOMParser().parseFromString( html, 'text/html' );
}

describe( 'buildGateSheetHtml', () => {
	it( 'names the event and date', () => {
		const doc = parse();
		expect( doc.querySelector( 'h1' ).textContent ).toBe( 'Summer Fest' );
		expect( doc.querySelector( 'header .meta' ).textContent ).toContain(
			'June 20, 2036, 6:00 pm'
		);
		expect( doc.title ).toContain( 'Summer Fest' );
	} );

	it( 'prints ticket and extra prices with currency, keeping zero and naming missing prices', () => {
		const doc = parse();
		const [ ticketTable, extraTable ] =
			doc.querySelectorAll( 'table.reference' );
		const ticketRows = [
			...ticketTable.querySelectorAll( 'tbody tr' ),
		].map( ( row ) =>
			[ ...row.querySelectorAll( 'td' ) ].map( ( td ) => td.textContent )
		);
		expect( ticketRows ).toEqual( [
			[ 'General', '25.00 EUR', 'Available' ],
			[ 'Volunteer', '0.00 EUR', 'Available' ],
			[ 'Reduced', 'Price not configured', 'Available' ],
			[ 'Early bird', '15.00 EUR', 'Not available at the event' ],
		] );
		expect( extraTable.textContent ).toContain( '14.50 EUR' );
		expect( extraTable.textContent ).toContain( 'Price not configured' );
		expect( doc.querySelector( '.period' ).textContent ).toContain(
			'Day of event (applies at the event start)'
		);
		expect( doc.querySelector( '.period' ).textContent ).toContain(
			'Currency: EUR'
		);
	} );

	it( 'warns about missing prices', () => {
		const warnings = [ ...parse().querySelectorAll( '.warning' ) ].map(
			( p ) => p.textContent
		);
		expect( warnings ).toEqual( [
			'Some prices are not configured. Do not treat them as free; check the Prices tab.',
		] );
	} );

	it( 'says when the period was chosen manually', () => {
		const doc = parse( {
			...resolvedPricing,
			isManualPeriod: true,
			hasMissingPrice: false,
		} );
		expect( doc.querySelector( '.period' ).textContent ).toContain(
			'Day of event (chosen manually)'
		);
		expect( doc.querySelectorAll( '.warning' ) ).toHaveLength( 1 );
		expect( doc.querySelector( '.warning' ).textContent ).toContain(
			'chosen when printing'
		);
	} );

	it( 'prints an unpriced sheet with a warning when no period applies', () => {
		const doc = parse( {
			...resolvedPricing,
			status: 'no_periods',
			period: null,
			tickets: [
				{ id: 10, name: 'General', price: null, isAvailable: true },
			],
		} );
		expect( doc.querySelector( '.warning' ).textContent ).toContain(
			'No pricing period applies'
		);
		expect( doc.querySelector( 'table.reference' ).textContent ).toContain(
			'Price not configured'
		);
	} );

	it( 'has two blank pages with all eight fields and unchecked boxes', () => {
		const doc = parse();
		const sheets = doc.querySelectorAll( 'table.sheet' );
		expect( sheets ).toHaveLength( 2 );
		sheets.forEach( ( sheet ) => {
			expect(
				[ ...sheet.querySelectorAll( 'thead th' ) ].map(
					( th ) => th.textContent
				)
			).toEqual( [
				'Name',
				'Surname',
				'Email',
				'Mailing opt-in',
				'Ticket type',
				'Extra options',
				'Total',
				'Comments',
			] );
			const rows = sheet.querySelectorAll( 'tbody tr' );
			expect( rows ).toHaveLength( 10 );
			rows.forEach( ( row ) => {
				expect( row.textContent.trim() ).toBe( '' );
				expect( row.querySelectorAll( '.box' ) ).toHaveLength( 1 );
			} );
		} );
		expect( doc.querySelectorAll( 'input' ) ).toHaveLength( 0 );
		expect( doc.body.textContent ).toContain(
			'An empty box means no consent.'
		);
	} );

	it( 'repeats headings, keeps rows whole and starts each blank page anew', () => {
		const style = parse().querySelector( 'style' ).textContent;
		expect( style ).toContain( 'thead { display: table-header-group; }' );
		expect( style ).toContain( 'break-inside: avoid' );
		expect( style ).toContain( 'break-before: page' );
		expect( style ).toContain( 'size: landscape' );
		const widths = gateSheetColumns().reduce(
			( sum, column ) => sum + column.width,
			0
		);
		expect( widths ).toBe( 100 );
	} );

	it( 'escapes names and titles', () => {
		const doc = parse(
			{
				...resolvedPricing,
				tickets: [
					{
						id: 1,
						name: '<img src=x onerror=alert(1)>',
						price: 1,
						isAvailable: true,
					},
				],
			},
			{ title: '<script>bad()</script>' }
		);
		expect( doc.querySelectorAll( 'script' ) ).toHaveLength( 0 );
		expect( doc.querySelectorAll( 'img' ) ).toHaveLength( 0 );
		expect( doc.querySelector( 'h1' ).textContent ).toBe(
			'<script>bad()</script>'
		);
	} );
} );

describe( 'gatePriceText', () => {
	it( 'never prints a missing price as zero', () => {
		expect( gatePriceText( null, 'EUR' ) ).toBe( 'Price not configured' );
		expect( gatePriceText( 0, 'EUR' ) ).toBe( '0.00 EUR' );
	} );
} );
