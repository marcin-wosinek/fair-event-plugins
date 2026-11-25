import { parseMollieCsv } from '../parseMollieCsv.js';

const csv = ( ...rows ) =>
	[ 'ID,Amount,Currency,Status,Description,Date', ...rows ].join( '\n' );

const amounts = ( text ) => parseMollieCsv( text ).map( ( t ) => t.amount );

describe( 'parseMollieCsv amounts', () => {
	it( 'parses decimal amounts', () => {
		expect(
			amounts( csv( 'tr_1,12.50,EUR,paid,,', 'tr_2,0.99,EUR,paid,,' ) )
		).toEqual( [ 12.5, 0.99 ] );
	} );

	it( 'keeps the numeric prefix of an amount with trailing text', () => {
		expect( amounts( csv( 'tr_1,"12.50 EUR",EUR,paid,,' ) ) ).toEqual( [
			12.5,
		] );
	} );

	it( 'stops at a decimal comma, as before', () => {
		expect( amounts( csv( 'tr_1,"12,50",EUR,paid,,' ) ) ).toEqual( [ 12 ] );
	} );

	it( 'falls back to 0 for empty, missing and invalid amounts', () => {
		expect(
			amounts(
				csv(
					'tr_1,,EUR,paid,,',
					'tr_2,abc,EUR,paid,,',
					'tr_3',
					'tr_4,0,EUR,paid,,'
				)
			)
		).toEqual( [ 0, 0, 0, 0 ] );
	} );

	it( 'keeps negative amounts', () => {
		expect( amounts( csv( 'tr_1,-5.25,EUR,refunded,,' ) ) ).toEqual( [
			-5.25,
		] );
	} );
} );
