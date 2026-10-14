/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Notice,
	RadioControl,
	Card,
	CardBody,
	ButtonGroup,
	Modal,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadConnectionSettings,
	loadConnectionOverview,
	loadOAuthStatus,
	saveConnectorSettings,
	testConnection,
	createTestPayment,
	loadTestPaymentContext,
	fetchOAuthState,
	buildAuthorizeUrl,
	disconnectOAuth,
} from './settings-api';

/**
 * Error message from an apiFetch rejection, or the fallback.
 *
 * @param {Object} error    Rejection value.
 * @param {string} fallback Message when the error carries none.
 * @return {string} Message to show
 */
function errorMessage( error, fallback ) {
	return ( error && error.message ) || fallback;
}

/**
 * Identifiers of the connected Mollie account, as definition-list rows.
 * Only the identifiers that are known are listed.
 *
 * @param {Object} props                Props
 * @param {string} props.profileName    Mollie profile name, if loaded.
 * @param {string} props.profileId      Mollie profile ID.
 * @param {string} props.organizationId Mollie organization ID.
 * @return {JSX.Element|null} The account details
 */
function AccountDetails( { profileName, profileId, organizationId } ) {
	const rows = [
		[ __( 'Profile name:', 'fair-payments-connector' ), profileName ],
		[ __( 'Profile ID:', 'fair-payments-connector' ), profileId ],
		[ __( 'Organization ID:', 'fair-payments-connector' ), organizationId ],
	].filter( ( [ , value ] ) => !! value );

	if ( rows.length === 0 ) {
		return null;
	}

	return (
		<dl className="fair-payments-connector-connection__details">
			{ rows.map( ( [ label, value ] ) => (
				<div key={ label }>
					<dt>{ label }</dt>
					<dd>{ value }</dd>
				</div>
			) ) }
		</dl>
	);
}

/**
 * Connection Tab Component
 *
 * Displays Mollie OAuth connection status and controls.
 * Manages its own loading state and data fetching.
 *
 * @param {Object}   props              Props
 * @param {Function} props.onNotice     Handler for displaying notices
 * @param {boolean}  props.shouldReload Whether to reload settings (external trigger)
 * @return {JSX.Element} The connection tab
 */
export default function ConnectionTab( { onNotice, shouldReload } ) {
	const [ connected, setConnected ] = useState( false );
	const [ mode, setMode ] = useState( 'test' );
	const [ organizationId, setOrganizationId ] = useState( '' );
	const [ profileId, setProfileId ] = useState( '' );
	const [ tokenExpires, setTokenExpires ] = useState( null );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ isRefreshing, setIsRefreshing ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ overview, setOverview ] = useState( null );
	const [ overviewLoading, setOverviewLoading ] = useState( false );
	const [ overviewError, setOverviewError ] = useState( null );
	const [ isTestingPayment, setIsTestingPayment ] = useState( false );
	const [ testCheckoutUrl, setTestCheckoutUrl ] = useState( null );
	const [ pendingMode, setPendingMode ] = useState( 'test' );
	// Disconnect dialog: null while closed, otherwise { saving, error }.
	const [ disconnection, setDisconnection ] = useState( null );
	// Live test payment dialog: null while closed, otherwise
	// { context, loading, saving, error }. `context` is what the server says
	// the payment would be created with, and what the administrator confirms.
	const [ liveConfirmation, setLiveConfirmation ] = useState( null );
	// Synchronous guard against a second submission before React re-renders
	// the busy state; only one connection action runs at a time.
	const actionInFlight = useRef( false );
	const latestLoadId = useRef( 0 );
	// Granted-permission status; null until loaded, and when it can't be
	// loaded — the rest of the tab doesn't depend on it.
	const [ oauthStatus, setOauthStatus ] = useState( null );

	/**
	 * Load connection settings from API
	 */
	const loadSettings = ( { force = false } = {} ) => {
		if ( isLoading && ! force ) {
			console.log(
				'[Fair Payments Connector] Skipping loadSettings - already loading'
			);
			return;
		}

		// A forced reload can overlap an earlier load; only the newest
		// request may update the tab, so an older response can't put stale
		// connection data back.
		const loadId = ++latestLoadId.current;
		const isLatest = () => loadId === latestLoadId.current;

		setIsLoading( true );

		loadOAuthStatus()
			.then( ( status ) => isLatest() && setOauthStatus( status ) )
			.catch( () => isLatest() && setOauthStatus( null ) );

		loadConnectionSettings()
			.then( ( settings ) => {
				if ( ! isLatest() ) {
					return;
				}
				setConnected( settings.connected );
				setMode( settings.mode );
				setPendingMode( settings.mode );
				setOrganizationId( settings.organizationId );
				setProfileId( settings.profileId );
				setTokenExpires( settings.tokenExpires );
				setIsLoading( false );
			} )
			.catch( ( error ) => {
				if ( ! isLatest() ) {
					return;
				}
				console.error(
					'[Fair Payments Connector] Failed to load settings:',
					error
				);
				onNotice( {
					status: 'error',
					message: __(
						'Failed to load settings.',
						'fair-payments-connector'
					),
				} );
				setIsLoading( false );
			} );
	};

	/**
	 * Load settings on mount
	 */
	useEffect( () => {
		loadSettings();
	}, [] );

	/**
	 * Reload settings when shouldReload changes. Forced: the OAuth callback
	 * can finish while the initial load is still running, and that load
	 * predates the connection it just saved.
	 */
	useEffect( () => {
		if ( shouldReload ) {
			loadSettings( { force: true } );
		}
	}, [ shouldReload ] );

	/**
	 * Load the connected profile name and enabled payment methods.
	 *
	 * Re-runs whenever the connection state or active mode changes, since the
	 * enabled methods differ between test and live mode.
	 */
	useEffect( () => {
		if ( ! connected ) {
			setOverview( null );
			setOverviewError( null );
			return;
		}

		// A response for an earlier connection or mode must not put its
		// profile name back after a newer one.
		let isCurrent = true;

		setOverview( null );
		setOverviewLoading( true );
		setOverviewError( null );

		loadConnectionOverview()
			.then( ( data ) => {
				if ( ! isCurrent ) {
					return;
				}
				setOverview( data );
				setOverviewLoading( false );
			} )
			.catch( ( error ) => {
				if ( ! isCurrent ) {
					return;
				}
				setOverviewError(
					error.message ||
						( error.data && error.data.message ) ||
						__(
							'Failed to load payment methods.',
							'fair-payments-connector'
						)
				);
				setOverviewLoading( false );
			} );

		return () => {
			isCurrent = false;
		};
	}, [ connected, mode ] );

	/**
	 * Handle Connect and Reconnect — fetches a CSRF state token first, then
	 * redirects. Reconnecting goes through the same authorization without
	 * disconnecting, so the current connection stays in place until the new
	 * one is saved.
	 */
	const handleConnect = () => {
		fetchOAuthState()
			.then( ( oauthState ) => {
				window.location.href = buildAuthorizeUrl( oauthState );
			} )
			.catch( () => {
				onNotice( {
					status: 'error',
					message: __(
						'Failed to initiate Mollie connection. Please try again.',
						'fair-payments-connector'
					),
				} );
			} );
	};

	/**
	 * Start a connection action unless one is already running.
	 *
	 * @return {boolean} Whether the caller may proceed
	 */
	const beginAction = () => {
		if ( actionInFlight.current ) {
			return false;
		}
		actionInFlight.current = true;
		return true;
	};

	const endAction = () => {
		actionInFlight.current = false;
	};

	/**
	 * Open the disconnect confirmation dialog.
	 */
	const handleDisconnect = () => {
		setDisconnection( { saving: false, error: null } );
	};

	const closeDisconnection = () => {
		if ( ! actionInFlight.current ) {
			setDisconnection( null );
		}
	};

	/**
	 * Confirm disconnect. The dialog stays open, busy, until the server
	 * answers, and shows a failure in place.
	 */
	const handleConfirmDisconnect = () => {
		if ( ! beginAction() ) {
			return;
		}
		setDisconnection( { saving: true, error: null } );

		disconnectOAuth()
			.then( () => {
				endAction();
				setDisconnection( null );
				loadSettings( { force: true } );
				onNotice( {
					status: 'success',
					message: __(
						'Disconnected from Mollie.',
						'fair-payments-connector'
					),
				} );
			} )
			.catch( ( error ) => {
				endAction();

				// The credentials are already gone; only the audit entry
				// failed. Retrying would mislead, so show the new state.
				if ( error && error.code === 'audit_log_failed' ) {
					setDisconnection( null );
					loadSettings( { force: true } );
					onNotice( {
						status: 'warning',
						message: __(
							'Disconnected, but the audit entry could not be recorded.',
							'fair-payments-connector'
						),
					} );
					return;
				}

				setDisconnection( {
					saving: false,
					error: errorMessage(
						error,
						__( 'Failed to disconnect.', 'fair-payments-connector' )
					),
				} );
			} );
	};

	/**
	 * Save a pending mode change — the Save button only appears once the mode
	 * actually differs from what's stored.
	 */
	const handleSaveMode = () => {
		setIsSaving( true );

		saveConnectorSettings( { fair_payment_mode: pendingMode } )
			.then( () => {
				loadSettings();
				onNotice( {
					status: 'success',
					message: sprintf(
						/* translators: %s: mode name (Test or Live) */
						__( 'Switched to %s mode.', 'fair-payments-connector' ),
						pendingMode === 'test'
							? __( 'Test', 'fair-payments-connector' )
							: __( 'Live', 'fair-payments-connector' )
					),
				} );
				setIsSaving( false );
			} )
			.catch( ( error ) => {
				onNotice( {
					status: 'error',
					message:
						error.message ||
						__(
							'Failed to change mode.',
							'fair-payments-connector'
						),
				} );
				setIsSaving( false );
			} );
	};

	/**
	 * Handle manual token refresh
	 */
	const handleRefreshToken = () => {
		setIsRefreshing( true );

		testConnection()
			.then( ( response ) => {
				loadSettings();
				onNotice( {
					status: 'success',
					message:
						response.message ||
						__(
							'Connection refreshed successfully.',
							'fair-payments-connector'
						),
				} );
				setIsRefreshing( false );
			} )
			.catch( ( error ) => {
				// Log detailed error for troubleshooting
				console.error(
					'[Fair Payments Connector] Connection test failed:',
					error
				);
				console.error( '[Fair Payments Connector] Error details:', {
					message: error.message,
					code: error.code,
					data: error.data,
				} );

				// Build detailed error message for admin
				let errorMessage =
					__(
						'Failed to refresh connection.',
						'fair-payments-connector'
					) + ' ';

				if ( error.message ) {
					errorMessage += error.message;
				}

				if ( error.data && error.data.details ) {
					const details = error.data.details;
					const debugInfo = [];

					if ( details.message ) {
						debugInfo.push( 'Error: ' + details.message );
					}
					if ( details.file && details.line ) {
						debugInfo.push(
							'Location: ' + details.file + ':' + details.line
						);
					}
					if ( details.code ) {
						debugInfo.push( 'Code: ' + details.code );
					}

					if ( debugInfo.length > 0 ) {
						errorMessage += ' (' + debugInfo.join( ', ' ) + ')';
					}
				}

				errorMessage +=
					' ' +
					__(
						'Please check the error log for more details or try reconnecting to Mollie.',
						'fair-payments-connector'
					);

				onNotice( {
					status: 'error',
					message: errorMessage,
				} );
				setIsRefreshing( false );
			} );
	};

	/**
	 * Create the test payment and open its Mollie checkout in a new tab.
	 *
	 * The checkout URL is also kept in state so a fallback link can be shown
	 * when the browser blocks the popup.
	 *
	 * @param {Object|null} confirmed Context the administrator confirmed, for a live payment.
	 * @return {Promise} Resolves once the payment exists; rejects with the API error
	 */
	const submitTestPayment = ( confirmed ) => {
		setIsTestingPayment( true );
		setTestCheckoutUrl( null );

		return createTestPayment( confirmed )
			.then( ( response ) => {
				setTestCheckoutUrl( response.checkout_url );
				window.open( response.checkout_url, '_blank', 'noopener' );
				onNotice( {
					status: 'success',
					message: __(
						'Test payment created. Complete or cancel the checkout in the new tab; its status updates automatically.',
						'fair-payments-connector'
					),
				} );
			} )
			.finally( () => setIsTestingPayment( false ) );
	};

	/**
	 * The server answers a missing or outdated live confirmation with the
	 * current context; show it for a fresh confirmation.
	 *
	 * @param {Object} error API error.
	 * @return {Object|null} Current context, if the error carries one
	 */
	const contextFromError = ( error ) =>
		error &&
		( error.code === 'test_payment_context_changed' ||
			error.code === 'test_payment_confirmation_required' ) &&
		error.data &&
		error.data.context
			? error.data.context
			: null;

	/**
	 * Handle Create test payment button click.
	 *
	 * In test mode the payment is created right away. In live mode a real
	 * payment with real money is made, so the amount, currency, and connected
	 * account are loaded from the server and confirmed first.
	 */
	const handleTestPayment = () => {
		if ( mode === 'live' ) {
			openLiveConfirmation();
			return;
		}

		if ( ! beginAction() ) {
			return;
		}

		submitTestPayment( null )
			.catch( ( error ) => {
				const context = contextFromError( error );
				if ( context ) {
					// The site switched to live mode elsewhere.
					loadSettings( { force: true } );
					setLiveConfirmation( {
						context,
						loading: false,
						saving: false,
						error: errorMessage( error, '' ),
					} );
					return;
				}
				onNotice( {
					status: 'error',
					message: errorMessage(
						error,
						__(
							'Failed to create test payment.',
							'fair-payments-connector'
						)
					),
				} );
			} )
			.finally( endAction );
	};

	/**
	 * Open the live confirmation and load what the payment would be created
	 * with. Nothing is created until the administrator confirms.
	 */
	const openLiveConfirmation = () => {
		setLiveConfirmation( {
			context: null,
			loading: true,
			saving: false,
			error: null,
		} );

		loadTestPaymentContext()
			.then( ( context ) =>
				setLiveConfirmation( ( current ) =>
					current ? { ...current, context, loading: false } : current
				)
			)
			.catch( ( error ) =>
				setLiveConfirmation( ( current ) =>
					current
						? {
								...current,
								loading: false,
								error: errorMessage(
									error,
									__(
										'Failed to load the test payment details.',
										'fair-payments-connector'
									)
								),
						  }
						: current
				)
			);
	};

	const closeLiveConfirmation = () => {
		if ( ! actionInFlight.current ) {
			setLiveConfirmation( null );
		}
	};

	/**
	 * Create the payment with the context shown in the dialog. The dialog
	 * stays open, busy, until the server answers, and shows a failure in
	 * place.
	 */
	const handleConfirmLivePayment = () => {
		if ( ! liveConfirmation || ! liveConfirmation.context ) {
			return;
		}
		if ( ! beginAction() ) {
			return;
		}

		const { context } = liveConfirmation;
		setLiveConfirmation( {
			context,
			loading: false,
			saving: true,
			error: null,
		} );

		submitTestPayment( context )
			.then( () => setLiveConfirmation( null ) )
			.catch( ( error ) => {
				const current = contextFromError( error );
				if ( current ) {
					loadSettings( { force: true } );
				}
				setLiveConfirmation( {
					context: current || context,
					loading: false,
					saving: false,
					error: errorMessage(
						error,
						__(
							'Failed to create test payment.',
							'fair-payments-connector'
						)
					),
				} );
			} )
			.finally( endAction );
	};

	const isActionRunning =
		isSaving || isTestingPayment || ( disconnection?.saving ?? false );

	const profileName = overview?.profile_name || '';

	const needsSettlementAccess =
		connected &&
		oauthStatus !== null &&
		oauthStatus.settlementAccessRequested &&
		! oauthStatus.settlementAccess;

	const liveContext = liveConfirmation?.context;
	const isLiveContext = liveContext?.mode === 'live';

	// Rendered while settings reload too, so a reload triggered from a dialog
	// doesn't close it.
	const dialogs = (
		<>
			{ disconnection && (
				<Modal
					title={ __(
						'Disconnect Mollie',
						'fair-payments-connector'
					) }
					onRequestClose={ closeDisconnection }
					isDismissible={ ! disconnection.saving }
					shouldCloseOnClickOutside={ ! disconnection.saving }
					shouldCloseOnEsc={ ! disconnection.saving }
					className="fair-payments-connector-connection__dialog"
				>
					{ disconnection.error && (
						<Notice status="error" isDismissible={ false }>
							{ disconnection.error }
						</Notice>
					) }
					<p>
						{ profileName
							? sprintf(
									/* translators: %s: Mollie profile name */
									__(
										'Disconnect this site from the Mollie profile "%s"?',
										'fair-payments-connector'
									),
									profileName
							  )
							: __(
									'Disconnect this site from the connected Mollie account?',
									'fair-payments-connector'
							  ) }
					</p>
					<AccountDetails
						profileName={ profileName }
						profileId={ profileId }
						organizationId={ organizationId }
					/>
					<p>
						{ __(
							'This site loses its Mollie connection: it cannot create new Mollie payments or receive status updates for existing ones until you reconnect. Payments already in Mollie are not cancelled or refunded.',
							'fair-payments-connector'
						) }
					</p>
					<div className="fair-payments-connector-connection__buttons">
						<Button
							variant="tertiary"
							onClick={ closeDisconnection }
							disabled={ disconnection.saving }
						>
							{ __( 'Cancel', 'fair-payments-connector' ) }
						</Button>
						<Button
							variant="primary"
							isDestructive
							isBusy={ disconnection.saving }
							disabled={ disconnection.saving }
							onClick={ handleConfirmDisconnect }
						>
							{ disconnection.saving
								? __(
										'Disconnecting…',
										'fair-payments-connector'
								  )
								: __(
										'Disconnect Mollie',
										'fair-payments-connector'
								  ) }
						</Button>
					</div>
				</Modal>
			) }

			{ liveConfirmation && (
				<Modal
					title={
						liveContext && ! isLiveContext
							? __(
									'Create test payment',
									'fair-payments-connector'
							  )
							: __(
									'Create live test payment',
									'fair-payments-connector'
							  )
					}
					onRequestClose={ closeLiveConfirmation }
					isDismissible={ ! liveConfirmation.saving }
					shouldCloseOnClickOutside={ ! liveConfirmation.saving }
					shouldCloseOnEsc={ ! liveConfirmation.saving }
					className="fair-payments-connector-connection__dialog"
				>
					{ liveConfirmation.error && (
						<Notice status="error" isDismissible={ false }>
							{ liveConfirmation.error }
						</Notice>
					) }
					{ liveConfirmation.loading && (
						<p>
							<Spinner />{ ' ' }
							{ __(
								'Loading the test payment details…',
								'fair-payments-connector'
							) }
						</p>
					) }
					{ liveContext && (
						<>
							<p>
								{ isLiveContext
									? sprintf(
											/* translators: %s: amount with currency code, e.g. "1.00 EUR" */
											__(
												'Create a live test payment of %s?',
												'fair-payments-connector'
											),
											liveContext.amount_display
									  )
									: sprintf(
											/* translators: %s: amount with currency code, e.g. "1.00 EUR" */
											__(
												'Create a test-mode payment of %s?',
												'fair-payments-connector'
											),
											liveContext.amount_display
									  ) }
							</p>
							<AccountDetails
								profileName={ profileName }
								profileId={ liveContext.profile_id }
								organizationId={ liveContext.organization_id }
							/>
							{ isLiveContext ? (
								<Notice
									status="warning"
									isDismissible={ false }
								>
									{ __(
										'Live mode: this creates a real payment with real money and gateway fees.',
										'fair-payments-connector'
									) }
								</Notice>
							) : (
								<p>
									{ __(
										'Test mode: no real money is charged.',
										'fair-payments-connector'
									) }
								</p>
							) }
						</>
					) }
					{ ! liveConfirmation.loading && ! liveContext && (
						<p>
							{ __(
								'The payment details could not be loaded, so no payment can be created. Close this dialog and try again.',
								'fair-payments-connector'
							) }
						</p>
					) }
					<div className="fair-payments-connector-connection__buttons">
						<Button
							variant="tertiary"
							onClick={ closeLiveConfirmation }
							disabled={ liveConfirmation.saving }
						>
							{ __( 'Cancel', 'fair-payments-connector' ) }
						</Button>
						<Button
							variant="primary"
							isBusy={ liveConfirmation.saving }
							disabled={
								! liveContext || liveConfirmation.saving
							}
							onClick={ handleConfirmLivePayment }
						>
							{ liveConfirmation.saving
								? __( 'Creating…', 'fair-payments-connector' )
								: isLiveContext || ! liveContext
								? __(
										'Create live test payment',
										'fair-payments-connector'
								  )
								: __(
										'Create test payment',
										'fair-payments-connector'
								  ) }
						</Button>
					</div>
				</Modal>
			) }
		</>
	);

	if ( isLoading ) {
		return (
			<>
				<Card>
					<CardBody>
						<p>
							{ __(
								'Loading connection settings...',
								'fair-payments-connector'
							) }
						</p>
					</CardBody>
				</Card>
				{ dialogs }
			</>
		);
	}

	return (
		<>
			<Card>
				<CardBody>
					<h2>
						{ __( 'Mollie Connection', 'fair-payments-connector' ) }
					</h2>

					{ ! connected ? (
						<>
							<p>
								{ __(
									'Connect your Mollie account to accept payments. This uses secure OAuth authentication.',
									'fair-payments-connector'
								) }
							</p>
							<div style={ { marginTop: '12px' } }>
								<Button isPrimary onClick={ handleConnect }>
									{ __(
										'Connect with Mollie',
										'fair-payments-connector'
									) }
								</Button>
							</div>
						</>
					) : (
						<>
							<Notice status="success" isDismissible={ false }>
								{ __(
									'Connected to Mollie',
									'fair-payments-connector'
								) }
							</Notice>

							{ needsSettlementAccess && (
								<Notice
									status="warning"
									isDismissible={ false }
									actions={ [
										{
											label: __(
												'Reconnect to Mollie',
												'fair-payments-connector'
											),
											onClick: handleConnect,
											variant: 'primary',
										},
									] }
								>
									{ __(
										'Mollie has not authorized this site to read settlements yet. Reconnect to grant that permission. Payments keep working in the meantime.',
										'fair-payments-connector'
									) }
								</Notice>
							) }

							{ oauthStatus?.settlementAccess && (
								<p
									style={ {
										fontSize: '0.9em',
										color: '#666',
										marginTop: '0.5rem',
									} }
								>
									{ __(
										'Settlement access: authorized',
										'fair-payments-connector'
									) }
								</p>
							) }

							{ organizationId && (
								<div style={ { marginTop: '1rem' } }>
									<p>
										<strong>
											{ __(
												'Organization ID:',
												'fair-payments-connector'
											) }
										</strong>{ ' ' }
										<code>{ organizationId }</code>
									</p>
								</div>
							) }

							<div style={ { marginTop: '0.5rem' } }>
								<p>
									<strong>
										{ __(
											'Profile ID:',
											'fair-payments-connector'
										) }
									</strong>{ ' ' }
									{ profileId ? (
										<code>{ profileId }</code>
									) : (
										<span style={ { color: '#d63638' } }>
											{ __(
												'Missing (required for payments)',
												'fair-payments-connector'
											) }
										</span>
									) }
								</p>
								{ ! profileId && (
									<p
										style={ {
											fontSize: '0.9em',
											color: '#d63638',
											marginTop: '0.5rem',
										} }
									>
										{ __(
											'Please reconnect to Mollie to fetch the profile ID.',
											'fair-payments-connector'
										) }
									</p>
								) }
							</div>

							<div style={ { marginTop: '1rem' } }>
								{ overviewLoading && (
									<p
										style={ {
											fontSize: '0.9em',
											color: '#666',
										} }
									>
										{ __(
											'Loading payment methods…',
											'fair-payments-connector'
										) }
									</p>
								) }

								{ overviewError && (
									<Notice
										status="warning"
										isDismissible={ false }
									>
										{ overviewError }
									</Notice>
								) }

								{ overview && ! overviewLoading && (
									<>
										<p>
											<strong>
												{ __(
													'Profile name:',
													'fair-payments-connector'
												) }
											</strong>{ ' ' }
											{ overview.profile_name }
										</p>

										<p
											style={ {
												marginBottom: '0.25rem',
											} }
										>
											<strong>
												{ __(
													'Enabled payment methods:',
													'fair-payments-connector'
												) }
											</strong>
										</p>
										{ overview.methods.length > 0 ? (
											<ul
												style={ {
													listStyle: 'disc',
													marginLeft: '1.5rem',
												} }
											>
												{ overview.methods.map(
													( method ) => (
														<li key={ method.id }>
															{ method.image && (
																<img
																	src={
																		method.image
																	}
																	alt=""
																	width="20"
																	height="20"
																	style={ {
																		verticalAlign:
																			'middle',
																		marginRight:
																			'0.5rem',
																	} }
																/>
															) }
															{
																method.description
															}
														</li>
													)
												) }
											</ul>
										) : (
											<p>
												{ __(
													'No payment methods are currently enabled.',
													'fair-payments-connector'
												) }
											</p>
										) }

										<p>
											<a
												href={ overview.manage_url }
												target="_blank"
												rel="noreferrer"
											>
												{ __(
													'Manage payment methods in Mollie',
													'fair-payments-connector'
												) }
											</a>
										</p>
									</>
								) }
							</div>

							{ tokenExpires && (
								<div style={ { marginTop: '0.5rem' } }>
									<p
										style={ {
											fontSize: '0.9em',
											color: '#666',
										} }
									>
										{ sprintf(
											/* translators: %s: expiration date */
											__(
												'Token expires: %s',
												'fair-payments-connector'
											),
											new Date(
												tokenExpires * 1000
											).toLocaleString()
										) }
									</p>
								</div>
							) }

							<div style={ { marginTop: '1.5rem' } }>
								<RadioControl
									label={ __(
										'Mode',
										'fair-payments-connector'
									) }
									selected={ pendingMode }
									options={ [
										{
											label: __(
												'Test Mode',
												'fair-payments-connector'
											),
											value: 'test',
										},
										{
											label: __(
												'Live Mode',
												'fair-payments-connector'
											),
											value: 'live',
										},
									] }
									onChange={ setPendingMode }
									disabled={ isActionRunning }
								/>
								{ pendingMode !== mode && (
									<div style={ { marginTop: '12px' } }>
										<Button
											variant="primary"
											onClick={ handleSaveMode }
											isBusy={ isSaving }
											disabled={ isActionRunning }
										>
											{ __(
												'Save mode',
												'fair-payments-connector'
											) }
										</Button>
									</div>
								) }
							</div>

							<div style={ { marginTop: '1.5rem' } }>
								<ButtonGroup>
									<Button
										isDestructive
										onClick={ handleDisconnect }
										disabled={ isActionRunning }
									>
										{ __(
											'Disconnect Mollie',
											'fair-payments-connector'
										) }
									</Button>
									<Button
										isSecondary
										onClick={ handleConnect }
										disabled={ isActionRunning }
									>
										{ __(
											'Reconnect',
											'fair-payments-connector'
										) }
									</Button>
									<Button
										isSecondary
										onClick={ handleRefreshToken }
										isBusy={ isRefreshing }
										disabled={
											isRefreshing || isActionRunning
										}
									>
										{ isRefreshing
											? __(
													'Refreshing...',
													'fair-payments-connector'
											  )
											: __(
													'Refresh Connection',
													'fair-payments-connector'
											  ) }
									</Button>
								</ButtonGroup>
							</div>
						</>
					) }
				</CardBody>
			</Card>

			<Card>
				<CardBody>
					<h2>{ __( 'Test payment', 'fair-payments-connector' ) }</h2>
					<p>
						{ __(
							'Make a small payment (one unit of your currency, e.g. €1) to check that checkout and confirmation work from start to finish.',
							'fair-payments-connector'
						) }
					</p>

					{ connected && (
						<p style={ { fontSize: '0.9em', color: '#666' } }>
							{ mode === 'live'
								? __(
										'Live mode: this creates a real payment with real money and gateway fees.',
										'fair-payments-connector'
								  )
								: __(
										'Test mode: no real money is charged.',
										'fair-payments-connector'
								  ) }
						</p>
					) }

					{ testCheckoutUrl && (
						<Notice status="success" isDismissible={ false }>
							{ __(
								'Test payment created. If the checkout did not open in a new tab, ',
								'fair-payments-connector'
							) }
							<a
								href={ testCheckoutUrl }
								target="_blank"
								rel="noreferrer"
							>
								{ __(
									'open it here.',
									'fair-payments-connector'
								) }
							</a>
						</Notice>
					) }

					<div style={ { marginTop: '1rem' } }>
						<Button
							isSecondary
							onClick={ handleTestPayment }
							isBusy={ isTestingPayment }
							disabled={ ! connected || isActionRunning }
						>
							{ __(
								'Create test payment',
								'fair-payments-connector'
							) }
						</Button>
					</div>

					{ ! connected && (
						<p
							style={ {
								fontSize: '0.9em',
								color: '#666',
								marginTop: '0.5rem',
							} }
						>
							{ __(
								'Connect Mollie first to run a test payment.',
								'fair-payments-connector'
							) }
						</p>
					) }
				</CardBody>
			</Card>

			{ dialogs }
		</>
	);
}
