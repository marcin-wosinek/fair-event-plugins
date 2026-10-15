/**
 * WordPress dependencies
 */
import { useEffect, useState } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	Button,
	CheckboxControl,
	Modal,
	Notice,
	SelectControl,
	Spinner,
	TextControl,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { importCsv, validateCsv } from '../settlements-api.js';
import { formatMoney, settlementUrl, typeLabel } from '../format.js';

const NEW_ACCOUNT = 'new';

/**
 * What importing the checked file will do.
 *
 * @param {string} outcome Outcome reported by the server.
 * @return {{status: string, text: string}} Notice tone and text.
 */
const outcomeNotice = ( outcome ) => {
	switch ( outcome ) {
		case 'attach':
			return {
				status: 'info',
				text: __(
					'This settlement is already saved from Mollie. The file will be added to it as a second source; amounts are compared, never added together.',
					'fair-finance'
				),
			};
		case 'duplicate':
			return {
				status: 'info',
				text: __(
					'This file is already saved for this settlement. Importing it again changes nothing.',
					'fair-finance'
				),
			};
		case 'conflict':
			return {
				status: 'warning',
				text: __(
					'A different file is already saved for this settlement. The saved data stays as it is; the differences in this file will be listed on the settlement for review.',
					'fair-finance'
				),
			};
		case 'ambiguous':
			return {
				status: 'error',
				text: __(
					'More than one saved settlement in this account has this reference, so the file cannot be attached to one of them.',
					'fair-finance'
				),
			};
		default:
			return {
				status: 'success',
				text: __(
					'The file is valid. A new settlement will be saved.',
					'fair-finance'
				),
			};
	}
};

/**
 * Uploads a Mollie settlement CSV: checks it first, then saves it.
 *
 * @param {Object}   props
 * @param {Object[]} props.accounts   Existing accounts.
 * @param {Function} props.onImported Called with the result once saved.
 * @param {Function} props.onClose    Called to close the dialog.
 * @return {JSX.Element} Dialog.
 */
export default function CsvImportModal( { accounts, onImported, onClose } ) {
	const [ file, setFile ] = useState( null );
	const [ accountChoice, setAccountChoice ] = useState(
		accounts.length > 0 ? String( accounts[ 0 ].id ) : NEW_ACCOUNT
	);
	const [ accountLabel, setAccountLabel ] = useState( '' );
	const [ confirmed, setConfirmed ] = useState( false );
	// One model for the check: what was checked and what came back.
	const [ check, setCheck ] = useState( { phase: 'idle' } );
	const [ saving, setSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );
	const [ result, setResult ] = useState( null );

	const isNew = accountChoice === NEW_ACCOUNT;
	const account = isNew
		? null
		: accounts.find( ( item ) => String( item.id ) === accountChoice );
	const label = accountLabel.trim();

	// Check the file whenever it or the account it belongs to changes.
	useEffect( () => {
		if ( ! file ) {
			setCheck( { phase: 'idle' } );
			return undefined;
		}

		let current = true;
		setCheck( { phase: 'checking' } );
		validateCsv( file, {
			accountId:
				accountChoice === NEW_ACCOUNT ? 0 : Number( accountChoice ),
		} )
			.then( ( preview ) => {
				if ( current ) {
					setCheck( { phase: 'valid', preview } );
				}
			} )
			.catch( ( error ) => {
				if ( current ) {
					setCheck( {
						phase: 'invalid',
						message: error?.message,
						errors: error?.data?.errors || [],
					} );
				}
			} );

		return () => {
			current = false;
		};
	}, [ file, accountChoice ] );

	const needsConfirmation = Boolean( account?.verified );

	// Why the file cannot be imported yet, shown next to the button.
	let blocked = null;
	if ( ! file ) {
		blocked = __( 'Choose a file first.', 'fair-finance' );
	} else if ( check.phase === 'checking' ) {
		blocked = __( 'Checking the file…', 'fair-finance' );
	} else if ( check.phase === 'invalid' ) {
		blocked = __( 'Fix the file and choose it again.', 'fair-finance' );
	} else if ( check.preview?.outcome === 'ambiguous' ) {
		blocked = __(
			'This file cannot be attached to one settlement.',
			'fair-finance'
		);
	} else if ( isNew && label === '' ) {
		blocked = __( 'Name the account first.', 'fair-finance' );
	} else if ( needsConfirmation && ! confirmed ) {
		blocked = __(
			'Confirm where the file was exported from.',
			'fair-finance'
		);
	}

	const save = async () => {
		setSaving( true );
		setSaveError( null );
		try {
			const saved = await importCsv( file, {
				accountId: account ? account.id : 0,
				accountLabel: label,
				confirmAccount: confirmed,
			} );
			setResult( saved );
			onImported( saved );
		} catch ( error ) {
			setSaveError(
				error?.message ||
					__( 'The file could not be imported.', 'fair-finance' )
			);
		}
		setSaving( false );
	};

	const preview = check.phase === 'valid' ? check.preview : null;

	return (
		<Modal
			title={ __( 'Import settlement CSV', 'fair-finance' ) }
			onRequestClose={ onClose }
			className="fair-finance-settlements-csv-modal"
		>
			{ result ? (
				<VStack spacing={ 4 }>
					<Notice
						status={ result.imported ? 'success' : 'info' }
						isDismissible={ false }
					>
						{ result.imported
							? __( 'The settlement was saved.', 'fair-finance' )
							: outcomeNotice( result.outcome ).text }
					</Notice>
					<HStack justify="flex-end">
						<Button variant="tertiary" onClick={ onClose }>
							{ __( 'Close', 'fair-finance' ) }
						</Button>
						{ result.settlement_id && (
							<Button
								variant="primary"
								href={ settlementUrl( result.settlement_id ) }
							>
								{ __( 'Open settlement', 'fair-finance' ) }
							</Button>
						) }
					</HStack>
				</VStack>
			) : (
				<VStack spacing={ 4 }>
					<p>
						{ __(
							'Upload a settlement exported from Mollie as CSV, in English or Dutch, one settlement per file. The file is checked before anything is saved, and it works without a Mollie connection. Consumer names and bank details in the file are not kept.',
							'fair-finance'
						) }
					</p>

					<div>
						<label
							htmlFor="fair-finance-settlement-csv"
							className="fair-finance-settlements-file-label"
						>
							{ __( 'Settlement file', 'fair-finance' ) }
						</label>
						<input
							id="fair-finance-settlement-csv"
							type="file"
							accept=".csv,text/csv"
							onChange={ ( event ) =>
								setFile( event.target.files?.[ 0 ] || null )
							}
						/>
					</div>

					<SelectControl
						__next40pxDefaultSize
						label={ __( 'Mollie account', 'fair-finance' ) }
						help={ __(
							'The file does not say which Mollie organization it was exported from.',
							'fair-finance'
						) }
						value={ accountChoice }
						options={ [
							...accounts.map( ( item ) => ( {
								value: String( item.id ),
								label: item.verified
									? item.label
									: sprintf(
											/* translators: %s: account name */
											__(
												'%s (not confirmed)',
												'fair-finance'
											),
											item.label
										),
							} ) ),
							{
								value: NEW_ACCOUNT,
								label: __( 'A new account…', 'fair-finance' ),
							},
						] }
						onChange={ ( value ) => {
							setAccountChoice( value );
							setConfirmed( false );
						} }
					/>

					{ isNew && (
						<TextControl
							__next40pxDefaultSize
							label={ __( 'Account name', 'fair-finance' ) }
							help={ __(
								'For your own reference. Its settlements stay separate from those loaded from Mollie until you confirm which organization it is.',
								'fair-finance'
							) }
							value={ accountLabel }
							onChange={ setAccountLabel }
						/>
					) }

					{ needsConfirmation && (
						<CheckboxControl
							label={ sprintf(
								/* translators: %s: account name */
								__(
									'This file was exported from %s.',
									'fair-finance'
								),
								account.label
							) }
							checked={ confirmed }
							onChange={ setConfirmed }
						/>
					) }

					{ check.phase === 'checking' && (
						<HStack justify="flex-start" role="status">
							<Spinner />
							<span>
								{ __( 'Checking the file…', 'fair-finance' ) }
							</span>
						</HStack>
					) }

					{ check.phase === 'invalid' && (
						<Notice status="error" isDismissible={ false }>
							<p>
								{ check.message ||
									__(
										'The file could not be imported.',
										'fair-finance'
									) }
							</p>
							{ check.errors.length > 0 && (
								<ul className="fair-finance-settlements-errors">
									{ check.errors.map( ( error, index ) => (
										<li key={ index }>
											{ error.row
												? sprintf(
														/* translators: 1: line number in the file, 2: what is wrong */
														__(
															'Line %1$d: %2$s',
															'fair-finance'
														),
														error.row,
														error.message
													)
												: error.message }
										</li>
									) ) }
								</ul>
							) }
						</Notice>
					) }

					{ preview && (
						<>
							<Notice
								status={
									outcomeNotice( preview.outcome ).status
								}
								isDismissible={ false }
							>
								{ outcomeNotice( preview.outcome ).text }
							</Notice>
							<dl className="fair-finance-settlements-facts">
								<div>
									<dt>
										{ __(
											'Settlement reference',
											'fair-finance'
										) }
									</dt>
									<dd>{ preview.reference }</dd>
								</div>
								<div>
									<dt>{ __( 'Rows', 'fair-finance' ) }</dt>
									<dd>
										{ sprintf(
											/* translators: %d: number of rows */
											_n(
												'%d row',
												'%d rows',
												preview.movement_count,
												'fair-finance'
											),
											preview.movement_count
										) }
									</dd>
								</div>
								{ Object.entries( preview.totals.by_type ).map(
									( [ type, total ] ) => (
										<div key={ type }>
											<dt>
												{ sprintf(
													/* translators: 1: movement type, 2: number of rows */
													__(
														'%1$s (%2$d)',
														'fair-finance'
													),
													typeLabel( type ),
													total.count
												) }
											</dt>
											<dd>
												{ formatMoney(
													total.settlement_amount,
													total.currency
												) }
											</dd>
										</div>
									)
								) }
							</dl>
						</>
					) }

					{ saveError && (
						<Notice status="error" isDismissible={ false }>
							{ saveError }
						</Notice>
					) }

					<HStack justify="flex-end" alignment="center" wrap>
						{ blocked && (
							<span className="fair-finance-settlements-blocked">
								{ blocked }
							</span>
						) }
						<Button variant="tertiary" onClick={ onClose }>
							{ __( 'Cancel', 'fair-finance' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ save }
							disabled={ Boolean( blocked ) || saving }
							isBusy={ saving }
						>
							{ __( 'Import settlement', 'fair-finance' ) }
						</Button>
					</HStack>
				</VStack>
			) }
		</Modal>
	);
}
