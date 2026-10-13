/**
 * @jest-environment jsdom
 */

/**
 * External dependencies
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Internal dependencies
 */
import { readSpreadsheetFile, readWorkbookRows } from '../readSpreadsheet.js';

const fixture = ( name ) =>
	readFileSync( join( __dirname, '../entries/__tests__/fixtures', name ) );

const bytes = ( text ) => new Uint8Array( Buffer.from( text, 'utf8' ) );

// The first sheet of both bank-export fixtures.
const BANK_ROWS = [
	[ 'Movimientos de cuenta' ],
	[],
	[ 'Cuenta: ES00 0000 0000 0000 0000 0000' ],
	[
		'Fecha operación',
		'Fecha valor',
		'Concepto',
		'Importe',
		'Saldo',
		'Nº apunte',
	],
	[ 46143, 46143, 'TRANSFERENCIA DE MOLLIE', 38.55, 1038.55, 1001 ],
	[ 46144, 46144, 'ALQUILER SALA', -250, 788.55, 1002 ],
	[ 46145, 46145, 'CUOTA SOCIO', 20.5, 809.05 ],
	[ 'Saldo final', undefined, undefined, 809.05 ],
];

describe( 'readWorkbookRows', () => {
	it.each( [ 'bank-entries.xlsx', 'bank-entries.xls' ] )(
		'reads the first sheet of %s as raw rows',
		( name ) => {
			const rows = readWorkbookRows( new Uint8Array( fixture( name ) ) );

			expect( rows ).toHaveLength( BANK_ROWS.length );
			BANK_ROWS.forEach( ( expected, index ) => {
				expect( Array.from( rows[ index ] ) ).toEqual( expected );
			} );
		}
	);

	it( 'reads CSV text, keeping identifiers and references as strings', () => {
		const rows = readWorkbookRows(
			bytes(
				'ID,Amount,Settlement reference\ntr_abc123,25.00,19415110.2605.03\n'
			)
		);

		expect( rows ).toEqual( [
			[ 'ID', 'Amount', 'Settlement reference' ],
			[ 'tr_abc123', 25, '19415110.2605.03' ],
		] );
	} );

	it( 'returns no rows for an empty file', () => {
		expect( readWorkbookRows( new Uint8Array( 0 ) ) ).toEqual( [] );
	} );

	it.each( [
		[ 'a truncated .xlsx', () => fixture( 'bank-entries.xlsx' ), 400 ],
		[ 'a truncated .xls', () => fixture( 'bank-entries.xls' ), 600 ],
	] )(
		'reports %s as a file that cannot be parsed',
		( label, read, size ) => {
			const corrupt = new Uint8Array( read().subarray( 0, size ) );

			expect( () => readWorkbookRows( corrupt ) ).toThrow(
				'Failed to parse file.'
			);
		}
	);

	it( 'does not let a workbook pollute Object.prototype', () => {
		readWorkbookRows(
			bytes( '__proto__,constructor\npolluted,prototype\n' )
		);

		expect( {}.polluted ).toBeUndefined();
		expect( Object.prototype.polluted ).toBeUndefined();
	} );
} );

describe( 'readSpreadsheetFile', () => {
	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'resolves with the rows of the selected file', async () => {
		const file = new File(
			[ fixture( 'bank-entries.xlsx' ) ],
			'bank-entries.xlsx'
		);

		const rows = await readSpreadsheetFile( file );

		expect( Array.from( rows[ 4 ] ) ).toEqual( BANK_ROWS[ 4 ] );
	} );

	it( 'rejects with a parse error for a corrupt file', async () => {
		const file = new File(
			[ fixture( 'bank-entries.xlsx' ).subarray( 0, 400 ) ],
			'broken.xlsx'
		);

		await expect( readSpreadsheetFile( file ) ).rejects.toThrow(
			'Failed to parse file.'
		);
	} );

	it( 'rejects with a read error when the file cannot be read', async () => {
		jest.spyOn(
			window.FileReader.prototype,
			'readAsArrayBuffer'
		).mockImplementation( function () {
			this.onerror();
		} );

		await expect(
			readSpreadsheetFile( new File( [ 'x' ], 'gone.xlsx' ) )
		).rejects.toThrow( 'Failed to read file.' );
	} );
} );
