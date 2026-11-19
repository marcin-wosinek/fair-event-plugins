/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	Modal,
	Notice,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadInstagramSettings, saveSettings } from './settings-api.js';

const rowStyle = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: '8px',
	alignItems: 'center',
};

/**
 * Instagram tab while Fair Audience holds the connection.
 *
 * Connecting moved to Fair Events → Instagram with Meta's Unified Login
 * (#2427): this tab no longer accepts tokens. It shows what is stored,
 * explains where to connect, and can remove the stored connection.
 *
 * @param {Object}   props
 * @param {Function} props.onNotice  Shows a page notice.
 * @param {?string}  props.setupUrl  Fair Events → Settings → Experimental, when available.
 * @return {JSX.Element} The tab.
 */
export default function InstagramTab( { onNotice, setupUrl = null } ) {
	const [ settings, setSettings ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ confirmingDisconnect, setConfirmingDisconnect ] = useState( false );
	const [ isDisconnecting, setIsDisconnecting ] = useState( false );
	const [ disconnectError, setDisconnectError ] = useState( null );
	// Refuses a second submission before the first one re-rendered the popup.
	const disconnectInFlight = useRef( false );

	const load = () =>
		loadInstagramSettings()
			.then( setSettings )
			.catch( () =>
				setLoadError(
					__(
						'The Instagram connection could not be loaded. Reload the page to try again.',
						'fair-audience'
					)
				)
			);

	useEffect( () => {
		// load() handles its own rejection.
		void load();
	}, [] );

	// Closing mid-request would hide whether the account was disconnected.
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

		saveSettings( {
			fair_audience_instagram_access_token: '',
			fair_audience_instagram_user_id: '',
			fair_audience_instagram_username: '',
			fair_audience_instagram_token_expires: 0,
			fair_audience_instagram_connected: false,
		} )
			.then( () => {
				setConfirmingDisconnect( false );
				onNotice( {
					status: 'success',
					message: __(
						'Disconnected from Instagram.',
						'fair-audience'
					),
				} );
				return load();
			} )
			.catch( ( error ) =>
				setDisconnectError(
					error?.message
						? sprintf(
								/* translators: %s: error message */
								__(
									'Instagram could not be disconnected: %s',
									'fair-audience'
								),
								error.message
							)
						: __(
								'Instagram could not be disconnected. Try again.',
								'fair-audience'
							)
				)
			)
			.finally( () => {
				disconnectInFlight.current = false;
				setIsDisconnecting( false );
			} );
	};

	if ( loadError ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ loadError }
			</Notice>
		);
	}

	if ( ! settings ) {
		return <Spinner />;
	}

	const howToConnect = __(
		'Instagram is connected in Fair Events → Instagram, through Meta’s Unified Login. Turn on Instagram in Fair Events → Settings → Experimental (part of Fair Events Experimental), then connect there.',
		'fair-audience'
	);

	let status;
	if ( ! settings.connected ) {
		status = (
			<p>
				{ __( 'No Instagram account is connected.', 'fair-audience' ) }
			</p>
		);
	} else if ( settings.reconnectRequired ) {
		status = (
			<Notice status="warning" isDismissible={ false }>
				{ __(
					'Instagram needs to be reconnected: Meta replaced the way sites connect to Instagram, and this connection was made the old way. Instagram Posts cannot publish until you connect again. Posts already published, and their records on this site, are kept.',
					'fair-audience'
				) }
			</Notice>
		);
	} else if ( settings.credentialStatus !== 'available' ) {
		status = (
			<Notice
				status={
					settings.credentialStatus === 'unrecoverable'
						? 'error'
						: 'warning'
				}
				isDismissible={ false }
			>
				{ settings.credentialMessage }
			</Notice>
		);
	} else {
		status = (
			<Notice status="success" isDismissible={ false }>
				{ settings.username
					? sprintf(
							/* translators: %s: Instagram username */
							__(
								'Connected to Instagram as @%s.',
								'fair-audience'
							),
							settings.username
						)
					: __( 'Connected to Instagram.', 'fair-audience' ) }
			</Notice>
		);
	}

	let disconnectQuestion;
	if ( settings.username ) {
		disconnectQuestion = sprintf(
			/* translators: %s: Instagram username */
			__(
				'Disconnect the Instagram account @%s from this site?',
				'fair-audience'
			),
			settings.username
		);
	} else if ( settings.userId ) {
		disconnectQuestion = sprintf(
			/* translators: %s: Instagram account ID */
			__(
				'Disconnect the Instagram account with ID %s from this site?',
				'fair-audience'
			),
			settings.userId
		);
	} else {
		disconnectQuestion = __(
			'Disconnect the Instagram account connected to this site? Its username and ID are not available.',
			'fair-audience'
		);
	}

	return (
		<Card>
			<CardBody>
				<h2>{ __( 'Instagram Connection', 'fair-audience' ) }</h2>
				{ status }
				{ settings.connected &&
					settings.username &&
					( settings.reconnectRequired ||
						settings.credentialStatus !== 'available' ) && (
						<p>
							{ sprintf(
								/* translators: %s: Instagram username */
								__( 'Stored account: @%s', 'fair-audience' ),
								settings.username
							) }
						</p>
					) }
				<p>{ howToConnect }</p>
				{ setupUrl && (
					<p>
						<a href={ setupUrl }>
							{ __(
								'Open Fair Events → Settings → Experimental',
								'fair-audience'
							) }
						</a>
					</p>
				) }
				{ settings.connected && (
					<div style={ rowStyle }>
						<Button
							variant="secondary"
							isDestructive
							onClick={ () => setConfirmingDisconnect( true ) }
						>
							{ __( 'Disconnect', 'fair-audience' ) }
						</Button>
					</div>
				) }
			</CardBody>

			{ confirmingDisconnect && (
				<Modal
					title={ __( 'Disconnect Instagram?', 'fair-audience' ) }
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
						<strong>{ disconnectQuestion }</strong>
					</p>
					<p>
						{ __(
							'The access token and account details stored on this site are removed. Posts already published on Instagram, and the post records on this site, are kept.',
							'fair-audience'
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
							{ __( 'Keep connected', 'fair-audience' ) }
						</Button>
						<Button
							variant="primary"
							isDestructive
							onClick={ confirmDisconnect }
							isBusy={ isDisconnecting }
							disabled={ isDisconnecting }
						>
							{ __( 'Disconnect Instagram', 'fair-audience' ) }
						</Button>
					</div>
				</Modal>
			) }
		</Card>
	);
}
