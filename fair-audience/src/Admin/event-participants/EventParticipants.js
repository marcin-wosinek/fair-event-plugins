import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Modal,
	SelectControl,
	Spinner,
	CheckboxControl,
} from '@wordpress/components';

export default function EventParticipants() {
	const [participants, setParticipants] = useState([]);
	const [allParticipants, setAllParticipants] = useState([]);
	const [eventTitle, setEventTitle] = useState('');
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [addModalLabel, setAddModalLabel] = useState(null);
	const [selectedToAdd, setSelectedToAdd] = useState(new Set());
	const [isAdding, setIsAdding] = useState(false);
	const [selectedParticipants, setSelectedParticipants] = useState(new Set());
	const [isRemoving, setIsRemoving] = useState(false);
	const [isSendingGalleryLinks, setIsSendingGalleryLinks] = useState(false);
	const [galleryStats, setGalleryStats] = useState(null);

	const eventId = new URLSearchParams(window.location.search).get('event_id');

	useEffect(() => {
		if (!eventId) {
			setError(__('No event ID provided', 'fair-audience'));
			setIsLoading(false);
			return;
		}

		loadParticipants();
		loadAllParticipants();
		loadGalleryStats();
	}, [eventId]);

	const loadGalleryStats = () => {
		apiFetch({
			path: `/fair-audience/v1/events/${eventId}/gallery-invitations/stats`,
		})
			.then((data) => {
				setGalleryStats(data);
			})
			.catch(() => {
				// Stats endpoint might not exist if no invitations sent yet.
				setGalleryStats({ total: 0, sent: 0, not_sent: 0 });
			});
	};

	const loadParticipants = () => {
		apiFetch({ path: `/fair-audience/v1/events/${eventId}/participants` })
			.then((data) => {
				setParticipants(data);
				// Get event title.
				apiFetch({ path: `/wp/v2/fair_event/${eventId}` })
					.then((event) => {
						setEventTitle(event.title.rendered);
					})
					.catch(() => {});
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
		} catch (err) {
			alert(
				__('Error adding participants: ', 'fair-audience') + err.message
			);
		} finally {
			setIsAdding(false);
		}
	};

	const handleUpdateLabel = (participantId, newLabel) => {
		apiFetch({
			path: `/fair-audience/v1/events/${eventId}/participants/${participantId}`,
			method: 'PUT',
			data: { label: newLabel },
		})
			.then(() => {
				loadParticipants();
			})
			.catch((err) => {
				alert(__('Error: ', 'fair-audience') + err.message);
			});
	};

	const handleRemove = (participantId) => {
		if (
			!confirm(
				__('Remove this participant from the event?', 'fair-audience')
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/events/${eventId}/participants/${participantId}`,
			method: 'DELETE',
		})
			.then(() => {
				loadParticipants();
			})
			.catch((err) => {
				alert(__('Error: ', 'fair-audience') + err.message);
			});
	};

	const handleSelectParticipant = (participantId) => {
		const newSelected = new Set(selectedParticipants);
		if (newSelected.has(participantId)) {
			newSelected.delete(participantId);
		} else {
			newSelected.add(participantId);
		}
		setSelectedParticipants(newSelected);
	};

	const handleSelectAll = () => {
		if (selectedParticipants.size === participants.length) {
			setSelectedParticipants(new Set());
		} else {
			setSelectedParticipants(
				new Set(participants.map((p) => p.participant_id))
			);
		}
	};

	const allSelected =
		participants.length > 0 &&
		selectedParticipants.size === participants.length;

	const handleBatchRemove = async () => {
		if (selectedParticipants.size === 0) {
			return;
		}

		const confirmed = window.confirm(
			sprintf(
				/* translators: %d: number of participants */
				__(
					'Are you sure you want to remove %d participant(s) from this event?',
					'fair-audience'
				),
				selectedParticipants.size
			)
		);

		if (!confirmed) {
			return;
		}

		setIsRemoving(true);

		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/events/${eventId}/participants/batch`,
				method: 'DELETE',
				data: {
					participant_ids: Array.from(selectedParticipants),
				},
			});

			if (response.removed > 0) {
				alert(
					sprintf(
						/* translators: %d: number of participants */
						__(
							'Successfully removed %d participant(s)',
							'fair-audience'
						),
						response.removed
					)
				);
			}

			if (response.failed > 0) {
				alert(
					sprintf(
						/* translators: %d: number of failed removals */
						__(
							'Failed to remove %d participant(s). See console for details.',
							'fair-audience'
						),
						response.failed
					)
				);
				console.error('Batch removal errors:', response.errors);
			}

			setSelectedParticipants(new Set());
			loadParticipants();
		} catch (err) {
			alert(
				__('Error removing participants: ', 'fair-audience') +
					err.message
			);
		} finally {
			setIsRemoving(false);
		}
	};

	const handleSendGalleryLinks = async () => {
		const targetCount =
			selectedParticipants.size > 0
				? selectedParticipants.size
				: participants.length;

		if (targetCount === 0) {
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
				targetCount
			)
		);

		if (!confirmed) {
			return;
		}

		setIsSendingGalleryLinks(true);

		try {
			const requestData =
				selectedParticipants.size > 0
					? { participant_ids: Array.from(selectedParticipants) }
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

			loadGalleryStats();
			// Clear selection after sending.
			if (selectedParticipants.size > 0) {
				setSelectedParticipants(new Set());
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
			<h1>
				{eventTitle
					? sprintf(
							/* translators: %s: event title */
							__('Participants for %s', 'fair-audience'),
							eventTitle
						)
					: __('Event Participants', 'fair-audience')}
			</h1>

			<div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
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
					isPrimary
					onClick={() => handleOpenAddModal('signed_up')}
				>
					{__('Add Participants', 'fair-audience')}
				</Button>
				<Button
					variant="secondary"
					onClick={handleSendGalleryLinks}
					disabled={
						isSendingGalleryLinks || participants.length === 0
					}
				>
					{isSendingGalleryLinks
						? __('Sending...', 'fair-audience')
						: selectedParticipants.size > 0
							? sprintf(
									/* translators: %d: number of selected participants */
									__(
										'Send Gallery to %d Selected',
										'fair-audience'
									),
									selectedParticipants.size
								)
							: __('Send Gallery Links', 'fair-audience')}
				</Button>
			</div>

			{galleryStats && galleryStats.sent > 0 && (
				<p style={{ color: '#666', fontStyle: 'italic' }}>
					{sprintf(
						/* translators: %d: number of gallery links sent */
						__(
							'Gallery links sent to %d participant(s)',
							'fair-audience'
						),
						galleryStats.sent
					)}
				</p>
			)}

			<p>
				{sprintf(
					/* translators: %d: number of participants */
					__('%d participants', 'fair-audience'),
					participants.length
				)}
			</p>

			{selectedParticipants.size > 0 && (
				<div style={{ marginBottom: '15px' }}>
					<Button
						variant="secondary"
						isDestructive
						onClick={handleBatchRemove}
						disabled={isRemoving}
					>
						{isRemoving
							? __('Removing...', 'fair-audience')
							: sprintf(
									/* translators: %d: number of selected participants */
									__('Remove %d Selected', 'fair-audience'),
									selectedParticipants.size
								)}
					</Button>
				</div>
			)}

			<table className="wp-list-table widefat fixed striped">
				<thead>
					<tr>
						<th style={{ width: '40px' }}>
							<input
								type="checkbox"
								checked={allSelected}
								onChange={handleSelectAll}
								disabled={isLoading || isRemoving}
							/>
						</th>
						<th>{__('Name', 'fair-audience')}</th>
						<th>{__('Email', 'fair-audience')}</th>
						<th>{__('Instagram', 'fair-audience')}</th>
						<th>{__('Label', 'fair-audience')}</th>
						<th>{__('Actions', 'fair-audience')}</th>
					</tr>
				</thead>
				<tbody>
					{participants.map((participant) => (
						<tr key={participant.id}>
							<td>
								<input
									type="checkbox"
									checked={selectedParticipants.has(
										participant.participant_id
									)}
									onChange={() =>
										handleSelectParticipant(
											participant.participant_id
										)
									}
									disabled={isRemoving}
								/>
							</td>
							<td>{participant.participant_name}</td>
							<td>{participant.participant_email}</td>
							<td>
								{participant.instagram ? (
									<a
										href={`https://instagram.com/${participant.instagram}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										@{participant.instagram}
									</a>
								) : (
									'—'
								)}
							</td>
							<td>
								<SelectControl
									value={participant.label}
									options={[
										{
											label: __(
												'Interested',
												'fair-audience'
											),
											value: 'interested',
										},
										{
											label: __(
												'Signed Up',
												'fair-audience'
											),
											value: 'signed_up',
										},
										{
											label: __(
												'Collaborator',
												'fair-audience'
											),
											value: 'collaborator',
										},
									]}
									onChange={(value) =>
										handleUpdateLabel(
											participant.participant_id,
											value
										)
									}
								/>
							</td>
							<td>
								<Button
									isSmall
									isDestructive
									onClick={() =>
										handleRemove(participant.participant_id)
									}
									disabled={isRemoving}
								>
									{__('Remove', 'fair-audience')}
								</Button>
							</td>
						</tr>
					))}
				</tbody>
			</table>

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
		</div>
	);
}
