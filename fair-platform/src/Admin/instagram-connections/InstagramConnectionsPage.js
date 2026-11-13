/**
 * Instagram Connections Admin Page Component
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import ConnectionManagementScreen from '../components/connection-management/ConnectionManagementScreen.js';

const api = {
	list: ( query ) =>
		apiFetch( {
			path: `/fair-platform/v1/instagram-connections?${ query }`,
		} ),
	stats: () =>
		apiFetch( { path: '/fair-platform/v1/instagram-connections/stats' } ),
	cleanup: ( days ) =>
		apiFetch( {
			path: `/fair-platform/v1/instagram-connections/cleanup?days=${ days }`,
			method: 'DELETE',
		} ),
};

const columns = [
	{
		id: 'username',
		label: __( 'IG Username', 'fair-platform' ),
		render: ( connection ) =>
			connection.instagram_username ? (
				<code>@{ connection.instagram_username }</code>
			) : (
				'-'
			),
	},
	{
		id: 'user-id',
		label: __( 'IG User ID', 'fair-platform' ),
		render: ( connection ) => (
			<code>{ connection.instagram_user_id || '-' }</code>
		),
	},
];

/**
 * InstagramConnectionsPage component
 */
export default function InstagramConnectionsPage() {
	return (
		<ConnectionManagementScreen
			api={ api }
			labels={ {
				title: __( 'Instagram Connection Logs', 'fair-platform' ),
				description: __(
					'Monitor Instagram OAuth connections from WordPress sites.',
					'fair-platform'
				),
				listError: __(
					'Failed to load Instagram connections',
					'fair-platform'
				),
				empty: __( 'No Instagram connections found.', 'fair-platform' ),
				history: __( 'Instagram Connection History', 'fair-platform' ),
				cleanupTitle: __(
					'Delete old Instagram connection logs',
					'fair-platform'
				),
				cleanupMessage: ( days ) =>
					sprintf(
						/* translators: %d: number of days */
						_n(
							'This deletes every Instagram connection log entry older than %d day.',
							'This deletes every Instagram connection log entry older than %d days.',
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
					key: 'unique_usernames',
					label: __( 'Unique Usernames', 'fair-platform' ),
				},
			] }
			columns={ columns }
		/>
	);
}
