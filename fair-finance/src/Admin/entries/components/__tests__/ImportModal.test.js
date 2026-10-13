/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import apiFetch from '@wordpress/api-fetch';
import ImportModal from '../ImportModal.js';

jest.mock( '@wordpress/api-fetch' );

const fixture = ( name ) =>
	readFileSync( join( __dirname, '../../__tests__/fixtures', name ) );

const workbook = ( name = 'bank-entries.xlsx' ) =>
	new File( [ fixture( name ) ], name );

const corruptWorkbook = () =>
	new File(
		[ fixture( 'bank-entries.xlsx' ).subarray( 0, 400 ) ],
		'broken.xlsx'
	);

const ENTRIES = [
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
		entry_date: '2026-05-03',
		description: 'CUOTA SOCIO',
		amount: 20.5,
		entry_type: 'income',
		external_reference: 'import_2026-05-03_6_20.5',
	},
];

const dialog = () => within( screen.getByRole( 'dialog' ) );

const chooseFile = ( file ) =>
	fireEvent.change( document.querySelector( 'input[type="file"]' ), {
		target: { files: [ file ] },
	} );

const importButton = () => dialog().getByRole( 'button', { name: 'Import' } );

const expectNoPreview = () => {
	expect( dialog().queryByText( 'Preview' ) ).not.toBeInTheDocument();
	expect( dialog().queryByText( 'Parsing file...' ) ).not.toBeInTheDocument();
	expect( importButton() ).toBeDisabled();
};

describe( 'ImportModal', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		render( <ImportModal onImport={ jest.fn() } onCancel={ jest.fn() } /> );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it.each( [ 'bank-entries.xlsx', 'bank-entries.xls' ] )(
		'previews %s and imports its entries',
		async ( name ) => {
			apiFetch.mockResolvedValue( {
				imported: 0,
				skipped: 3,
				message: 'Imported 0 entries, skipped 3.',
			} );

			expect( importButton() ).toBeDisabled();
			chooseFile( workbook( name ) );

			expect(
				await dialog().findByText( 'TRANSFERENCIA DE MOLLIE' )
			).toBeInTheDocument();
			expect( dialog().getByText( 'ALQUILER SALA' ) ).toBeInTheDocument();
			expect( dialog().getByText( 'CUOTA SOCIO' ) ).toBeInTheDocument();
			expect( apiFetch ).not.toHaveBeenCalled();

			fireEvent.click( importButton() );

			expect(
				await dialog().findByText( 'Imported 0 entries, skipped 3.' )
			).toBeInTheDocument();
			expect( apiFetch ).toHaveBeenCalledTimes( 1 );
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-finance/v1/financial-entries/import',
				method: 'POST',
				data: { entries: ENTRIES, import_source: name },
			} );
		}
	);

	it.each( [
		[ 'a corrupt workbook', corruptWorkbook, 'Failed to parse file.' ],
		[
			'an empty file',
			() => new File( [], 'empty.xlsx' ),
			'Could not find header row in the file.',
		],
		[
			'a file without the expected header',
			() => new File( [ 'Name,Amount\nSomeone,10\n' ], 'other.csv' ),
			'Could not find header row in the file.',
		],
		[
			'a file with a header and no entries',
			() => new File( [ 'Fecha,Concepto\n' ], 'no-rows.csv' ),
			'No valid entries found in the file.',
		],
		[
			'a file that is not a spreadsheet',
			() =>
				new File(
					[ new Uint8Array( [ 0x89, 0x50, 0x4e, 0x47, 0, 1, 2 ] ) ],
					'picture.png'
				),
			'Failed to parse file.',
		],
	] )(
		'reports %s and offers nothing to import',
		async ( label, make, message ) => {
			chooseFile( make() );

			expect( await dialog().findByText( message ) ).toBeInTheDocument();
			expectNoPreview();

			fireEvent.click( importButton() );
			expect( apiFetch ).not.toHaveBeenCalled();
		}
	);

	it( 'reports a file that cannot be read', async () => {
		jest.spyOn(
			window.FileReader.prototype,
			'readAsArrayBuffer'
		).mockImplementation( function () {
			this.onerror();
		} );

		chooseFile( workbook() );

		expect(
			await dialog().findByText( 'Failed to read file.' )
		).toBeInTheDocument();
		expectNoPreview();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'drops the preview for a broken file and recovers with a valid one', async () => {
		apiFetch.mockResolvedValue( {
			imported: 0,
			skipped: 3,
			message: 'Imported 0 entries, skipped 3.',
		} );

		chooseFile( workbook() );
		expect( await dialog().findByText( 'Preview' ) ).toBeInTheDocument();

		chooseFile( corruptWorkbook() );
		expect(
			await dialog().findByText( 'Failed to parse file.' )
		).toBeInTheDocument();
		expectNoPreview();

		chooseFile( workbook( 'bank-entries.xls' ) );
		expect( await dialog().findByText( 'Preview' ) ).toBeInTheDocument();
		expect(
			dialog().queryByText( 'Failed to parse file.' )
		).not.toBeInTheDocument();

		fireEvent.click( importButton() );
		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].data ).toEqual( {
			entries: ENTRIES,
			import_source: 'bank-entries.xls',
		} );
	} );
} );
