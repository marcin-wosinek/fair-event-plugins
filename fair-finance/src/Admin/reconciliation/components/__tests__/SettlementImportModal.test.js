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
import SettlementImportModal from '../SettlementImportModal.js';

jest.mock( '@wordpress/api-fetch' );

const CSV = [
	'Date,Payment method,Currency,Amount,Status,ID,Description,Consumer name,Consumer bank account,Consumer BIC,Settlement currency,Settlement amount,Settlement reference,Amount refunded',
	'2026-05-01 10:00:00,ideal,EUR,25.00,paid,tr_jrvX5d2SRpB2chSyrb7RJ,Ticket A,Jane Example,NL00BANK0123456789,,EUR,25.00,19415110.2605.03,',
	'2026-05-01 10:05:00,creditcard,EUR,15.50,paid,tr_aaaBBBcccDDDeeeFFF111,Ticket B,,,,EUR,15.50,19415110.2605.03,',
	',,EUR,-1.45,,,Transaction fees ideal,,,,EUR,-1.45,19415110.2605.03,',
	'',
].join( '\n' );

const PARSED = {
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
			description: 'Ticket B',
			settlement_amount: 15.5,
		},
	],
	fee_rows: [ { description: 'Transaction fees ideal', amount: -1.45 } ],
	settlement_total: 25 + 15.5 - 1.45,
};

const REPORT = {
	settlement_reference: '19415110.2605.03',
	currency: 'EUR',
	settlement_total: 39.05,
	payments_total: 40.5,
	fees_total: -1.45,
	payment_count: 2,
	matched: [ { transaction_id: 11 }, { transaction_id: 12 } ],
	unmatched_csv_rows: [],
	transactions_without_csv: [],
	fee_reconciliation: { difference: 0 },
	suggested_entry: { id: 7, amount: 39.05, entry_date: '2026-05-04' },
	alternative_entries: [],
	resolved_transaction_ids: [ 11, 12 ],
};

const settlement = () => new File( [ CSV ], 'settlement.csv' );

const corruptWorkbook = () =>
	new File(
		[
			readFileSync(
				join(
					__dirname,
					'../../../entries/__tests__/fixtures/bank-entries.xlsx'
				)
			).subarray( 0, 400 ),
		],
		'broken.xlsx'
	);

const dialog = () => within( screen.getByRole( 'dialog' ) );

const chooseFile = ( file ) =>
	fireEvent.change( document.querySelector( 'input[type="file"]' ), {
		target: { files: [ file ] },
	} );

const confirmButton = () =>
	dialog().getByRole( 'button', { name: 'Confirm Match' } );

const expectNoReport = () => {
	expect(
		dialog().queryByText( 'Settlement 19415110.2605.03' )
	).not.toBeInTheDocument();
	expect( dialog().queryByText( 'Parsing file…' ) ).not.toBeInTheDocument();
	expect(
		dialog().queryByText( 'Matching settlement…' )
	).not.toBeInTheDocument();
	expect( confirmButton() ).toBeDisabled();
};

describe( 'SettlementImportModal', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		render(
			<SettlementImportModal
				onImport={ jest.fn() }
				onCancel={ jest.fn() }
			/>
		);
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'previews a settlement CSV and matches it to the suggested entry', async () => {
		apiFetch.mockResolvedValueOnce( REPORT ).mockResolvedValueOnce( {} );

		expect( confirmButton() ).toBeDisabled();
		chooseFile( settlement() );

		expect(
			await dialog().findByText( 'Settlement 19415110.2605.03' )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-finance/v1/reconciliation/settlement/preview',
			method: 'POST',
			data: PARSED,
		} );

		await waitFor( () => expect( confirmButton() ).toBeEnabled() );
		fireEvent.click( confirmButton() );

		expect(
			await dialog().findByText( 'Settlement matched successfully.' )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-finance/v1/financial-entries/7/match',
			method: 'POST',
			data: { transaction_ids: [ 11, 12 ] },
		} );
	} );

	it.each( [
		[ 'a corrupt workbook', corruptWorkbook, 'Failed to parse file.' ],
		[
			'an empty file',
			() => new File( [], 'empty.csv' ),
			'The file is empty or could not be read.',
		],
		[
			'a file without the settlement columns',
			() => new File( [ 'Name,Amount\nSomeone,10\n' ], 'other.csv' ),
			'This does not look like a Mollie settlement export (missing expected columns).',
		],
		[
			'a settlement without payment rows',
			() =>
				new File(
					[
						CSV.split( '\n' )
							.filter( ( line ) => ! line.includes( 'tr_' ) )
							.join( '\n' ),
					],
					'fees-only.csv'
				),
			'No payment rows found in the settlement file.',
		],
	] )(
		'reports %s without asking for a match',
		async ( label, make, message ) => {
			chooseFile( make() );

			expect( await dialog().findByText( message ) ).toBeInTheDocument();
			expectNoReport();

			fireEvent.click( confirmButton() );
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

		chooseFile( settlement() );

		expect(
			await dialog().findByText( 'Failed to read file.' )
		).toBeInTheDocument();
		expectNoReport();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'reports a failed preview and stops loading', async () => {
		apiFetch.mockRejectedValueOnce(
			new Error( 'Preview is unavailable.' )
		);

		chooseFile( settlement() );

		expect(
			await dialog().findByText( 'Preview is unavailable.' )
		).toBeInTheDocument();
		expectNoReport();
	} );

	it( 'drops the report for a broken file and recovers with a valid one', async () => {
		apiFetch.mockResolvedValue( REPORT );

		chooseFile( settlement() );
		expect(
			await dialog().findByText( 'Settlement 19415110.2605.03' )
		).toBeInTheDocument();

		chooseFile( corruptWorkbook() );
		expect(
			await dialog().findByText( 'Failed to parse file.' )
		).toBeInTheDocument();
		expectNoReport();
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );

		chooseFile( settlement() );
		expect(
			await dialog().findByText( 'Settlement 19415110.2605.03' )
		).toBeInTheDocument();
		expect(
			dialog().queryByText( 'Failed to parse file.' )
		).not.toBeInTheDocument();
		await waitFor( () => expect( confirmButton() ).toBeEnabled() );
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'ignores a preview that arrives after a broken file was chosen', async () => {
		let resolvePreview;
		apiFetch.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				resolvePreview = resolve;
			} )
		);

		chooseFile( settlement() );
		expect(
			await dialog().findByText( 'Matching settlement…' )
		).toBeInTheDocument();

		chooseFile( corruptWorkbook() );
		expect(
			await dialog().findByText( 'Failed to parse file.' )
		).toBeInTheDocument();

		await act( async () => {
			resolvePreview( REPORT );
		} );

		expect(
			dialog().getByText( 'Failed to parse file.' )
		).toBeInTheDocument();
		expectNoReport();
	} );
} );
