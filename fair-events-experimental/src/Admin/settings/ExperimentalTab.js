/**
 * Internal dependencies
 */
import FeaturesTab from './FeaturesTab.js';
import MetaConversions from './MetaConversions.js';
import WeeklyNotifications from './WeeklyNotifications.js';

/**
 * Experimental tab of the Fair Events Settings page.
 *
 * Renders the feature toggles and the settings of enabled integrations.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying page-level notices
 * @return {JSX.Element} The Experimental settings tab
 */
export default function ExperimentalTab( { onNotice } ) {
	const features = window.fairEventsExperimentalSettingsData?.features;

	return (
		<div className="fair-events-experimental-settings">
			<FeaturesTab onNotice={ onNotice } />
			{ features?.sources?.enabled && (
				<WeeklyNotifications onNotice={ onNotice } />
			) }
			{ features?.[ 'meta-conversions' ]?.enabled && (
				<MetaConversions onNotice={ onNotice } />
			) }
		</div>
	);
}
