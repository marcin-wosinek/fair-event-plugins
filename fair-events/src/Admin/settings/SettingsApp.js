/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { Notice, TabPanel } from '@wordpress/components';
import { applyFilters } from '@wordpress/hooks';

/**
 * Internal dependencies
 */
import GeneralTab from './GeneralTab.js';
import FeaturesTab from './FeaturesTab.js';
import OrganizerTab from './OrganizerTab.js';

/**
 * Settings App Component
 *
 * Main settings page with General, Features and Organizer tabs. Extensions
 * add tabs through the `fairEvents.settings.tabs` filter; each descriptor is
 * `{ name, title, order, render: ( { onNotice } ) => JSX }`.
 *
 * @return {JSX.Element} The Settings app component
 */
export default function SettingsApp() {
	const [ notice, setNotice ] = useState( null );

	const tabDescriptors = useMemo( () => {
		const builtInTabs = [
			{
				name: 'general',
				title: __( 'General', 'fair-events' ),
				order: 10,
				render: ( props ) => <GeneralTab { ...props } />,
			},
			{
				name: 'features',
				title: __( 'Features', 'fair-events' ),
				order: 20,
				render: ( props ) => <FeaturesTab { ...props } />,
			},
			{
				name: 'organizer',
				title: __( 'Organizer', 'fair-events' ),
				order: 30,
				render: ( props ) => <OrganizerTab { ...props } />,
			},
		];

		return [
			...applyFilters( 'fairEvents.settings.tabs', builtInTabs ),
		].sort( ( a, b ) => a.order - b.order );
	}, [] );

	// Shape TabPanel expects: { name, title }.
	const tabs = useMemo(
		() => tabDescriptors.map( ( { name, title } ) => ( { name, title } ) ),
		[ tabDescriptors ]
	);

	const initialTab = useMemo( () => {
		const urlTab = new URLSearchParams( window.location.search ).get(
			'tab'
		);
		if ( tabs.some( ( t ) => t.name === urlTab ) ) {
			return urlTab;
		}
		return 'general';
	}, [ tabs ] );

	const handleTabSelect = useCallback( ( tabName ) => {
		const url = new URL( window.location.href );
		if ( tabName === 'general' ) {
			url.searchParams.delete( 'tab' );
		} else {
			url.searchParams.set( 'tab', tabName );
		}
		window.history.replaceState( null, '', url.toString() );
	}, [] );

	return (
		<div className="wrap fair-events-settings">
			<style>
				{ `/* Let the tab bar wrap onto multiple rows instead of overflowing the
   viewport on narrow screens. Harmless on desktop, where the tabs fit on
   one row. */
.fair-events-settings .components-tab-panel__tabs { flex-wrap: wrap; row-gap: 4px; }
/* The 1.5px height of the active-tab indicator anti-aliases to a thin
   darker top edge at 1x DPI. Round to 2px so the bar renders crisp. */
.fair-events-settings .components-tab-panel__tabs-item.is-active::after { height: 2px; outline: none; }` }
			</style>
			<h1>{ __( 'Fair Events Settings', 'fair-events' ) }</h1>

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
				className="fair-events-settings-tabs"
				activeClass="active-tab"
				initialTabName={ initialTab }
				onSelect={ handleTabSelect }
				tabs={ tabs }
			>
				{ ( tab ) => (
					<div style={ { marginTop: '1rem' } }>
						{ tabDescriptors
							.find( ( t ) => t.name === tab.name )
							?.render( { onNotice: setNotice } ) }
					</div>
				) }
			</TabPanel>
		</div>
	);
}
