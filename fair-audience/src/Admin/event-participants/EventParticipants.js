import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Modal,
	SelectControl,
	Spinner,
	CheckboxControl,
	Card,
	CardHeader,
	CardBody,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import { dateI18n, getSettings } from '@wordpress/date';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'participant_name',
		direction: 'asc',
	},
	search: '',
	filters: [],
	fields: ['name', 'photo_likes'],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function EventParticipants() {
	const [participants, setParticipants] = useState([]);
	const [allParticipants, setAllParticipants] = useState([]);
	const [eventInfo, setEventInfo] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [addModalLabel, setAddModalLabel] = useState(null);
	const [selectedToAdd, setSelectedToAdd] = useState(new Set());
	const [isAdding, setIsAdding] = useState(false);
	const [isRemoving, setIsRemoving] = useState(false);
	const [isSendingGalleryLinks, setIsSendingGalleryLinks] = useState(false);
	const [view, setView] = useState(DEFAULT_VIEW);
	const [selection, setSelection] = useState([]);
	const [editModalOpen, setEditModalOpen] = useState(false);
	const [editingParticipant, setEditingParticipant] = useState(null);
	const [editLabel, setEditLabel] = useState('');
	const [showInvitationModal, setShowInvitationModal] = useState(false);
	const [groups, setGroups] = useState([]);
	const [selectedGroups, setSelectedGroups] = useState(new Set());
	const [isSendingInvitations, setIsSendingInvitations] = useState(false);

	const eventId = new URLSearchParams(window.location.search).get('event_id');

	useEffect(() => {
		if (!eventId) {
			setError(__('No event ID provided', 'fair-audience'));
			setIsLoading(false);
			return;
		}

		loadEventInfo();
		loadParticipants();
		loadAllParticipants();
		loadGroups();
	}, [eventId]);

	const loadEventInfo = () => {
		apiFetch({
			path: `/fair-audience/v1/events/${eventId}`,
		})
			.then((data) => {
				setEventInfo(data);
			})
			.catch((err) => {
				// Fallback: try to get event title from WP REST API.
				apiFetch({ path: `/wp/v2/fair_event/${eventId}` })
					.then((event) => {
						setEventInfo({
							event_id: eventId,
							title: event.title.rendered,
							event_date: null,
							gallery_count: 0,
							gallery_link: `upload.php?event_id=${eventId}`,
							signed_up: 0,
							collaborators: 0,
						});
					})
					.catch(() => {
						// eslint-disable-next-line no-console
						console.error('Error loading event info:', err);
					});
			});
	};

	const loadParticipants = () => {
		apiFetch({ path: `/fair-audience/v1/events/${eventId}/participants` })
			.then((data) => {
				setParticipants(data);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err.message);
				setIsLoading(false);
			});
	};

	const loadAllParticipants = () => {
		apiFetch({ path: '/fair-audience/v1/participants' })
			.then((data) => {
				setAllParticipants(data);
			})
			.catch(() => {});
	};

	const loadGroups = () => {
		apiFetch({ path: '/fair-audience/v1/groups' })
			.then((data) => {
				setGroups(data);
			})
			.catch(() => {});
	};

	// Get participants not already in this event.
	const availableParticipants = useMemo(() => {
		const existingIds = new Set(participants.map((p) => p.participant_id));
		return allParticipants.filter((p) => !existingIds.has(p.id));
	}, [allParticipants, participants]);

	const handleOpenAddModal = (label) => {
		setAddModalLabel(label);
		setSelectedToAdd(new Set());
	};

	const handleCloseAddModal = () => {
		setAddModalLabel(null);
		setSelectedToAdd(new Set());
	};

	const handleToggleParticipantToAdd = (participantId) => {
		const newSelected = new Set(selectedToAdd);
		if (newSelected.has(participantId)) {
			newSelected.delete(participantId);
		} else {
			newSelected.add(participantId);
		}
		setSelectedToAdd(newSelected);
	};

	const handleSelectAllToAdd = () => {
		if (selectedToAdd.size === availableParticipants.length) {
			setSelectedToAdd(new Set());
		} else {
			setSelectedToAdd(new Set(availableParticipants.map((p) => p.id)));
		}
	};

	const handleBatchAdd = async () => {
		if (selectedToAdd.size === 0 || !addModalLabel) {
			return;
		}

		setIsAdding(true);

		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/events/${eventId}/participants/batch`,
				method: 'POST',
				data: {
					participant_ids: Array.from(selectedToAdd),
					label: addModalLabel,
				},
			});

			if (response.added > 0) {
				alert(
					sprintf(
						/* translators: %d: number of participants */
						__(
							'Successfully added %d participant(s)',
							'fair-audience'
						),
						response.added
					)
				);
			}

			handleCloseAddModal();
			loadParticipants();
			loadEventInfo();
		} catch (err) {
			alert(
				__('Error adding participants: ', 'fair-audience') + err.message
			);
		} finally {
			setIsAdding(false);
		}
	};

	const handleUpdateLabel = async (participantId, newLabel) => {
		try {
			await apiFetch({
				path: `/fair-audience/v1/events/${eventId}/participants/${participantId}`,
				method: 'PUT',
				data: { label: newLabel },
			});
			loadParticipants();
			loadEventInfo();
			setEditModalOpen(false);
			setEditingParticipant(null);
		} catch (err) {
			alert(__('Error: ', 'fair-audience') + err.message);
		}
	};

	const handleRemove = async (items) => {
		const participantIds = items.map((item) => item.participant_id);
		const count = participantIds.length;

		if (
			!confirm(
				sprintf(
					/* translators: %d: number of participants */
					__(
						'Remove %d participant(s) from this event?',
						'fair-audience'
					),
					count
				)
			)
		) {
			return;
		}

		setIsRemoving(true);

		try {
			if (count === 1) {
				await apiFetch({
					path: `/fair-audience/v1/events/${eventId}/participants/${participantIds[0]}`,
					method: 'DELETE',
				});
			} else {
				await apiFetch({
					path: `/fair-audience/v1/events/${eventId}/participants/batch`,
					method: 'DELETE',
					data: {
						participant_ids: participantIds,
					},
				});
			}

			loadParticipants();
			loadEventInfo();
		} catch (err) {
			alert(__('Error: ', 'fair-audience') + err.message);
		} finally {
			setIsRemoving(false);
		}
	};

	const handleSendGalleryLink = async (items) => {
		const participantIds = items.map((item) => item.participant_id);
		const count = participantIds.length;

		const confirmed = window.confirm(
			sprintf(
				/* translators: %d: number of participants */
				__(
					'Send gallery links to %d participant(s)? They will receive an email with a unique link to view and like photos.',
					'fair-audience'
				),
				count
			)
		);

		if (!confirmed) {
			return;
		}

		setIsSendingGalleryLinks(true);

		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/events/${eventId}/gallery-invitations`,
				method: 'POST',
				data: { participant_ids: participantIds },
			});

			if (response.sent_count > 0) {
				alert(
					sprintf(
						/* translators: %d: number of emails sent */
						__(
							'Successfully sent gallery links to %d participant(s)!',
							'fair-audience'
						),
						response.sent_count
					)
				);
			}

			if (response.failed && response.failed.length > 0) {
				// eslint-disable-next-line no-console
				console.error('Failed to send to:', response.failed);
				alert(
					sprintf(
						/* translators: %d: number of failed sends */
						__(
							'Failed to send to %d participant(s). Check console for details.',
							'fair-audience'
						),
						response.failed.length
					)
				);
			}
		} catch (err) {
			alert(
				__('Error sending gallery links: ', 'fair-audience') +
					err.message
			);
		} finally {
			setIsSendingGalleryLinks(false);
		}
	};

	const handleSendGalleryLinkButton = async () => {
		// If some participants are selected, send to them; otherwise send to all.
		const targetParticipants =
			selection.length > 0
				? participants.filter((p) =>
						selection.includes(p.participant_id)
					)
				: participants;

		if (targetParticipants.length === 0) {
			alert(
				__('No participants to send gallery links to.', 'fair-audience')
			);
			return;
		}

		const confirmed = window.confirm(
			sprintf(
				/* translators: %d: number of participants */
				__(
					'Send gallery links to %d participant(s)? They will receive an email with a unique link to view and like photos.',
					'fair-audience'
				),
				targetParticipants.length
			)
		);

		if (!confirmed) {
			return;
		}

		setIsSendingGalleryLinks(true);

		try {
			const requestData =
				selection.length > 0
					? {
							participant_ids: targetParticipants.map(
								(p) => p.participant_id
							),
						}
					: {};

			const response = await apiFetch({
				path: `/fair-audience/v1/events/${eventId}/gallery-invitations`,
				method: 'POST',
				data: requestData,
			});

			if (response.sent_count > 0) {
				alert(
					sprintf(
						/* translators: %d: number of emails sent */
						__(
							'Successfully sent gallery links to %d participant(s)!',
							'fair-audience'
						),
						response.sent_count
					)
				);
			}

			if (response.failed && response.failed.length > 0) {
				// eslint-disable-next-line no-console
				console.error('Failed to send to:', response.failed);
				alert(
					sprintf(
						/* translators: %d: number of failed sends */
						__(
							'Failed to send to %d participant(s). Check console for details.',
							'fair-audience'
						),
						response.failed.length
					)
				);
			}

			// Clear selection after sending.
			setSelection([]);
		} catch (err) {
			alert(
				__('Error sending gallery links: ', 'fair-audience') +
					err.message
			);
		} finally {
			setIsSendingGalleryLinks(false);
		}
	};

	const handleOpenEditModal = (item) => {
		setEditingParticipant(item);
		setEditLabel(item.label);
		setEditModalOpen(true);
	};

	const handleCloseEditModal = () => {
		setEditModalOpen(false);
		setEditingParticipant(null);
		setEditLabel('');
	};

	const handleSaveEdit = () => {
		if (editingParticipant && editLabel) {
			handleUpdateLabel(editingParticipant.participant_id, editLabel);
		}
	};

	const handleToggleGroup = (groupId) => {
		const newSelected = new Set(selectedGroups);
		if (newSelected.has(groupId)) {
			newSelected.delete(groupId);
		} else {
			newSelected.add(groupId);
		}
		setSelectedGroups(newSelected);
	};

	const handleSendInvitations = async () => {
		if (selectedGroups.size === 0) {
			return;
		}

		setIsSendingInvitations(true);

		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/events/${eventId}/event-invitations`,
				method: 'POST',
				data: {
					group_ids: Array.from(selectedGroups),
				},
			});

			let message = sprintf(
				/* translators: %d: number of emails sent */
				__(
					'Successfully sent invitations to %d participant(s)!',
					'fair-audience'
				),
				response.sent_count
			);

			if (response.skipped_count > 0) {
				message +=
					' ' +
					sprintf(
						/* translators: %d: number of skipped participants */
						__('%d already signed up (skipped).', 'fair-audience'),
						response.skipped_count
					);
			}

			alert(message);

			if (response.failed && response.failed.length > 0) {
				// eslint-disable-next-line no-console
				console.error('Failed to send to:', response.failed);
				alert(
					sprintf(
						/* translators: %d: number of failed sends */
						__(
							'Failed to send to %d participant(s). Check console for details.',
							'fair-audience'
						),
						response.failed.length
					)
				);
			}

			setShowInvitationModal(false);
			setSelectedGroups(new Set());
		} catch (err) {
			alert(
				__('Error sending invitations: ', 'fair-audience') + err.message
			);
		} finally {
			setIsSendingInvitations(false);
		}
	};

	const getLabelTitle = (label) => {
		switch (label) {
			case 'collaborator':
				return __('Add Collaborators', 'fair-audience');
			case 'interested':
				return __('Add Interested', 'fair-audience');
			case 'signed_up':
				return __('Add Participants', 'fair-audience');
			default:
				return __('Add', 'fair-audience');
		}
	};

	// Define fields for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'name',
				label: __('Name', 'fair-audience'),
				render: ({ item }) => item.participant_name,
				enableSorting: true,
				enableHiding: false,
				getValue: ({ item }) =>
					item.participant_name?.toLowerCase() || '',
			},
			{
				id: 'photo_likes',
				label: __('Photo Likes', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.photo_likes_received || 0}
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.photo_likes_received || 0,
			},
		],
		[]
	);

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'send_gallery',
				label: __('Send Photo Link', 'fair-audience'),
				callback: handleSendGalleryLink,
				supportsBulk: true,
			},
			{
				id: 'edit',
				label: __('Edit', 'fair-audience'),
				callback: ([item]) => handleOpenEditModal(item),
			},
			{
				id: 'remove',
				label: __('Remove', 'fair-audience'),
				isDestructive: true,
				callback: handleRemove,
				supportsBulk: true,
			},
		],
		[eventId]
	);

	// Pagination info for DataViews (client-side pagination).
	const paginationInfo = useMemo(
		() => ({
			totalItems: participants.length,
			totalPages: Math.ceil(participants.length / view.perPage) || 1,
		}),
		[participants.length, view.perPage]
	);

	// Get date format.
	const { formats } = getSettings();

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('Event Participants', 'fair-audience')}</h1>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('Event Participants', 'fair-audience')}</h1>
				<div className="notice notice-error">
					<p>{__('Error: ', 'fair-audience') + error}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Event Participants', 'fair-audience')}</h1>

			<Card>
				<CardHeader>
					<div
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							width: '100%',
							flexWrap: 'wrap',
							gap: '10px',
						}}
					>
						<h2 style={{ margin: 0 }}>
							{eventInfo?.title ||
								__('Event Participants', 'fair-audience')}
						</h2>
						{eventInfo && (
							<div
								style={{
									display: 'flex',
									gap: '24px',
									alignItems: 'center',
									flexWrap: 'wrap',
								}}
							>
								<span>
									{__('Date:', 'fair-audience')}{' '}
									{eventInfo.event_date
										? dateI18n(
												formats.datetime,
												eventInfo.event_date
											)
										: '—'}
								</span>
								<span>
									<a href={eventInfo.gallery_link}>
										{sprintf(
											/* translators: %d: number of photos */
											__('%d Photos', 'fair-audience'),
											eventInfo.gallery_count || 0
										)}
									</a>
								</span>
								<span>
									{sprintf(
										/* translators: %d: number of signed up participants */
										__('%d Signed Up', 'fair-audience'),
										eventInfo.signed_up || 0
									)}
								</span>
								<span>
									{sprintf(
										/* translators: %d: number of collaborators */
										__('%d Collaborators', 'fair-audience'),
										eventInfo.collaborators || 0
									)}
								</span>
							</div>
						)}
					</div>
				</CardHeader>
				<CardBody>
					<div
						style={{
							display: 'flex',
							gap: '10px',
							marginBottom: '15px',
							flexWrap: 'wrap',
						}}
					>
						<Button
							isPrimary
							onClick={() => handleOpenAddModal('signed_up')}
						>
							{__('Add Participants', 'fair-audience')}
						</Button>
						<Button
							variant="secondary"
							onClick={() => handleOpenAddModal('collaborator')}
						>
							{__('Add Collaborators', 'fair-audience')}
						</Button>
						<Button
							variant="secondary"
							onClick={() => handleOpenAddModal('interested')}
						>
							{__('Add Interested', 'fair-audience')}
						</Button>
						<Button
							variant="secondary"
							onClick={() => setShowInvitationModal(true)}
						>
							{__('Send Invitation', 'fair-audience')}
						</Button>
					</div>

					<DataViews
						data={participants}
						fields={fields}
						view={view}
						onChangeView={setView}
						actions={actions}
						paginationInfo={paginationInfo}
						defaultLayouts={DEFAULT_LAYOUTS}
						isLoading={isLoading || isRemoving}
						getItemId={(item) => item.participant_id}
						selection={selection}
						onChangeSelection={setSelection}
					/>

					<div style={{ marginTop: '15px' }}>
						<Button
							variant="secondary"
							onClick={handleSendGalleryLinkButton}
							disabled={
								isSendingGalleryLinks ||
								participants.length === 0
							}
						>
							{isSendingGalleryLinks
								? __('Sending...', 'fair-audience')
								: selection.length > 0
									? sprintf(
											/* translators: %d: number of selected participants */
											__(
												'Send Gallery Link to %d Selected',
												'fair-audience'
											),
											selection.length
										)
									: __(
											'Send Gallery Link to All',
											'fair-audience'
										)}
						</Button>
					</div>
				</CardBody>
			</Card>

			{addModalLabel && (
				<Modal
					title={getLabelTitle(addModalLabel)}
					onRequestClose={handleCloseAddModal}
					style={{ maxWidth: '600px', width: '100%' }}
				>
					{availableParticipants.length === 0 ? (
						<p>
							{__(
								'All participants are already added to this event.',
								'fair-audience'
							)}
						</p>
					) : (
						<>
							<div
								style={{
									marginBottom: '15px',
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
								}}
							>
								<span>
									{sprintf(
										/* translators: %d: number of available participants */
										__(
											'%d participant(s) available',
											'fair-audience'
										),
										availableParticipants.length
									)}
								</span>
								<Button
									variant="secondary"
									isSmall
									onClick={handleSelectAllToAdd}
								>
									{selectedToAdd.size ===
									availableParticipants.length
										? __('Deselect All', 'fair-audience')
										: __('Select All', 'fair-audience')}
								</Button>
							</div>

							<div
								style={{
									maxHeight: '400px',
									overflowY: 'auto',
									border: '1px solid #ddd',
									borderRadius: '4px',
								}}
							>
								{availableParticipants.map((p) => (
									<div
										key={p.id}
										style={{
											padding: '10px 15px',
											borderBottom: '1px solid #eee',
											display: 'flex',
											alignItems: 'center',
											gap: '10px',
										}}
									>
										<CheckboxControl
											checked={selectedToAdd.has(p.id)}
											onChange={() =>
												handleToggleParticipantToAdd(
													p.id
												)
											}
										/>
										<div>
											<strong>
												{p.name} {p.surname}
											</strong>
											<br />
											<span
												style={{
													color: '#666',
													fontSize: '12px',
												}}
											>
												{p.email}
											</span>
										</div>
									</div>
								))}
							</div>

							<div
								style={{
									marginTop: '20px',
									display: 'flex',
									justifyContent: 'flex-end',
									gap: '10px',
								}}
							>
								<Button
									variant="secondary"
									onClick={handleCloseAddModal}
								>
									{__('Cancel', 'fair-audience')}
								</Button>
								<Button
									isPrimary
									onClick={handleBatchAdd}
									disabled={
										selectedToAdd.size === 0 || isAdding
									}
								>
									{isAdding
										? __('Adding...', 'fair-audience')
										: sprintf(
												/* translators: %d: number of selected participants */
												__(
													'Add %d Selected',
													'fair-audience'
												),
												selectedToAdd.size
											)}
								</Button>
							</div>
						</>
					)}
				</Modal>
			)}

			{editModalOpen && editingParticipant && (
				<Modal
					title={__('Edit Participant', 'fair-audience')}
					onRequestClose={handleCloseEditModal}
				>
					<p>
						<strong>{editingParticipant.participant_name}</strong>
					</p>
					<SelectControl
						label={__('Label', 'fair-audience')}
						value={editLabel}
						options={[
							{
								label: __('Interested', 'fair-audience'),
								value: 'interested',
							},
							{
								label: __('Signed Up', 'fair-audience'),
								value: 'signed_up',
							},
							{
								label: __('Collaborator', 'fair-audience'),
								value: 'collaborator',
							},
						]}
						onChange={(value) => setEditLabel(value)}
					/>
					<div
						style={{
							marginTop: '20px',
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '10px',
						}}
					>
						<Button
							variant="secondary"
							onClick={handleCloseEditModal}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button isPrimary onClick={handleSaveEdit}>
							{__('Save', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}

			{showInvitationModal && (
				<Modal
					title={__('Send Event Invitations', 'fair-audience')}
					onRequestClose={() => {
						setShowInvitationModal(false);
						setSelectedGroups(new Set());
					}}
					style={{ maxWidth: '500px', width: '100%' }}
				>
					<p>{__('Select groups to invite:', 'fair-audience')}</p>
					<p style={{ fontSize: '12px', color: '#666' }}>
						{__(
							'Participants already signed up will be skipped.',
							'fair-audience'
						)}
					</p>

					{groups.length === 0 ? (
						<p>
							{__(
								'No groups available. Create groups first.',
								'fair-audience'
							)}
						</p>
					) : (
						<div
							style={{
								maxHeight: '300px',
								overflow: 'auto',
								marginBottom: '15px',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						>
							{groups.map((group) => (
								<div
									key={group.id}
									style={{
										padding: '10px 15px',
										borderBottom: '1px solid #eee',
										display: 'flex',
										alignItems: 'center',
										gap: '10px',
									}}
								>
									<CheckboxControl
										label={sprintf(
											/* translators: 1: group name, 2: member count */
											__(
												'%1$s (%2$d members)',
												'fair-audience'
											),
											group.name,
											group.member_count || 0
										)}
										checked={selectedGroups.has(group.id)}
										onChange={() =>
											handleToggleGroup(group.id)
										}
									/>
								</div>
							))}
						</div>
					)}

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '10px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => {
								setShowInvitationModal(false);
								setSelectedGroups(new Set());
							}}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleSendInvitations}
							disabled={
								selectedGroups.size === 0 ||
								isSendingInvitations
							}
						>
							{isSendingInvitations
								? __('Sending...', 'fair-audience')
								: __('Send Invitations', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}
