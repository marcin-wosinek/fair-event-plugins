/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Settings App Component
 *
 * @return {JSX.Element} The settings app
 */
export default function SettingsApp() {
	return (
		<div className="wrap">
			<h1>{__('Fair Payment Settings', 'fair-payment')}</h1>
		</div>
	);
}
