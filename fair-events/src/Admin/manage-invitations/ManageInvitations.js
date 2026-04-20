/**
 * Manage Invitations Component
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Notice,
	Spinner,
	TextControl,
	SelectControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function ManageInvitations() {
	const { eventDateId, manageEventUrl } =
		window.fairEventsManageInvitationsData || {};

	const [tokens, setTokens] = useState([]);
	const [groups, setGroups] = useState([]);
	const [ticketTypes, setTicketTypes] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);

	const [bulkGroupId, setBulkGroupId] = useState('');
	const [bulkCount, setBulkCount] = useState('5');
	const [bulkMaxUses, setBulkMaxUses] = useState('1');
	const [creating, setCreating] = useState(false);

	const loadTokens = useCallback(async () => {
		try {
			const data = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/invitation-tokens`,
			});
			setTokens(data || []);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to load invitation tokens.', 'fair-events')
			);
		}
	}, [eventDateId]);

	const loadGroups = useCallback(async () => {
		try {
			const data = await apiFetch({ path: '/fair-audience/v1/groups' });
			setGroups(data || []);
		} catch {
			setGroups([]);
		}
	}, []);

	const loadTicketTypes = useCallback(async () => {
		try {
			const data = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/tickets`,
			});
			setTicketTypes(data?.ticket_types || []);
		} catch {
			setTicketTypes([]);
		}
	}, [eventDateId]);

	useEffect(() => {
		Promise.all([loadTokens(), loadGroups(), loadTicketTypes()]).finally(
			() => setLoading(false)
		);
	}, [loadTokens, loadGroups, loadTicketTypes]);

	const invitationTicketTypes = ticketTypes.filter((t) => t.invitation_only);
	const groupNameById = Object.fromEntries(groups.map((g) => [g.id, g.name]));

	const invitationGroupIds = [
		...new Set(invitationTicketTypes.flatMap((t) => t.group_ids || [])),
	];
	const invitationGroups = groups.filter((g) =>
		invitationGroupIds.includes(g.id)
	);

	const handleBulkCreate = async () => {
		if (!bulkGroupId) {
			setError(__('Please select a group.', 'fair-events'));
			return;
		}

		setCreating(true);
		setError(null);
		setSuccess(null);

		try {
			const created = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/invitation-tokens/bulk`,
				method: 'POST',
				data: {
					group_id: parseInt(bulkGroupId, 10),
					count: parseInt(bulkCount, 10) || 5,
					max_uses: parseInt(bulkMaxUses, 10) || 1,
				},
			});

			setSuccess(
				sprintf(
					/* translators: %d: number of tokens created */
					__('%d invitation tokens created.', 'fair-events'),
					created.length
				)
			);
			await loadTokens();
		} catch (err) {
			setError(
				err.message || __('Failed to create tokens.', 'fair-events')
			);
		} finally {
			setCreating(false);
		}
	};

	const handleDelete = async (tokenId) => {
		if (
			!window.confirm(__('Delete this invitation token?', 'fair-events'))
		) {
			return;
		}

		try {
			await apiFetch({
				path: `/fair-events/v1/invitation-tokens/${tokenId}`,
				method: 'DELETE',
			});
			setTokens(tokens.filter((t) => t.id !== tokenId));
		} catch (err) {
			setError(
				err.message || __('Failed to delete token.', 'fair-events')
			);
		}
	};

	const getSignupUrl = (token) => {
		const siteUrl = window.location.origin;
		return `${siteUrl}/?invitation=${token}`;
	};

	const copyToClipboard = (text) => {
		navigator.clipboard.writeText(text).then(() => {
			setSuccess(__('Link copied to clipboard.', 'fair-events'));
		});
	};

	if (loading) {
		return (
			<div className="wrap">
				<Spinner />
			</div>
		);
	}

	const backUrl = manageEventUrl
		? `${manageEventUrl}&event_date_id=${eventDateId}&tab=tickets`
		: '#';

	return (
		<div className="wrap">
			<h1>{__('Manage Invitations', 'fair-events')}</h1>
			<p>
				<a href={backUrl}>{__('← Back to Tickets', 'fair-events')}</a>
			</p>

			{error && (
				<Notice
					status="error"
					isDismissible
					onRemove={() => setError(null)}
				>
					{error}
				</Notice>
			)}

			{success && (
				<Notice
					status="success"
					isDismissible
					onRemove={() => setSuccess(null)}
				>
					{success}
				</Notice>
			)}

			{invitationGroups.length > 0 && (
				<Card style={{ marginBottom: '16px' }}>
					<CardHeader>
						<strong>
							{__('Create Invitation Tokens', 'fair-events')}
						</strong>
					</CardHeader>
					<CardBody>
						<HStack spacing={3} alignment="bottom" wrap>
							<SelectControl
								label={__('Group', 'fair-events')}
								value={bulkGroupId}
								onChange={setBulkGroupId}
								options={[
									{
										label: __(
											'— Select group —',
											'fair-events'
										),
										value: '',
									},
									...invitationGroups.map((g) => ({
										label: g.name,
										value: String(g.id),
									})),
								]}
								__nextHasNoMarginBottom
							/>
							<TextControl
								label={__('Count', 'fair-events')}
								type="number"
								min="1"
								max="100"
								value={bulkCount}
								onChange={setBulkCount}
								__nextHasNoMarginBottom
							/>
							<TextControl
								label={__('Max uses each', 'fair-events')}
								type="number"
								min="1"
								value={bulkMaxUses}
								onChange={setBulkMaxUses}
								__nextHasNoMarginBottom
							/>
							<Button
								variant="primary"
								onClick={handleBulkCreate}
								isBusy={creating}
								disabled={creating}
							>
								{__('Create', 'fair-events')}
							</Button>
						</HStack>
					</CardBody>
				</Card>
			)}

			<Card>
				<CardHeader>
					<strong>
						{sprintf(
							/* translators: %d: number of tokens */
							__('Invitation Tokens (%d)', 'fair-events'),
							tokens.length
						)}
					</strong>
				</CardHeader>
				<CardBody>
					{tokens.length === 0 ? (
						<p>{__('No invitation tokens yet.', 'fair-events')}</p>
					) : (
						<div style={{ overflowX: 'auto' }}>
							<table className="wp-list-table widefat striped">
								<thead>
									<tr>
										<th>{__('Token', 'fair-events')}</th>
										<th>{__('Group', 'fair-events')}</th>
										<th>{__('Inviter', 'fair-events')}</th>
										<th>{__('Invitee', 'fair-events')}</th>
										<th>{__('Uses', 'fair-events')}</th>
										<th>{__('Created', 'fair-events')}</th>
										<th>{__('Actions', 'fair-events')}</th>
									</tr>
								</thead>
								<tbody>
									{tokens.map((token) => (
										<tr key={token.id}>
											<td>
												<code
													style={{
														fontSize: '11px',
													}}
												>
													{token.token.substring(
														0,
														12
													)}
													…
												</code>
											</td>
											<td>
												{token.group_name ||
													groupNameById[
														token.group_id
													] ||
													`#${token.group_id}`}
											</td>
											<td>
												{token.inviter_name ||
													(token.inviter_participant_id
														? `#${token.inviter_participant_id}`
														: __(
																'Admin',
																'fair-events'
														  ))}
											</td>
											<td>{token.invitee_name || '—'}</td>
											<td>
												{`${token.uses_count} / ${token.max_uses}`}
											</td>
											<td>
												{token.created_at
													? token.created_at.substring(
															0,
															16
													  )
													: '—'}
											</td>
											<td>
												<HStack spacing={1}>
													<Button
														variant="secondary"
														size="small"
														onClick={() =>
															copyToClipboard(
																getSignupUrl(
																	token.token
																)
															)
														}
													>
														{__(
															'Copy link',
															'fair-events'
														)}
													</Button>
													<Button
														variant="tertiary"
														isDestructive
														size="small"
														onClick={() =>
															handleDelete(
																token.id
															)
														}
													>
														{__(
															'Delete',
															'fair-events'
														)}
													</Button>
												</HStack>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
