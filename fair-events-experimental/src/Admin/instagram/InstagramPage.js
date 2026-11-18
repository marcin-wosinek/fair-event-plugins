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
	TextControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadConnection,
	connect,
	saveUserId,
	testConnection,
	disconnect,
} from './api.js';

const OAUTH_PARAMS = [
	'instagram_access_token',
	'instagram_user_id',
	'instagram_username',
	'instagram_expires_in',
	'error',
	'error_description',
];

const helpStyle = { color: '#50575e', marginTop: 0 };
const rowStyle = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: '8px',
	alignItems: 'center',
};

/**
 * Read and remove the OAuth proxy's return parameters, so the token does
 * not stay in the address bar or the browser history.
 *
 * @return {Object|null} Return parameters, or null when this is no return.
 */
function takeOAuthReturn() {
	const url = new URL( window.location.href );
	const params = url.searchParams;
	if ( ! params.has( 'instagram_access_token' ) && ! params.has( 'error' ) ) {
		return null;
	}
	const result = {
		accessToken: params.get( 'instagram_access_token' ) || '',
		userId: params.get( 'instagram_user_id' ) || '',
		username: params.get( 'instagram_username' ) || '',
		expiresIn: params.has( 'instagram_expires_in' )
			? parseInt( params.get( 'instagram_expires_in' ), 10 ) || null
			: null,
		error: params.get( 'error' ) || '',
	};
	OAUTH_PARAMS.forEach( ( key ) => params.delete( key ) );
	window.history.replaceState( {}, '', url.toString() );
	return result;
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
 * Format a Unix time with the browser's locale.
 *
 * @param {number} timestamp Unix seconds.
 * @return {string} Date and time.
 */
function formatTime( timestamp ) {
	return new Date( timestamp * 1000 ).toLocaleString();
}

/**
 * Fair Events → Instagram: the connected Instagram account, connecting by
 * OAuth or a manual token, the user ID, a connection test and disconnecting.
 *
 * @return {JSX.Element} The page.
 */
export default function InstagramPage() {
	const data = window.fairEventsInstagramData || {};
	const [ connection, setConnection ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ notice, setNotice ] = useState( null );
	const [ manualToken, setManualToken ] = useState( '' );
	const [ isSavingToken, setIsSavingToken ] = useState( false );
	const [ userId, setUserId ] = useState( '' );
	const [ isSavingUserId, setIsSavingUserId ] = useState( false );
	const [ isTesting, setIsTesting ] = useState( false );
	const [ testError, setTestError ] = useState( null );
	const [ confirmingDisconnect, setConfirmingDisconnect ] = useState( false );
	const [ isDisconnecting, setIsDisconnecting ] = useState( false );
	const [ disconnectError, setDisconnectError ] = useState( null );
	const disconnectInFlight = useRef( false );

	const apply = ( details ) => {
		setConnection( details );
		setUserId( details.user_id || '' );
	};

	useEffect( () => {
		const oauth = takeOAuthReturn();
		const initial = oauth?.accessToken
			? connect( oauth )
					.then( ( details ) => {
						setNotice( {
							status: 'success',
							message: __(
								'Connected to Instagram.',
								'fair-events-experimental'
							),
						} );
						return details;
					} )
					.catch( ( error ) => {
						setNotice( {
							status: 'error',
							message: errorMessage(
								error,
								__(
									'The Instagram connection could not be saved. Try connecting again.',
									'fair-events-experimental'
								)
							),
						} );
						return loadConnection();
					} )
			: loadConnection();

		if ( oauth?.error ) {
			setNotice( {
				status: 'error',
				message:
					oauth.error === 'access_denied'
						? __(
								'Instagram authorization was cancelled. Nothing was changed.',
								'fair-events-experimental'
							)
						: __(
								'Instagram authorization failed. Nothing was changed; try connecting again.',
								'fair-events-experimental'
							),
			} );
		}

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
		const authorizeUrl = new URL( data.authorizeUrl );
		authorizeUrl.searchParams.set(
			'site_id',
			window.btoa( window.location.hostname )
		);
		authorizeUrl.searchParams.set( 'return_url', data.pageUrl );
		authorizeUrl.searchParams.set( 'site_name', document.title );
		authorizeUrl.searchParams.set( 'site_url', window.location.origin );
		window.location.assign( authorizeUrl.toString() );
	};

	const handleSaveToken = () => {
		if ( isSavingToken || ! manualToken.trim() ) {
			return;
		}
		setIsSavingToken( true );
		connect( { accessToken: manualToken.trim() } )
			.then( ( details ) => {
				apply( details );
				setManualToken( '' );
				setNotice( {
					status: 'success',
					message: __(
						'Access token saved. Test the connection to load the account details.',
						'fair-events-experimental'
					),
				} );
			} )
			.catch( ( error ) =>
				setNotice( {
					status: 'error',
					message: errorMessage(
						error,
						__(
							'The access token could not be saved. Try again.',
							'fair-events-experimental'
						)
					),
				} )
			)
			.finally( () => setIsSavingToken( false ) );
	};

	const handleSaveUserId = () => {
		if ( isSavingUserId ) {
			return;
		}
		setIsSavingUserId( true );
		saveUserId( userId.trim() )
			.then( ( details ) => {
				apply( details );
				setNotice( {
					status: 'success',
					message: __(
						'Instagram user ID saved.',
						'fair-events-experimental'
					),
				} );
			} )
			.catch( ( error ) =>
				setNotice( {
					status: 'error',
					message: errorMessage(
						error,
						__(
							'The user ID could not be saved. Try again.',
							'fair-events-experimental'
						)
					),
				} )
			)
			.finally( () => setIsSavingUserId( false ) );
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

	if ( ! connection.managed_here ) {
		return (
			<div className="wrap fair-events-instagram">
				{ header }
				<Notice status="warning" isDismissible={ false }>
					<p>
						{ __(
							'This site’s Fair Audience is older than this plugin and still manages the Instagram connection. Update Fair Audience to manage the connection here. Nothing has to be re-entered: the stored connection moves here as it is.',
							'fair-events-experimental'
						) }
					</p>
					{ connection.legacy_manage_url && (
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
	const needsReconnect = connection.connected && status === 'unrecoverable';
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
			/* translators: %s: Instagram user ID */
			__(
				'Disconnect the Instagram account with user ID %s from this site?',
				'fair-events-experimental'
			),
			connection.user_id
		);
	} else {
		accountName = __(
			'Disconnect the Instagram account connected to this site? Its username and user ID are not known.',
			'fair-events-experimental'
		);
	}

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
								'Connect with Instagram to sign in and authorize this site. This needs the Fair Event Plugins OAuth service.',
								'fair-events-experimental'
							) }
						</p>
						<div style={ rowStyle }>
							<Button variant="primary" onClick={ handleConnect }>
								{ __(
									'Connect with Instagram',
									'fair-events-experimental'
								) }
							</Button>
						</div>

						<h3>
							{ __(
								'Or enter an access token',
								'fair-events-experimental'
							) }
						</h3>
						<p style={ helpStyle }>
							{ __(
								'An Instagram API access token from the Meta Developer Portal, with permission to publish content.',
								'fair-events-experimental'
							) }
						</p>
						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							type="password"
							autoComplete="off"
							label={ __(
								'Access token',
								'fair-events-experimental'
							) }
							value={ manualToken }
							onChange={ setManualToken }
							disabled={ isSavingToken }
						/>
						<div style={ { ...rowStyle, marginTop: '8px' } }>
							<Button
								variant="secondary"
								onClick={ handleSaveToken }
								disabled={
									isSavingToken || ! manualToken.trim()
								}
								isBusy={ isSavingToken }
							>
								{ __(
									'Save access token',
									'fair-events-experimental'
								) }
							</Button>
							{ ! manualToken.trim() && (
								<span style={ helpStyle }>
									{ __(
										'Enter a token to save it.',
										'fair-events-experimental'
									) }
								</span>
							) }
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
										'Or disconnect to remove the unreadable token from this site.',
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
									{ connection.username
										? sprintf(
												/* translators: %s: Instagram username */
												__(
													'Connected to Instagram as @%s.',
													'fair-events-experimental'
												),
												connection.username
											)
										: __(
												'Connected to Instagram.',
												'fair-events-experimental'
											) }
								</Notice>
							) }
							<p>
								{ connection.token_expires
									? sprintf(
											/* translators: %s: date and time */
											__(
												'The access token expires on %s. It is renewed automatically during its last week.',
												'fair-events-experimental'
											),
											formatTime(
												connection.token_expires
											)
										)
									: __(
											'The access token’s expiry is not known yet. It is renewed automatically.',
											'fair-events-experimental'
										) }
							</p>
							{ ! connection.credentials_encrypted && (
								<p style={ helpStyle }>
									{ __(
										'The access token is not encrypted yet; it is encrypted on a later page load once this server supports it.',
										'fair-events-experimental'
									) }
								</p>
							) }
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								label={ __(
									'Instagram user ID',
									'fair-events-experimental'
								) }
								help={ __(
									'The numeric ID of the account, needed to publish. Testing the connection fills it in.',
									'fair-events-experimental'
								) }
								inputMode="numeric"
								value={ userId }
								onChange={ setUserId }
								disabled={ isSavingUserId }
							/>
							<div style={ { ...rowStyle, marginTop: '8px' } }>
								<Button
									variant="secondary"
									onClick={ handleSaveUserId }
									disabled={
										isSavingUserId ||
										userId.trim() ===
											( connection.user_id || '' )
									}
									isBusy={ isSavingUserId }
								>
									{ __(
										'Save user ID',
										'fair-events-experimental'
									) }
								</Button>
							</div>
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
									'Asks Instagram which account the token belongs to. Nothing is published.',
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
													'Details from Instagram',
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
									'Removes the access token and account details from this site.',
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
