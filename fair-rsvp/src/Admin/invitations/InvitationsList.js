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
	SelectControl,
	Button,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	Notice,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import './style.css';

const InvitationsList = () => {
	const [invitations, setInvitations] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [statusFilter, setStatusFilter] = useState('');
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);

	useEffect(() => {
		loadInvitations();
	}, [statusFilter, page]);

	const loadInvitations = async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams({
				page: page.toString(),
				per_page: '50',
			});

			if (statusFilter) {
				params.append('status', statusFilter);
			}

			const response = await apiFetch({
				path: `/fair-rsvp/v1/invitations/all?${params.toString()}`,
			});

			setInvitations(response.invitations || []);
			setTotalPages(response.total_pages || 1);
		} catch (err) {
			setError(
				err.message || __('Failed to load invitations.', 'fair-rsvp')
			);
		} finally {
			setLoading(false);
		}
	};

	const getStatusBadge = (status) => {
		const statusColors = {
			pending: 'status-pending',
			accepted: 'status-accepted',
			expired: 'status-expired',
		};

		const statusLabels = {
			pending: __('Pending', 'fair-rsvp'),
			accepted: __('Accepted', 'fair-rsvp'),
			expired: __('Expired', 'fair-rsvp'),
		};

		return (
			<span className={`invitation-status-badge ${statusColors[status]}`}>
				{statusLabels[status] || status}
			</span>
		);
	};

	const formatDate = (dateString) => {
		if (!dateString) return '-';
		const date = new Date(dateString);
		return date.toLocaleString();
	};

	return (
		<div className="fair-rsvp-invitations-page">
			<Card>
				<CardHeader>
					<h1>{__('Invitations', 'fair-rsvp')}</h1>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						<HStack spacing={2}>
							<SelectControl
								label={__('Filter by Status', 'fair-rsvp')}
								value={statusFilter}
								options={[
									{
										label: __('All Statuses', 'fair-rsvp'),
										value: '',
									},
									{
										label: __('Pending', 'fair-rsvp'),
										value: 'pending',
									},
									{
										label: __('Accepted', 'fair-rsvp'),
										value: 'accepted',
									},
									{
										label: __('Expired', 'fair-rsvp'),
										value: 'expired',
									},
								]}
								onChange={setStatusFilter}
							/>
						</HStack>

						{error && (
							<Notice status="error" isDismissible={false}>
								{error}
							</Notice>
						)}

						{loading ? (
							<div className="loading-container">
								<Spinner />
								<p>
									{__('Loading invitations...', 'fair-rsvp')}
								</p>
							</div>
						) : invitations.length === 0 ? (
							<Notice status="info" isDismissible={false}>
								{__('No invitations found.', 'fair-rsvp')}
							</Notice>
						) : (
							<>
								<div className="invitations-table-wrapper">
									<table className="widefat striped">
										<thead>
											<tr>
												<th>
													{__('Event', 'fair-rsvp')}
												</th>
												<th>
													{__('Sent By', 'fair-rsvp')}
												</th>
												<th>
													{__(
														'Invited Email',
														'fair-rsvp'
													)}
												</th>
												<th>
													{__(
														'Invited User',
														'fair-rsvp'
													)}
												</th>
												<th>
													{__('Status', 'fair-rsvp')}
												</th>
												<th>
													{__('Created', 'fair-rsvp')}
												</th>
												<th>
													{__('Expires', 'fair-rsvp')}
												</th>
												<th>
													{__('Used', 'fair-rsvp')}
												</th>
											</tr>
										</thead>
										<tbody>
											{invitations.map((invitation) => (
												<tr key={invitation.id}>
													<td>
														{invitation.event_url ? (
															<a
																href={
																	invitation.event_url
																}
																target="_blank"
																rel="noopener noreferrer"
															>
																{
																	invitation.event_title
																}
															</a>
														) : (
															invitation.event_title
														)}
													</td>
													<td>
														{
															invitation.inviter_name
														}
														{invitation.inviter_email && (
															<div className="small-text">
																{
																	invitation.inviter_email
																}
															</div>
														)}
													</td>
													<td>
														{invitation.invited_email ||
															'-'}
													</td>
													<td>
														{invitation.invited_user_name ||
															'-'}
														{invitation.invited_user_email &&
															invitation.invited_user_name && (
																<div className="small-text">
																	{
																		invitation.invited_user_email
																	}
																</div>
															)}
													</td>
													<td>
														{getStatusBadge(
															invitation.invitation_status
														)}
													</td>
													<td>
														{formatDate(
															invitation.created_at
														)}
													</td>
													<td>
														{formatDate(
															invitation.expires_at
														)}
													</td>
													<td>
														{formatDate(
															invitation.used_at
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>

								{totalPages > 1 && (
									<HStack spacing={2} justify="center">
										<Button
											variant="secondary"
											disabled={page === 1}
											onClick={() => setPage(page - 1)}
										>
											{__('Previous', 'fair-rsvp')}
										</Button>
										<span>
											{__('Page', 'fair-rsvp')} {page}{' '}
											{__('of', 'fair-rsvp')} {totalPages}
										</span>
										<Button
											variant="secondary"
											disabled={page === totalPages}
											onClick={() => setPage(page + 1)}
										>
											{__('Next', 'fair-rsvp')}
										</Button>
									</HStack>
								)}
							</>
						)}
					</VStack>
				</CardBody>
			</Card>
		</div>
	);
};

export default InvitationsList;
