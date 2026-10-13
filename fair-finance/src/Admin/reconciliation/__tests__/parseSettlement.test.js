/**
 * Internal dependencies
 */
import { readWorkbookRows } from '../../readSpreadsheet.js';
import { parseSettlementRows } from '../parseSettlement.js';

const HEADER = [
	'ID',
	'Settlement reference',
	'Status',
	'Amount',
	'Settlement amount',
	'Currency',
	'Description',
];

const buildRow = ( {
	id = '',
	reference = '19415110.2605.03',
	status = '',
	amount = 0,
	settlementAmount = 0,
	currency = 'EUR',
	description = '',
} ) => [
	id,
	reference,
	status,
	amount,
	settlementAmount,
	currency,
	description,
];

const validRows = () => [
	[ 'Mollie settlement export' ],
	HEADER,
	buildRow( {
		id: 'tr_jrvX5d2SRpB2chSyrb7RJ',
		status: 'paid',
		amount: 25,
		settlementAmount: 24.5,
		description: 'Ticket A',
	} ),
	buildRow( {
		id: 'tr_aaaBBBcccDDDeeeFFF111',
		status: 'paid',
		amount: 40,
		settlementAmount: 39.2,
		description: 'Ticket B',
	} ),
	buildRow( {
		id: '',
		status: '',
		amount: -1.3,
		settlementAmount: -1.3,
		description: 'Mollie fees',
	} ),
];

describe( 'parseSettlementRows', () => {
	it( 'classifies payment rows vs fee rows and extracts the reference', () => {
		const result = parseSettlementRows( validRows() );

		expect( result.settlement_reference ).toBe( '19415110.2605.03' );
		expect( result.currency ).toBe( 'EUR' );
		expect( result.payment_rows ).toHaveLength( 2 );
		expect( result.fee_rows ).toHaveLength( 1 );

		expect( result.payment_rows[ 0 ] ).toEqual( {
			mollie_payment_id: 'tr_jrvX5d2SRpB2chSyrb7RJ',
			amount: 25,
			status: 'paid',
			description: 'Ticket A',
			settlement_amount: 24.5,
		} );
		expect( result.fee_rows[ 0 ] ).toEqual( {
			description: 'Mollie fees',
			amount: -1.3,
		} );
	} );

	it( 'computes settlement_total from all settlement amount cells', () => {
		const result = parseSettlementRows( validRows() );
		// 24.5 + 39.2 - 1.3
		expect( result.settlement_total ).toBeCloseTo( 62.4, 5 );
	} );

	it( 'parses amounts that carry currency symbols and thousands separators', () => {
		const rows = [
			HEADER,
			buildRow( {
				id: 'tr_withFormattedAmount0001',
				status: 'paid',
				amount: '€1,234.56',
				settlementAmount: '1,200.00',
			} ),
		];
		const result = parseSettlementRows( rows );
		expect( result.payment_rows[ 0 ].amount ).toBeCloseTo( 1234.56, 2 );
		expect( result.settlement_total ).toBeCloseTo( 1200, 2 );
	} );

	it( 'throws when expected columns are missing', () => {
		const rows = [
			[ 'Date', 'Description', 'Value' ],
			[ '2026-05-01', 'Something', 10 ],
		];
		expect( () => parseSettlementRows( rows ) ).toThrow();
	} );

	it( 'throws when there are multiple settlement references', () => {
		const rows = [
			HEADER,
			buildRow( {
				id: 'tr_first0000000000000001',
				reference: 'ref-A',
				amount: 10,
				settlementAmount: 10,
			} ),
			buildRow( {
				id: 'tr_second000000000000002',
				reference: 'ref-B',
				amount: 10,
				settlementAmount: 10,
			} ),
		];
		expect( () => parseSettlementRows( rows ) ).toThrow();
	} );

	it( 'throws when no payment rows are present', () => {
		const rows = [
			HEADER,
			buildRow( {
				id: '',
				amount: -1.3,
				settlementAmount: -1.3,
				description: 'Mollie fees',
			} ),
		];
		expect( () => parseSettlementRows( rows ) ).toThrow();
	} );

	it( 'throws on empty input', () => {
		expect( () => parseSettlementRows( [] ) ).toThrow();
	} );
} );

describe( 'parseSettlementRows with a Mollie settlement CSV file', () => {
	// The column layout of a real Mollie settlement export.
	const CSV = [
		'Date,Payment method,Currency,Amount,Status,ID,Description,Consumer name,Consumer bank account,Consumer BIC,Settlement currency,Settlement amount,Settlement reference,Amount refunded',
		'2026-05-01 10:00:00,ideal,EUR,25.00,paid,tr_jrvX5d2SRpB2chSyrb7RJ,Ticket A,Jane Example,NL00BANK0123456789,,EUR,25.00,19415110.2605.03,',
		'2026-05-01 10:05:00,creditcard,EUR,15.50,paid,tr_aaaBBBcccDDDeeeFFF111,"Ticket B, reduced",,,,EUR,15.50,19415110.2605.03,',
		',,EUR,-1.45,,,Transaction fees ideal,,,,EUR,-1.45,19415110.2605.03,',
		'',
	].join( '\n' );

	it( 'produces the settlement preview payload', () => {
		const rows = readWorkbookRows(
			new Uint8Array( Buffer.from( CSV, 'utf8' ) )
		);

		expect( parseSettlementRows( rows ) ).toEqual( {
			settlement_reference: '19415110.2605.03',
			currency: 'EUR',
			payment_rows: [
				{
					mollie_payment_id: 'tr_jrvX5d2SRpB2chSyrb7RJ',
					amount: 25,
					status: 'paid',
					description: 'Ticket A',
					settlement_amount: 25,
				},
				{
					mollie_payment_id: 'tr_aaaBBBcccDDDeeeFFF111',
					amount: 15.5,
					status: 'paid',
					description: 'Ticket B, reduced',
					settlement_amount: 15.5,
				},
			],
			fee_rows: [
				{ description: 'Transaction fees ideal', amount: -1.45 },
			],
			settlement_total: 25 + 15.5 - 1.45,
		} );
	} );

	it( 'rejects a spreadsheet that is not a settlement export', () => {
		const rows = readWorkbookRows(
			new Uint8Array( Buffer.from( 'Name,Amount\nSomeone,10\n', 'utf8' ) )
		);

		expect( () => parseSettlementRows( rows ) ).toThrow(
			'This does not look like a Mollie settlement export (missing expected columns).'
		);
	} );

	it( 'rejects an empty file', () => {
		expect( () =>
			parseSettlementRows( readWorkbookRows( new Uint8Array( 0 ) ) )
		).toThrow( 'The file is empty or could not be read.' );
	} );
} );
