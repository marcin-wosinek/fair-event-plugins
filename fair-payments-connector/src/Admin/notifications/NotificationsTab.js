/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Notice,
	SelectControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';

const CHANNELS = [
	{
		label: __( 'Telegram', 'fair-payments-connector' ),
		value: 'telegram',
	},
	{
		label: __( 'Email', 'fair-payments-connector' ),
		value: 'email',
	},
];

const FREQUENCIES = [
	{
		label: __( 'Immediate', 'fair-payments-connector' ),
		value: 'immediate',
	},
	{
		label: __( 'Hourly digest', 'fair-payments-connector' ),
		value: 'hourly',
	},
	{
		label: __( 'Daily digest', 'fair-payments-connector' ),
		value: 'daily',
	},
	{
		label: __( 'Weekly digest', 'fair-payments-connector' ),
		value: 'weekly',
	},
];

function newRoute() {
	return {
		id: '',
		enabled: true,
		channel: 'telegram',
		destination: '',
		frequency: 'immediate',
		include_pii: true,
	};
}

/**
 * Single route editor row.
 *
 * @param {Object}   props
 * @param {Object}   props.route      Route config object.
 * @param {Function} props.onChange   Called with updated route when any field changes.
 * @param {Function} props.onRemove   Called when the Remove button is clicked.
 * @param {Function} props.onNotice   Parent notice handler for test results.
 * @return {JSX.Element}
 */
function RouteRow( { route, onChange, onRemove, onNotice } ) {
	const [ isTesting, setIsTesting ] = useState( false );
	const [ testResult, setTestResult ] = useState( null );

	const handleTest = () => {
		setIsTesting( true );
		setTestResult( null );
		apiFetch( {
			path: '/fair-payments-connector/v1/notifications/test',
			method: 'POST',
			data: {
				channel: route.channel,
				destination: route.destination,
				include_pii: route.include_pii,
			},
		} )
			.then( ( response ) => {
				setTestResult( {
					status: 'success',
					message:
						response.message ||
						__(
							'Test notification sent.',
							'fair-payments-connector'
						),
				} );
				setIsTesting( false );
			} )
			.catch( ( error ) => {
				setTestResult( {
					status: 'error',
					message:
						error.message ||
						__(
							'Test notification failed.',
							'fair-payments-connector'
						),
				} );
				setIsTesting( false );
			} );
	};

	return (
		<Card style={ { marginBottom: '1rem' } }>
			<CardBody>
				<div
					style={ {
						display: 'flex',
						gap: '1rem',
						alignItems: 'flex-start',
						flexWrap: 'wrap',
					} }
				>
					<div style={ { flex: '0 0 auto' } }>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __( 'Enabled', 'fair-payments-connector' ) }
							checked={ route.enabled }
							onChange={ ( val ) =>
								onChange( { ...route, enabled: val } )
							}
						/>
					</div>

					<div style={ { flex: '1 1 140px' } }>
						<SelectControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Channel', 'fair-payments-connector' ) }
							value={ route.channel }
							options={ CHANNELS }
							onChange={ ( val ) =>
								onChange( { ...route, channel: val } )
							}
						/>
					</div>

					<div style={ { flex: '2 1 200px' } }>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={
								route.channel === 'email'
									? __(
											'Email address',
											'fair-payments-connector'
									  )
									: __( 'Chat ID', 'fair-payments-connector' )
							}
							help={
								route.channel === 'telegram'
									? __(
											'Numeric user/chat/channel ID, or @channelname.',
											'fair-payments-connector'
									  )
									: undefined
							}
							value={ route.destination }
							onChange={ ( val ) =>
								onChange( { ...route, destination: val } )
							}
						/>
					</div>

					<div style={ { flex: '1 1 160px' } }>
						<SelectControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __(
								'Frequency',
								'fair-payments-connector'
							) }
							value={ route.frequency }
							options={ FREQUENCIES }
							onChange={ ( val ) =>
								onChange( { ...route, frequency: val } )
							}
						/>
					</div>

					<div style={ { flex: '0 0 auto', marginTop: '1.5rem' } }>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Include PII',
								'fair-payments-connector'
							) }
							help={ __(
								'Name & email in messages.',
								'fair-payments-connector'
							) }
							checked={ route.include_pii }
							onChange={ ( val ) =>
								onChange( { ...route, include_pii: val } )
							}
						/>
					</div>
				</div>

				<div
					style={ {
						display: 'flex',
						gap: '0.5rem',
						marginTop: '0.75rem',
					} }
				>
					<Button
						variant="secondary"
						isDestructive
						onClick={ onRemove }
					>
						{ __( 'Remove', 'fair-payments-connector' ) }
					</Button>
					<Button
						variant="secondary"
						onClick={ handleTest }
						isBusy={ isTesting }
						disabled={ isTesting || ! route.destination }
					>
						{ __( 'Send test', 'fair-payments-connector' ) }
					</Button>
				</div>

				{ testResult && (
					<div style={ { marginTop: '0.75rem' } }>
						<Notice
							status={ testResult.status }
							isDismissible={ true }
							onRemove={ () => setTestResult( null ) }
						>
							{ testResult.message }
						</Notice>
					</div>
				) }
			</CardBody>
		</Card>
	);
}

/**
 * Notifications settings tab.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying global notices
 * @return {JSX.Element} The Notifications tab
 */
export default function NotificationsTab( { onNotice } ) {
	const [ botToken, setBotToken ] = useState( '' );
	const [ routes, setRoutes ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );

	useEffect( () => {
		setIsLoading( true );
		apiFetch( { path: '/wp/v2/settings' } )
			.then( ( settings ) => {
				setBotToken( settings.fair_payment_telegram_bot_token || '' );
				setRoutes( settings.fair_payment_notification_routes || [] );
				setIsLoading( false );
			} )
			.catch( ( error ) => {
				console.error(
					'[Fair Payments Connector] Failed to load notification settings:',
					error
				);
				onNotice( {
					status: 'error',
					message: __(
						'Failed to load notification settings.',
						'fair-payments-connector'
					),
				} );
				setIsLoading( false );
			} );
	}, [] );

	const handleSave = () => {
		setIsSaving( true );
		apiFetch( {
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_payment_telegram_bot_token: botToken,
				fair_payment_notification_routes: routes,
			},
		} )
			.then( () => {
				onNotice( {
					status: 'success',
					message: __(
						'Notification settings saved.',
						'fair-payments-connector'
					),
				} );
				setIsSaving( false );
			} )
			.catch( ( error ) => {
				console.error(
					'[Fair Payments Connector] Failed to save notification settings:',
					error
				);
				onNotice( {
					status: 'error',
					message:
						__(
							'Failed to save notification settings: ',
							'fair-payments-connector'
						) + ( error.message || 'Unknown error' ),
				} );
				setIsSaving( false );
			} );
	};

	const addRoute = () => setRoutes( [ ...routes, newRoute() ] );

	const updateRoute = ( index, updated ) => {
		const next = [ ...routes ];
		next[ index ] = updated;
		setRoutes( next );
	};

	const removeRoute = ( index ) => {
		setRoutes( routes.filter( ( _, i ) => i !== index ) );
	};

	if ( isLoading ) {
		return (
			<Card>
				<CardBody>
					<p>
						{ __(
							'Loading notification settings…',
							'fair-payments-connector'
						) }
					</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<div>
			<Card style={ { marginBottom: '1.5rem' } }>
				<CardBody>
					<h2>
						{ __(
							'Telegram Bot Token',
							'fair-payments-connector'
						) }
					</h2>
					<p style={ { color: '#666', marginBottom: '1rem' } }>
						{ __(
							'Required for any Telegram notification routes.',
							'fair-payments-connector'
						) }
					</p>
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Bot token', 'fair-payments-connector' ) }
						help={ __(
							'From @BotFather. Stored as plain text in wp_options — anyone with admin access can read it.',
							'fair-payments-connector'
						) }
						type="password"
						value={ botToken }
						onChange={ setBotToken }
						autoComplete="off"
					/>
				</CardBody>
			</Card>

			<h2>{ __( 'Notification Routes', 'fair-payments-connector' ) }</h2>
			<p style={ { color: '#666', marginBottom: '1rem' } }>
				{ __(
					'Each route sends a notification on a transaction paid event. Immediate routes fire at once; digest routes batch transactions into a single periodic message.',
					'fair-payments-connector'
				) }
			</p>

			{ routes.map( ( route, index ) => (
				<RouteRow
					key={ route.id || index }
					route={ route }
					onChange={ ( updated ) => updateRoute( index, updated ) }
					onRemove={ () => removeRoute( index ) }
					onNotice={ onNotice }
				/>
			) ) }

			<div
				style={ { display: 'flex', gap: '0.75rem', marginTop: '1rem' } }
			>
				<Button variant="secondary" onClick={ addRoute }>
					{ __( 'Add route', 'fair-payments-connector' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ handleSave }
					isBusy={ isSaving }
					disabled={ isSaving }
				>
					{ __( 'Save settings', 'fair-payments-connector' ) }
				</Button>
			</div>
		</div>
	);
}
