/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { Notice, TabPanel } from '@wordpress/components';

/**
 * Internal dependencies
 */
import GeneralTab from './GeneralTab.js';
import FacebookTab from './FacebookTab.js';

/**
 * Settings App Component
 *
 * Main settings page with tabs for General and Facebook settings.
 *
 * @return {JSX.Element} The Settings app component
 */
export default function SettingsApp() {
	const [notice, setNotice] = useState(null);

	return (
		<div className="wrap">
			<h1>{__('Fair Events Settings', 'fair-events')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible={true}
					onRemove={() => setNotice(null)}
				>
					{notice.message}
				</Notice>
			)}

			<TabPanel
				className="fair-events-settings-tabs"
				activeClass="active-tab"
				tabs={[
					{
						name: 'general',
						title: __('General', 'fair-events'),
					},
					{
						name: 'facebook',
						title: __('Facebook', 'fair-events'),
					},
				]}
			>
				{(tab) => (
					<div style={{ marginTop: '1rem' }}>
						{tab.name === 'general' && (
							<GeneralTab onNotice={setNotice} />
						)}
						{tab.name === 'facebook' && (
							<FacebookTab onNotice={setNotice} />
						)}
					</div>
				)}
			</TabPanel>
		</div>
	);
}
