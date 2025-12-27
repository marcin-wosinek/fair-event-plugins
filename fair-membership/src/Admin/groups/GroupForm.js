import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	TextControl,
	TextareaControl,
	SelectControl,
	Button,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const GroupForm = ({ group, onSave, onCancel }) => {
	const [formData, setFormData] = useState({
		name: group?.name || '',
		slug: group?.slug || '',
		description: group?.description || '',
		access_control: group?.access_control || 'open',
		status: group?.status || 'active',
	});

	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);

	const handleChange = (field, value) => {
		setFormData((prev) => ({
			...prev,
			[field]: value,
		}));

		// Auto-generate slug from name if editing name and slug is empty or matches old name
		if (
			field === 'name' &&
			(!formData.slug || formData.slug === slugify(formData.name))
		) {
			setFormData((prev) => ({
				...prev,
				slug: slugify(value),
			}));
		}
	};

	const slugify = (text) => {
		return text
			.toString()
			.toLowerCase()
			.trim()
			.replace(/\s+/g, '-') // Replace spaces with -
			.replace(/[^\w\-]+/g, '') // Remove all non-word chars
			.replace(/\-\-+/g, '-') // Replace multiple - with single -
			.replace(/^-+/, '') // Trim - from start of text
			.replace(/-+$/, ''); // Trim - from end of text
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		// Validate
		if (!formData.name.trim()) {
			setError(__('Group name is required.', 'fair-membership'));
			setIsSaving(false);
			return;
		}

		if (!formData.slug.trim()) {
			setError(__('Group slug is required.', 'fair-membership'));
			setIsSaving(false);
			return;
		}

		try {
			// Build data object with only non-empty values
			const data = {
				name: formData.name,
				slug: formData.slug,
				access_control: formData.access_control,
				status: formData.status,
			};

			// Only include description if not empty
			if (formData.description && formData.description !== '') {
				data.description = formData.description;
			}

			await onSave(data);
			// Parent component will close the modal
		} catch (err) {
			setError(err.message);
			setIsSaving(false);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<VStack spacing={4}>
				{error && (
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				)}

				<TextControl
					label={__('Name', 'fair-membership')}
					value={formData.name}
					onChange={(value) => handleChange('name', value)}
					required
					help={__(
						'The name of the group as it will appear to users.',
						'fair-membership'
					)}
				/>

				<TextControl
					label={__('Slug', 'fair-membership')}
					value={formData.slug}
					onChange={(value) => handleChange('slug', slugify(value))}
					required
					help={__(
						'Unique identifier for the group (lowercase letters, numbers, and hyphens only).',
						'fair-membership'
					)}
				/>

				<TextareaControl
					label={__('Description', 'fair-membership')}
					value={formData.description}
					onChange={(value) => handleChange('description', value)}
					help={__(
						'Optional description of what this group represents.',
						'fair-membership'
					)}
					rows={4}
				/>

				<SelectControl
					label={__('Access Control', 'fair-membership')}
					value={formData.access_control}
					onChange={(value) => handleChange('access_control', value)}
					options={[
						{
							label: __(
								'Open - Users can join themselves',
								'fair-membership'
							),
							value: 'open',
						},
						{
							label: __(
								'Managed - Only administrators can add members',
								'fair-membership'
							),
							value: 'managed',
						},
					]}
					help={__(
						'Determines who can add members to this group.',
						'fair-membership'
					)}
				/>

				<SelectControl
					label={__('Status', 'fair-membership')}
					value={formData.status}
					onChange={(value) => handleChange('status', value)}
					options={[
						{
							label: __('Active', 'fair-membership'),
							value: 'active',
						},
						{
							label: __('Inactive', 'fair-membership'),
							value: 'inactive',
						},
					]}
					help={__(
						'Inactive groups are hidden from users.',
						'fair-membership'
					)}
				/>

				<HStack justify="flex-end" spacing={3}>
					<Button
						variant="tertiary"
						onClick={onCancel}
						disabled={isSaving}
					>
						{__('Cancel', 'fair-membership')}
					</Button>
					<Button
						variant="primary"
						type="submit"
						isBusy={isSaving}
						disabled={isSaving}
					>
						{group
							? __('Update Group', 'fair-membership')
							: __('Create Group', 'fair-membership')}
					</Button>
				</HStack>
			</VStack>
		</form>
	);
};

export default GroupForm;
