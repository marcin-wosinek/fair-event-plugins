/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Notice, TabPanel } from '@wordpress/components';

/**
 * Internal dependencies
 */
import ConnectionTab from './ConnectionTab';
import AdvancedTab from './AdvancedTab';
import { saveSettings } from './settings-api';

/**
 * Settings App Component
 *
 * Main settings page with tabs for Connection and Advanced settings.
 * Handles OAuth callback and notice display. Each tab manages its own loading state.
 *
 * @return {JSX.Element} The settings app
 */
export default function SettingsApp() {
	const [ notice, setNotice ] = useState( null );
	const [ currentTab, setCurrentTab ] = useState( 'connection' );
	const [ shouldReloadConnection, setShouldReloadConnection ] =
		useState( false );

	/**
	 * Handle OAuth callback on mount
	 */
	useEffect( () => {
		const params = new URLSearchParams( window.location.search );
		const accessToken = params.get( 'mollie_access_token' );
		const refreshToken = params.get( 'mollie_refresh_token' );
		const expiresIn = params.get( 'mollie_expires_in' );
		const orgId = params.get( 'mollie_organization_id' );
		const profileId = params.get( 'mollie_profile_id' );
		const testMode = params.get( 'mollie_test_mode' );
		const error = params.get( 'error' );

		// Debug: Log received OAuth parameters
		if ( accessToken || refreshToken || error ) {
			console.log( '[Fair Payment OAuth] Callback parameters:', {
				hasAccessToken: !! accessToken,
				accessTokenLength: accessToken ? accessToken.length : 0,
				hasRefreshToken: !! refreshToken,
				refreshTokenLength: refreshToken ? refreshToken.length : 0,
				expiresIn,
				orgId,
				profileId,
				testMode,
				error,
			} );
		}

		// Handle OAuth errors
		if ( error === 'access_denied' ) {
			setNotice( {
				status: 'error',
				message: __(
					'Authorization cancelled. Please try again.',
					'fair-payment'
				),
			} );
			// Clean URL
			window.history.replaceState(
				{},
				'',
				window.location.pathname + '?page=fair-payment-settings'
			);
			return;
		}

		// Handle successful OAuth callback
		if ( accessToken && refreshToken ) {
			const settingsData = {
				fair_payment_mollie_access_token: accessToken,
				fair_payment_mollie_refresh_token: refreshToken,
				fair_payment_mollie_token_expires:
					Math.floor( Date.now() / 1000 ) + parseInt( expiresIn ),
				fair_payment_mollie_organization_id: orgId || '',
				fair_payment_mollie_profile_id: profileId || '',
				fair_payment_mollie_connected: true,
				fair_payment_mode: testMode === '1' ? 'test' : 'live',
			};

			// Debug: Log data being sent to API
			console.log(
				'[Fair Payment OAuth] Saving settings:',
				settingsData
			);

			saveSettings( settingsData )
				.then( ( response ) => {
					// Debug: Log successful save
					console.log(
						'[Fair Payment OAuth] Settings saved successfully:',
						response
					);

					// Clean URL (remove tokens from address bar)
					window.history.replaceState(
						{},
						'',
						window.location.pathname + '?page=fair-payment-settings'
					);

					// Trigger reload in ConnectionTab
					setShouldReloadConnection( true );

					setNotice( {
						status: 'success',
						message: __(
							'Successfully connected to Mollie!',
							'fair-payment'
						),
					} );
				} )
				.catch( ( error ) => {
					// Debug: Log API error
					console.error( '[Fair Payment OAuth] Save error:', error );
					console.error(
						'[Fair Payment OAuth] Error details:',
						error.message,
						error.data
					);

					setNotice( {
						status: 'error',
						message:
							__(
								'Failed to save OAuth tokens: ',
								'fair-payment'
							) + ( error.message || 'Unknown error' ),
					} );
				} );
		} else if ( accessToken && ! refreshToken ) {
			// Debug: Access token received but no refresh token
			console.warn(
				'[Fair Payment OAuth] Access token received but refresh token is missing!'
			);
			setNotice( {
				status: 'warning',
				message: __(
					'OAuth callback incomplete: refresh token not received from authorization server.',
					'fair-payment'
				),
			} );
		}
	}, [] );

	/**
	 * Reset shouldReloadConnection flag after it's been used
	 */
	useEffect( () => {
		if ( shouldReloadConnection ) {
			setShouldReloadConnection( false );
		}
	}, [ shouldReloadConnection ] );

	/**
	 * Handle tab selection
	 *
	 * @param {string} tabName Name of selected tab
	 */
	const handleTabSelect = ( tabName ) => {
		console.log(
			'[Fair Payment] Tab selected:',
			tabName,
			'(current:',
			currentTab,
			')'
		);

		// Only update tab if switching to different tab
		if ( tabName === currentTab ) {
			console.log( '[Fair Payment] Same tab, skipping' );
			return;
		}

		setCurrentTab( tabName );
	};

	return (
		<div className="wrap">
			<h1>{ __( 'Fair Payment Settings', 'fair-payment' ) }</h1>

			{ notice && (
				<Notice
					status={ notice.status }
					isDismissible={ true }
					onRemove={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			<TabPanel
				className="fair-payment-settings-tabs"
				activeClass="active-tab"
				tabs={ [
					{
						name: 'connection',
						title: __( 'Connection', 'fair-payment' ),
					},
					{
						name: 'advanced',
						title: __( 'Advanced', 'fair-payment' ),
					},
				] }
				onSelect={ handleTabSelect }
			>
				{ ( tab ) => (
					<div style={ { marginTop: '1rem' } }>
						{ tab.name === 'connection' && (
							<ConnectionTab
								onNotice={ setNotice }
								shouldReload={ shouldReloadConnection }
							/>
						) }
						{ tab.name === 'advanced' && (
							<AdvancedTab onNotice={ setNotice } />
						) }
					</div>
				) }
			</TabPanel>
		</div>
	);
}
