/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import './style.css';

const InvitationStats = () => {
	const [stats, setStats] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [isAdmin, setIsAdmin] = useState(false);

	useEffect(() => {
		checkUserRole();
		loadStats();
	}, []);

	const checkUserRole = () => {
		// Check if current user has admin capabilities
		// In WordPress, we can check this via apiFetch to stats endpoint
		// If they can access /stats-by-user, they're admin
		setIsAdmin(
			window.wpApiSettings?.user?.capabilities?.manage_options || false
		);
	};

	const loadStats = async () => {
		setLoading(true);
		setError(null);

		try {
			// Determine endpoint based on user role
			// Try admin endpoint first, fall back to user endpoint if forbidden
			let response;
			try {
				response = await apiFetch({
					path: '/fair-rsvp/v1/invitations/stats-by-user',
				});
				setIsAdmin(true);
			} catch (adminError) {
				// If admin endpoint fails, try user endpoint
				response = await apiFetch({
					path: '/fair-rsvp/v1/invitations/my-stats',
				});
				setIsAdmin(false);
			}

			setStats(response.stats || []);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to load invitation stats.', 'fair-rsvp')
			);
		} finally {
			setLoading(false);
		}
	};

	const renderStatsTable = () => {
		if (stats.length === 0) {
			return (
				<Notice status="info" isDismissible={false}>
					{__('No invitation stats available.', 'fair-rsvp')}
				</Notice>
			);
		}

		return (
			<div className="fair-rsvp-stats-table">
				<table className="widefat striped">
					<thead>
						<tr>
							{isAdmin && (
								<>
									<th>{__('Inviter', 'fair-rsvp')}</th>
									<th>{__('Email', 'fair-rsvp')}</th>
								</>
							)}
							<th>{__('Event', 'fair-rsvp')}</th>
							<th>{__('Total Sent', 'fair-rsvp')}</th>
							<th>{__('Accepted', 'fair-rsvp')}</th>
							<th>{__('Pending', 'fair-rsvp')}</th>
							<th>{__('Expired', 'fair-rsvp')}</th>
						</tr>
					</thead>
					<tbody>
						{stats.map((row, index) => (
							<tr key={index}>
								{isAdmin && (
									<>
										<td>{row.inviter_name || '-'}</td>
										<td>{row.inviter_email || '-'}</td>
									</>
								)}
								<td>
									<strong>
										{row.event_title ||
											__('Unknown Event', 'fair-rsvp')}
									</strong>
								</td>
								<td>
									<span className="stats-number">
										{row.total_sent}
									</span>
								</td>
								<td>
									<span className="stats-number stats-accepted">
										{row.accepted}
									</span>
								</td>
								<td>
									<span className="stats-number stats-pending">
										{row.pending}
									</span>
								</td>
								<td>
									<span className="stats-number stats-expired">
										{row.expired}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	};

	return (
		<div className="fair-rsvp-stats-page">
			<Card>
				<CardHeader>
					<h1>
						{isAdmin
							? __('Invitation Stats (All Users)', 'fair-rsvp')
							: __('My Invitation Stats', 'fair-rsvp')}
					</h1>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						{error && (
							<Notice status="error" isDismissible={false}>
								{error}
							</Notice>
						)}

						{loading ? (
							<div className="fair-rsvp-stats-loading">
								<Spinner />
								<p>{__('Loading stats...', 'fair-rsvp')}</p>
							</div>
						) : (
							renderStatsTable()
						)}
					</VStack>
				</CardBody>
			</Card>
		</div>
	);
};

export default InvitationStats;
