/**
 * External dependencies
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Internal dependencies
 */
import { readWorkbookRows } from '../../readSpreadsheet.js';
import { parseEntryRows } from '../parseEntries.js';

const fixtureRows = ( name ) =>
	readWorkbookRows(
		new Uint8Array( readFileSync( join( __dirname, 'fixtures', name ) ) )
	);

const HEADER = [ 'Fecha operación', 'Fecha valor', 'Concepto', 'Importe' ];

describe( 'parseEntryRows', () => {
	it.each( [ 'bank-entries.xlsx', 'bank-entries.xls' ] )(
		'turns the bank export %s into the import payload',
		( name ) => {
			expect( parseEntryRows( fixtureRows( name ) ) ).toEqual( [
				{
					entry_date: '2026-05-01',
					description: 'TRANSFERENCIA DE MOLLIE',
					amount: 38.55,
					entry_type: 'income',
					external_reference: 'import_2026-05-01_1001_38.55',
				},
				{
					entry_date: '2026-05-02',
					description: 'ALQUILER SALA',
					amount: 250,
					entry_type: 'cost',
					external_reference: 'import_2026-05-02_1002_-250',
				},
				{
					// No entry number in the file: the row index stands in.
					entry_date: '2026-05-03',
					description: 'CUOTA SOCIO',
					amount: 20.5,
					entry_type: 'income',
					external_reference: 'import_2026-05-03_6_20.5',
				},
			] );
		}
	);

	it( 'finds a Catalan header row', () => {
		const entries = parseEntryRows( [
			[ "Data de l'operació", 'Data valor', 'Concepte', 'Import' ],
			[ 46143, 46143, 'QUOTA', 12 ],
		] );

		expect( entries ).toEqual( [
			{
				entry_date: '2026-05-01',
				description: 'QUOTA',
				amount: 12,
				entry_type: 'income',
				external_reference: 'import_2026-05-01_1_12',
			},
		] );
	} );

	it( 'skips rows that are short or do not start with a date serial', () => {
		const entries = parseEntryRows( [
			HEADER,
			[ '01/05/2026', '01/05/2026', 'TEXT DATE', 5 ],
			[ 46143, 46143, 'SHORT' ],
			[],
			[ 46144, 46144, 'KEPT', -7.25, 0, 77 ],
		] );

		expect( entries ).toEqual( [
			{
				entry_date: '2026-05-02',
				description: 'KEPT',
				amount: 7.25,
				entry_type: 'cost',
				external_reference: 'import_2026-05-02_77_-7.25',
			},
		] );
	} );

	it.each( [
		[ 'no rows', [] ],
		[ 'something that is not a list of rows', undefined ],
		[
			'rows without a date column',
			[
				[ 'Name', 'Amount' ],
				[ 'A', 1 ],
			],
		],
	] )( 'rejects %s as a file without a header row', ( label, rows ) => {
		expect( () => parseEntryRows( rows ) ).toThrow(
			'Could not find header row in the file.'
		);
	} );

	it( 'rejects a file whose header is followed by no usable rows', () => {
		expect( () =>
			parseEntryRows( [ HEADER, [ 'Saldo final', '', '', 10 ] ] )
		).toThrow( 'No valid entries found in the file.' );
	} );
} );
