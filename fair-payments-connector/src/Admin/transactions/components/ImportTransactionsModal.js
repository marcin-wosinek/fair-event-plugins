/**
 * WordPress dependencies
 */
import { useState, useRef } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { parseMollieCsv } from '../parseMollieCsv.js';

/**
 * Import transactions from a JSON export or a Mollie CSV file.
 *
 * Imports from Mollie and connected sites run from the External Updates
 * page, which logs every run.
 *
 * Choosing a file starts the import. While it runs, the popup cannot be
 * dismissed and no second import starts. When the request fails, the parsed
 * transactions are kept so the same import can be retried without choosing
 * the file again.
 *
 * @param {Object}   props
 * @param {Function} props.onClose    Close handler.
 * @param {Function} props.onImported Called with the result message.
 * @return {JSX.Element} Modal.
 */
const ImportTransactionsModal = ( { onClose, onImported } ) => {
	const [ error, setError ] = useState( null );
	const [ isImporting, setIsImporting ] = useState( false );
	// The parsed file whose import request failed: { fileName, transactions }.
	const [ retained, setRetained ] = useState( null );
	// Refuses a second import before the first one re-rendered the popup.
	const inFlight = useRef( false );
	const fileInputRef = useRef( null );
	const externalUpdatesUrl =
		window.fairPaymentTransactions?.externalUpdatesUrl;

	const begin = () => {
		if ( inFlight.current ) {
			return false;
		}
		inFlight.current = true;
		setIsImporting( true );
		setError( null );
		return true;
	};

	const finish = () => {
		inFlight.current = false;
		setIsImporting( false );
	};

	const submit = async ( payload ) => {
		try {
			const response = await apiFetch( {
				path: '/fair-payments-connector/v1/transactions/import',
				method: 'POST',
				data: { transactions: payload.transactions },
			} );
			onImported( response.message );
		} catch ( err ) {
			setRetained( payload );
			setError(
				err.message ||
					__(
						'The transactions could not be imported. Try again.',
						'fair-payments-connector'
					)
			);
		}
	};

	const handleFileChange = async ( e ) => {
		const file = e.target.files[ 0 ];
		if ( ! file ) {
			return;
		}

		// Reset the input so the same file can be re-selected.
		e.target.value = '';

		if ( ! begin() ) {
			return;
		}
		// A newly chosen file replaces the one whose import failed.
		setRetained( null );

		try {
			const text = await file.text();
			let toImport;

			if ( file.name.endsWith( '.csv' ) ) {
				toImport = parseMollieCsv( text );
			} else {
				const imported = JSON.parse( text );

				if ( ! Array.isArray( imported ) ) {
					throw new Error(
						__(
							'Invalid file format. Expected a JSON array.',
							'fair-payments-connector'
						)
					);
				}

				toImport = imported.filter( ( t ) => t.mollie_payment_id );
			}

			if ( toImport.length === 0 ) {
				throw new Error(
					__(
						'No valid transactions found in the file.',
						'fair-payments-connector'
					)
				);
			}

			await submit( { fileName: file.name, transactions: toImport } );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'The file could not be read. Choose another file.',
						'fair-payments-connector'
					)
			);
		} finally {
			finish();
		}
	};

	const handleRetry = async () => {
		if ( ! retained || ! begin() ) {
			return;
		}
		try {
			await submit( retained );
		} finally {
			finish();
		}
	};

	// The outcome of a dismissed import would be unknown to the user.
	const close = () => {
		if ( ! isImporting ) {
			onClose();
		}
	};

	return (
		<Modal
			title={ __( 'Import Transactions', 'fair-payments-connector' ) }
			onRequestClose={ close }
			isDismissible={ ! isImporting }
			shouldCloseOnEsc={ ! isImporting }
			shouldCloseOnClickOutside={ ! isImporting }
			style={ {
				maxWidth: '640px',
				width: '100%',
				overflowWrap: 'anywhere',
			} }
		>
			<VStack spacing={ 4 }>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }

				<p style={ { margin: 0 } }>
					{ __(
						'Select a JSON file exported from another site, or a Mollie payments CSV export.',
						'fair-payments-connector'
					) }
				</p>
				<input
					ref={ fileInputRef }
					type="file"
					accept=".json,.csv"
					onChange={ handleFileChange }
					disabled={ isImporting }
				/>
				{ retained && (
					<p style={ { margin: 0 } }>
						{ sprintf(
							/* translators: 1: file name, 2: number of transactions */
							_n(
								'%1$s: %2$d transaction is ready to import again.',
								'%1$s: %2$d transactions are ready to import again.',
								retained.transactions.length,
								'fair-payments-connector'
							),
							retained.fileName,
							retained.transactions.length
						) }
					</p>
				) }
				{ isImporting && (
					<HStack justify="flex-start" spacing={ 2 }>
						<Spinner />
						<span>
							{ __( 'Importing…', 'fair-payments-connector' ) }
						</span>
					</HStack>
				) }
				<p style={ { margin: 0 } }>
					{ __(
						'To import from Mollie or a connected site, use External Updates.',
						'fair-payments-connector'
					) }{ ' ' }
					<a
						href={ externalUpdatesUrl }
						aria-disabled={ isImporting || undefined }
						onClick={ ( e ) => {
							// Leaving now would discard the import's outcome.
							if ( isImporting ) {
								e.preventDefault();
							}
						} }
					>
						{ __(
							'Open External Updates',
							'fair-payments-connector'
						) }
					</a>
				</p>
				<HStack justify="flex-start" spacing={ 3 } wrap>
					<Button
						variant="tertiary"
						onClick={ close }
						disabled={ isImporting }
					>
						{ __( 'Cancel', 'fair-payments-connector' ) }
					</Button>
					{ retained && (
						<Button
							variant="primary"
							onClick={ handleRetry }
							isBusy={ isImporting }
							disabled={ isImporting }
							// Stay focusable while pending, so focus stays in
							// the popup.
							accessibleWhenDisabled={ isImporting }
						>
							{ __( 'Retry import', 'fair-payments-connector' ) }
						</Button>
					) }
				</HStack>
			</VStack>
		</Modal>
	);
};

export default ImportTransactionsModal;
