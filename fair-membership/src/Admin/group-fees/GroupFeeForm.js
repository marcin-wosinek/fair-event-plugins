import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	TextControl,
	TextareaControl,
	SelectControl,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';

const GroupFeeForm = ({ groupFee, onSave, onCancel }) => {
	const [title, setTitle] = useState(groupFee?.title || '');
	const [description, setDescription] = useState(groupFee?.description || '');
	const [defaultAmount, setDefaultAmount] = useState(
		groupFee?.default_amount?.toString() || ''
	);
	const [dueDate, setDueDate] = useState(groupFee?.due_date || '');
	const [groupId, setGroupId] = useState(
		groupFee?.group_id?.toString() || ''
	);

	const [groups, setGroups] = useState([]);
	const [loadingGroups, setLoadingGroups] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);

	// Load groups for the dropdown
	useEffect(() => {
		loadGroups();
	}, []);

	const loadGroups = async () => {
		setLoadingGroups(true);
		try {
			const response = await apiFetch({
				path: '/fair-membership/v1/groups?per_page=100&orderby=name&order=ASC',
			});
			setGroups(response.items || []);
		} catch (err) {
			setError(
				err.message || __('Failed to load groups.', 'fair-membership')
			);
		} finally {
			setLoadingGroups(false);
		}
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		setError(null);
		setSaving(true);

		try {
			const data = {
				title,
				description,
				default_amount: parseFloat(defaultAmount),
				due_date: dueDate,
			};

			// Only include group_id for new fees
			if (!groupFee) {
				data.group_id = parseInt(groupId);
			}

			await onSave(data);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to save group fee.', 'fair-membership')
			);
		} finally {
			setSaving(false);
		}
	};

	if (loadingGroups) {
		return <Spinner />;
	}

	const groupOptions = [
		{ value: '', label: __('Select a group', 'fair-membership') },
		...groups.map((group) => ({
			value: group.id.toString(),
			label: group.name,
		})),
	];

	return (
		<form onSubmit={handleSubmit}>
			<VStack spacing={4}>
				{error && (
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				)}

				{!groupFee && (
					<SelectControl
						label={__('Group', 'fair-membership')}
						value={groupId}
						options={groupOptions}
						onChange={setGroupId}
						required
						help={__(
							'Select the group for this fee. Individual user fees will be created for all active members.',
							'fair-membership'
						)}
					/>
				)}

				<TextControl
					label={__('Title', 'fair-membership')}
					value={title}
					onChange={setTitle}
					required
				/>

				<TextareaControl
					label={__('Description', 'fair-membership')}
					value={description}
					onChange={setDescription}
					rows={3}
				/>

				<TextControl
					label={__('Default Amount', 'fair-membership')}
					type="number"
					value={defaultAmount}
					onChange={setDefaultAmount}
					required
					min="0"
					step="0.01"
				/>

				<TextControl
					label={__('Due Date', 'fair-membership')}
					type="date"
					value={dueDate}
					onChange={setDueDate}
					required
				/>

				<div
					style={{
						display: 'flex',
						justifyContent: 'flex-end',
						gap: '8px',
						marginTop: '16px',
					}}
				>
					<Button variant="secondary" onClick={onCancel}>
						{__('Cancel', 'fair-membership')}
					</Button>
					<Button
						variant="primary"
						type="submit"
						isBusy={saving}
						disabled={saving}
					>
						{saving
							? __('Saving...', 'fair-membership')
							: __('Save', 'fair-membership')}
					</Button>
				</div>
			</VStack>
		</form>
	);
};

export default GroupFeeForm;
