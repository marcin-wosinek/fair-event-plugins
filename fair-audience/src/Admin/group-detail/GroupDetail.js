import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	SearchControl,
	CheckboxControl,
	Spinner,
	Notice,
} from '@wordpress/components';

export default function GroupDetail() {
	const urlParams = new URLSearchParams(window.location.search);
	const groupId = urlParams.get('group_id');

	const groupsListUrl =
		// eslint-disable-next-line no-undef
		typeof fairAudienceGroupDetailData !== 'undefined'
			? // eslint-disable-next-line no-undef
			  fairAudienceGroupDetailData.groupsListUrl
			: 'admin.php?page=fair-audience-groups';

	const [group, setGroup] = useState(null);
	const [members, setMembers] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [membersLoading, setMembersLoading] = useState(true);
	const [error, setError] = useState(null);

	const [allParticipants, setAllParticipants] = useState([]);
	const [participantsLoading, setParticipantsLoading] = useState(false);
	const [participantSearch, setParticipantSearch] = useState('');
	const [selectedParticipants, setSelectedParticipants] = useState([]);
	const [isAddingMembers, setIsAddingMembers] = useState(false);

	const loadGroup = useCallback(() => {
		if (!groupId) {
			setError(__('No group ID provided.', 'fair-audience'));
			setIsLoading(false);
			return;
		}

		apiFetch({ path: `/fair-audience/v1/groups/${groupId}` })
			.then((data) => {
				setGroup(data);
			})
			.catch(() => {
				setError(__('Group not found.', 'fair-audience'));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [groupId]);

	const loadMembers = useCallback(() => {
		if (!groupId) {
			return;
		}
		setMembersLoading(true);
		apiFetch({ path: `/fair-audience/v1/groups/${groupId}/participants` })
			.then((data) => {
				setMembers(data);
			})
			.catch(() => {
				// Ignore; main error handled in loadGroup.
			})
			.finally(() => {
				setMembersLoading(false);
			});
	}, [groupId]);

	const loadParticipants = useCallback((search = '') => {
		setParticipantsLoading(true);

		const params = new URLSearchParams();
		params.append('per_page', '100');
		params.append('orderby', 'surname');
		params.append('order', 'asc');
		if (search) {
			params.append('search', search);
		}

		apiFetch({
			path: `/fair-audience/v1/participants?${params.toString()}`,
		})
			.then((data) => {
				setAllParticipants(data);
			})
			.catch(() => {
				setAllParticipants([]);
			})
			.finally(() => {
				setParticipantsLoading(false);
			});
	}, []);

	useEffect(() => {
		loadGroup();
		loadMembers();
		loadParticipants();
	}, [loadGroup, loadMembers, loadParticipants]);

	const handleParticipantSearch = (value) => {
		setParticipantSearch(value);
		loadParticipants(value);
	};

	const toggleParticipantSelection = (participantId) => {
		setSelectedParticipants((prev) => {
			if (prev.includes(participantId)) {
				return prev.filter((id) => id !== participantId);
			}
			return [...prev, participantId];
		});
	};

	const handleAddMembers = () => {
		if (!groupId || selectedParticipants.length === 0) {
			return;
		}

		setIsAddingMembers(true);

		const promises = selectedParticipants.map((participantId) =>
			apiFetch({
				path: `/fair-audience/v1/groups/${groupId}/participants`,
				method: 'POST',
				data: { participant_id: participantId },
			}).catch((err) => {
				if (!err.message?.includes('already')) {
					throw err;
				}
			})
		);

		Promise.all(promises)
			.then(() => {
				setSelectedParticipants([]);
				loadMembers();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(__('Error: ', 'fair-audience') + err.message);
			})
			.finally(() => {
				setIsAddingMembers(false);
			});
	};

	const handleRemoveMember = (participantId) => {
		if (!groupId) {
			return;
		}

		// eslint-disable-next-line no-undef
		if (
			!confirm(
				__('Remove this participant from the group?', 'fair-audience')
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/groups/${groupId}/participants/${participantId}`,
			method: 'DELETE',
		})
			.then(() => {
				loadMembers();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(__('Error: ', 'fair-audience') + err.message);
			});
	};

	if (isLoading) {
		return (
			<div style={{ padding: '20px', textAlign: 'center' }}>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<p>
					<a href={groupsListUrl}>
						{__('← Back to Groups', 'fair-audience')}
					</a>
				</p>
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			</div>
		);
	}

	if (!group) {
		return null;
	}

	const memberIds = members.map((m) => m.id);
	const availableParticipants = allParticipants.filter(
		(p) => !memberIds.includes(p.id)
	);

	return (
		<div className="wrap">
			<p>
				<a href={groupsListUrl}>
					{__('← Back to Groups', 'fair-audience')}
				</a>
			</p>

			<h1>{group.name}</h1>
			{group.description && (
				<p style={{ color: '#666' }}>{group.description}</p>
			)}

			<Card style={{ marginBottom: '16px' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Members', 'fair-audience')} ({members.length})
					</h2>
				</CardHeader>
				<CardBody>
					{membersLoading ? (
						<Spinner />
					) : members.length === 0 ? (
						<p>
							{__('No members in this group.', 'fair-audience')}
						</p>
					) : (
						<table className="wp-list-table widefat striped">
							<thead>
								<tr>
									<th>{__('Name', 'fair-audience')}</th>
									<th>{__('Email', 'fair-audience')}</th>
									<th style={{ width: '120px' }}>
										{__('Actions', 'fair-audience')}
									</th>
								</tr>
							</thead>
							<tbody>
								{members.map((member) => {
									const detailUrl = `admin.php?page=fair-audience-participant-detail&participant_id=${member.id}`;
									const fullName = `${member.name || ''} ${
										member.surname || ''
									}`.trim();
									return (
										<tr key={member.id}>
											<td>
												<a href={detailUrl}>
													{fullName ||
														__(
															'(unnamed)',
															'fair-audience'
														)}
												</a>
											</td>
											<td>{member.email || '—'}</td>
											<td>
												<Button
													variant="link"
													isDestructive
													onClick={() =>
														handleRemoveMember(
															member.id
														)
													}
												>
													{__(
														'Remove',
														'fair-audience'
													)}
												</Button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					)}
				</CardBody>
			</Card>

			<Card>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Add Members', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					<SearchControl
						value={participantSearch}
						onChange={handleParticipantSearch}
						placeholder={__(
							'Search participants...',
							'fair-audience'
						)}
					/>

					<div
						style={{
							maxHeight: '320px',
							overflowY: 'auto',
							marginTop: '8px',
							marginBottom: '16px',
							padding: '4px',
						}}
					>
						{participantsLoading ? (
							<Spinner />
						) : availableParticipants.length === 0 ? (
							<p>
								{__(
									'No participants available to add.',
									'fair-audience'
								)}
							</p>
						) : (
							availableParticipants.map((participant) => (
								<CheckboxControl
									key={participant.id}
									label={`${participant.name || ''} ${
										participant.surname || ''
									}${
										participant.email
											? ` (${participant.email})`
											: ''
									}`.trim()}
									checked={selectedParticipants.includes(
										participant.id
									)}
									onChange={() =>
										toggleParticipantSelection(
											participant.id
										)
									}
								/>
							))
						)}
					</div>

					<Button
						variant="primary"
						onClick={handleAddMembers}
						disabled={
							selectedParticipants.length === 0 || isAddingMembers
						}
						isBusy={isAddingMembers}
					>
						{__('Add Selected', 'fair-audience')}
					</Button>
				</CardBody>
			</Card>
		</div>
	);
}
