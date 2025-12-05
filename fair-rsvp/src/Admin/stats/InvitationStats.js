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
	TabPanel,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import './style.css';

const InvitationStats = () => {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [isAdmin, setIsAdmin] = useState(false);

	// RSVP Stats
	const [rsvpStats, setRsvpStats] = useState(null);
	const [eventsHistory, setEventsHistory] = useState([]);
	const [allUsersStats, setAllUsersStats] = useState([]);
	const [topUsers, setTopUsers] = useState(null);

	// Invitation Stats (existing)
	const [invitationStats, setInvitationStats] = useState([]);

	useEffect(() => {
		loadAllStats();
	}, []);

	const loadAllStats = async () => {
		setLoading(true);
		setError(null);

		try {
			// Try admin endpoints first, fall back to user endpoints
			let isAdminUser = false;

			const promises = [];

			// Load RSVP stats
			try {
				promises.push(
					apiFetch({ path: '/fair-rsvp/v1/rsvps/user-stats' })
				);
				isAdminUser = true;
			} catch (e) {
				promises.push(
					apiFetch({ path: '/fair-rsvp/v1/rsvps/my-stats' })
				);
			}

			// Load event history (user only)
			promises.push(apiFetch({ path: '/fair-rsvp/v1/rsvps/my-events' }));

			// Load top users (admin only)
			if (isAdminUser) {
				promises.push(
					apiFetch({ path: '/fair-rsvp/v1/rsvps/top-users' })
				);
			}

			// Load invitation stats
			try {
				promises.push(
					apiFetch({
						path: '/fair-rsvp/v1/invitations/stats-by-user',
					})
				);
			} catch (e) {
				promises.push(
					apiFetch({ path: '/fair-rsvp/v1/invitations/my-stats' })
				);
			}

			const results = await Promise.all(promises);

			setIsAdmin(isAdminUser);

			if (isAdminUser) {
				setAllUsersStats(results[0]?.stats || []);
				setEventsHistory(results[1]?.events || []);
				setTopUsers(results[2] || null);
				setInvitationStats(results[3]?.stats || []);
			} else {
				setRsvpStats(results[0]?.stats || null);
				setEventsHistory(results[1]?.events || []);
				setInvitationStats(results[2]?.stats || []);
			}
		} catch (err) {
			setError(err.message || __('Failed to load stats.', 'fair-rsvp'));
		} finally {
			setLoading(false);
		}
	};

	const renderOverviewTab = () => {
		if (isAdmin) {
			return renderAdminOverview();
		}
		return renderUserOverview();
	};

	const renderUserOverview = () => {
		if (!rsvpStats) {
			return (
				<Notice status="info" isDismissible={false}>
					{__('No stats available yet.', 'fair-rsvp')}
				</Notice>
			);
		}

		const inviteSent = invitationStats.reduce(
			(sum, s) => sum + parseInt(s.total_sent || 0),
			0
		);
		const inviteAccepted = invitationStats.reduce(
			(sum, s) => sum + parseInt(s.accepted || 0),
			0
		);
		const inviteRate =
			inviteSent > 0
				? Math.round((inviteAccepted / inviteSent) * 100)
				: 0;

		return (
			<div className="stats-overview">
				<div className="stats-grid">
					<div className="stat-card">
						<div className="stat-number">
							{rsvpStats.total_rsvps}
						</div>
						<div className="stat-label">
							{__('Events RSVPed', 'fair-rsvp')}
						</div>
					</div>
					<div className="stat-card highlight-green">
						<div className="stat-number">{rsvpStats.yes_count}</div>
						<div className="stat-label">
							{__('Yes RSVPs', 'fair-rsvp')}
						</div>
					</div>
					<div className="stat-card highlight-blue">
						<div className="stat-number">
							{rsvpStats.checked_in_count}
						</div>
						<div className="stat-label">
							{__('Events Attended', 'fair-rsvp')}
						</div>
					</div>
					<div className="stat-card">
						<div className="stat-number">
							{rsvpStats.attendance_rate}%
						</div>
						<div className="stat-label">
							{__('Attendance Rate', 'fair-rsvp')}
						</div>
					</div>
					<div className="stat-card">
						<div className="stat-number">{inviteSent}</div>
						<div className="stat-label">
							{__('Invitations Sent', 'fair-rsvp')}
						</div>
					</div>
					<div className="stat-card">
						<div className="stat-number">{inviteRate}%</div>
						<div className="stat-label">
							{__('Invitation Acceptance Rate', 'fair-rsvp')}
						</div>
					</div>
				</div>

				<h3 style={{ marginTop: '24px' }}>
					{__('RSVP Breakdown', 'fair-rsvp')}
				</h3>
				<table className="widefat striped">
					<tbody>
						<tr>
							<td>
								<span className="status-badge status-yes">
									{__('Yes', 'fair-rsvp')}
								</span>
							</td>
							<td>
								{rsvpStats.yes_count}{' '}
								{__('events', 'fair-rsvp')}
							</td>
						</tr>
						<tr>
							<td>
								<span className="status-badge status-maybe">
									{__('Maybe', 'fair-rsvp')}
								</span>
							</td>
							<td>
								{rsvpStats.maybe_count}{' '}
								{__('events', 'fair-rsvp')}
							</td>
						</tr>
						<tr>
							<td>
								<span className="status-badge status-no">
									{__('No', 'fair-rsvp')}
								</span>
							</td>
							<td>
								{rsvpStats.no_count} {__('events', 'fair-rsvp')}
							</td>
						</tr>
						<tr>
							<td>
								<span className="status-badge status-pending">
									{__('Pending', 'fair-rsvp')}
								</span>
							</td>
							<td>
								{rsvpStats.pending_count}{' '}
								{__('events', 'fair-rsvp')}
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		);
	};

	const renderAdminOverview = () => {
		const totalUsers = allUsersStats.length;
		const totalRsvps = allUsersStats.reduce(
			(sum, u) => sum + parseInt(u.total_rsvps || 0),
			0
		);
		const totalAttended = allUsersStats.reduce(
			(sum, u) => sum + parseInt(u.checked_in_count || 0),
			0
		);
		const totalInvites = allUsersStats.reduce(
			(sum, u) => sum + parseInt(u.invitations_sent || 0),
			0
		);

		return (
			<div className="stats-overview">
				<div className="stats-grid">
					<div className="stat-card">
						<div className="stat-number">{totalUsers}</div>
						<div className="stat-label">
							{__('Active Users', 'fair-rsvp')}
						</div>
					</div>
					<div className="stat-card">
						<div className="stat-number">{totalRsvps}</div>
						<div className="stat-label">
							{__('Total RSVPs', 'fair-rsvp')}
						</div>
					</div>
					<div className="stat-card highlight-blue">
						<div className="stat-number">{totalAttended}</div>
						<div className="stat-label">
							{__('Total Attendances', 'fair-rsvp')}
						</div>
					</div>
					<div className="stat-card">
						<div className="stat-number">{totalInvites}</div>
						<div className="stat-label">
							{__('Total Invitations Sent', 'fair-rsvp')}
						</div>
					</div>
				</div>
			</div>
		);
	};

	const renderEventsTab = () => {
		if (isAdmin) {
			return renderAllUsersTable();
		}
		return renderMyEventsTable();
	};

	const renderMyEventsTable = () => {
		if (eventsHistory.length === 0) {
			return (
				<Notice status="info" isDismissible={false}>
					{__('No events yet.', 'fair-rsvp')}
				</Notice>
			);
		}

		return (
			<div className="events-table">
				<table className="widefat striped">
					<thead>
						<tr>
							<th>{__('Event', 'fair-rsvp')}</th>
							<th>{__('RSVP Status', 'fair-rsvp')}</th>
							<th>{__('Attendance', 'fair-rsvp')}</th>
							<th>{__('Type', 'fair-rsvp')}</th>
							<th>{__('Invited By', 'fair-rsvp')}</th>
							<th>{__('Date', 'fair-rsvp')}</th>
						</tr>
					</thead>
					<tbody>
						{eventsHistory.map((event, index) => (
							<tr key={index}>
								<td>
									<strong>{event.event_title}</strong>
								</td>
								<td>{getRsvpStatusBadge(event.rsvp_status)}</td>
								<td>
									{getAttendanceBadge(
										event.attendance_status
									)}
								</td>
								<td>
									{event.was_invited == 1 ? (
										<span className="invite-badge">
											{__('Invited', 'fair-rsvp')}
										</span>
									) : (
										<span className="direct-badge">
											{__('Direct', 'fair-rsvp')}
										</span>
									)}
								</td>
								<td>{event.invited_by_name || '-'}</td>
								<td>{formatDate(event.rsvp_at)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	};

	const renderAllUsersTable = () => {
		if (allUsersStats.length === 0) {
			return (
				<Notice status="info" isDismissible={false}>
					{__('No user stats available.', 'fair-rsvp')}
				</Notice>
			);
		}

		return (
			<div className="users-stats-table">
				<table className="widefat striped">
					<thead>
						<tr>
							<th>{__('User', 'fair-rsvp')}</th>
							<th>{__('Email', 'fair-rsvp')}</th>
							<th>{__('Total RSVPs', 'fair-rsvp')}</th>
							<th>{__('Yes RSVPs', 'fair-rsvp')}</th>
							<th>{__('Attended', 'fair-rsvp')}</th>
							<th>{__('Attendance Rate', 'fair-rsvp')}</th>
							<th>{__('Invitations Sent', 'fair-rsvp')}</th>
							<th>{__('Acceptance Rate', 'fair-rsvp')}</th>
						</tr>
					</thead>
					<tbody>
						{allUsersStats.map((user) => (
							<tr key={user.user_id}>
								<td>
									<strong>{user.user_name}</strong>
								</td>
								<td>{user.user_email}</td>
								<td>
									<span className="stats-number">
										{user.total_rsvps}
									</span>
								</td>
								<td>
									<span className="stats-number stats-yes">
										{user.yes_count}
									</span>
								</td>
								<td>
									<span className="stats-number stats-attended">
										{user.checked_in_count}
									</span>
								</td>
								<td>
									<span className="stats-number">
										{user.attendance_rate}%
									</span>
								</td>
								<td>
									<span className="stats-number">
										{user.invitations_sent}
									</span>
								</td>
								<td>
									<span className="stats-number">
										{user.acceptance_rate}%
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	};

	const renderLeaderboardTab = () => {
		if (!isAdmin || !topUsers) {
			return (
				<Notice status="info" isDismissible={false}>
					{__('Leaderboard available for admins only.', 'fair-rsvp')}
				</Notice>
			);
		}

		return (
			<div className="leaderboard">
				<HStack spacing={4} alignment="top" style={{ gap: '24px' }}>
					<div style={{ flex: 1 }}>
						<h3>{__('Top Attendees', 'fair-rsvp')}</h3>
						<table className="widefat striped">
							<thead>
								<tr>
									<th>#</th>
									<th>{__('User', 'fair-rsvp')}</th>
									<th>
										{__('Events Attended', 'fair-rsvp')}
									</th>
								</tr>
							</thead>
							<tbody>
								{topUsers.top_attendees &&
								topUsers.top_attendees.length > 0 ? (
									topUsers.top_attendees.map(
										(user, index) => (
											<tr key={user.user_id}>
												<td>
													<strong>{index + 1}</strong>
												</td>
												<td>{user.user_name}</td>
												<td>
													<span className="stats-number stats-attended">
														{user.events_attended}
													</span>
												</td>
											</tr>
										)
									)
								) : (
									<tr>
										<td colSpan="3">
											{__(
												'No data available.',
												'fair-rsvp'
											)}
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>

					<div style={{ flex: 1 }}>
						<h3>{__('Top Inviters', 'fair-rsvp')}</h3>
						<table className="widefat striped">
							<thead>
								<tr>
									<th>#</th>
									<th>{__('User', 'fair-rsvp')}</th>
									<th>{__('Invites Sent', 'fair-rsvp')}</th>
									<th>
										{__('Acceptance Rate', 'fair-rsvp')}
									</th>
								</tr>
							</thead>
							<tbody>
								{topUsers.top_inviters &&
								topUsers.top_inviters.length > 0 ? (
									topUsers.top_inviters.map((user, index) => (
										<tr key={user.user_id}>
											<td>
												<strong>{index + 1}</strong>
											</td>
											<td>{user.user_name}</td>
											<td>
												<span className="stats-number">
													{user.invitations_sent}
												</span>
											</td>
											<td>
												<span className="stats-number">
													{user.acceptance_rate}%
												</span>
											</td>
										</tr>
									))
								) : (
									<tr>
										<td colSpan="4">
											{__(
												'No data available. Minimum 5 invitations required.',
												'fair-rsvp'
											)}
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</HStack>
			</div>
		);
	};

	const renderInvitationsTab = () => {
		if (invitationStats.length === 0) {
			return (
				<Notice status="info" isDismissible={false}>
					{__('No invitation stats available.', 'fair-rsvp')}
				</Notice>
			);
		}

		return (
			<div className="invitations-table">
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
						{invitationStats.map((row, index) => (
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

	const getRsvpStatusBadge = (status) => {
		const badges = {
			yes: (
				<span className="status-badge status-yes">
					{__('Yes', 'fair-rsvp')}
				</span>
			),
			maybe: (
				<span className="status-badge status-maybe">
					{__('Maybe', 'fair-rsvp')}
				</span>
			),
			no: (
				<span className="status-badge status-no">
					{__('No', 'fair-rsvp')}
				</span>
			),
			pending: (
				<span className="status-badge status-pending">
					{__('Pending', 'fair-rsvp')}
				</span>
			),
			cancelled: (
				<span className="status-badge status-expired">
					{__('Cancelled', 'fair-rsvp')}
				</span>
			),
		};
		return badges[status] || status;
	};

	const getAttendanceBadge = (status) => {
		const badges = {
			checked_in: (
				<span className="status-badge status-attended">
					{__('Checked In', 'fair-rsvp')}
				</span>
			),
			no_show: (
				<span className="status-badge status-no">
					{__('No Show', 'fair-rsvp')}
				</span>
			),
			not_applicable: (
				<span className="status-badge status-na">
					{__('N/A', 'fair-rsvp')}
				</span>
			),
		};
		return badges[status] || '-';
	};

	const formatDate = (dateStr) => {
		if (!dateStr) return '-';
		const date = new Date(dateStr);
		return date.toLocaleDateString();
	};

	if (loading) {
		return (
			<div className="fair-rsvp-stats-loading">
				<Spinner />
				<p>{__('Loading stats...', 'fair-rsvp')}</p>
			</div>
		);
	}

	const tabs = [
		{
			name: 'overview',
			title: __('Overview', 'fair-rsvp'),
			className: 'tab-overview',
		},
		{
			name: 'events',
			title: isAdmin
				? __('Users', 'fair-rsvp')
				: __('My Events', 'fair-rsvp'),
			className: 'tab-events',
		},
	];

	if (isAdmin) {
		tabs.push({
			name: 'leaderboard',
			title: __('Leaderboard', 'fair-rsvp'),
			className: 'tab-leaderboard',
		});
	}

	tabs.push({
		name: 'invitations',
		title: __('Invitations', 'fair-rsvp'),
		className: 'tab-invitations',
	});

	return (
		<div className="fair-rsvp-stats-page">
			<Card>
				<CardHeader>
					<h1>
						{isAdmin
							? __('RSVP & Invitation Stats', 'fair-rsvp')
							: __('My Stats', 'fair-rsvp')}
					</h1>
				</CardHeader>
				<CardBody>
					{error && (
						<Notice status="error" isDismissible={false}>
							{error}
						</Notice>
					)}

					<TabPanel
						className="stats-tabs"
						activeClass="is-active"
						tabs={tabs}
					>
						{(tab) => {
							switch (tab.name) {
								case 'overview':
									return renderOverviewTab();
								case 'events':
									return renderEventsTab();
								case 'leaderboard':
									return renderLeaderboardTab();
								case 'invitations':
									return renderInvitationsTab();
								default:
									return null;
							}
						}}
					</TabPanel>
				</CardBody>
			</Card>
		</div>
	);
};

export default InvitationStats;
