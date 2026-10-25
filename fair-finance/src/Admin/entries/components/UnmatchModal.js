/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef, useCallback } from '@wordpress/element';
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
import { formatDateOnly } from 'fair-events-shared/src/dateTime.js';

const RECONCILIATION_URL = 'admin.php?page=fair-finance-reconciliation';

const formatAmount = ( amount, currency = 'EUR' ) =>
	new Intl.NumberFormat( 'en-US', {
		style: 'currency',
		currency,
	} ).format( amount );

/**
 * Confirmation for removing every transaction association of an entry.
 *
 * The associations, and whether a saved settlement reconciliation protects
 * the entry, are loaded fresh when the dialog opens: Unmatch stays withheld
 * until they are known. A conflict reported by the server (protection added
 * after opening) switches the dialog to the protected explanation. Failures
 * keep the dialog open for a retry; while the request runs every way of
 * dismissing it is blocked.
 *
 * @param {Object}   props             Component props.
 * @param {Object}   props.entry       Entry row being unmatched.
 * @param {Function} props.onUnmatched Called once the associations are removed.
 * @param {Function} props.onCancel    Called when the dialog is dismissed.
 * @return {JSX.Element} The dialog.
 */
export default function UnmatchModal( { entry, onUnmatched, onCancel } ) {
	// `details` is null until loaded; `loadError` holds a failed load.
	const [ details, setDetails ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ isBusy, setIsBusy ] = useState( false );
	const [ error, setError ] = useState( null );
	// A double click can fire before the busy re-render.
	const busyRef = useRef( false );

	const loadDetails = useCallback( async () => {
		setDetails( null );
		setLoadError( null );
		try {
			const data = await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ entry.id }`,
			} );
			setDetails( data.unmatch );
		} catch ( err ) {
			setLoadError(
				err.message ||
					__(
						'The linked transactions could not be loaded.',
						'fair-finance'
					)
			);
		}
	}, [ entry.id ] );

	useEffect( () => {
		loadDetails();
	}, [ loadDetails ] );

	const isLoading = ! details && ! loadError;
	const protectionUnknown =
		!! details && null === details.settlement_protected;
	const isProtected = !! details && true === details.settlement_protected;
	const canConfirm = !! details && false === details.settlement_protected;

	const handleCancel = () => {
		if ( ! busyRef.current ) {
			onCancel();
		}
	};

	const handleConfirm = async () => {
		if ( busyRef.current || ! canConfirm ) {
			return;
		}
		busyRef.current = true;
		setIsBusy( true );
		setError( null );

		try {
			await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ entry.id }/match`,
				method: 'DELETE',
			} );
		} catch ( err ) {
			busyRef.current = false;
			setIsBusy( false );
			if ( 'reconciliation_entry_in_use' === err.code ) {
				setDetails( ( prev ) => ( {
					...prev,
					settlement_protected: true,
				} ) );
				return;
			}
			setError(
				err.message ||
					__(
						'The entry could not be unmatched. Nothing was changed; try again.',
						'fair-finance'
					)
			);
			return;
		}

		busyRef.current = false;
		onUnmatched();
	};

	const transactions = details ? details.transactions : [];
	let summary;
	if ( isProtected ) {
		summary = sprintf(
			/* translators: %d: number of linked transactions. */
			_n(
				'%d linked transaction:',
				'%d linked transactions:',
				transactions.length,
				'fair-finance'
			),
			transactions.length
		);
	} else if ( transactions.length > 0 ) {
		summary = sprintf(
			/* translators: %d: number of linked transactions. */
			_n(
				'This removes the link to %d transaction:',
				'This removes the links to all %d transactions:',
				transactions.length,
				'fair-finance'
			),
			transactions.length
		);
	} else {
		summary = __(
			'This entry has no linked transactions left. Unmatching only refreshes the list.',
			'fair-finance'
		);
	}
	const label =
		entry.description ||
		/* translators: %d: financial entry ID. */
		sprintf( __( 'Entry #%d', 'fair-finance' ), entry.id );

	return (
		<Modal
			title={
				/* translators: %s: financial entry description. */
				sprintf( __( 'Unmatch entry — %s', 'fair-finance' ), label )
			}
			onRequestClose={ handleCancel }
			isDismissible={ ! isBusy }
			shouldCloseOnEsc={ ! isBusy }
			shouldCloseOnClickOutside={ ! isBusy }
			size="medium"
			className="fair-finance-unmatch-modal"
		>
			<VStack spacing={ 3 }>
				<div className="fair-finance-unmatch-modal__entry">
					<div>
						<strong>{ __( 'Date:', 'fair-finance' ) }</strong>{ ' ' }
						{ formatDateOnly( entry.entry_date, 'numeric' ) }
					</div>
					<div>
						<strong>{ __( 'Amount:', 'fair-finance' ) }</strong>{ ' ' }
						{ formatAmount( entry.amount ) }
					</div>
					<div>
						<strong>{ __( 'ID:', 'fair-finance' ) }</strong>{ ' ' }
						{ entry.id }
					</div>
				</div>

				{ isProtected && (
					<Notice status="warning" isDismissible={ false }>
						<p>
							{ __(
								'This entry belongs to a saved settlement reconciliation, so it cannot be unmatched here. Review or release its bank association in Reconciliation first.',
								'fair-finance'
							) }
						</p>
						<Button variant="secondary" href={ RECONCILIATION_URL }>
							{ __( 'Open Reconciliation', 'fair-finance' ) }
						</Button>
					</Notice>
				) }

				{ protectionUnknown && (
					<Notice status="error" isDismissible={ false }>
						<p>
							{ __(
								'It could not be checked whether this entry belongs to a saved settlement reconciliation, so it cannot be unmatched yet.',
								'fair-finance'
							) }
						</p>
						<Button variant="secondary" onClick={ loadDetails }>
							{ __( 'Try again', 'fair-finance' ) }
						</Button>
					</Notice>
				) }

				{ isLoading && (
					<HStack justify="flex-start">
						<Spinner />
						<span>
							{ __(
								'Loading linked transactions…',
								'fair-finance'
							) }
						</span>
					</HStack>
				) }

				{ loadError && (
					<Notice status="error" isDismissible={ false }>
						<p>{ loadError }</p>
						<Button variant="secondary" onClick={ loadDetails }>
							{ __( 'Try again', 'fair-finance' ) }
						</Button>
					</Notice>
				) }

				{ details && (
					<>
						<p style={ { margin: 0 } }>{ summary }</p>
						{ transactions.length > 0 && (
							<ul className="fair-finance-unmatch-modal__transactions">
								{ transactions.map( ( transaction ) => (
									<li key={ transaction.id }>
										{ transaction.missing
											? sprintf(
													/* translators: %d: transaction ID. */
													__(
														'Transaction #%d (its record no longer exists)',
														'fair-finance'
													),
													transaction.id
												)
											: sprintf(
													/* translators: 1: transaction date, 2: amount, 3: description, 4: transaction ID. */
													__(
														'%1$s · %2$s · %3$s (#%4$d)',
														'fair-finance'
													),
													formatDateOnly(
														transaction.created_at,
														'numeric'
													),
													formatAmount(
														transaction.amount,
														transaction.currency
													),
													transaction.description ||
														__(
															'No description',
															'fair-finance'
														),
													transaction.id
												) }
									</li>
								) ) }
							</ul>
						) }
						{ ! isProtected && (
							<p style={ { margin: 0 } }>
								{ __(
									'Unmatching removes only these local associations. The financial entry, its split allocations and the payment-provider transactions are kept, and you can match the entry again later.',
									'fair-finance'
								) }
							</p>
						) }
					</>
				) }

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }

				<HStack justify="flex-end" spacing={ 3 } wrap>
					<Button
						variant="tertiary"
						onClick={ handleCancel }
						disabled={ isBusy }
					>
						{ __( 'Cancel', 'fair-finance' ) }
					</Button>
					<Button
						variant="primary"
						isDestructive
						onClick={ handleConfirm }
						isBusy={ isBusy }
						disabled={ isBusy || ! canConfirm }
						// Stay focusable while pending: a truly disabled
						// button drops focus to the page, and the dialog
						// could then not hand it back to its trigger.
						accessibleWhenDisabled={ isBusy }
					>
						{ isBusy
							? __( 'Unmatching…', 'fair-finance' )
							: __( 'Unmatch', 'fair-finance' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
