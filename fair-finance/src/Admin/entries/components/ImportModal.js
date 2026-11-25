/**
 * WordPress dependencies
 */
import { useState, useRef, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	Button,
	Notice,
	Spinner,
	SelectControl,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { readSpreadsheetFile } from '../../readSpreadsheet.js';
import { parseEntryRows } from '../parseEntries.js';

const ImportModal = ( { onImport, onCancel } ) => {
	const [ file, setFile ] = useState( null );
	const [ parsedEntries, setParsedEntries ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ isParsing, setIsParsing ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ result, setResult ] = useState( null );
	const fileInputRef = useRef( null );
	const selectionRef = useRef( 0 );

	// The bank account is optional: "Account unknown" ('') stays valid.
	const [ accounts, setAccounts ] = useState( [] );
	const [ accountsError, setAccountsError ] = useState( null );
	const [ accountId, setAccountId ] = useState( '' );
	const [ isAddingAccount, setIsAddingAccount ] = useState( false );
	const [ newAccountName, setNewAccountName ] = useState( '' );
	const [ isCreatingAccount, setIsCreatingAccount ] = useState( false );
	const [ accountError, setAccountError ] = useState( null );
	const creatingAccountRef = useRef( false );

	useEffect( () => {
		let active = true;
		apiFetch( { path: '/fair-finance/v1/bank-accounts' } )
			.then( ( data ) => {
				if ( active ) {
					setAccounts( Array.isArray( data ) ? data : [] );
				}
			} )
			.catch( () => {
				if ( active ) {
					setAccountsError(
						__(
							'Bank accounts could not be loaded. You can still import with the account unknown.',
							'fair-finance'
						)
					);
				}
			} );
		return () => {
			active = false;
		};
	}, [] );

	const handleCreateAccount = async () => {
		if ( creatingAccountRef.current ) {
			return;
		}
		const name = newAccountName.trim();
		if ( ! name ) {
			setAccountError(
				__( 'Enter a name for the bank account.', 'fair-finance' )
			);
			return;
		}

		creatingAccountRef.current = true;
		setIsCreatingAccount( true );
		setAccountError( null );
		try {
			const account = await apiFetch( {
				path: '/fair-finance/v1/bank-accounts',
				method: 'POST',
				data: { name },
			} );
			setAccounts( ( current ) =>
				[ ...current, account ].sort( ( a, b ) =>
					a.name.localeCompare( b.name )
				)
			);
			setAccountId( account.id.toString() );
			setNewAccountName( '' );
			setIsAddingAccount( false );
		} catch ( err ) {
			setAccountError(
				err.message ||
					__(
						'The bank account could not be created.',
						'fair-finance'
					)
			);
		} finally {
			creatingAccountRef.current = false;
			setIsCreatingAccount( false );
		}
	};

	const cancelAddAccount = () => {
		setIsAddingAccount( false );
		setNewAccountName( '' );
		setAccountError( null );
	};

	const handleFileChange = async ( e ) => {
		const selectedFile = e.target.files[ 0 ];
		if ( ! selectedFile ) {
			return;
		}

		const selection = ++selectionRef.current;

		setFile( selectedFile );
		setError( null );
		setResult( null );
		setParsedEntries( [] );
		setIsParsing( true );

		let entries = [];
		let parseError = null;
		try {
			entries = parseEntryRows(
				await readSpreadsheetFile( selectedFile )
			);
		} catch ( err ) {
			parseError =
				err.message || __( 'Failed to parse file.', 'fair-finance' );
		}

		// A file chosen in the meantime owns the preview now.
		if ( selection !== selectionRef.current ) {
			return;
		}

		setParsedEntries( entries );
		setError( parseError );
		setIsParsing( false );
	};

	const handleImport = async () => {
		if ( parsedEntries.length === 0 ) {
			return;
		}

		setIsLoading( true );
		setError( null );
		setResult( null );

		try {
			const response = await apiFetch( {
				path: '/fair-finance/v1/financial-entries/import',
				method: 'POST',
				data: {
					entries: parsedEntries,
					import_source: file?.name || null,
					bank_account_id: accountId
						? Number.parseInt( accountId, 10 )
						: null,
				},
			} );

			setResult( response );

			if ( response.imported > 0 ) {
				// Notify parent to refresh data
				setTimeout( () => {
					onImport();
				}, 2000 );
			}
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to import entries.', 'fair-finance' )
			);
		} finally {
			setIsLoading( false );
		}
	};

	const formatAmount = ( amount ) => {
		return new Intl.NumberFormat( 'en-US', {
			style: 'currency',
			currency: 'EUR',
		} ).format( amount );
	};

	const costEntries = parsedEntries.filter(
		( e ) => e.entry_type === 'cost'
	);
	const incomeEntries = parsedEntries.filter(
		( e ) => e.entry_type === 'income'
	);
	const totalCosts = costEntries.reduce( ( sum, e ) => sum + e.amount, 0 );
	const totalIncome = incomeEntries.reduce( ( sum, e ) => sum + e.amount, 0 );

	return (
		<Modal
			title={ __( 'Import Financial Entries', 'fair-finance' ) }
			onRequestClose={ onCancel }
			style={ { maxWidth: '640px', width: '100%' } }
		>
			<VStack spacing={ 4 }>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }

				{ result && (
					<Notice
						status={ result.imported > 0 ? 'success' : 'warning' }
						isDismissible={ false }
					>
						{ result.message }
					</Notice>
				) }

				<div>
					<p>
						{ __(
							'Select an Excel file (.xlsx) to import financial entries. The file should have columns for date, description, and amount.',
							'fair-finance'
						) }
					</p>
					<p>
						<strong>
							{ __(
								'Note: Duplicate entries will be automatically skipped.',
								'fair-finance'
							) }
						</strong>
					</p>
				</div>

				<div>
					<SelectControl
						label={ __( 'Bank account', 'fair-finance' ) }
						value={ accountId }
						options={ [
							{
								label: __( 'Account unknown', 'fair-finance' ),
								value: '',
							},
							...accounts.map( ( account ) => ( {
								label: account.name,
								value: account.id.toString(),
							} ) ),
						] }
						onChange={ setAccountId }
						disabled={ !! result }
						help={ __(
							'Recorded with every imported entry as its origin. It cannot be changed after the import.',
							'fair-finance'
						) }
					/>
					{ accountsError && (
						<Notice status="warning" isDismissible={ false }>
							{ accountsError }
						</Notice>
					) }
					{ ! isAddingAccount && ! result && (
						<Button
							variant="link"
							onClick={ () => setIsAddingAccount( true ) }
						>
							{ __( 'Add bank account', 'fair-finance' ) }
						</Button>
					) }
					{ isAddingAccount && ! result && (
						<VStack spacing={ 2 }>
							<TextControl
								label={ __(
									'New bank account name',
									'fair-finance'
								) }
								value={ newAccountName }
								onChange={ setNewAccountName }
								disabled={ isCreatingAccount }
								help={ __(
									'A name to recognize the account by, such as the bank and account nickname. Do not enter credentials.',
									'fair-finance'
								) }
							/>
							{ accountError && (
								<Notice status="error" isDismissible={ false }>
									{ accountError }
								</Notice>
							) }
							<HStack justify="flex-start" spacing={ 2 } wrap>
								<Button
									variant="secondary"
									onClick={ handleCreateAccount }
									isBusy={ isCreatingAccount }
									disabled={ isCreatingAccount }
								>
									{ __( 'Add account', 'fair-finance' ) }
								</Button>
								<Button
									variant="tertiary"
									onClick={ cancelAddAccount }
									disabled={ isCreatingAccount }
								>
									{ __( 'Cancel', 'fair-finance' ) }
								</Button>
							</HStack>
						</VStack>
					) }
				</div>

				<div>
					<input
						ref={ fileInputRef }
						type="file"
						accept=".xlsx,.xls"
						onChange={ handleFileChange }
						style={ { marginBottom: '16px' } }
					/>
				</div>

				{ isParsing && (
					<HStack justify="center">
						<Spinner />
						<span>{ __( 'Parsing file...', 'fair-finance' ) }</span>
					</HStack>
				) }

				{ parsedEntries.length > 0 && ! result && (
					<div
						style={ {
							backgroundColor: '#f0f0f1',
							padding: '16px',
							borderRadius: '4px',
						} }
					>
						<h4 style={ { marginTop: 0 } }>
							{ __( 'Preview', 'fair-finance' ) }
						</h4>
						<p>
							<strong>
								{ __( 'Total entries:', 'fair-finance' ) }
							</strong>{ ' ' }
							{ parsedEntries.length }
						</p>
						<p>
							<strong>{ __( 'Costs:', 'fair-finance' ) }</strong>{ ' ' }
							{ costEntries.length } (
							{ formatAmount( totalCosts ) })
						</p>
						<p>
							<strong>{ __( 'Income:', 'fair-finance' ) }</strong>{ ' ' }
							{ incomeEntries.length } (
							{ formatAmount( totalIncome ) })
						</p>
						<p>
							<strong>
								{ __( 'Balance:', 'fair-finance' ) }
							</strong>{ ' ' }
							<span
								style={ {
									color:
										totalIncome - totalCosts >= 0
											? '#007017'
											: '#d63638',
								} }
							>
								{ formatAmount( totalIncome - totalCosts ) }
							</span>
						</p>

						{ parsedEntries.length <= 10 && (
							<div style={ { marginTop: '16px' } }>
								<strong>
									{ __(
										'Entries to import:',
										'fair-finance'
									) }
								</strong>
								<table
									style={ {
										width: '100%',
										marginTop: '8px',
										fontSize: '12px',
									} }
								>
									<thead>
										<tr>
											<th style={ { textAlign: 'left' } }>
												{ __( 'Date', 'fair-finance' ) }
											</th>
											<th style={ { textAlign: 'left' } }>
												{ __( 'Type', 'fair-finance' ) }
											</th>
											<th
												style={ { textAlign: 'right' } }
											>
												{ __(
													'Amount',
													'fair-finance'
												) }
											</th>
											<th style={ { textAlign: 'left' } }>
												{ __(
													'Description',
													'fair-finance'
												) }
											</th>
										</tr>
									</thead>
									<tbody>
										{ parsedEntries.map(
											( entry, index ) => (
												<tr key={ index }>
													<td>
														{ entry.entry_date }
													</td>
													<td
														style={ {
															color:
																entry.entry_type ===
																'cost'
																	? '#d63638'
																	: '#007017',
														} }
													>
														{ entry.entry_type ===
														'cost'
															? __(
																	'Cost',
																	'fair-finance'
																)
															: __(
																	'Income',
																	'fair-finance'
																) }
													</td>
													<td
														style={ {
															textAlign: 'right',
														} }
													>
														{ formatAmount(
															entry.amount
														) }
													</td>
													<td
														style={ {
															maxWidth: '150px',
															overflow: 'hidden',
															textOverflow:
																'ellipsis',
															whiteSpace:
																'nowrap',
														} }
													>
														{ entry.description }
													</td>
												</tr>
											)
										) }
									</tbody>
								</table>
							</div>
						) }
					</div>
				) }

				<HStack justify="flex-end" spacing={ 2 }>
					<Button variant="tertiary" onClick={ onCancel }>
						{ __( 'Cancel', 'fair-finance' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ handleImport }
						isBusy={ isLoading }
						disabled={
							isLoading ||
							isParsing ||
							parsedEntries.length === 0 ||
							result
						}
					>
						{ __( 'Import', 'fair-finance' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
};

export default ImportModal;
