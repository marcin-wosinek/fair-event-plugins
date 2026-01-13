import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Modal,
	SelectControl,
	Spinner,
	Card,
	CardBody,
} from '@wordpress/components';

export default function EventParticipants() {
	const [participants, setParticipants] = useState([]);
	const [allParticipants, setAllParticipants] = useState([]);
	const [eventTitle, setEventTitle] = useState('');
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [selectedParticipantId, setSelectedParticipantId] = useState('');
	const [selectedLabel, setSelectedLabel] = useState('interested');
	const [selectedParticipants, setSelectedParticipants] = useState(new Set());
	const [isRemoving, setIsRemoving] = useState(false);

	const eventId = new URLSearchParams(window.location.search).get('event_id');

	useEffect(() => {
		if (!eventId) {
			setError(__('No event ID provided', 'fair-audience'));
			setIsLoading(false);
			return;
		}

		loadParticipants();
		loadAllParticipants();
	}, [eventId]);

	const loadParticipants = () => {
		apiFetch({ path: `/fair-audience/v1/events/${eventId}/participants` })
			.then((data) => {
				setParticipants(data);
				// Get event title
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

	const handleAdd = () => {
		if (!selectedParticipantId) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/events/${eventId}/participants`,
			method: 'POST',
			data: {
				participant_id: parseInt(selectedParticipantId),
				label: selectedLabel,
			},
		})
			.then(() => {
				setIsAddModalOpen(false);
				setSelectedParticipantId('');
				loadParticipants();
			})
			.catch((err) => {
				alert(__('Error: ', 'fair-audience') + err.message);
			});
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

			<Button isPrimary onClick={() => setIsAddModalOpen(true)}>
				{__('Add Participant', 'fair-audience')}
			</Button>

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

			{isAddModalOpen && (
				<Modal
					title={__('Add Participant to Event', 'fair-audience')}
					onRequestClose={() => setIsAddModalOpen(false)}
				>
					<Card>
						<CardBody>
							<SelectControl
								label={__(
									'Select Participant',
									'fair-audience'
								)}
								value={selectedParticipantId}
								options={[
									{
										label: __(
											'— Select —',
											'fair-audience'
										),
										value: '',
									},
									...allParticipants.map((p) => ({
										label: `${p.name} ${p.surname} (${p.email})`,
										value: p.id.toString(),
									})),
								]}
								onChange={(value) =>
									setSelectedParticipantId(value)
								}
							/>
							<SelectControl
								label={__('Label', 'fair-audience')}
								value={selectedLabel}
								options={[
									{
										label: __(
											'Interested',
											'fair-audience'
										),
										value: 'interested',
									},
									{
										label: __('Signed Up', 'fair-audience'),
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
								onChange={(value) => setSelectedLabel(value)}
							/>
							<Button
								isPrimary
								onClick={handleAdd}
								disabled={!selectedParticipantId}
							>
								{__('Add', 'fair-audience')}
							</Button>
						</CardBody>
					</Card>
				</Modal>
			)}
		</div>
	);
}
