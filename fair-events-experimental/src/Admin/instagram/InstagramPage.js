/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Modal,
	Notice,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadConnection,
	startAuthorization,
	completeAuthorization,
	testConnection,
	disconnect,
} from './api.js';
import { navigate } from './navigate.js';
import AccountChoice from './AccountChoice.js';

const OAUTH_PARAMS = [ 'instagram_handoff', 'instagram_error', 'state' ];

const helpStyle = { color: '#50575e', marginTop: 0 };
const rowStyle = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: '8px',
	alignItems: 'center',
};

/**
 * Read and remove the OAuth service's return parameters, so the single-use
 * handoff code does not stay in the address bar or the browser history.
 *
 * @return {Object|null} Return parameters, or null when this is no return.
 */
export function takeOAuthReturn() {
	const url = new URL( window.location.href );
	const params = url.searchParams;
	if (
		! params.has( 'instagram_handoff' ) &&
		! params.has( 'instagram_error' )
	) {
		return null;
	}
	const result = {
		state: params.get( 'state' ) || '',
		handoff: params.get( 'instagram_handoff' ) || '',
		error: params.get( 'instagram_error' ) || '',
	};
	OAUTH_PARAMS.forEach( ( key ) => params.delete( key ) );
	window.history.replaceState( {}, '', url.toString() );
	return result;
}

/**
 * The "Connected to Instagram as \@name." sentence for connection details.
 *
 * @param {Object} details Connection details.
 * @return {string} Sentence.
 */
function connectedText( details ) {
	return details.username
		? sprintf(
				/* translators: %s: Instagram username */
				__(
					'Connected to Instagram as @%s.',
					'fair-events-experimental'
				),
				details.username
			)
		: __( 'Connected to Instagram.', 'fair-events-experimental' );
}

/**
 * Fallback message for a failed request.
 *
 * @param {Object} error    apiFetch error.
 * @param {string} fallback Full-sentence fallback.
 * @return {string} Message.
 */
function errorMessage( error, fallback ) {
	return error?.message || fallback;
}

/**
 * How long the stored token works.
 *
 * @param {Object} connection Connection details.
 * @return {string} Sentence.
 */
export function expiryText( connection ) {
	if ( connection.token_expiry === 'never' ) {
		return __(
			'The access token does not expire. It stops working if the business removes the app in Meta Business Settings.',
			'fair-events-experimental'
		);
	}
	if ( connection.token_expiry === 'expires' && connection.token_expires ) {
		return sprintf(
			/* translators: %s: date and time */
			__(
				'The access token expires on %s. Connect again before then; it is not renewed automatically.',
				'fair-events-experimental'
			),
			formatTime( connection.token_expires )
		);
	}
	return __(
		'The access token’s expiry is not known.',
		'fair-events-experimental'
	);
}

/**
 * Format a Unix time with the browser's locale.
 *
 * @param {number} timestamp Unix seconds.
 * @return {string} Date and time.
 */
function formatTime( timestamp ) {
	return new Date( timestamp * 1000 ).toLocaleString();
}

/**
 * What to tell the administrator while this page does not manage the
 * connection, from the API's `ownership_reason`. Only a reported missing
 * handoff recommends updating Fair Audience; an absent or unknown reason is
 * treated as an incomplete response, not as an old plugin.
 *
 * @param {Object} connection Connection response.
 * @return {{status: string, messages: string[], showLegacyLink: boolean}} Notice.
 */
export function ownershipNotice( connection ) {
	const unchanged = __(
		'Nothing has to be re-entered: the stored connection moves here as it is.',
		'fair-events-experimental'
	);
	const showLegacyLink =
		connection?.managed_here === false &&
		typeof connection.legacy_manage_url === 'string' &&
		connection.legacy_manage_url !== '';

	// A reason only counts alongside an explicit `managed_here: false`.
	const reason =
		connection?.managed_here === false ? connection.ownership_reason : null;

	switch ( reason ) {
		case 'audience_handoff_missing':
			return {
				status: 'warning',
				messages: [
					__(
						'This site’s Fair Audience is older than this plugin and still manages the Instagram connection. Update Fair Audience to manage the connection here.',
						'fair-events-experimental'
					),
					unchanged,
				],
				showLegacyLink,
			};
		case 'audience_update_not_loaded':
			return {
				status: 'warning',
				messages: [
					__(
						'Fair Audience is updated, but the site still runs its previous code, so Fair Audience still manages the Instagram connection. Clear the PHP opcode cache or restart PHP (your hosting control panel usually offers this), then reload this page.',
						'fair-events-experimental'
					),
					unchanged,
				],
				showLegacyLink,
			};
		case 'feature_disabled':
			return {
				status: 'warning',
				messages: [
					__(
						'Instagram is turned off in Fair Events → Settings → Experimental. Turn it on to manage the connection here.',
						'fair-events-experimental'
					),
				],
				showLegacyLink,
			};
		case 'not_claimed':
			return {
				status: 'warning',
				messages: [
					__(
						'Fair Events Experimental did not take over the Instagram connection while this page loaded, so Fair Audience still manages it. Reload this page. Until it is taken over, keep managing it in Fair Audience → Settings → Instagram.',
						'fair-events-experimental'
					),
					unchanged,
				],
				showLegacyLink,
			};
		default:
			return {
				status: 'error',
				messages: [
					__(
						'The site did not say who manages the Instagram connection. Reload this page. If this keeps happening, make sure no cache serves outdated responses for the site’s REST API.',
						'fair-events-experimental'
					),
				],
				showLegacyLink,
			};
	}
}

/**
 * Fair Events → Instagram: the connected Instagram account, connecting
 * through Meta's Unified Login, a connection test and disconnecting.
 *
 * @return {JSX.Element} The page.
 */
export default function InstagramPage() {
	const [ connection, setConnection ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ notice, setNotice ] = useState( null );
	const [ isStarting, setIsStarting ] = useState( false );
	const [ startError, setStartError ] = useState( null );
	const [ isTesting, setIsTesting ] = useState( false );
	const [ testError, setTestError ] = useState( null );
	const [ confirmingDisconnect, setConfirmingDisconnect ] = useState( false );
	const [ isDisconnecting, setIsDisconnecting ] = useState( false );
	const [ disconnectError, setDisconnectError ] = useState( null );
	const disconnectInFlight = useRef( false );

	const apply = ( details ) => setConnection( details );

	useEffect( () => {
		const oauth = takeOAuthReturn();
		const initial = oauth
			? completeAuthorization( oauth )
					.then( ( details ) => {
						// With several shared accounts, the choice card
						// explains the next step; nothing is connected yet.
						if ( ! details.pending_choice ) {
							setNotice( {
								status: 'success',
								message: connectedText( details ),
							} );
						}
						return details;
					} )
					.catch( ( error ) => {
						setNotice( {
							status: 'error',
							message: errorMessage(
								error,
								__(
									'Instagram authorization failed. Nothing was changed; try connecting again.',
									'fair-events-experimental'
								)
							),
						} );
						return loadConnection();
					} )
			: loadConnection();

		initial
			.then( apply )
			.catch( ( error ) =>
				setLoadError(
					errorMessage(
						error,
						__(
							'The Instagram connection could not be loaded. Reload the page to try again.',
							'fair-events-experimental'
						)
					)
				)
			);
	}, [] );

	const handleConnect = () => {
		if ( isStarting ) {
			return;
		}
		setIsStarting( true );
		setStartError( null );
		startAuthorization()
			.then( ( result ) => {
				navigate( result.authorize_url );
			} )
			.catch( ( error ) => {
				setIsStarting( false );
				setStartError(
					errorMessage(
						error,
						__(
							'The Instagram connection could not be started. Try again.',
							'fair-events-experimental'
						)
					)
				);
			} );
	};

	const handleTest = () => {
		if ( isTesting ) {
			return;
		}
		setIsTesting( true );
		setTestError( null );
		testConnection()
			.then( ( result ) => {
				apply( result );
				setNotice( { status: 'success', message: result.message } );
			} )
			.catch( ( error ) =>
				setTestError( {
					message: errorMessage(
						error,
						__(
							'The connection test failed. Try again.',
							'fair-events-experimental'
						)
					),
					details: error?.data?.details || '',
				} )
			)
			.finally( () => setIsTesting( false ) );
	};

	const closeDisconnect = () => {
		if ( ! disconnectInFlight.current ) {
			setConfirmingDisconnect( false );
			setDisconnectError( null );
		}
	};

	const confirmDisconnect = () => {
		if ( disconnectInFlight.current ) {
			return;
		}
		disconnectInFlight.current = true;
		setIsDisconnecting( true );
		setDisconnectError( null );
		disconnect()
			.then( ( details ) => {
				apply( details );
				setTestError( null );
				setConfirmingDisconnect( false );
				setNotice( {
					status: 'success',
					message: __(
						'Disconnected from Instagram.',
						'fair-events-experimental'
					),
				} );
			} )
			.catch( ( error ) =>
				setDisconnectError(
					errorMessage(
						error,
						__(
							'Instagram could not be disconnected. Try again.',
							'fair-events-experimental'
						)
					)
				)
			)
			.finally( () => {
				disconnectInFlight.current = false;
				setIsDisconnecting( false );
			} );
	};

	const header = (
		<>
			<h1>{ __( 'Instagram', 'fair-events-experimental' ) }</h1>
			{ notice && (
				<Notice
					status={ notice.status }
					isDismissible
					onRemove={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }
		</>
	);

	if ( loadError ) {
		return (
			<div className="wrap fair-events-instagram">
				{ header }
				<Notice status="error" isDismissible={ false }>
					{ loadError }
				</Notice>
			</div>
		);
	}

	if ( ! connection ) {
		return (
			<div className="wrap fair-events-instagram">
				{ header }
				<Spinner />
			</div>
		);
	}

	if ( connection.managed_here !== true ) {
		const ownership = ownershipNotice( connection );
		return (
			<div className="wrap fair-events-instagram">
				{ header }
				<Notice status={ ownership.status } isDismissible={ false }>
					{ ownership.messages.map( ( message ) => (
						<p key={ message }>{ message }</p>
					) ) }
					{ ownership.showLegacyLink && (
						<p>
							<a href={ connection.legacy_manage_url }>
								{ __(
									'Open Fair Audience → Settings → Instagram',
									'fair-events-experimental'
								) }
							</a>
						</p>
					) }
				</Notice>
			</div>
		);
	}

	const status = connection.credential_status;
	const needsReconnect =
		connection.connected &&
		[ 'unrecoverable', 'reconnect_required', 'expired' ].includes( status );
	const isPaused =
		connection.connected && status === 'encryption_unavailable';
	const showConnectForm = ! connection.connected || needsReconnect;

	let accountName;
	if ( connection.username ) {
		accountName = sprintf(
			/* translators: %s: Instagram username */
			__( 'Disconnect @%s from this site?', 'fair-events-experimental' ),
			connection.username
		);
	} else if ( connection.user_id ) {
		accountName = sprintf(
			/* translators: %s: Instagram account ID */
			__(
				'Disconnect the Instagram account with ID %s from this site?',
				'fair-events-experimental'
			),
			connection.user_id
		);
	} else {
		accountName = __(
			'Disconnect the Instagram account connected to this site? Its username and ID are not known.',
			'fair-events-experimental'
		);
	}

	const choice =
		connection.pending_choice &&
		Array.isArray( connection.pending_choice.accounts )
			? connection.pending_choice
			: null;

	const choiceCard = choice && (
		<AccountChoice
			key={ choice.id }
			choice={ choice }
			connection={ connection }
			onConnected={ ( details ) => {
				apply( details );
				setTestError( null );
				setNotice( {
					status: 'success',
					message: connectedText( details ),
				} );
			} }
			onCancelled={ ( details ) => {
				apply( details );
				setNotice( {
					status: 'info',
					message: __(
						'The account choice was cancelled. Nothing was changed.',
						'fair-events-experimental'
					),
				} );
			} }
			onGone={ ( message ) => {
				setNotice( { status: 'error', message } );
				loadConnection()
					.then( apply )
					.catch( () => {} );
			} }
		/>
	);

	const disconnectButton = (
		<Button
			variant="secondary"
			isDestructive
			onClick={ () => setConfirmingDisconnect( true ) }
		>
			{ __( 'Disconnect', 'fair-events-experimental' ) }
		</Button>
	);

	return (
		<div className="wrap fair-events-instagram">
			{ header }

			<p style={ { maxWidth: '720px' } }>
				{ __(
					'The Instagram professional account this site publishes to. The access token is stored encrypted and is never shown again after it is saved.',
					'fair-events-experimental'
				) }
			</p>

			{ choiceCard }

			{ showConnectForm ? (
				<Card style={ { marginBottom: '16px' } }>
					<CardHeader>
						<h2 style={ { margin: 0 } }>
							{ __(
								'Connect an account',
								'fair-events-experimental'
							) }
						</h2>
					</CardHeader>
					<CardBody>
						{ needsReconnect && (
							<Notice status="error" isDismissible={ false }>
								{ connection.message }
							</Notice>
						) }
						<p style={ helpStyle }>
							{ __(
								'Connect with Instagram to sign in with Facebook, choose the business, and share the Instagram professional account this site publishes to. This uses the Fair Event Plugins OAuth service.',
								'fair-events-experimental'
							) }
						</p>
						{ startError && (
							<Notice status="error" isDismissible={ false }>
								{ startError }
							</Notice>
						) }
						<div style={ rowStyle }>
							<Button
								variant="primary"
								onClick={ handleConnect }
								isBusy={ isStarting }
								disabled={ isStarting }
							>
								{ __(
									'Connect with Instagram',
									'fair-events-experimental'
								) }
							</Button>
						</div>
						{ needsReconnect && (
							<>
								<p
									style={ {
										...helpStyle,
										marginTop: '16px',
									} }
								>
									{ __(
										'Or disconnect to remove the stored token from this site.',
										'fair-events-experimental'
									) }
								</p>
								{ disconnectButton }
							</>
						) }
					</CardBody>
				</Card>
			) : (
				<>
					<Card style={ { marginBottom: '16px' } }>
						<CardHeader>
							<h2 style={ { margin: 0 } }>
								{ __( 'Account', 'fair-events-experimental' ) }
							</h2>
						</CardHeader>
						<CardBody>
							{ isPaused ? (
								<Notice
									status="warning"
									isDismissible={ false }
								>
									{ connection.message }
								</Notice>
							) : (
								<Notice
									status="success"
									isDismissible={ false }
								>
									{ connectedText( connection ) }
								</Notice>
							) }
							{ connection.user_id && (
								<p>
									{ sprintf(
										/* translators: %s: Instagram account ID */
										__(
											'Instagram account ID: %s',
											'fair-events-experimental'
										),
										connection.user_id
									) }
								</p>
							) }
							<p>{ expiryText( connection ) }</p>
							{ ! connection.credentials_encrypted && (
								<p style={ helpStyle }>
									{ __(
										'The access token is not encrypted yet; it is encrypted on a later page load once this server supports it.',
										'fair-events-experimental'
									) }
								</p>
							) }
						</CardBody>
					</Card>

					<Card style={ { marginBottom: '16px' } }>
						<CardHeader>
							<h2 style={ { margin: 0 } }>
								{ __(
									'Test the connection',
									'fair-events-experimental'
								) }
							</h2>
						</CardHeader>
						<CardBody>
							<p style={ helpStyle }>
								{ __(
									'Asks Meta whether the connected account can still be reached with the stored token. Nothing is published.',
									'fair-events-experimental'
								) }
							</p>
							{ testError && (
								<Notice status="error" isDismissible={ false }>
									<p>{ testError.message }</p>
									{ testError.details && (
										<details>
											<summary>
												{ __(
													'Details from Meta',
													'fair-events-experimental'
												) }
											</summary>
											<p
												style={ {
													overflowWrap: 'anywhere',
												} }
											>
												{ testError.details }
											</p>
										</details>
									) }
								</Notice>
							) }
							<div style={ rowStyle }>
								<Button
									variant="secondary"
									onClick={ handleTest }
									disabled={ isTesting || isPaused }
									isBusy={ isTesting }
								>
									{ __(
										'Test connection',
										'fair-events-experimental'
									) }
								</Button>
								{ isPaused && (
									<span style={ helpStyle }>
										{ __(
											'Testing waits until the token can be read again.',
											'fair-events-experimental'
										) }
									</span>
								) }
							</div>
						</CardBody>
					</Card>

					<Card>
						<CardHeader>
							<h2 style={ { margin: 0 } }>
								{ __(
									'Disconnect',
									'fair-events-experimental'
								) }
							</h2>
						</CardHeader>
						<CardBody>
							<p style={ helpStyle }>
								{ __(
									'Removes the access token and account details from this site. To also revoke the app’s access in Meta, remove it under Meta Business Settings → Integrations → Connected apps.',
									'fair-events-experimental'
								) }
							</p>
							{ disconnectButton }
						</CardBody>
					</Card>
				</>
			) }

			{ confirmingDisconnect && (
				<Modal
					title={ __(
						'Disconnect Instagram',
						'fair-events-experimental'
					) }
					onRequestClose={ closeDisconnect }
					isDismissible={ ! isDisconnecting }
					shouldCloseOnEsc={ ! isDisconnecting }
					shouldCloseOnClickOutside={ ! isDisconnecting }
					style={ {
						maxWidth: '560px',
						width: '100%',
						overflowWrap: 'anywhere',
					} }
				>
					<p style={ { marginTop: 0 } }>
						<strong>{ accountName }</strong>
					</p>
					<p>
						{ __(
							'The access token and account details stored on this site are removed. Until you connect again, this site cannot publish to Instagram, including manual posts from Fair Audience.',
							'fair-events-experimental'
						) }
					</p>
					<p>
						{ __(
							'Posts already published on Instagram, and the post records on this site, are kept.',
							'fair-events-experimental'
						) }
					</p>
					{ disconnectError && (
						<Notice status="error" isDismissible={ false }>
							{ disconnectError }
						</Notice>
					) }
					<div
						style={ {
							...rowStyle,
							justifyContent: 'flex-end',
							marginTop: '16px',
						} }
					>
						<Button
							variant="tertiary"
							onClick={ closeDisconnect }
							disabled={ isDisconnecting }
						>
							{ __( 'Cancel', 'fair-events-experimental' ) }
						</Button>
						<Button
							variant="primary"
							isDestructive
							onClick={ confirmDisconnect }
							isBusy={ isDisconnecting }
							disabled={ isDisconnecting }
						>
							{ __(
								'Disconnect Instagram',
								'fair-events-experimental'
							) }
						</Button>
					</div>
				</Modal>
			) }
		</div>
	);
}
