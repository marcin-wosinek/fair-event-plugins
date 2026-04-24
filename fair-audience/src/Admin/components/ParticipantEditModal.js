import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Modal,
	TextControl,
	SelectControl,
	CheckboxControl,
	Spinner,
} from '@wordpress/components';
import UserLinkSection from '../all-participants/UserLinkSection.js';

const EMPTY_FORM = {
	name: '',
	surname: '',
	email: '',
	phone: '',
	instagram: '',
	email_profile: 'minimal',
	wp_user_id: null,
	wp_user: null,
};

export default function ParticipantEditModal({
	isOpen,
	participant,
	onClose,
	onSaved,
}) {
	const [formData, setFormData] = useState(EMPTY_FORM);
	const [allGroups, setAllGroups] = useState([]);
	const [selectedGroupIds, setSelectedGroupIds] = useState([]);
	const [originalGroupIds, setOriginalGroupIds] = useState([]);
	const [groupsLoading, setGroupsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		if (participant) {
			setFormData({
				name: participant.name || '',
				surname: participant.surname || '',
				email: participant.email || '',
				phone: participant.phone || '',
				instagram: participant.instagram || '',
				email_profile: participant.email_profile || 'minimal',
				wp_user_id: participant.wp_user_id || null,
				wp_user: participant.wp_user || null,
			});
			const groupIds = (participant.groups || []).map((g) => g.id);
			setSelectedGroupIds(groupIds);
			setOriginalGroupIds(groupIds);
		} else {
			setFormData(EMPTY_FORM);
			setSelectedGroupIds([]);
			setOriginalGroupIds([]);
		}

		setGroupsLoading(true);
		apiFetch({ path: '/fair-audience/v1/groups' })
			.then((data) => {
				setAllGroups(data);
				setGroupsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading groups:', err);
				setGroupsLoading(false);
			});
	}, [isOpen, participant]);

	const handleLinkUser = (user) => {
		setFormData({ ...formData, wp_user_id: user.id, wp_user: user });
	};

	const handleUnlinkUser = () => {
		setFormData({ ...formData, wp_user_id: null, wp_user: null });
	};

	const handleSubmit = async () => {
		setIsSaving(true);
		const method = participant ? 'PUT' : 'POST';
		const path = participant
			? `/fair-audience/v1/participants/${participant.id}`
			: '/fair-audience/v1/participants';

		const dataToSend = {
			name: formData.name,
			surname: formData.surname,
			email: formData.email,
			phone: formData.phone,
			instagram: formData.instagram,
			email_profile: formData.email_profile,
			wp_user_id: formData.wp_user_id,
		};

		try {
			const result = await apiFetch({ path, method, data: dataToSend });
			const participantId = participant ? participant.id : result.id;

			const groupsToAdd = selectedGroupIds.filter(
				(id) => !originalGroupIds.includes(id)
			);
			const groupsToRemove = originalGroupIds.filter(
				(id) => !selectedGroupIds.includes(id)
			);

			const addPromises = groupsToAdd.map((groupId) =>
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

			const removePromises = groupsToRemove.map((groupId) =>
				apiFetch({
					path: `/fair-audience/v1/groups/${groupId}/participants/${participantId}`,
					method: 'DELETE',
				})
			);

			await Promise.all([...addPromises, ...removePromises]);

			setIsSaving(false);
			onSaved?.(result);
			onClose();
		} catch (err) {
			setIsSaving(false);
			// eslint-disable-next-line no-alert
			alert(__('Error: ', 'fair-audience') + err.message);
		}
	};

	if (!isOpen) {
		return null;
	}

	return (
		<Modal
			title={
				participant
					? __('Edit Participant', 'fair-audience')
					: __('Add Participant', 'fair-audience')
			}
			onRequestClose={onClose}
			style={{ maxWidth: '500px', width: '100%' }}
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
						label={__('Surname', 'fair-audience')}
						value={formData.surname}
						onChange={(value) =>
							setFormData({ ...formData, surname: value })
						}
					/>
					<TextControl
						label={__('Email', 'fair-audience')}
						type="email"
						value={formData.email}
						onChange={(value) =>
							setFormData({ ...formData, email: value })
						}
					/>
					<TextControl
						label={__('Phone', 'fair-audience')}
						type="tel"
						value={formData.phone}
						onChange={(value) =>
							setFormData({ ...formData, phone: value })
						}
					/>
					<TextControl
						label={__('Instagram Handle', 'fair-audience')}
						value={formData.instagram}
						onChange={(value) =>
							setFormData({ ...formData, instagram: value })
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
								label: __('Marketing', 'fair-audience'),
								value: 'marketing',
							},
						]}
						onChange={(value) =>
							setFormData({ ...formData, email_profile: value })
						}
					/>
					<UserLinkSection
						linkedUser={formData.wp_user}
						participantEmail={formData.email}
						onLink={handleLinkUser}
						onUnlink={handleUnlinkUser}
					/>
					<div style={{ marginTop: '16px' }}>
						<label
							style={{
								display: 'block',
								marginBottom: '8px',
								fontWeight: '600',
							}}
						>
							{__('Groups', 'fair-audience')}
						</label>
						{groupsLoading ? (
							<Spinner />
						) : allGroups.length === 0 ? (
							<p style={{ color: '#666' }}>
								{__('No groups available.', 'fair-audience')}
							</p>
						) : (
							<div
								style={{
									maxHeight: '150px',
									overflowY: 'auto',
									border: '1px solid #ddd',
									padding: '8px',
									borderRadius: '4px',
								}}
							>
								{allGroups.map((group) => (
									<CheckboxControl
										key={group.id}
										label={group.name}
										checked={selectedGroupIds.includes(
											group.id
										)}
										onChange={(checked) => {
											if (checked) {
												setSelectedGroupIds([
													...selectedGroupIds,
													group.id,
												]);
											} else {
												setSelectedGroupIds(
													selectedGroupIds.filter(
														(id) => id !== group.id
													)
												);
											}
										}}
									/>
								))}
							</div>
						)}
					</div>
					<div style={{ marginTop: '16px' }}>
						<Button
							variant="primary"
							onClick={handleSubmit}
							disabled={isSaving}
						>
							{participant
								? __('Update', 'fair-audience')
								: __('Add', 'fair-audience')}
						</Button>
					</div>
				</CardBody>
			</Card>
		</Modal>
	);
}
