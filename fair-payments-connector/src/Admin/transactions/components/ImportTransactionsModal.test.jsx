import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ImportTransactionsModal from './ImportTransactionsModal.js';

jest.mock( '@wordpress/api-fetch' );

beforeEach( () => {
	window.fairPaymentTransactions = {
		externalUpdatesUrl:
			'/wp-admin/admin.php?page=fair-payments-connector-external-updates',
	};
	apiFetch.mockReset();
} );

it( 'offers only file import and points to External Updates for Mollie and connected sites (#1695)', () => {
	render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ jest.fn() }
		/>
	);

	expect(
		screen.queryByRole( 'button', { name: 'Import from Mollie' } )
	).not.toBeInTheDocument();
	expect(
		screen.queryByRole( 'button', { name: 'Connected Sites' } )
	).not.toBeInTheDocument();
	expect(
		screen.getByRole( 'link', { name: 'Open External Updates' } )
	).toHaveAttribute(
		'href',
		'/wp-admin/admin.php?page=fair-payments-connector-external-updates'
	);
} );

it( 'imports transactions from a JSON file', async () => {
	apiFetch.mockResolvedValueOnce( {
		message: 'Imported 1 new, updated 0, skipped 0 transaction(s).',
	} );
	const onImported = jest.fn();
	const { container } = render(
		<ImportTransactionsModal
			onClose={ jest.fn() }
			onImported={ onImported }
		/>
	);

	const file = new File(
		[ JSON.stringify( [ { mollie_payment_id: 'tr_file', amount: 5 } ] ) ],
		'transactions.json',
		{ type: 'application/json' }
	);
	file.text = () =>
		Promise.resolve(
			JSON.stringify( [ { mollie_payment_id: 'tr_file', amount: 5 } ] )
		);
	fireEvent.change(
		container.ownerDocument.querySelector( 'input[type="file"]' ),
		{
			target: { files: [ file ] },
		}
	);

	await waitFor( () =>
		expect( onImported ).toHaveBeenCalledWith(
			'Imported 1 new, updated 0, skipped 0 transaction(s).'
		)
	);
	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( {
			path: '/fair-payments-connector/v1/transactions/import',
			data: {
				transactions: [ { mollie_payment_id: 'tr_file', amount: 5 } ],
			},
		} )
	);
} );
