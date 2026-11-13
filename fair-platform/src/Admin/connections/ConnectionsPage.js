/**
 * Connections Admin Page Component
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import ConnectionManagementScreen from '../components/connection-management/ConnectionManagementScreen.js';

const api = {
	list: ( query ) =>
		apiFetch( { path: `/fair-platform/v1/connections?${ query }` } ),
	stats: () => apiFetch( { path: '/fair-platform/v1/connections/stats' } ),
	cleanup: ( days ) =>
		apiFetch( {
			path: `/fair-platform/v1/connections/cleanup?days=${ days }`,
			method: 'DELETE',
		} ),
};

const columns = [
	{
		id: 'organization',
		label: __( 'Organization', 'fair-platform' ),
		render: ( connection ) => (
			<code>{ connection.mollie_organization_id || '-' }</code>
		),
	},
	{
		id: 'profile',
		label: __( 'Profile', 'fair-platform' ),
		render: ( connection ) => (
			<code>{ connection.mollie_profile_id || '-' }</code>
		),
	},
];

const renderStatusDetails = ( connection ) =>
	connection.profile_created ? (
		<div style={ { marginTop: '4px', fontSize: '11px', color: '#00a32a' } }>
			{ __( '✓ Profile created', 'fair-platform' ) }
		</div>
	) : null;

/**
 * ConnectionsPage component
 */
export default function ConnectionsPage() {
	return (
		<ConnectionManagementScreen
			api={ api }
			labels={ {
				title: __( 'Connection Logs', 'fair-platform' ),
				description: __(
					'Monitor OAuth connections from WordPress sites.',
					'fair-platform'
				),
				listError: __( 'Failed to load connections', 'fair-platform' ),
				empty: __( 'No connections found.', 'fair-platform' ),
				history: __( 'Connection History', 'fair-platform' ),
				cleanupTitle: __(
					'Delete old connection logs',
					'fair-platform'
				),
				cleanupMessage: ( days ) =>
					sprintf(
						/* translators: %d: number of days */
						_n(
							'This deletes every connection log entry older than %d day.',
							'This deletes every connection log entry older than %d days.',
							days,
							'fair-platform'
						),
						days
					),
			} }
			statuses={ [
				{
					value: 'connected',
					label: __( 'Connected', 'fair-platform' ),
					color: '#00a32a',
				},
				{
					value: 'failed',
					label: __( 'Failed', 'fair-platform' ),
					color: '#d63638',
				},
				{
					value: 'disconnected',
					label: __( 'Disconnected', 'fair-platform' ),
					color: '#dba617',
				},
			] }
			statistics={ [
				{
					key: 'total_connections',
					label: __( 'Total Connections', 'fair-platform' ),
				},
				{
					key: 'successful',
					label: __( 'Successful', 'fair-platform' ),
					color: '#00a32a',
				},
				{
					key: 'failed',
					label: __( 'Failed', 'fair-platform' ),
					color: '#d63638',
				},
				{
					key: 'unique_sites',
					label: __( 'Unique Sites', 'fair-platform' ),
				},
			] }
			columns={ columns }
			renderStatusDetails={ renderStatusDetails }
		/>
	);
}
