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
	act,
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

const ACCOUNTS_PATH = '/fair-finance/v1/bank-accounts';
const IMPORT_PATH = '/fair-finance/v1/financial-entries/import';

// Responses by request; each test sets what it needs.
let api;

const importCalls = () =>
	apiFetch.mock.calls.filter(
		( [ options ] ) => options.path === IMPORT_PATH
	);

const expectNoPreview = () => {
	expect( dialog().queryByText( 'Preview' ) ).not.toBeInTheDocument();
	expect( dialog().queryByText( 'Parsing file...' ) ).not.toBeInTheDocument();
	expect( importButton() ).toBeDisabled();
};

describe( 'ImportModal', () => {
	beforeEach( async () => {
		api = {
			accounts: () => Promise.resolve( [] ),
			createAccount: () => new Promise( () => {} ),
			import: () => new Promise( () => {} ),
		};
		apiFetch.mockReset();
		apiFetch.mockImplementation( ( options ) => {
			if ( options.path === ACCOUNTS_PATH ) {
				return 'POST' === options.method
					? api.createAccount( options )
					: api.accounts();
			}
			return api.import( options );
		} );
		render( <ImportModal onImport={ jest.fn() } onCancel={ jest.fn() } /> );
		// Let the bank-account list settle before each test acts.
		await act( async () => {} );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it.each( [ 'bank-entries.xlsx', 'bank-entries.xls' ] )(
		'previews %s and imports its entries',
		async ( name ) => {
			api.import = () =>
				Promise.resolve( {
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
			expect( importCalls() ).toHaveLength( 0 );

			fireEvent.click( importButton() );

			expect(
				await dialog().findByText( 'Imported 0 entries, skipped 3.' )
			).toBeInTheDocument();
			expect( importCalls() ).toEqual( [
				[
					{
						path: IMPORT_PATH,
						method: 'POST',
						data: {
							entries: ENTRIES,
							import_source: name,
							bank_account_id: null,
						},
					},
				],
			] );
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
			expect( importCalls() ).toHaveLength( 0 );
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
		expect( importCalls() ).toHaveLength( 0 );
	} );

	it( 'drops the preview for a broken file and recovers with a valid one', async () => {
		api.import = () =>
			Promise.resolve( {
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
		await waitFor( () => expect( importCalls() ).toHaveLength( 1 ) );
		expect( importCalls()[ 0 ][ 0 ].data ).toEqual( {
			entries: ENTRIES,
			import_source: 'bank-entries.xls',
			bank_account_id: null,
		} );
		expect(
			await dialog().findByText( 'Imported 0 entries, skipped 3.' )
		).toBeInTheDocument();
	} );
} );

describe( 'ImportModal bank account', () => {
	const ACCOUNTS = [
		{ id: 3, name: 'Savings' },
		{ id: 2, name: 'Main account' },
	];

	let importRequests;
	let createRequests;

	const renderModal = ( { accounts, createAccount } = {} ) => {
		importRequests = [];
		createRequests = [];
		apiFetch.mockReset();
		apiFetch.mockImplementation( ( options ) => {
			if ( options.path === ACCOUNTS_PATH ) {
				if ( 'POST' === options.method ) {
					createRequests.push( options.data );
					return createAccount( options );
				}
				return accounts ? accounts() : Promise.resolve( ACCOUNTS );
			}
			importRequests.push( options.data );
			return Promise.resolve( {
				imported: 3,
				skipped: 0,
				message: 'Imported 3 entries, skipped 0.',
			} );
		} );
		render( <ImportModal onImport={ jest.fn() } onCancel={ jest.fn() } /> );
	};

	const accountSelect = () => dialog().getByLabelText( 'Bank account' );

	it( 'imports with the selected account', async () => {
		renderModal();
		expect(
			await dialog().findByRole( 'option', { name: 'Main account' } )
		).toBeInTheDocument();
		expect( accountSelect() ).toHaveValue( '' );
		expect(
			dialog().getByRole( 'option', { name: 'Account unknown' } )
		).toBeInTheDocument();

		fireEvent.change( accountSelect(), { target: { value: '2' } } );
		chooseFile( workbook() );
		expect( await dialog().findByText( 'Preview' ) ).toBeInTheDocument();
		fireEvent.click( importButton() );

		expect(
			await dialog().findByText( 'Imported 3 entries, skipped 0.' )
		).toBeInTheDocument();
		expect( importRequests ).toEqual( [
			{
				entries: ENTRIES,
				import_source: 'bank-entries.xlsx',
				bank_account_id: 2,
			},
		] );
	} );

	it( 'creates an account inline and selects it', async () => {
		renderModal( {
			createAccount: ( { data } ) =>
				Promise.resolve( { id: 9, name: data.name } ),
		} );
		await dialog().findByRole( 'option', { name: 'Main account' } );

		fireEvent.click(
			dialog().getByRole( 'button', { name: 'Add bank account' } )
		);
		fireEvent.click(
			dialog().getByRole( 'button', { name: 'Add account' } )
		);
		expect(
			dialog().getByText( 'Enter a name for the bank account.' )
		).toBeInTheDocument();
		expect( createRequests ).toHaveLength( 0 );

		fireEvent.change( dialog().getByLabelText( 'New bank account name' ), {
			target: { value: '  Business current  ' },
		} );
		fireEvent.click(
			dialog().getByRole( 'button', { name: 'Add account' } )
		);

		await waitFor( () => expect( accountSelect() ).toHaveValue( '9' ) );
		expect( createRequests ).toEqual( [ { name: 'Business current' } ] );
		expect(
			dialog().queryByLabelText( 'New bank account name' )
		).not.toBeInTheDocument();

		chooseFile( workbook() );
		expect( await dialog().findByText( 'Preview' ) ).toBeInTheDocument();
		fireEvent.click( importButton() );
		await waitFor( () => expect( importRequests ).toHaveLength( 1 ) );
		expect( importRequests[ 0 ].bank_account_id ).toBe( 9 );
		expect(
			await dialog().findByText( 'Imported 3 entries, skipped 0.' )
		).toBeInTheDocument();
	} );

	it( 'keeps the typed name and shows the error when creation fails', async () => {
		renderModal( {
			createAccount: () =>
				Promise.reject( { message: 'Name is too long.' } ),
		} );
		await dialog().findByRole( 'option', { name: 'Main account' } );

		fireEvent.click(
			dialog().getByRole( 'button', { name: 'Add bank account' } )
		);
		fireEvent.change( dialog().getByLabelText( 'New bank account name' ), {
			target: { value: 'Shared' },
		} );
		fireEvent.click(
			dialog().getByRole( 'button', { name: 'Add account' } )
		);

		expect(
			await dialog().findByText( 'Name is too long.' )
		).toBeInTheDocument();
		expect(
			dialog().getByLabelText( 'New bank account name' )
		).toHaveValue( 'Shared' );
		expect( accountSelect() ).toHaveValue( '' );
	} );

	it( 'still imports with the account unknown when accounts fail to load', async () => {
		renderModal( { accounts: () => Promise.reject( new Error( 'x' ) ) } );

		expect(
			await dialog().findByText(
				'Bank accounts could not be loaded. You can still import with the account unknown.'
			)
		).toBeInTheDocument();
		chooseFile( workbook() );
		expect( await dialog().findByText( 'Preview' ) ).toBeInTheDocument();
		fireEvent.click( importButton() );
		await waitFor( () => expect( importRequests ).toHaveLength( 1 ) );
		expect( importRequests[ 0 ].bank_account_id ).toBeNull();
		expect(
			await dialog().findByText( 'Imported 3 entries, skipped 0.' )
		).toBeInTheDocument();
	} );
} );
