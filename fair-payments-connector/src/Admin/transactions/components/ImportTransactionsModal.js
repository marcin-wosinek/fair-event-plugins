/**
 * WordPress dependencies
 */
import { useState, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
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
 * @param {Object}   props
 * @param {Function} props.onClose    Close handler.
 * @param {Function} props.onImported Called with the result message.
 * @return {JSX.Element} Modal.
 */
const ImportTransactionsModal = ( { onClose, onImported } ) => {
	const [ error, setError ] = useState( null );
	const [ isImporting, setIsImporting ] = useState( false );
	const fileInputRef = useRef( null );
	const externalUpdatesUrl =
		window.fairPaymentTransactions?.externalUpdatesUrl;

	const handleFileChange = async ( e ) => {
		const file = e.target.files[ 0 ];
		if ( ! file ) {
			return;
		}

		// Reset the input so the same file can be re-selected.
		e.target.value = '';

		setIsImporting( true );
		setError( null );

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

			const response = await apiFetch( {
				path: '/fair-payments-connector/v1/transactions/import',
				method: 'POST',
				data: { transactions: toImport },
			} );

			onImported( response.message );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'Failed to import transactions.',
						'fair-payments-connector'
					)
			);
		} finally {
			setIsImporting( false );
		}
	};

	return (
		<Modal
			title={ __( 'Import Transactions', 'fair-payments-connector' ) }
			onRequestClose={ onClose }
			style={ { maxWidth: '640px', width: '100%' } }
		>
			<VStack spacing={ 4 }>
				{ error && (
					<Notice
						status="error"
						isDismissible
						onRemove={ () => setError( null ) }
					>
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
					<a href={ externalUpdatesUrl }>
						{ __(
							'Open External Updates',
							'fair-payments-connector'
						) }
					</a>
				</p>
				<HStack justify="flex-start">
					<Button
						variant="tertiary"
						onClick={ onClose }
						disabled={ isImporting }
					>
						{ __( 'Cancel', 'fair-payments-connector' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
};

export default ImportTransactionsModal;
