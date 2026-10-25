import { __, _n, sprintf } from '@wordpress/i18n';
import {
	useState,
	useEffect,
	useCallback,
	useMemo,
	useRef,
} from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Modal,
	TextControl,
	TextareaControl,
	SelectControl,
	SearchControl,
	Notice,
	Spinner,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import useBudgets from '../components/useBudgets.js';
import BudgetLoadStatus from '../components/BudgetLoadStatus.js';
import ConfirmActionModal, {
	useConfirmAction,
} from '../components/ConfirmActionModal.js';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'participant_surname',
		direction: 'asc',
	},
	search: '',
	filters: [],
	fields: [
		'participant_name',
		'participant_email',
		'amount',
		'status',
		'paid_at',
		'reminder_sent_at',
	],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

// Rejections that mean the row on screen is out of date, not that mail failed.
const STALE_PAYMENT_ERRORS = [
	'payment_not_pending',
	'payment_not_found',
	'participant_not_found',
	'fee_not_found',
];

const memberName = ( payment ) =>
	`${ payment.participant_name || '' } ${
		payment.participant_surname || ''
	}`.trim();

export default function FeeDetail() {
	const urlParams = new URLSearchParams( window.location.search );
	const feeId = urlParams.get( 'fee_id' );

	const [ fee, setFee ] = useState( null );
	const [ payments, setPayments ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ view, setView ] = useState( DEFAULT_VIEW );

	// Adjust amount modal.
	const [ isAdjustModalOpen, setIsAdjustModalOpen ] = useState( false );
	const [ adjustingPayment, setAdjustingPayment ] = useState( null );
	const [ newAmount, setNewAmount ] = useState( '' );
	const [ adjustReason, setAdjustReason ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ adjustError, setAdjustError ] = useState( null );

	// Audit log modal.
	const [ isAuditModalOpen, setIsAuditModalOpen ] = useState( false );
	const [ auditEntries, setAuditEntries ] = useState( [] );
	const [ auditLoading, setAuditLoading ] = useState( false );

	// Transactions modal.
	const [ isTransactionsModalOpen, setIsTransactionsModalOpen ] =
		useState( false );
	const [ transactionEntries, setTransactionEntries ] = useState( [] );
	const [ transactionsLoading, setTransactionsLoading ] = useState( false );

	// Notice state.
	const [ notice, setNotice ] = useState( null );

	// Status changes and the bulk reminder, each confirmed in a dialog.
	const markPaid = useConfirmAction();
	const cancelPayment = useConfirmAction();
	const bulkReminders = useConfirmAction();
	const isSendingReminders = bulkReminders.isBusy;

	// Single-member reminder: the payment being confirmed, whether its request
	// is in flight, and the error to show in the dialog.
	const [ reminderPayment, setReminderPayment ] = useState( null );
	const [ isSendingReminder, setIsSendingReminder ] = useState( false );
	const [ reminderError, setReminderError ] = useState( null );
	// Set synchronously so a second click cannot start another send before the
	// state above has re-rendered.
	const reminderSendLock = useRef( false );

	// Add participant modal.
	const [ isAddModalOpen, setIsAddModalOpen ] = useState( false );
	const [ groupMembers, setGroupMembers ] = useState( [] );
	const [ groupMembersLoading, setGroupMembersLoading ] = useState( false );
	const [ addSearch, setAddSearch ] = useState( '' );
	const [ selectedToAdd, setSelectedToAdd ] = useState( null );
	const [ addAmount, setAddAmount ] = useState( '' );
	const [ isAddingPayment, setIsAddingPayment ] = useState( false );
	const [ addError, setAddError ] = useState( null );

	// Transfer modal.
	const [ isTransferModalOpen, setIsTransferModalOpen ] = useState( false );
	const [ transferPayment, setTransferPayment ] = useState( null );
	// Reloaded each time the transfer modal opens.
	const { status: budgetsStatus, budgets, load: loadBudgets } = useBudgets();
	const [ transferData, setTransferData ] = useState( {
		amount: '',
		entry_date: '',
		description: '',
		source_budget_id: '',
		target_budget_id: '',
	} );
	const [ isCreatingTransfer, setIsCreatingTransfer ] = useState( false );
	const [ transferError, setTransferError ] = useState( null );
	// Set synchronously so a second click cannot create a second transfer
	// before the state above has re-rendered.
	const transferCreateLock = useRef( false );

	const loadFee = useCallback( () => {
		if ( ! feeId ) return;

		apiFetch( { path: `/fair-audience/v1/fees/${ feeId }` } )
			.then( ( data ) => {
				setFee( data );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading fee:', err );
			} );
	}, [ feeId ] );

	const loadPayments = useCallback( () => {
		if ( ! feeId ) return;

		setIsLoading( true );

		apiFetch( { path: `/fair-audience/v1/fees/${ feeId }/payments` } )
			.then( ( data ) => {
				setPayments( data );
				setIsLoading( false );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading payments:', err );
				setIsLoading( false );
			} );
	}, [ feeId ] );

	useEffect( () => {
		loadFee();
		loadPayments();
	}, [ loadFee, loadPayments ] );

	// Define fields configuration for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'participant_name',
				label: __( 'Name', 'fair-audience-experimental' ),
				render: ( { item } ) =>
					`${ item.participant_name || '' } ${
						item.participant_surname || ''
					}`.trim() || '—',
				enableSorting: false,
				enableHiding: false,
			},
			{
				id: 'participant_email',
				label: __( 'Email', 'fair-audience-experimental' ),
				render: ( { item } ) => item.participant_email || '—',
				enableSorting: false,
			},
			{
				id: 'amount',
				label: __( 'Amount', 'fair-audience-experimental' ),
				render: ( { item } ) => (
					<div style={ { textAlign: 'right' } }>
						{ parseFloat( item.amount ).toFixed( 2 ) }
					</div>
				),
				enableSorting: false,
				getValue: ( { item } ) => parseFloat( item.amount ),
			},
			{
				id: 'status',
				label: __( 'Status', 'fair-audience-experimental' ),
				render: ( { item } ) => {
					const colors = {
						pending: '#dba617',
						paid: '#00a32a',
						canceled: '#d63638',
					};
					return (
						<span
							style={ {
								color: colors[ item.status ] || '#333',
								fontWeight: 'bold',
							} }
						>
							{ item.status }
						</span>
					);
				},
				enableSorting: false,
			},
			{
				id: 'paid_at',
				label: __( 'Paid At', 'fair-audience-experimental' ),
				render: ( { item } ) => item.paid_at || '—',
				enableSorting: false,
			},
			{
				id: 'reminder_sent_at',
				label: __( 'Reminder Sent', 'fair-audience-experimental' ),
				render: ( { item } ) => item.reminder_sent_at || '—',
				enableSorting: false,
			},
		],
		[]
	);

	// Adjust amount.
	const openAdjustModal = ( payment ) => {
		setAdjustingPayment( payment );
		setNewAmount( payment.amount );
		setAdjustReason( '' );
		setAdjustError( null );
		setIsAdjustModalOpen( true );
	};

	const handleAdjustAmount = () => {
		if ( ! adjustingPayment || ! adjustReason.trim() || isSaving ) return;

		setIsSaving( true );
		setAdjustError( null );

		apiFetch( {
			path: `/fair-audience/v1/fees/${ feeId }/payments/${ adjustingPayment.id }/amount`,
			method: 'PUT',
			data: {
				amount: parseFloat( newAmount ),
				comment: adjustReason.trim(),
			},
		} )
			.then( () => {
				setIsAdjustModalOpen( false );
				setAdjustingPayment( null );
				loadPayments();
				setNotice( {
					status: 'success',
					message: __(
						'Amount adjusted successfully.',
						'fair-audience-experimental'
					),
				} );
			} )
			.catch( ( err ) => {
				setAdjustError(
					err.message ||
						__(
							'The amount could not be adjusted. Try again.',
							'fair-audience-experimental'
						)
				);
			} )
			.finally( () => {
				setIsSaving( false );
			} );
	};

	// Mark as paid, after confirmation.
	const handleMarkPaid = () =>
		markPaid.run(
			async ( payment ) => {
				await apiFetch( {
					path: `/fair-audience/v1/fees/${ feeId }/payments/${ payment.id }/mark-paid`,
					method: 'POST',
				} );
				loadPayments();
				setNotice( {
					status: 'success',
					message: sprintf(
						/* translators: %s: member name */
						__(
							'Payment of %s marked as paid.',
							'fair-audience-experimental'
						),
						memberName( payment ) ||
							__( '(unnamed)', 'fair-audience-experimental' )
					),
				} );
			},
			__(
				'The payment could not be marked as paid. Try again.',
				'fair-audience-experimental'
			)
		);

	// Cancel payment, after confirmation.
	const handleCancel = () =>
		cancelPayment.run(
			async ( payment ) => {
				await apiFetch( {
					path: `/fair-audience/v1/fees/${ feeId }/payments/${ payment.id }/cancel`,
					method: 'POST',
				} );
				loadPayments();
				setNotice( {
					status: 'success',
					message: sprintf(
						/* translators: %s: member name */
						__(
							'Payment of %s canceled.',
							'fair-audience-experimental'
						),
						memberName( payment ) ||
							__( '(unnamed)', 'fair-audience-experimental' )
					),
				} );
			},
			__(
				'The payment could not be canceled. Try again.',
				'fair-audience-experimental'
			)
		);

	// View audit log.
	const openAuditLog = ( payment ) => {
		setAuditLoading( true );
		setAuditEntries( [] );
		setIsAuditModalOpen( true );

		apiFetch( {
			path: `/fair-audience/v1/fees/${ feeId }/payments/${ payment.id }/audit-log`,
		} )
			.then( ( data ) => {
				setAuditEntries( data );
				setAuditLoading( false );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading audit log:', err );
				setAuditLoading( false );
			} );
	};

	// View payment attempts.
	const openTransactionsModal = ( payment ) => {
		setTransactionsLoading( true );
		setTransactionEntries( [] );
		setIsTransactionsModalOpen( true );

		apiFetch( {
			path: `/fair-audience/v1/fees/${ feeId }/payments/${ payment.id }/transactions`,
		} )
			.then( ( data ) => {
				setTransactionEntries( data );
				setTransactionsLoading( false );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading transactions:', err );
				setTransactionsLoading( false );
			} );
	};

	// Copy payment link.
	const handleCopyPaymentLink = ( payment ) => {
		apiFetch( {
			path: `/fair-audience/v1/fees/${ feeId }/payments/${ payment.id }/payment-url`,
		} )
			.then( ( data ) => {
				navigator.clipboard.writeText( data.url ).then( () => {
					setNotice( {
						status: 'success',
						message: __(
							'Payment link copied to clipboard.',
							'fair-audience-experimental'
						),
					} );
				} );
			} )
			.catch( ( err ) => {
				setNotice( {
					status: 'error',
					message:
						err.message ||
						__(
							'The payment link could not be loaded. Try again.',
							'fair-audience-experimental'
						),
				} );
			} );
	};

	// Open add-participant modal.
	const openAddModal = () => {
		if ( ! fee || ! fee.group_id ) return;

		setAddSearch( '' );
		setSelectedToAdd( null );
		setAddAmount( fee.amount ? String( fee.amount ) : '' );
		setAddError( null );
		setIsAddModalOpen( true );

		setGroupMembersLoading( true );
		apiFetch( {
			path: `/fair-audience/v1/groups/${ fee.group_id }/participants`,
		} )
			.then( ( data ) => {
				setGroupMembers( data );
			} )
			.catch( () => {
				setGroupMembers( [] );
			} )
			.finally( () => {
				setGroupMembersLoading( false );
			} );
	};

	const handleAddPayment = () => {
		if ( ! selectedToAdd || isAddingPayment ) return;

		setIsAddingPayment( true );
		setAddError( null );

		apiFetch( {
			path: `/fair-audience/v1/fees/${ feeId }/payments`,
			method: 'POST',
			data: {
				participant_id: selectedToAdd,
				amount: parseFloat( addAmount ),
			},
		} )
			.then( () => {
				setIsAddModalOpen( false );
				setSelectedToAdd( null );
				loadPayments();
				setNotice( {
					status: 'success',
					message: __(
						'Participant added to fee.',
						'fair-audience-experimental'
					),
				} );
			} )
			.catch( ( err ) => {
				setAddError(
					err.message ||
						__(
							'The participant could not be added. Try again.',
							'fair-audience-experimental'
						)
				);
			} )
			.finally( () => {
				setIsAddingPayment( false );
			} );
	};

	// Transfer creation.
	const openTransferModal = ( payment ) => {
		setTransferPayment( payment );
		setTransferData( {
			amount: parseFloat( payment.amount ).toFixed( 2 ),
			entry_date: new Date().toISOString().split( 'T' )[ 0 ],
			description: fee
				? `${ fee.name } — ${ payment.participant_name || '' } ${
						payment.participant_surname || ''
					}`.trim()
				: '',
			source_budget_id: '',
			target_budget_id: fee?.budget_id ? fee.budget_id.toString() : '',
		} );
		setTransferError( null );
		setIsTransferModalOpen( true );
		loadBudgets();
	};

	const closeTransferModal = () => {
		if ( isCreatingTransfer ) {
			return;
		}
		setIsTransferModalOpen( false );
		setTransferPayment( null );
		setTransferError( null );
	};

	const handleCreateTransfer = async () => {
		if ( ! transferPayment || transferCreateLock.current ) {
			return;
		}

		transferCreateLock.current = true;
		setIsCreatingTransfer( true );
		setTransferError( null );

		const data = {
			amount: parseFloat( transferData.amount ),
			entry_date: transferData.entry_date,
			source_budget_id: parseInt( transferData.source_budget_id, 10 ),
			target_budget_id: parseInt( transferData.target_budget_id, 10 ),
			participant_id: transferPayment.participant_id,
		};
		// The endpoint declares the description as a string: omit it if empty.
		const description = transferData.description.trim();
		if ( description ) {
			data.description = description;
		}

		try {
			await apiFetch( {
				path: '/fair-finance/v1/financial-entries/transfer',
				method: 'POST',
				data,
			} );
		} catch ( err ) {
			transferCreateLock.current = false;
			setIsCreatingTransfer( false );
			setTransferError(
				err.message ||
					__(
						'The transfer could not be created.',
						'fair-audience-experimental'
					)
			);
			return;
		}

		// The transfer exists from here on: the dialog closes whatever happens
		// next, so it cannot be submitted a second time.
		let markedPaid = true;
		try {
			await apiFetch( {
				path: `/fair-audience/v1/fees/${ feeId }/payments/${ transferPayment.id }/mark-paid`,
				method: 'POST',
			} );
		} catch {
			markedPaid = false;
		}

		transferCreateLock.current = false;
		setIsCreatingTransfer( false );
		setIsTransferModalOpen( false );
		setTransferPayment( null );
		loadPayments();

		if ( markedPaid ) {
			setNotice( {
				status: 'success',
				message: __(
					'Transfer created and payment marked as paid.',
					'fair-audience-experimental'
				),
			} );
		} else {
			setNotice( {
				status: 'warning',
				message: __(
					'The transfer was created, but the payment could not be marked as paid. Mark the payment as paid from its row actions; do not create the transfer again.',
					'fair-audience-experimental'
				),
			} );
		}
	};

	// Send a reminder to one member.
	const openReminderModal = ( payment ) => {
		setReminderError( null );
		setReminderPayment( payment );
	};

	const closeReminderModal = () => {
		if ( isSendingReminder ) {
			return;
		}
		setReminderPayment( null );
		setReminderError( null );
	};

	const handleSendPaymentReminder = async () => {
		if (
			! reminderPayment ||
			! reminderPayment.participant_email ||
			isSendingReminders ||
			reminderSendLock.current
		) {
			return;
		}

		reminderSendLock.current = true;
		setIsSendingReminder( true );
		setReminderError( null );

		let result;
		try {
			result = await apiFetch( {
				path: `/fair-audience/v1/fees/${ feeId }/payments/${ reminderPayment.id }/send-reminder`,
				method: 'POST',
			} );
		} catch ( err ) {
			reminderSendLock.current = false;
			setIsSendingReminder( false );

			const message =
				err.message ||
				__(
					'The payment reminder could not be sent.',
					'fair-audience-experimental'
				);

			if ( STALE_PAYMENT_ERRORS.includes( err.code ) ) {
				// The row changed since it was loaded: show its current state.
				setReminderPayment( null );
				setNotice( { status: 'error', message } );
				loadPayments();
				return;
			}

			setReminderError( message );
			return;
		}

		reminderSendLock.current = false;
		setIsSendingReminder( false );
		setReminderPayment( null );

		const recipient = result.email || reminderPayment.participant_email;
		let refreshed = true;
		try {
			const [ feeData, paymentData ] = await Promise.all( [
				apiFetch( { path: `/fair-audience/v1/fees/${ feeId }` } ),
				apiFetch( {
					path: `/fair-audience/v1/fees/${ feeId }/payments`,
				} ),
			] );
			setFee( feeData );
			setPayments( paymentData );
		} catch {
			refreshed = false;
		}

		if ( result.recorded === false ) {
			setNotice( { status: 'warning', message: result.message } );
		} else if ( ! refreshed ) {
			setNotice( {
				status: 'warning',
				message: sprintf(
					/* translators: %s: recipient email address */
					__(
						'Payment reminder sent to %s, but this page could not be refreshed. Reload the page to see the reminder date; the email does not need to be sent again.',
						'fair-audience-experimental'
					),
					recipient
				),
			} );
		} else {
			setNotice( {
				status: 'success',
				message: sprintf(
					/* translators: %s: recipient email address */
					__(
						'Payment reminder sent to %s.',
						'fair-audience-experimental'
					),
					recipient
				),
			} );
		}
	};

	// Send reminders to every pending member, after confirmation.
	const openBulkReminders = () => {
		if ( reminderSendLock.current ) {
			return;
		}
		bulkReminders.open( {
			pending: payments.filter(
				( payment ) => payment.status === 'pending'
			),
		} );
	};

	const handleSendReminders = () =>
		bulkReminders.run(
			async () => {
				const results = await apiFetch( {
					path: `/fair-audience/v1/fees/${ feeId }/send-reminders`,
					method: 'POST',
				} );
				const sentCount = results.sent ? results.sent.length : 0;
				const failed = results.failed || [];

				setNotice( {
					status: failed.length > 0 ? 'warning' : 'success',
					message: (
						<>
							<p>
								{ sprintf(
									/* translators: %d: number of reminders sent */
									_n(
										'%d reminder sent.',
										'%d reminders sent.',
										sentCount,
										'fair-audience-experimental'
									),
									sentCount
								) }
							</p>
							{ failed.length > 0 && (
								<>
									<p>
										{ sprintf(
											/* translators: %d: number of reminders not sent */
											_n(
												'%d reminder was not sent:',
												'%d reminders were not sent:',
												failed.length,
												'fair-audience-experimental'
											),
											failed.length
										) }
									</p>
									<ul>
										{ failed.map( ( item, index ) => (
											<li key={ index }>
												{ sprintf(
													/* translators: 1: member name or email, 2: reason */
													__(
														'%1$s: %2$s',
														'fair-audience-experimental'
													),
													item.name ||
														item.email ||
														__(
															'(unnamed)',
															'fair-audience-experimental'
														),
													item.reason
												) }
											</li>
										) ) }
									</ul>
								</>
							) }
						</>
					),
				} );

				loadPayments();
			},
			__(
				'The reminders could not be sent. Some may already have gone out; check the reminder dates before trying again.',
				'fair-audience-experimental'
			)
		);

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'adjust-amount',
				label: __( 'Adjust Amount', 'fair-audience-experimental' ),
				icon: 'edit',
				callback: ( [ item ] ) => openAdjustModal( item ),
				supportsBulk: false,
			},
			{
				id: 'mark-paid',
				label: __( 'Mark as Paid', 'fair-audience-experimental' ),
				icon: 'yes-alt',
				callback: ( [ item ] ) => markPaid.open( item ),
				supportsBulk: false,
				isEligible: ( item ) => item.status === 'pending',
			},
			{
				id: 'cancel',
				label: __( 'Cancel', 'fair-audience-experimental' ),
				icon: 'dismiss',
				callback: ( [ item ] ) => cancelPayment.open( item ),
				supportsBulk: false,
				isEligible: ( item ) => item.status === 'pending',
			},
			{
				id: 'send-payment-reminder',
				label: __(
					'Send Payment Reminder',
					'fair-audience-experimental'
				),
				icon: 'email',
				callback: ( [ item ] ) => openReminderModal( item ),
				supportsBulk: false,
				isEligible: ( item ) => item.status === 'pending',
			},
			{
				id: 'copy-payment-link',
				label: __( 'Copy Payment Link', 'fair-audience-experimental' ),
				icon: 'admin-links',
				callback: ( [ item ] ) => handleCopyPaymentLink( item ),
				supportsBulk: false,
				isEligible: ( item ) => item.status === 'pending',
			},
			{
				id: 'view-transactions',
				label: __(
					'View Payment Attempts',
					'fair-audience-experimental'
				),
				icon: 'money-alt',
				callback: ( [ item ] ) => openTransactionsModal( item ),
				supportsBulk: false,
				isEligible: ( item ) => !! item.transaction_id,
			},
			{
				id: 'create-transfer',
				label: __( 'Create Transfer', 'fair-audience-experimental' ),
				icon: 'money-alt',
				callback: ( [ item ] ) => openTransferModal( item ),
				supportsBulk: false,
				isEligible: ( item ) => item.status === 'pending',
			},
			{
				id: 'audit-log',
				label: __( 'View Audit Log', 'fair-audience-experimental' ),
				icon: 'list-view',
				callback: ( [ item ] ) => openAuditLog( item ),
				supportsBulk: false,
			},
		],
		[ feeId, fee, loadBudgets ]
	);

	const paginationInfo = useMemo(
		() => ( {
			totalItems: payments.length,
			totalPages: 1,
		} ),
		[ payments ]
	);

	if ( ! feeId ) {
		return (
			<div className="wrap">
				<p>
					{ __(
						'No fee ID specified.',
						'fair-audience-experimental'
					) }
				</p>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>
				<a href="admin.php?page=fair-audience-fees">
					{ __( 'Membership Fees', 'fair-audience-experimental' ) }
				</a>
				{ ' → ' }
				{ fee ? fee.name : '...' }
			</h1>

			{ notice && (
				<Notice
					status={ notice.status }
					onRemove={ () => setNotice( null ) }
					isDismissible
				>
					{ notice.message }
				</Notice>
			) }

			{ /* Fee Summary */ }
			{ fee && (
				<Card style={ { marginBottom: '16px' } }>
					<CardHeader>
						<h2 style={ { margin: 0 } }>
							{ __(
								'Fee Summary',
								'fair-audience-experimental'
							) }
						</h2>
					</CardHeader>
					<CardBody>
						<div
							style={ {
								display: 'grid',
								gridTemplateColumns:
									'repeat(auto-fit, minmax(200px, 1fr))',
								gap: '16px',
							} }
						>
							<div>
								<strong>
									{ __(
										'Name:',
										'fair-audience-experimental'
									) }
								</strong>{ ' ' }
								{ fee.name }
							</div>
							<div>
								<strong>
									{ __(
										'Group:',
										'fair-audience-experimental'
									) }
								</strong>{ ' ' }
								{ fee.group_name || '—' }
							</div>
							<div>
								<strong>
									{ __(
										'Budget:',
										'fair-audience-experimental'
									) }
								</strong>{ ' ' }
								{ fee.budget_name || '—' }
							</div>
							<div>
								<strong>
									{ __(
										'Default Amount:',
										'fair-audience-experimental'
									) }
								</strong>{ ' ' }
								{ parseFloat( fee.amount ).toFixed( 2 ) }{ ' ' }
								{ fee.currency }
							</div>
							<div>
								<strong>
									{ __(
										'Due Date:',
										'fair-audience-experimental'
									) }
								</strong>{ ' ' }
								{ fee.due_date || '—' }
							</div>
							<div>
								<strong>
									{ __(
										'Status:',
										'fair-audience-experimental'
									) }
								</strong>{ ' ' }
								{ fee.status }
							</div>
						</div>
					</CardBody>
				</Card>
			) }

			{ /* Payments Table */ }
			<Card>
				<CardBody>
					<div
						style={ {
							marginBottom: '16px',
							display: 'flex',
							gap: '8px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ openBulkReminders }
							disabled={ isSendingReminders || isSendingReminder }
						>
							{ __(
								'Send Reminders',
								'fair-audience-experimental'
							) }
						</Button>
						<Button
							variant="secondary"
							onClick={ openAddModal }
							disabled={ ! fee }
						>
							{ __(
								'Add Participant',
								'fair-audience-experimental'
							) }
						</Button>
					</div>

					<DataViews
						data={ payments }
						fields={ fields }
						view={ view }
						onChangeView={ setView }
						actions={ actions }
						paginationInfo={ paginationInfo }
						defaultLayouts={ DEFAULT_LAYOUTS }
						isLoading={ isLoading }
						getItemId={ ( item ) => item.id }
					/>
				</CardBody>
			</Card>

			{ /* Status changes, confirmed with the member and amount */ }
			{ [
				{
					confirm: markPaid,
					onConfirm: handleMarkPaid,
					/* translators: %s: member name */
					title: __(
						'Mark as paid — %s',
						'fair-audience-experimental'
					),
					confirmLabel: __(
						'Mark as paid',
						'fair-audience-experimental'
					),
					busyLabel: __( 'Saving…', 'fair-audience-experimental' ),
					isDestructive: false,
					consequence: __(
						'This records the payment as paid by hand. No money is collected or checked with the payment provider, and there is no action to set it back to pending. The change is logged in the payment history.',
						'fair-audience-experimental'
					),
				},
				{
					confirm: cancelPayment,
					onConfirm: handleCancel,
					/* translators: %s: member name */
					title: __(
						'Cancel payment — %s',
						'fair-audience-experimental'
					),
					confirmLabel: __(
						'Cancel payment',
						'fair-audience-experimental'
					),
					busyLabel: __( 'Canceling…', 'fair-audience-experimental' ),
					isDestructive: true,
					consequence: __(
						'The member no longer owes this fee and gets no more reminders for it. No payment-provider transaction is canceled or refunded, and there is no action to undo this. The change is logged in the payment history.',
						'fair-audience-experimental'
					),
				},
			].map(
				( dialog ) =>
					dialog.confirm.target && (
						<ConfirmActionModal
							key={ dialog.confirmLabel }
							title={ sprintf(
								dialog.title,
								memberName( dialog.confirm.target ) ||
									__(
										'(unnamed)',
										'fair-audience-experimental'
									)
							) }
							confirmLabel={ dialog.confirmLabel }
							busyLabel={ dialog.busyLabel }
							isDestructive={ dialog.isDestructive }
							isBusy={ dialog.confirm.isBusy }
							error={ dialog.confirm.error }
							onConfirm={ dialog.onConfirm }
							onCancel={ dialog.confirm.close }
						>
							<p>
								{ sprintf(
									/* translators: 1: fee name, 2: amount with currency, 3: member email or dash */
									__(
										'%1$s: %2$s (%3$s).',
										'fair-audience-experimental'
									),
									fee ? fee.name : '—',
									`${ parseFloat(
										dialog.confirm.target.amount
									).toFixed( 2 ) }${
										fee?.currency
											? ` ${ fee.currency }`
											: ''
									}`,
									dialog.confirm.target.participant_email ||
										'—'
								) }
							</p>
							<p>{ dialog.consequence }</p>
						</ConfirmActionModal>
					)
			) }

			{ bulkReminders.target && (
				<ConfirmActionModal
					title={ sprintf(
						/* translators: %s: fee name */
						__(
							'Send payment reminders — %s',
							'fair-audience-experimental'
						),
						fee ? fee.name : '—'
					) }
					confirmLabel={ __(
						'Send reminders',
						'fair-audience-experimental'
					) }
					busyLabel={ __( 'Sending…', 'fair-audience-experimental' ) }
					isBusy={ bulkReminders.isBusy }
					error={ bulkReminders.error }
					onConfirm={ handleSendReminders }
					onCancel={ bulkReminders.close }
					confirmDisabled={
						bulkReminders.target.pending.length === 0
					}
				>
					{ bulkReminders.target.pending.length === 0 ? (
						<p>
							{ __(
								'No member has a pending payment, so there is nobody to remind.',
								'fair-audience-experimental'
							) }
						</p>
					) : (
						<>
							<p>
								{ sprintf(
									/* translators: %d: number of members with a pending payment */
									_n(
										'One reminder email goes to the %d member with a pending payment, including any who were reminded before:',
										'One reminder email goes to each of the %d members with a pending payment, including any who were reminded before:',
										bulkReminders.target.pending.length,
										'fair-audience-experimental'
									),
									bulkReminders.target.pending.length
								) }
							</p>
							<ul
								style={ {
									maxHeight: '200px',
									overflowY: 'auto',
									margin: 0,
								} }
							>
								{ bulkReminders.target.pending.map(
									( payment ) => (
										<li key={ payment.id }>
											{ memberName( payment ) ||
												__(
													'(unnamed)',
													'fair-audience-experimental'
												) }
											{ ' — ' }
											{ payment.participant_email ||
												__(
													'no email address; it will be reported as not sent',
													'fair-audience-experimental'
												) }
										</li>
									)
								) }
							</ul>
							<p>
								{ __(
									'Sent emails cannot be recalled.',
									'fair-audience-experimental'
								) }
							</p>
						</>
					) }
				</ConfirmActionModal>
			) }

			{ /* Send Payment Reminder Modal */ }
			{ reminderPayment && (
				<Modal
					title={ __(
						'Send Payment Reminder',
						'fair-audience-experimental'
					) }
					onRequestClose={ closeReminderModal }
					isDismissible={ ! isSendingReminder }
					shouldCloseOnClickOutside={ ! isSendingReminder }
					shouldCloseOnEsc={ ! isSendingReminder }
					style={ { maxWidth: '500px', width: '100%' } }
				>
					<p>
						{ __(
							'One reminder email will be sent to this member only.',
							'fair-audience-experimental'
						) }
					</p>

					<div
						style={ {
							display: 'grid',
							gap: '4px',
							marginBottom: '16px',
							overflowWrap: 'anywhere',
						} }
					>
						<div>
							<strong>
								{ __(
									'Member:',
									'fair-audience-experimental'
								) }
							</strong>{ ' ' }
							{ memberName( reminderPayment ) ||
								__(
									'(unnamed)',
									'fair-audience-experimental'
								) }
						</div>
						<div>
							<strong>
								{ __( 'Email:', 'fair-audience-experimental' ) }
							</strong>{ ' ' }
							{ reminderPayment.participant_email || '—' }
						</div>
						<div>
							<strong>
								{ __( 'Fee:', 'fair-audience-experimental' ) }
							</strong>{ ' ' }
							{ fee ? fee.name : '—' }
						</div>
						<div>
							<strong>
								{ __(
									'Amount:',
									'fair-audience-experimental'
								) }
							</strong>{ ' ' }
							{ parseFloat( reminderPayment.amount ).toFixed(
								2
							) }
							{ fee?.currency ? ` ${ fee.currency }` : '' }
						</div>
					</div>

					{ ! reminderPayment.participant_email && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'This member has no email address, so a reminder cannot be sent.',
								'fair-audience-experimental'
							) }
						</Notice>
					) }

					{ reminderPayment.participant_email &&
						isSendingReminders && (
							<Notice status="info" isDismissible={ false }>
								{ __(
									'Reminders are being sent to all members with pending payments. Wait for that to finish before sending this one.',
									'fair-audience-experimental'
								) }
							</Notice>
						) }

					{ reminderError && (
						<Notice status="error" isDismissible={ false }>
							{ reminderError }
						</Notice>
					) }

					<div
						style={ {
							display: 'flex',
							flexWrap: 'wrap',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ closeReminderModal }
							disabled={ isSendingReminder }
						>
							{ __( 'Cancel', 'fair-audience-experimental' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleSendPaymentReminder }
							disabled={
								! reminderPayment.participant_email ||
								isSendingReminder ||
								isSendingReminders
							}
							isBusy={ isSendingReminder }
						>
							{ __(
								'Send Payment Reminder',
								'fair-audience-experimental'
							) }
						</Button>
					</div>
				</Modal>
			) }

			{ /* Add Participant Modal */ }
			{ isAddModalOpen && (
				<Modal
					title={ __(
						'Add Participant to Fee',
						'fair-audience-experimental'
					) }
					onRequestClose={ () => setIsAddModalOpen( false ) }
					style={ { maxWidth: '500px', width: '100%' } }
				>
					{ ( () => {
						const existingParticipantIds = payments.map(
							( p ) => p.participant_id
						);
						const available = groupMembers.filter(
							( m ) => ! existingParticipantIds.includes( m.id )
						);
						const term = addSearch.trim().toLowerCase();
						const filtered = term
							? available.filter( ( p ) => {
									const label = `${ p.name || '' } ${
										p.surname || ''
									} ${ p.email || '' }`.toLowerCase();
									return label.includes( term );
								} )
							: available;

						return (
							<>
								<SearchControl
									value={ addSearch }
									onChange={ setAddSearch }
									placeholder={ __(
										'Search group members...',
										'fair-audience-experimental'
									) }
								/>

								<div
									style={ {
										maxHeight: '280px',
										overflowY: 'auto',
										border: '1px solid #ddd',
										borderRadius: '4px',
										marginTop: '8px',
										marginBottom: '16px',
									} }
								>
									{ groupMembersLoading ? (
										<div
											style={ {
												padding: '16px',
												textAlign: 'center',
											} }
										>
											<Spinner />
										</div>
									) : filtered.length === 0 ? (
										<p style={ { padding: '12px' } }>
											{ available.length === 0
												? __(
														'All group members already have a payment for this fee.',
														'fair-audience-experimental'
													)
												: __(
														'No matches.',
														'fair-audience-experimental'
													) }
										</p>
									) : (
										filtered.map( ( p ) => {
											const label = `${ p.name || '' } ${
												p.surname || ''
											}`.trim();
											const isSelected =
												selectedToAdd === p.id;
											return (
												<div
													key={ p.id }
													onClick={ () =>
														setSelectedToAdd( p.id )
													}
													style={ {
														padding: '8px 12px',
														cursor: 'pointer',
														background: isSelected
															? '#e6f3ff'
															: 'transparent',
														borderBottom:
															'1px solid #eee',
													} }
												>
													<div>
														{ label ||
															__(
																'(unnamed)',
																'fair-audience-experimental'
															) }
													</div>
													{ p.email && (
														<div
															style={ {
																fontSize:
																	'12px',
																color: '#666',
															} }
														>
															{ p.email }
														</div>
													) }
												</div>
											);
										} )
									) }
								</div>

								<TextControl
									label={ __(
										'Amount',
										'fair-audience-experimental'
									) }
									type="number"
									value={ addAmount }
									onChange={ setAddAmount }
									min="0"
									step="0.01"
								/>

								{ addError && (
									<Notice
										status="error"
										isDismissible={ false }
									>
										{ addError }
									</Notice>
								) }
								<div
									style={ {
										display: 'flex',
										justifyContent: 'flex-end',
										gap: '8px',
										marginTop: '16px',
									} }
								>
									<Button
										variant="secondary"
										onClick={ () =>
											setIsAddModalOpen( false )
										}
									>
										{ __(
											'Cancel',
											'fair-audience-experimental'
										) }
									</Button>
									<Button
										variant="primary"
										onClick={ handleAddPayment }
										disabled={
											! selectedToAdd ||
											isAddingPayment ||
											! addAmount
										}
										isBusy={ isAddingPayment }
									>
										{ __(
											'Add',
											'fair-audience-experimental'
										) }
									</Button>
								</div>
							</>
						);
					} )() }
				</Modal>
			) }

			{ /* Adjust Amount Modal */ }
			{ isAdjustModalOpen && adjustingPayment && (
				<Modal
					title={ __(
						'Adjust Amount',
						'fair-audience-experimental'
					) }
					onRequestClose={ () => {
						setIsAdjustModalOpen( false );
						setAdjustingPayment( null );
					} }
					style={ { maxWidth: '500px', width: '100%' } }
				>
					<p>
						{ __(
							'Current amount:',
							'fair-audience-experimental'
						) }{ ' ' }
						<strong>
							{ parseFloat( adjustingPayment.amount ).toFixed(
								2
							) }
						</strong>
					</p>

					<TextControl
						label={ __(
							'New Amount',
							'fair-audience-experimental'
						) }
						type="number"
						value={ newAmount }
						onChange={ setNewAmount }
						min="0"
						step="0.01"
					/>

					<TextareaControl
						label={ __(
							'Reason (required)',
							'fair-audience-experimental'
						) }
						value={ adjustReason }
						onChange={ setAdjustReason }
						placeholder={ __(
							'Explain why the amount is being adjusted...',
							'fair-audience-experimental'
						) }
					/>

					{ adjustError && (
						<Notice status="error" isDismissible={ false }>
							{ adjustError }
						</Notice>
					) }

					<div
						style={ {
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ () => {
								setIsAdjustModalOpen( false );
								setAdjustingPayment( null );
							} }
						>
							{ __( 'Cancel', 'fair-audience-experimental' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleAdjustAmount }
							disabled={ ! adjustReason.trim() || isSaving }
							isBusy={ isSaving }
						>
							{ __( 'Adjust', 'fair-audience-experimental' ) }
						</Button>
					</div>
				</Modal>
			) }

			{ /* Payment Attempts Modal */ }
			{ isTransactionsModalOpen && (
				<Modal
					title={ __(
						'Payment Attempts',
						'fair-audience-experimental'
					) }
					onRequestClose={ () => setIsTransactionsModalOpen( false ) }
					style={ { maxWidth: '640px', width: '100%' } }
				>
					{ transactionsLoading ? (
						<Spinner />
					) : transactionEntries.length === 0 ? (
						<p>
							{ __(
								'No payment attempts found.',
								'fair-audience-experimental'
							) }
						</p>
					) : (
						<div
							style={ {
								maxHeight: '400px',
								overflowY: 'auto',
							} }
						>
							{ transactionEntries.map( ( entry ) => {
								const statusColors = {
									paid: '#00a32a',
									failed: '#d63638',
									canceled: '#d63638',
									expired: '#d63638',
									pending_payment: '#dba617',
									draft: '#757575',
								};
								return (
									<div
										key={ entry.id }
										style={ {
											padding: '12px',
											borderBottom: '1px solid #eee',
										} }
									>
										<div
											style={ {
												display: 'flex',
												justifyContent: 'space-between',
												marginBottom: '4px',
											} }
										>
											<span
												style={ {
													color:
														statusColors[
															entry.status
														] || '#333',
													fontWeight: 'bold',
												} }
											>
												{ entry.status ||
													__(
														'unknown',
														'fair-audience-experimental'
													) }
											</span>
											<span
												style={ {
													color: '#666',
													fontSize: '12px',
												} }
											>
												{ entry.created_at }
											</span>
										</div>
										<div
											style={ {
												fontSize: '13px',
												color: '#555',
											} }
										>
											{ __(
												'Transaction:',
												'fair-audience-experimental'
											) }{ ' ' }
											#{ entry.transaction_id }
											{ entry.amount && (
												<>
													{ ' — ' }
													{ parseFloat(
														entry.amount
													).toFixed( 2 ) }{ ' ' }
													{ entry.currency ||
														window
															.fairPaymentsConnector
															?.currency ||
														'EUR' }
												</>
											) }
										</div>
										{ entry.payment_initiated_at && (
											<div
												style={ {
													fontSize: '12px',
													color: '#888',
													marginTop: '4px',
												} }
											>
												{ __(
													'Initiated:',
													'fair-audience-experimental'
												) }{ ' ' }
												{ entry.payment_initiated_at }
											</div>
										) }
									</div>
								);
							} ) }
						</div>
					) }

					<div
						style={ {
							display: 'flex',
							justifyContent: 'flex-end',
							marginTop: '16px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ () =>
								setIsTransactionsModalOpen( false )
							}
						>
							{ __( 'Close', 'fair-audience-experimental' ) }
						</Button>
					</div>
				</Modal>
			) }

			{ /* Create Transfer Modal */ }
			{ isTransferModalOpen && transferPayment && (
				<Modal
					title={ __(
						'Create Transfer',
						'fair-audience-experimental'
					) }
					onRequestClose={ closeTransferModal }
					isDismissible={ ! isCreatingTransfer }
					shouldCloseOnClickOutside={ ! isCreatingTransfer }
					shouldCloseOnEsc={ ! isCreatingTransfer }
					style={ { maxWidth: '500px', width: '100%' } }
				>
					<p>
						{ __( 'Participant:', 'fair-audience-experimental' ) }{ ' ' }
						<strong>
							{ `${ transferPayment.participant_name || '' } ${
								transferPayment.participant_surname || ''
							}`.trim() }
						</strong>
					</p>

					<TextControl
						label={ __( 'Amount', 'fair-audience-experimental' ) }
						value={ transferData.amount }
						onChange={ ( value ) =>
							setTransferData( {
								...transferData,
								amount: value,
							} )
						}
						type="number"
						step="0.01"
						min="0.01"
					/>

					<TextControl
						label={ __( 'Date', 'fair-audience-experimental' ) }
						value={ transferData.entry_date }
						onChange={ ( value ) =>
							setTransferData( {
								...transferData,
								entry_date: value,
							} )
						}
						type="date"
					/>

					<TextareaControl
						label={ __(
							'Description',
							'fair-audience-experimental'
						) }
						value={ transferData.description }
						onChange={ ( value ) =>
							setTransferData( {
								...transferData,
								description: value,
							} )
						}
					/>

					<BudgetLoadStatus
						status={ budgetsStatus }
						budgets={ budgets }
						onRetry={ loadBudgets }
						failureMessage={ __(
							'A transfer needs a source and a target budget.',
							'fair-audience-experimental'
						) }
						emptyMessage={ __(
							'There are no budgets yet. Add budgets in Fair Finance to create a transfer.',
							'fair-audience-experimental'
						) }
					/>

					<SelectControl
						label={ __(
							'From Budget (Source)',
							'fair-audience-experimental'
						) }
						value={ transferData.source_budget_id }
						options={ [
							{
								label: __(
									'-- Select Budget --',
									'fair-audience-experimental'
								),
								value: '',
							},
							...budgets.map( ( b ) => ( {
								label: b.name,
								value: b.id.toString(),
							} ) ),
						] }
						onChange={ ( value ) =>
							setTransferData( {
								...transferData,
								source_budget_id: value,
							} )
						}
						disabled={ budgetsStatus === 'loading' }
					/>

					<SelectControl
						label={ __(
							'To Budget (Target)',
							'fair-audience-experimental'
						) }
						value={ transferData.target_budget_id }
						options={ [
							{
								label: __(
									'-- Select Budget --',
									'fair-audience-experimental'
								),
								value: '',
							},
							...budgets.map( ( b ) => ( {
								label: b.name,
								value: b.id.toString(),
							} ) ),
						] }
						onChange={ ( value ) =>
							setTransferData( {
								...transferData,
								target_budget_id: value,
							} )
						}
						disabled={ budgetsStatus === 'loading' }
					/>

					{ transferData.source_budget_id &&
						transferData.target_budget_id &&
						transferData.source_budget_id ===
							transferData.target_budget_id && (
							<Notice status="warning" isDismissible={ false }>
								{ __(
									'Source and target budgets must be different.',
									'fair-audience-experimental'
								) }
							</Notice>
						) }

					{ transferError && (
						<Notice status="error" isDismissible={ false }>
							{ transferError }
						</Notice>
					) }

					<div
						style={ {
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ closeTransferModal }
							disabled={ isCreatingTransfer }
						>
							{ __( 'Cancel', 'fair-audience-experimental' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleCreateTransfer }
							disabled={
								isCreatingTransfer ||
								! transferData.amount ||
								! transferData.entry_date ||
								! transferData.source_budget_id ||
								! transferData.target_budget_id ||
								transferData.source_budget_id ===
									transferData.target_budget_id
							}
							isBusy={ isCreatingTransfer }
						>
							{ __(
								'Create Transfer',
								'fair-audience-experimental'
							) }
						</Button>
					</div>
				</Modal>
			) }

			{ /* Audit Log Modal */ }
			{ isAuditModalOpen && (
				<Modal
					title={ __( 'Audit Log', 'fair-audience-experimental' ) }
					onRequestClose={ () => setIsAuditModalOpen( false ) }
					style={ { maxWidth: '640px', width: '100%' } }
				>
					{ auditLoading ? (
						<Spinner />
					) : auditEntries.length === 0 ? (
						<p>
							{ __(
								'No audit log entries found.',
								'fair-audience-experimental'
							) }
						</p>
					) : (
						<div
							style={ {
								maxHeight: '400px',
								overflowY: 'auto',
							} }
						>
							{ auditEntries.map( ( entry ) => (
								<div
									key={ entry.id }
									style={ {
										padding: '12px',
										borderBottom: '1px solid #eee',
									} }
								>
									<div
										style={ {
											display: 'flex',
											justifyContent: 'space-between',
											marginBottom: '4px',
										} }
									>
										<strong>
											{ entry.action.replace(
												/_/g,
												' '
											) }
										</strong>
										<span
											style={ {
												color: '#666',
												fontSize: '12px',
											} }
										>
											{ entry.created_at }
										</span>
									</div>
									{ ( entry.old_value ||
										entry.new_value ) && (
										<div
											style={ {
												fontSize: '13px',
												color: '#555',
											} }
										>
											{ entry.old_value } →{ ' ' }
											{ entry.new_value }
										</div>
									) }
									{ entry.comment && (
										<div
											style={ {
												fontSize: '13px',
												fontStyle: 'italic',
												color: '#555',
												marginTop: '4px',
											} }
										>
											{ entry.comment }
										</div>
									) }
									<div
										style={ {
											fontSize: '12px',
											color: '#888',
											marginTop: '4px',
										} }
									>
										{ __(
											'By:',
											'fair-audience-experimental'
										) }{ ' ' }
										{ entry.performed_by_name ||
											entry.performed_by }
									</div>
								</div>
							) ) }
						</div>
					) }

					<div
						style={ {
							display: 'flex',
							justifyContent: 'flex-end',
							marginTop: '16px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ () => setIsAuditModalOpen( false ) }
						>
							{ __( 'Close', 'fair-audience-experimental' ) }
						</Button>
					</div>
				</Modal>
			) }
		</div>
	);
}
