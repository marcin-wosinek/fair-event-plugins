/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { Notice, TabPanel } from '@wordpress/components';

/**
 * Internal dependencies
 */
import GeneralTab from './GeneralTab.js';
import FeaturesTab from './FeaturesTab.js';

/**
 * Settings App Component
 *
 * Main settings page with tabs for General and Features settings.
 *
 * @return {JSX.Element} The Settings app component
 */
export default function SettingsApp() {
	const [notice, setNotice] = useState(null);

	const tabs = useMemo(
		() => [
			{
				name: 'general',
				title: __('General', 'fair-events'),
			},
			{
				name: 'features',
				title: __('Features', 'fair-events'),
			},
		],
		[]
	);

	const initialTab = useMemo(() => {
		const urlTab = new URLSearchParams(window.location.search).get('tab');
		if (tabs.some((t) => t.name === urlTab)) {
			return urlTab;
		}
		return 'general';
	}, [tabs]);

	const handleTabSelect = useCallback((tabName) => {
		const url = new URL(window.location.href);
		if (tabName === 'general') {
			url.searchParams.delete('tab');
		} else {
			url.searchParams.set('tab', tabName);
		}
		window.history.replaceState(null, '', url.toString());
	}, []);

	return (
		<div className="wrap fair-events-settings">
			<style>
				{`/* The 1.5px height of the active-tab indicator anti-aliases to a thin
   darker top edge at 1x DPI. Round to 2px so the bar renders crisp. */
.fair-events-settings .components-tab-panel__tabs-item.is-active::after { height: 2px; outline: none; }`}
			</style>
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
				initialTabName={initialTab}
				onSelect={handleTabSelect}
				tabs={tabs}
			>
				{(tab) => (
					<div style={{ marginTop: '1rem' }}>
						{tab.name === 'general' && (
							<GeneralTab onNotice={setNotice} />
						)}
						{tab.name === 'features' && (
							<FeaturesTab onNotice={setNotice} />
						)}
					</div>
				)}
			</TabPanel>
		</div>
	);
}
