import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
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

/**
 * A File whose text() resolves, which jsdom's File lacks.
 *
 * @param {string} name    File name.
 * @param {string} content File contents.
 * @return {File} File
 */
function textFile( name, content ) {
	const file = new File( [ content ], name );
	file.text = () => Promise.resolve( content );
	return file;
}

function renderImport() {
	const onClose = jest.fn();
	const onImported = jest.fn();
	const { container } = render(
		<ImportTransactionsModal
			onClose={ onClose }
			onImported={ onImported }
		/>
	);
	const input = container.ownerDocument.querySelector( 'input[type="file"]' );
	const choose = ( file ) =>
		fireEvent.change( input, { target: { files: [ file ] } } );
	return { onClose, onImported, input, choose };
}

const importCalls = () =>
	apiFetch.mock.calls.filter(
		( [ options ] ) =>
			options.path === '/fair-payments-connector/v1/transactions/import'
	);

const errorNotice = ( text ) =>
	screen.queryByText( text, { selector: '.components-notice__content' } );

it( 'blocks dismissal, the file input, External Updates and a second import while importing (#1934)', async () => {
	let finish;
	apiFetch.mockImplementation(
		() =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} )
	);
	const { onClose, onImported, input, choose } = renderImport();
	const file = textFile(
		'transactions.json',
		JSON.stringify( [ { mollie_payment_id: 'tr_one' } ] )
	);

	// Both selections land before React re-renders the popup.
	await act( async () => {
		choose( file );
		choose( file );
	} );

	expect( importCalls() ).toHaveLength( 1 );
	expect( input ).toBeDisabled();
	expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toBeDisabled();
	expect(
		screen.queryByRole( 'button', { name: 'Close' } )
	).not.toBeInTheDocument();
	fireEvent.keyDown( screen.getByRole( 'dialog' ), {
		key: 'Escape',
		code: 'Escape',
	} );
	expect( onClose ).not.toHaveBeenCalled();
	const link = screen.getByRole( 'link', { name: 'Open External Updates' } );
	expect( link ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( fireEvent.click( link ) ).toBe( false );

	await act( async () => {
		finish( { message: 'Imported 1 new transaction(s).' } );
	} );
	expect( onImported ).toHaveBeenCalledWith(
		'Imported 1 new transaction(s).'
	);
} );

it( 'keeps a failed JSON import for a retry without choosing the file again (#1934)', async () => {
	apiFetch
		.mockRejectedValueOnce( new Error( 'Database unavailable.' ) )
		.mockRejectedValueOnce( {} )
		.mockResolvedValueOnce( { message: 'Imported 1 new.' } );
	const { onClose, onImported, input, choose } = renderImport();
	const transactions = [ { mollie_payment_id: 'tr_one', amount: 5 } ];

	choose(
		textFile(
			'transactions.json',
			JSON.stringify( [ ...transactions, { amount: 9 } ] )
		)
	);

	expect(
		await screen.findByText( 'Database unavailable.', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
	expect(
		screen.getByText(
			'transactions.json: 1 transaction is ready to import again.'
		)
	).toBeInTheDocument();
	expect( input ).toBeEnabled();
	expect( onClose ).not.toHaveBeenCalled();

	// Without a server message, the translated fallback.
	fireEvent.click( screen.getByRole( 'button', { name: 'Retry import' } ) );
	expect( errorNotice( 'Database unavailable.' ) ).not.toBeInTheDocument();
	expect(
		await screen.findByText(
			'The transactions could not be imported. Try again.',
			{ selector: '.components-notice__content' }
		)
	).toBeInTheDocument();

	fireEvent.click( screen.getByRole( 'button', { name: 'Retry import' } ) );
	expect(
		errorNotice( 'The transactions could not be imported. Try again.' )
	).not.toBeInTheDocument();
	await waitFor( () =>
		expect( onImported ).toHaveBeenCalledWith( 'Imported 1 new.' )
	);
	expect( importCalls() ).toHaveLength( 3 );
	importCalls().forEach( ( [ options ] ) =>
		expect( options.data ).toEqual( { transactions } )
	);
} );

it( 'keeps a failed Mollie CSV import for a retry (#1934)', async () => {
	apiFetch
		.mockRejectedValueOnce( new Error( 'Database unavailable.' ) )
		.mockResolvedValueOnce( { message: 'Imported 2 new.' } );
	const { onImported, choose } = renderImport();

	choose(
		textFile(
			'mollie.csv',
			'ID,Amount,Currency,Status,Description,Date\n' +
				'tr_a,10.00,EUR,paid,Workshop,2026-10-01\n' +
				'tr_b,12.50,EUR,paidout,"Dinner, two",2026-10-02\n'
		)
	);

	expect(
		await screen.findByText(
			'mollie.csv: 2 transactions are ready to import again.'
		)
	).toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Retry import' } ) );
	await waitFor( () =>
		expect( onImported ).toHaveBeenCalledWith( 'Imported 2 new.' )
	);
	const [ first, second ] = importCalls();
	expect( second[ 0 ].data ).toEqual( first[ 0 ].data );
	expect(
		first[ 0 ].data.transactions.map( ( t ) => t.mollie_payment_id )
	).toEqual( [ 'tr_a', 'tr_b' ] );
} );

it( 'reports an invalid file inline and accepts a replacement (#1934)', async () => {
	apiFetch
		.mockRejectedValueOnce( new Error( 'Database unavailable.' ) )
		.mockResolvedValueOnce( { message: 'Imported 1 new.' } );
	const { onImported, input, choose } = renderImport();

	choose(
		textFile(
			'transactions.json',
			JSON.stringify( [ { mollie_payment_id: 'tr_one' } ] )
		)
	);
	await screen.findByRole( 'button', { name: 'Retry import' } );

	// A file that cannot be imported replaces the failed one.
	choose( textFile( 'broken.json', '{"not":"a list"}' ) );
	expect(
		await screen.findByText(
			'Invalid file format. Expected a JSON array.',
			{ selector: '.components-notice__content' }
		)
	).toBeInTheDocument();
	expect(
		screen.queryByRole( 'button', { name: 'Retry import' } )
	).not.toBeInTheDocument();
	expect( input ).toBeEnabled();
	expect( importCalls() ).toHaveLength( 1 );

	choose(
		textFile(
			'fixed.json',
			JSON.stringify( [ { mollie_payment_id: 'tr_two' } ] )
		)
	);
	await waitFor( () =>
		expect( onImported ).toHaveBeenCalledWith( 'Imported 1 new.' )
	);
	expect( importCalls()[ 1 ][ 0 ].data ).toEqual( {
		transactions: [ { mollie_payment_id: 'tr_two' } ],
	} );
} );
