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

			<table className="wp-list-table widefat fixed striped">
				<thead>
					<tr>
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
