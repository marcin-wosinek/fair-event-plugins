import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Modal,
	SelectControl,
	Spinner,
	CheckboxControl,
	ToggleControl,
	Card,
	CardHeader,
	CardBody,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import { dateI18n, getSettings } from '@wordpress/date';
import EmailSendResultNotice from '../components/EmailSendResultNotice.js';

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
	fields: ['name', 'role', 'photo_likes'],
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
	const [addSearch, setAddSearch] = useState('');
	const [addGroupFilter, setAddGroupFilter] = useState('');
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
	const [inviteMode, setInviteMode] = useState('groups'); // 'groups' or 'participants'
	const [selectedInviteParticipants, setSelectedInviteParticipants] =
		useState(new Set());
	const [inviteSearch, setInviteSearch] = useState('');
	const [gallerySendResult, setGallerySendResult] = useState(null);
	const [invitationSendResult, setInvitationSendResult] = useState(null);
	const [showGalleryPreviewModal, setShowGalleryPreviewModal] =
		useState(false);
	const [galleryPreviewParticipants, setGalleryPreviewParticipants] =
		useState([]);
	const [extraMessages, setExtraMessages] = useState([]);
	const [disabledExtraMessageIds, setDisabledExtraMessageIds] = useState(
		new Set()
	);
	const [isLoadingExtraMessages, setIsLoadingExtraMessages] = useState(false);

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
		apiFetch({
			path: `/fair-audience/v1/events/${eventId}/participants`,
		})
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

	// Filter available participants by search text and group.
	const filteredAvailableParticipants = useMemo(() => {
		let filtered = availableParticipants;

		if (addSearch.trim()) {
			const searchLower = addSearch.toLowerCase();
			filtered = filtered.filter(
				(p) =>
					(p.name && p.name.toLowerCase().includes(searchLower)) ||
					(p.surname &&
						p.surname.toLowerCase().includes(searchLower)) ||
					(p.email && p.email.toLowerCase().includes(searchLower))
			);
		}

		if (addGroupFilter) {
			const groupId = parseInt(addGroupFilter, 10);
			filtered = filtered.filter(
				(p) => p.groups && p.groups.some((g) => g.id === groupId)
			);
		}

		return filtered;
	}, [availableParticipants, addSearch, addGroupFilter]);

	const handleOpenAddModal = (label) => {
		setAddModalLabel(label);
		setSelectedToAdd(new Set());
		setAddSearch('');
		setAddGroupFilter('');
	};

	const handleCloseAddModal = () => {
		setAddModalLabel(null);
		setSelectedToAdd(new Set());
		setAddSearch('');
		setAddGroupFilter('');
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
		const filteredIds = filteredAvailableParticipants.map((p) => p.id);
		const allSelected = filteredIds.every((id) => selectedToAdd.has(id));
		if (allSelected) {
			const newSelected = new Set(selectedToAdd);
			filteredIds.forEach((id) => newSelected.delete(id));
			setSelectedToAdd(newSelected);
		} else {
			const newSelected = new Set(selectedToAdd);
			filteredIds.forEach((id) => newSelected.add(id));
			setSelectedToAdd(newSelected);
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

	const openGalleryPreviewModal = async (targetParticipants) => {
		setGalleryPreviewParticipants(targetParticipants);
		setDisabledExtraMessageIds(new Set());
		setIsLoadingExtraMessages(true);
		setShowGalleryPreviewModal(true);

		try {
			const messages = await apiFetch({
				path: '/fair-audience/v1/extra-messages',
			});
			setExtraMessages(messages.filter((m) => m.is_active));
		} catch {
			setExtraMessages([]);
		} finally {
			setIsLoadingExtraMessages(false);
		}
	};

	const handleSendGalleryLink = (items) => {
		openGalleryPreviewModal(items);
	};

	const handleSendGalleryLinkButton = () => {
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

		openGalleryPreviewModal(targetParticipants);
	};

	const handleConfirmGalleryLink = async () => {
		setIsSendingGalleryLinks(true);

		try {
			const participantIds = galleryPreviewParticipants.map(
				(p) => p.participant_id
			);

			const requestData = {
				participant_ids: participantIds,
				disabled_extra_message_ids: Array.from(disabledExtraMessageIds),
			};

			const response = await apiFetch({
				path: `/fair-audience/v1/events/${eventId}/gallery-invitations`,
				method: 'POST',
				data: requestData,
			});

			setGallerySendResult({
				sent_count: response.sent_count,
				failed: response.failed,
			});

			setShowGalleryPreviewModal(false);
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

	const handleToggleExtraMessage = (messageId) => {
		const newDisabled = new Set(disabledExtraMessageIds);
		if (newDisabled.has(messageId)) {
			newDisabled.delete(messageId);
		} else {
			newDisabled.add(messageId);
		}
		setDisabledExtraMessageIds(newDisabled);
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

	const handleToggleInviteParticipant = (participantId) => {
		const newSelected = new Set(selectedInviteParticipants);
		if (newSelected.has(participantId)) {
			newSelected.delete(participantId);
		} else {
			newSelected.add(participantId);
		}
		setSelectedInviteParticipants(newSelected);
	};

	// Filter participants for invitation modal based on search.
	const filteredInviteParticipants = useMemo(() => {
		if (!inviteSearch.trim()) {
			return allParticipants;
		}
		const searchLower = inviteSearch.toLowerCase();
		return allParticipants.filter(
			(p) =>
				(p.name && p.name.toLowerCase().includes(searchLower)) ||
				(p.surname && p.surname.toLowerCase().includes(searchLower)) ||
				(p.email && p.email.toLowerCase().includes(searchLower))
		);
	}, [allParticipants, inviteSearch]);

	const handleSendInvitations = async () => {
		const hasGroupSelection =
			inviteMode === 'groups' && selectedGroups.size > 0;
		const hasParticipantSelection =
			inviteMode === 'participants' &&
			selectedInviteParticipants.size > 0;

		if (!hasGroupSelection && !hasParticipantSelection) {
			return;
		}

		setIsSendingInvitations(true);

		try {
			const requestData =
				inviteMode === 'groups'
					? { group_ids: Array.from(selectedGroups) }
					: {
							participant_ids: Array.from(
								selectedInviteParticipants
							),
					  };

			const response = await apiFetch({
				path: `/fair-audience/v1/events/${eventId}/event-invitations`,
				method: 'POST',
				data: requestData,
			});

			setInvitationSendResult({
				sent_count: response.sent_count,
				failed: response.failed,
				skipped_count: response.skipped_count,
			});

			setShowInvitationModal(false);
			setSelectedGroups(new Set());
			setSelectedInviteParticipants(new Set());
			setInviteSearch('');
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
	const formatLabel = (label) => {
		switch (label) {
			case 'signed_up':
				return __('Signed Up', 'fair-audience');
			case 'collaborator':
				return __('Collaborator', 'fair-audience');
			case 'interested':
				return __('Interested', 'fair-audience');
			default:
				return label || '';
		}
	};

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
				id: 'role',
				label: __('Role', 'fair-audience'),
				render: ({ item }) => formatLabel(item.label),
				enableSorting: true,
				getValue: ({ item }) => item.label || '',
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

			<EmailSendResultNotice
				result={gallerySendResult}
				onDismiss={() => setGallerySendResult(null)}
			/>
			<EmailSendResultNotice
				result={invitationSendResult}
				onDismiss={() => setInvitationSendResult(null)}
			/>

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
						<div>
							<h2 style={{ margin: 0 }}>
								{eventInfo?.title ||
									__('Event Participants', 'fair-audience')}
							</h2>
							<div
								style={{
									display: 'flex',
									gap: '12px',
									marginTop: '4px',
								}}
							>
								{eventInfo?.edit_url && (
									<a href={eventInfo.edit_url}>
										{__('Edit Article', 'fair-audience')}
									</a>
								)}
								{eventInfo?.manage_event_url && (
									<a href={eventInfo.manage_event_url}>
										{__('Manage Event', 'fair-audience')}
									</a>
								)}
							</div>
						</div>
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
									display: 'flex',
									gap: '10px',
									marginBottom: '10px',
								}}
							>
								<input
									type="text"
									placeholder={__(
										'Search by name or email...',
										'fair-audience'
									)}
									value={addSearch}
									onChange={(e) =>
										setAddSearch(e.target.value)
									}
									style={{
										flex: 1,
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
									}}
								/>
								{groups.length > 0 && (
									<SelectControl
										value={addGroupFilter}
										options={[
											{
												label: __(
													'All groups',
													'fair-audience'
												),
												value: '',
											},
											...groups.map((g) => ({
												label: g.name,
												value: String(g.id),
											})),
										]}
										onChange={setAddGroupFilter}
										__nextHasNoMarginBottom
									/>
								)}
							</div>

							<div
								style={{
									marginBottom: '10px',
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
								}}
							>
								<span
									style={{
										fontSize: '12px',
										color: '#666',
									}}
								>
									{selectedToAdd.size > 0
										? sprintf(
												/* translators: 1: selected count, 2: shown count */
												__(
													'%1$d selected, %2$d shown',
													'fair-audience'
												),
												selectedToAdd.size,
												filteredAvailableParticipants.length
										  )
										: sprintf(
												/* translators: %d: number of available participants */
												__(
													'%d participant(s) available',
													'fair-audience'
												),
												filteredAvailableParticipants.length
										  )}
								</span>
								<Button
									variant="secondary"
									isSmall
									onClick={handleSelectAllToAdd}
								>
									{filteredAvailableParticipants.length > 0 &&
									filteredAvailableParticipants.every((p) =>
										selectedToAdd.has(p.id)
									)
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
								{filteredAvailableParticipants.map((p) => (
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
								{filteredAvailableParticipants.length === 0 && (
									<p
										style={{
											padding: '15px',
											color: '#666',
										}}
									>
										{__(
											'No participants match your search.',
											'fair-audience'
										)}
									</p>
								)}
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

			{showGalleryPreviewModal && (
				<Modal
					title={__('Send Gallery Invitations', 'fair-audience')}
					onRequestClose={() => setShowGalleryPreviewModal(false)}
					style={{ maxWidth: '600px', width: '100%' }}
				>
					<p>
						{sprintf(
							/* translators: %d: number of participants */
							__('Send to %d participant(s)', 'fair-audience'),
							galleryPreviewParticipants.length
						)}
					</p>

					<div
						style={{
							border: '1px solid #ddd',
							borderRadius: '8px',
							overflow: 'hidden',
							marginBottom: '20px',
							boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
						}}
					>
						<div
							style={{
								backgroundColor: '#0073aa',
								color: '#fff',
								padding: '20px',
								textAlign: 'center',
								fontSize: '18px',
								fontWeight: 'bold',
							}}
						>
							{eventInfo?.title || ''}
						</div>
						<div style={{ padding: '25px 20px' }}>
							<p
								style={{
									margin: '0 0 15px 0',
									fontSize: '14px',
								}}
							>
								{sprintf(
									/* translators: %s: participant name placeholder */
									__('Hi %s,', 'fair-audience'),
									'(...)'
								)}
							</p>
							<p
								style={{
									margin: '0 0 15px 0',
									fontSize: '14px',
								}}
							>
								{sprintf(
									/* translators: %s: event title */
									__(
										'The photos from %s are now available for you to view and like!',
										'fair-audience'
									),
									eventInfo?.title || ''
								)}
							</p>
							<p
								style={{
									margin: '0 0 15px 0',
									fontSize: '14px',
								}}
							>
								{__(
									'Click the button below to browse the gallery and let us know which photos you like best:',
									'fair-audience'
								)}
							</p>
							<p
								style={{
									textAlign: 'center',
									margin: '0 0 20px 0',
								}}
							>
								<span
									style={{
										display: 'inline-block',
										backgroundColor: '#0073aa',
										color: '#fff',
										padding: '10px 24px',
										borderRadius: '5px',
										fontWeight: 'bold',
										fontSize: '14px',
									}}
								>
									{__('View Gallery', 'fair-audience')}
								</span>
							</p>

							{isLoadingExtraMessages ? (
								<Spinner />
							) : (
								extraMessages.map((msg) => (
									<div
										key={msg.id}
										style={{
											marginBottom: '12px',
											padding: '10px',
											border: '1px solid #e0e0e0',
											borderRadius: '4px',
											opacity:
												disabledExtraMessageIds.has(
													msg.id
												)
													? 0.4
													: 1,
										}}
									>
										<div
											style={{
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'space-between',
												marginBottom: '6px',
											}}
										>
											<ToggleControl
												label={
													msg.category_name
														? msg.category_name
														: __(
																'All categories',
																'fair-audience'
														  )
												}
												checked={
													!disabledExtraMessageIds.has(
														msg.id
													)
												}
												onChange={() =>
													handleToggleExtraMessage(
														msg.id
													)
												}
												__nextHasNoMarginBottom
											/>
										</div>
										<div
											style={{
												fontSize: '13px',
												color: '#555',
											}}
											dangerouslySetInnerHTML={{
												__html: msg.content,
											}}
										/>
									</div>
								))
							)}
						</div>
					</div>

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '10px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => setShowGalleryPreviewModal(false)}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleConfirmGalleryLink}
							disabled={isSendingGalleryLinks}
						>
							{isSendingGalleryLinks
								? __('Sending...', 'fair-audience')
								: sprintf(
										/* translators: %d: number of participants */
										__(
											'Send to %d Participant(s)',
											'fair-audience'
										),
										galleryPreviewParticipants.length
								  )}
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
						setSelectedInviteParticipants(new Set());
						setInviteSearch('');
					}}
					style={{ maxWidth: '600px', width: '100%' }}
				>
					<p style={{ fontSize: '12px', color: '#666' }}>
						{__(
							'Participants already signed up or who opted out of marketing emails will be skipped.',
							'fair-audience'
						)}
					</p>

					<div
						style={{
							display: 'flex',
							gap: '0',
							marginBottom: '15px',
							borderBottom: '1px solid #ddd',
						}}
					>
						<button
							type="button"
							onClick={() => setInviteMode('groups')}
							style={{
								padding: '10px 20px',
								border: 'none',
								background:
									inviteMode === 'groups'
										? '#fff'
										: '#f0f0f0',
								borderBottom:
									inviteMode === 'groups'
										? '2px solid #007cba'
										: '2px solid transparent',
								cursor: 'pointer',
								fontWeight:
									inviteMode === 'groups' ? '600' : '400',
							}}
						>
							{__('By Group', 'fair-audience')}
						</button>
						<button
							type="button"
							onClick={() => setInviteMode('participants')}
							style={{
								padding: '10px 20px',
								border: 'none',
								background:
									inviteMode === 'participants'
										? '#fff'
										: '#f0f0f0',
								borderBottom:
									inviteMode === 'participants'
										? '2px solid #007cba'
										: '2px solid transparent',
								cursor: 'pointer',
								fontWeight:
									inviteMode === 'participants'
										? '600'
										: '400',
							}}
						>
							{__('By Participant', 'fair-audience')}
						</button>
					</div>

					{inviteMode === 'groups' && (
						<>
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
												checked={selectedGroups.has(
													group.id
												)}
												onChange={() =>
													handleToggleGroup(group.id)
												}
											/>
										</div>
									))}
								</div>
							)}
						</>
					)}

					{inviteMode === 'participants' && (
						<>
							<input
								type="text"
								placeholder={__(
									'Search by name or email...',
									'fair-audience'
								)}
								value={inviteSearch}
								onChange={(e) =>
									setInviteSearch(e.target.value)
								}
								style={{
									width: '100%',
									padding: '8px 12px',
									marginBottom: '10px',
									border: '1px solid #ddd',
									borderRadius: '4px',
								}}
							/>
							<div
								style={{
									marginBottom: '10px',
									fontSize: '12px',
									color: '#666',
								}}
							>
								{sprintf(
									/* translators: 1: selected count, 2: total count */
									__(
										'%1$d selected of %2$d participants',
										'fair-audience'
									),
									selectedInviteParticipants.size,
									allParticipants.length
								)}
							</div>
							{allParticipants.length === 0 ? (
								<p>
									{__(
										'No participants available.',
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
									{filteredInviteParticipants.map((p) => (
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
												checked={selectedInviteParticipants.has(
													p.id
												)}
												onChange={() =>
													handleToggleInviteParticipant(
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
									{filteredInviteParticipants.length ===
										0 && (
										<p
											style={{
												padding: '15px',
												color: '#666',
											}}
										>
											{__(
												'No participants match your search.',
												'fair-audience'
											)}
										</p>
									)}
								</div>
							)}
						</>
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
								setSelectedInviteParticipants(new Set());
								setInviteSearch('');
							}}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleSendInvitations}
							disabled={
								(inviteMode === 'groups' &&
									selectedGroups.size === 0) ||
								(inviteMode === 'participants' &&
									selectedInviteParticipants.size === 0) ||
								isSendingInvitations
							}
						>
							{isSendingInvitations
								? __('Sending...', 'fair-audience')
								: inviteMode === 'participants' &&
								  selectedInviteParticipants.size > 0
								? sprintf(
										/* translators: %d: number of selected participants */
										__(
											'Send to %d Selected',
											'fair-audience'
										),
										selectedInviteParticipants.size
								  )
								: __('Send Invitations', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}
