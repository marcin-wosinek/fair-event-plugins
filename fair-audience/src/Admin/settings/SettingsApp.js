/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { Notice, TabPanel } from '@wordpress/components';

/**
 * Internal dependencies
 */
import InstagramMoved from './InstagramMoved.js';
import InstagramTab from './InstagramTab.js';
import MailingTab from './MailingTab.js';

/**
 * Settings App Component
 *
 * Main settings page with tabs for the Instagram connection and mailing.
 *
 * @return {JSX.Element} The settings app
 */
export default function SettingsApp() {
	// Set while Fair Events Experimental manages the Instagram connection.
	const instagramPageUrl =
		window.fairAudienceSettingsData?.instagramPageUrl || null;
	const instagramSetupUrl =
		window.fairAudienceSettingsData?.instagramSetupUrl || null;
	const [ notice, setNotice ] = useState( null );

	return (
		<div className="wrap">
			<h1>{ __( 'Fair Audience Settings', 'fair-audience' ) }</h1>

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
				className="fair-audience-settings-tabs"
				activeClass="active-tab"
				tabs={ [
					{
						name: 'instagram',
						title: __( 'Instagram', 'fair-audience' ),
					},
					{
						name: 'mailing',
						title: __( 'Mailing', 'fair-audience' ),
					},
				] }
			>
				{ ( tab ) => (
					<div style={ { marginTop: '1rem' } }>
						{ tab.name === 'instagram' && instagramPageUrl && (
							<InstagramMoved url={ instagramPageUrl } />
						) }
						{ tab.name === 'instagram' && ! instagramPageUrl && (
							<InstagramTab
								onNotice={ setNotice }
								setupUrl={ instagramSetupUrl }
							/>
						) }
						{ tab.name === 'mailing' && (
							<MailingTab onNotice={ setNotice } />
						) }
					</div>
				) }
			</TabPanel>
		</div>
	);
}
