import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Flex,
	FlexItem,
	Notice,
	TextControl,
} from '@wordpress/components';

const PATH = '/fair-events-experimental/v1/whatsapp/webhook-credentials';

const EMPTY = { app_secret: '', verify_token: '' };

/**
 * Where a webhook credential comes from, without its value.
 *
 * @param {Object} status Credential status from the API.
 * @return {string} Help text.
 */
export function credentialHelp( status ) {
	if ( 'env' === status.source ) {
		return sprintf(
			/* translators: %s: environment variable name */
			__(
				'Set by the %s environment variable. A value saved here is ignored.',
				'fair-events-experimental'
			),
			status.override_name
		);
	}
	if ( 'constant' === status.source ) {
		return sprintf(
			/* translators: %s: PHP constant name */
			__(
				'Set by the %s constant. A value saved here is ignored.',
				'fair-events-experimental'
			),
			status.override_name
		);
	}
	if ( status.configured ) {
		return __(
			'Saved, not shown. Enter a new value to replace it.',
			'fair-events-experimental'
		);
	}
	return __( 'Not set.', 'fair-events-experimental' );
}

/**
 * What is known about the webhook: whether Meta verified the callback URL
 * and whether an authenticated update has arrived. Verification alone does
 * not prove that updates arrive.
 *
 * @param {Object} webhook Webhook status from the API.
 * @return {Array<{key: string, status: string, message: string}>} Lines.
 */
export function webhookProgress( webhook ) {
	return [
		{
			key: 'verified',
			status: webhook.verified_at_local ? 'success' : 'warning',
			message: webhook.verified_at_local
				? sprintf(
						/* translators: %s: date and time */
						__(
							'Verified: Meta checked the callback URL with the current verify token on %s.',
							'fair-events-experimental'
						),
						webhook.verified_at_local
					)
				: __(
						'Not verified: Meta has not checked the callback URL with the current verify token.',
						'fair-events-experimental'
					),
		},
		{
			key: 'received',
			status: webhook.received_at_local ? 'success' : 'warning',
			message: webhook.received_at_local
				? sprintf(
						/* translators: %s: date and time */
						__(
							'Receiving updates: the last authenticated update for this account arrived on %s.',
							'fair-events-experimental'
						),
						webhook.received_at_local
					)
				: __(
						'No updates received yet: no authenticated update for this account has arrived. Verification alone does not show that updates arrive; subscribe to the messages field and send a test template.',
						'fair-events-experimental'
					),
		},
	];
}

/**
 * The message of a failed request, or a fallback when it carries none.
 *
 * @param {Object} error    apiFetch error.
 * @param {string} fallback Message to use otherwise.
 * @return {string} Message.
 */
function errorMessage( error, fallback ) {
	return typeof error?.message === 'string' && error?.code
		? error.message
		: fallback;
}

/**
 * Setup instructions, credentials and progress of the webhook that reports
 * delivery updates.
 *
 * @param {Object}   props
 * @param {Object}   props.webhook  Webhook status from the API.
 * @param {Function} props.onSaved  Receives the settings payload after a save.
 * @param {Function} props.onNotice Shows a page-level notice.
 * @return {Element} The webhook card.
 */
export default function WebhookSetup( { webhook, onSaved, onNotice } ) {
	const [ values, setValues ] = useState( EMPTY );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	const dirty = !! ( values.app_secret.trim() || values.verify_token.trim() );
	useEffect( () => {
		if ( ! dirty ) {
			return undefined;
		}
		const warn = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ dirty ] );

	const save = async ( data, success ) => {
		if ( saving ) {
			return;
		}
		setSaving( true );
		setError( null );
		try {
			onSaved( await apiFetch( { path: PATH, method: 'POST', data } ) );
			setValues( EMPTY );
			onNotice( { status: 'success', message: success } );
		} catch ( caught ) {
			setError(
				errorMessage(
					caught,
					__(
						'Failed to save the webhook settings.',
						'fair-events-experimental'
					)
				)
			);
		}
		setSaving( false );
	};

	const saveEntered = () => {
		const data = {};
		Object.keys( EMPTY ).forEach( ( key ) => {
			if ( values[ key ].trim() ) {
				data[ key ] = values[ key ].trim();
			}
		} );
		save(
			data,
			__(
				'Webhook settings saved. If you changed the verify token, verify the callback URL again in the App Dashboard.',
				'fair-events-experimental'
			)
		);
	};

	const field = ( key, label ) => {
		const status = webhook[ key ];
		return (
			<div>
				<TextControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					label={ label }
					help={ credentialHelp( status ) }
					type="password"
					autoComplete="off"
					value={ values[ key ] }
					disabled={ saving }
					onChange={ ( value ) =>
						setValues( ( current ) => ( {
							...current,
							[ key ]: value,
						} ) )
					}
				/>
				{ 'database' === status.source && (
					<Button
						variant="link"
						isDestructive
						disabled={ saving }
						onClick={ () =>
							save(
								{ [ key ]: '' },
								'app_secret' === key
									? __(
											'App Secret removed. Delivery updates are refused until another one is saved.',
											'fair-events-experimental'
										)
									: __(
											'Verify token removed. Meta cannot verify the callback URL until another one is saved.',
											'fair-events-experimental'
										)
							)
						}
					>
						{ 'app_secret' === key
							? __(
									'Remove the saved App Secret',
									'fair-events-experimental'
								)
							: __(
									'Remove the saved verify token',
									'fair-events-experimental'
								) }
					</Button>
				) }
			</div>
		);
	};

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>
					{ __( 'Delivery updates', 'fair-events-experimental' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<p>
					{ __(
						'WhatsApp reports whether each message was delivered through a webhook. Until it is set up, a send only shows that WhatsApp accepted the message.',
						'fair-events-experimental'
					) }
				</p>
				<ol style={ { overflowWrap: 'anywhere' } }>
					<li>
						{ __(
							'Copy the App Secret from App settings → Basic in the App Dashboard, and choose a verify token of at least 8 characters. Save both below.',
							'fair-events-experimental'
						) }
					</li>
					<li>
						{ __(
							'In the App Dashboard, open WhatsApp → Configuration, edit the webhook, enter the callback URL below and the same verify token, then select Verify and save.',
							'fair-events-experimental'
						) }
					</li>
					<li>
						{ __(
							'Subscribe the webhook to the messages field.',
							'fair-events-experimental'
						) }
					</li>
				</ol>
				<div style={ { display: 'grid', gap: '16px' } }>
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __(
							'Callback URL',
							'fair-events-experimental'
						) }
						value={ webhook.callback_url }
						readOnly
						onChange={ () => {} }
						onFocus={ ( event ) => event.target.select() }
					/>
					{ field(
						'app_secret',
						__( 'App Secret', 'fair-events-experimental' )
					) }
					{ field(
						'verify_token',
						__( 'Verify token', 'fair-events-experimental' )
					) }
				</div>
				<Flex
					wrap
					justify="flex-start"
					gap={ 2 }
					style={ { marginTop: '16px' } }
				>
					<FlexItem>
						<Button
							variant="primary"
							onClick={ saveEntered }
							isBusy={ saving }
							disabled={ saving || ! dirty }
						>
							{ __(
								'Save webhook settings',
								'fair-events-experimental'
							) }
						</Button>
					</FlexItem>
				</Flex>
				{ ! dirty && (
					<p className="description">
						{ __(
							'Enter an App Secret or a verify token to save.',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }
				<div role="status" style={ { marginTop: '16px' } }>
					{ webhookProgress( webhook ).map( ( line ) => (
						<Notice
							key={ line.key }
							status={ line.status }
							isDismissible={ false }
						>
							{ line.message }
						</Notice>
					) ) }
				</div>
			</CardBody>
		</Card>
	);
}
