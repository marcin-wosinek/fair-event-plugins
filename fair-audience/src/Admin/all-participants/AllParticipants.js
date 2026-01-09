import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Modal,
	TextControl,
	SelectControl,
	Spinner,
} from '@wordpress/components';

export default function AllParticipants() {
	const [participants, setParticipants] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingParticipant, setEditingParticipant] = useState(null);
	const [formData, setFormData] = useState({
		name: '',
		surname: '',
		email: '',
		instagram: '',
		email_profile: 'minimal',
	});

	useEffect(() => {
		loadParticipants();
	}, []);

	const loadParticipants = () => {
		setIsLoading(true);
		apiFetch({ path: '/fair-audience/v1/participants' })
			.then((data) => {
				setParticipants(data);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err.message);
				setIsLoading(false);
			});
	};

	const openAddModal = () => {
		setEditingParticipant(null);
		setFormData({
			name: '',
			surname: '',
			email: '',
			instagram: '',
			email_profile: 'minimal',
		});
		setIsModalOpen(true);
	};

	const openEditModal = (participant) => {
		setEditingParticipant(participant);
		setFormData({
			name: participant.name,
			surname: participant.surname,
			email: participant.email,
			instagram: participant.instagram,
			email_profile: participant.email_profile,
		});
		setIsModalOpen(true);
	};

	const handleSubmit = () => {
		const method = editingParticipant ? 'PUT' : 'POST';
		const path = editingParticipant
			? `/fair-audience/v1/participants/${editingParticipant.id}`
			: '/fair-audience/v1/participants';

		apiFetch({
			path,
			method,
			data: formData,
		})
			.then(() => {
				setIsModalOpen(false);
				loadParticipants();
			})
			.catch((err) => {
				alert(__('Error: ', 'fair-audience') + err.message);
			});
	};

	const handleDelete = (id) => {
		if (
			!confirm(
				__(
					'Are you sure you want to delete this participant?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/participants/${id}`,
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
				<h1>{__('All Participants', 'fair-audience')}</h1>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('All Participants', 'fair-audience')}</h1>
				<div className="notice notice-error">
					<p>{__('Error: ', 'fair-audience') + error}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('All Participants', 'fair-audience')}</h1>

			<Button isPrimary onClick={openAddModal}>
				{__('Add Participant', 'fair-audience')}
			</Button>

			<p>
				{sprintf(
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
						<th>{__('Email Profile', 'fair-audience')}</th>
						<th>{__('Actions', 'fair-audience')}</th>
					</tr>
				</thead>
				<tbody>
					{participants.map((participant) => (
						<tr key={participant.id}>
							<td>
								{participant.name} {participant.surname}
							</td>
							<td>{participant.email}</td>
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
							<td>{participant.email_profile}</td>
							<td>
								<Button
									isSmall
									onClick={() => openEditModal(participant)}
								>
									{__('Edit', 'fair-audience')}
								</Button>{' '}
								<Button
									isSmall
									isDestructive
									onClick={() => handleDelete(participant.id)}
								>
									{__('Delete', 'fair-audience')}
								</Button>
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{isModalOpen && (
				<Modal
					title={
						editingParticipant
							? __('Edit Participant', 'fair-audience')
							: __('Add Participant', 'fair-audience')
					}
					onRequestClose={() => setIsModalOpen(false)}
				>
					<Card>
						<CardBody>
							<TextControl
								label={__('Name *', 'fair-audience')}
								value={formData.name}
								onChange={(value) =>
									setFormData({ ...formData, name: value })
								}
								required
							/>
							<TextControl
								label={__('Surname *', 'fair-audience')}
								value={formData.surname}
								onChange={(value) =>
									setFormData({
										...formData,
										surname: value,
									})
								}
								required
							/>
							<TextControl
								label={__('Email *', 'fair-audience')}
								type="email"
								value={formData.email}
								onChange={(value) =>
									setFormData({ ...formData, email: value })
								}
								required
							/>
							<TextControl
								label={__('Instagram Handle', 'fair-audience')}
								value={formData.instagram}
								onChange={(value) =>
									setFormData({
										...formData,
										instagram: value,
									})
								}
								help={__(
									'Enter handle only (without @)',
									'fair-audience'
								)}
							/>
							<SelectControl
								label={__('Email Profile', 'fair-audience')}
								value={formData.email_profile}
								options={[
									{
										label: __('Minimal', 'fair-audience'),
										value: 'minimal',
									},
									{
										label: __(
											'In the Loop',
											'fair-audience'
										),
										value: 'in_the_loop',
									},
								]}
								onChange={(value) =>
									setFormData({
										...formData,
										email_profile: value,
									})
								}
							/>
							<Button isPrimary onClick={handleSubmit}>
								{editingParticipant
									? __('Update', 'fair-audience')
									: __('Add', 'fair-audience')}
							</Button>
						</CardBody>
					</Card>
				</Modal>
			)}
		</div>
	);
}
