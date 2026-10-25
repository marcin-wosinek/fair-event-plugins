/**
 * Manage Event screenshot manifest (#2043).
 *
 * One entry per Manage Event tab, in tab order. The tab names come from the
 * descriptors registered in:
 *
 * - fair-events/src/Admin/manage-event/ManageEventApp.js (built-in tabs)
 * - fair-events-experimental/src/Admin/manage-event-schedule/index.js
 * - fair-audience/src/Admin/manage-event-audience-tab/index.js
 * - fair-audience-experimental/src/Admin/manage-event-ext/index.js
 *
 * scripts/__tests__/manage-event-screenshots.test.mjs fails when a tab is
 * registered there but missing here, or listed here but no longer
 * registered. `ready` lists the demo data a tab must show before it counts
 * as loaded; see e2e/mu-plugins/scripts/manage-event-demo.php for the data.
 */

/** Files that register Manage Event tabs, relative to the repository root. */
export const TAB_SOURCES = [
	'fair-events/src/Admin/manage-event/ManageEventApp.js',
	'fair-events-experimental/src/Admin/manage-event-schedule/index.js',
	'fair-audience/src/Admin/manage-event-audience-tab/index.js',
	'fair-audience-experimental/src/Admin/manage-event-ext/index.js',
];

export const SCENARIO = 'standalone-event';
export const LOCALE = 'en_US';
export const VIEWPORT = { name: 'desktop', width: 1280, height: 900 };

/**
 * @typedef {object} ManageEventTab
 * @property {string}   name          Canonical `tab` URL parameter.
 * @property {string}   title         Tab label in English.
 * @property {string}   plugin        Plugin that registers the tab.
 * @property {string[]} prerequisites What must hold for the tab to be offered.
 * @property {Function} ready         ( panel, demo ) => locators that must be visible.
 */

/** @type {ManageEventTab[]} */
export const MANAGE_EVENT_TABS = [
	{
		name: 'event-details',
		title: 'Event Details',
		plugin: 'fair-events',
		prerequisites: [ 'Always offered.' ],
		ready: ( panel ) => [
			panel.getByRole( 'heading', { name: 'Details' } ),
			panel.getByRole( 'button', { name: 'Save event details' } ),
		],
	},
	{
		name: 'prices',
		title: 'Prices',
		plugin: 'fair-events',
		prerequisites: [
			'Fair Events Ticketing feature on.',
			'Not a generated series occurrence or a link-only event.',
		],
		ready: ( panel ) => [
			panel.getByRole( 'columnheader', { name: 'Early bird' } ),
			panel.getByRole( 'columnheader', { name: 'Regular' } ),
		],
	},
	{
		name: 'schedule',
		title: 'Schedule',
		plugin: 'fair-events-experimental',
		prerequisites: [
			'Fair Events Experimental active.',
			'Fair Events Ticketing feature on.',
			'Workshop schedule enabled for the event (Prices → More options).',
		],
		ready: ( panel, demo ) => [
			panel.getByText( demo.workshop, { exact: true } ).first(),
			panel.getByText( 'Evening social with live band' ).first(),
		],
	},
	{
		name: 'list',
		title: 'List',
		plugin: 'fair-events',
		prerequisites: [
			'Fair Events Ticketing feature on.',
			'Not a link-only event.',
		],
		ready: ( panel, demo ) => [
			panel.getByRole( 'cell', { name: demo.firstParticipant } ),
		],
	},
	{
		name: 'groups',
		title: 'Groups',
		plugin: 'fair-audience-experimental',
		prerequisites: [
			'Fair Events Experimental and Fair Audience Experimental active.',
			'Fair Events Ticketing and Experimental Ticketing extensions on.',
			'Fair Audience Experimental Groups and Manage Event extensions on.',
		],
		ready: ( panel, demo ) => [
			panel.getByRole( 'heading', { name: demo.groupName } ),
			panel.getByText( 'Discount: 50%' ),
		],
	},
	{
		name: 'audience',
		title: 'Audience',
		plugin: 'fair-audience',
		prerequisites: [ 'Fair Audience active.', 'Not a link-only event.' ],
		ready: ( panel, demo ) => [
			panel.getByText( demo.firstParticipant, { exact: true } ).first(),
		],
	},
	{
		name: 'mailings',
		title: 'Mailings',
		plugin: 'fair-audience-experimental',
		prerequisites: [
			'Fair Audience and Fair Audience Experimental active.',
			'Fair Events Experimental Mailings feature on.',
			'Fair Audience Experimental Manage Event extensions on.',
		],
		ready: ( panel, demo ) => [
			panel.getByText( demo.mailingSubject, { exact: true } ).first(),
			panel.getByText(
				`${ demo.paidTickets } recipient(s) match right now.`
			),
		],
	},
	{
		name: 'statistics',
		title: 'Statistics',
		plugin: 'fair-events',
		prerequisites: [
			'Fair Audience active (it provides ticket and payment data).',
			'Viewed by an administrator (manage_options).',
		],
		ready: ( panel, demo ) => [
			panel.getByText( `${ demo.paidTickets } tickets`, { exact: true } ),
			// Both cumulative charts have drawn their area, the bar charts a bar.
			panel.locator( '.recharts-area-area' ).nth( 1 ),
			panel.locator( '.recharts-bar-rectangle' ).first(),
			panel.getByRole( 'heading', { name: 'Tickets per activity' } ),
		],
	},
	{
		name: 'finance',
		title: 'Finance',
		plugin: 'fair-events',
		prerequisites: [ 'Fair Finance active.', 'Not a link-only event.' ],
		ready: ( panel, demo ) => [
			panel.getByRole( 'cell', { name: demo.costEntry } ),
			panel
				.getByRole( 'cell', {
					name: demo.firstParticipant,
					exact: true,
				} )
				.first(),
		],
	},
	{
		name: 'admin',
		title: 'Admin',
		plugin: 'fair-events',
		prerequisites: [ 'Always offered.' ],
		ready: ( panel ) => [
			panel.getByRole( 'link', { name: 'Copy event' } ),
			panel.getByRole( 'button', { name: 'Delete Event' } ),
		],
	},
];

/**
 * Stable screenshot filename for a tab, e.g. `03-schedule.png`.
 *
 * @param {ManageEventTab} tab Manifest entry.
 * @return {string} Filename.
 */
export function screenshotFilename( tab ) {
	const position = MANAGE_EVENT_TABS.indexOf( tab ) + 1;
	return `${ String( position ).padStart( 2, '0' ) }-${ tab.name }.png`;
}

/**
 * Compare the tabs Manage Event offers with the manifest.
 *
 * @param {Array<{name: string, title: string}>} manifest Expected tabs.
 * @param {Array<{name: string, disabled: boolean}>} offered Tabs on the page.
 * @return {{missing: string[], unexpected: string[], disabled: string[], ok: boolean}}
 */
export function checkTabCoverage( manifest, offered ) {
	const offeredNames = new Set( offered.map( ( tab ) => tab.name ) );
	const expectedNames = new Set( manifest.map( ( tab ) => tab.name ) );
	const missing = manifest
		.map( ( tab ) => tab.name )
		.filter( ( name ) => ! offeredNames.has( name ) );
	const unexpected = offered
		.map( ( tab ) => tab.name )
		.filter( ( name ) => ! expectedNames.has( name ) );
	const disabled = offered
		.filter( ( tab ) => tab.disabled && expectedNames.has( tab.name ) )
		.map( ( tab ) => tab.name );

	return {
		missing,
		unexpected,
		disabled,
		ok: ! missing.length && ! unexpected.length && ! disabled.length,
	};
}

/**
 * Human-readable explanation of a failed coverage check.
 *
 * @param {ReturnType<typeof checkTabCoverage>} coverage Coverage result.
 * @return {string} Message naming every affected tab.
 */
export function describeCoverage( coverage ) {
	const parts = [];
	if ( coverage.missing.length ) {
		parts.push( `missing tabs: ${ coverage.missing.join( ', ' ) }` );
	}
	if ( coverage.disabled.length ) {
		parts.push( `disabled tabs: ${ coverage.disabled.join( ', ' ) }` );
	}
	if ( coverage.unexpected.length ) {
		parts.push(
			`tabs not in the manifest: ${ coverage.unexpected.join(
				', '
			) } (add them to e2e/screenshots/manage-event-tabs.js)`
		);
	}
	return parts.join( '; ' );
}
