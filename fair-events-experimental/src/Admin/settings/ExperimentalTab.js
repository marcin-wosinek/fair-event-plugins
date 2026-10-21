/**
 * Internal dependencies
 */
import FeaturesTab from './FeaturesTab.js';
import MetaMoved from './MetaMoved.js';
import WeeklyNotificationsMoved from './WeeklyNotificationsMoved.js';

/**
 * Experimental tab of the Fair Events Settings page.
 *
 * Renders the feature toggles, plus links to the integrations that moved to
 * their own pages.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying page-level notices
 * @return {JSX.Element} The Experimental settings tab
 */
export default function ExperimentalTab( { onNotice } ) {
	const features = window.fairEventsExperimentalSettingsData?.features;
	const metaUrl = window.fairEventsExperimentalSettingsData?.metaUrl;

	return (
		<div className="fair-events-experimental-settings">
			<FeaturesTab onNotice={ onNotice } />
			<WeeklyNotificationsMoved
				url={
					window.fairEventsExperimentalSettingsData
						?.eventNotificationsUrl || null
				}
			/>
			{ features?.[ 'meta-conversions' ]?.enabled && metaUrl && (
				<MetaMoved url={ metaUrl } />
			) }
		</div>
	);
}
