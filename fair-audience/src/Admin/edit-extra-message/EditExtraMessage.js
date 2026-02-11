import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	TextareaControl,
	ToggleControl,
	Spinner,
} from '@wordpress/components';

export default function EditExtraMessage() {
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);
	const [messageId, setMessageId] = useState(null);
	const [formData, setFormData] = useState({
		content: '',
		is_active: true,
	});

	useEffect(() => {
		loadData();
	}, []);

	const loadData = async () => {
		const urlParams = new URLSearchParams(window.location.search);
		const id = urlParams.get('message_id');

		if (id) {
			try {
				const response = await apiFetch({
					path: `/fair-audience/v1/extra-messages/${id}`,
				});
				setMessageId(id);
				setFormData({
					content: response.content,
					is_active: response.is_active,
				});
			} catch (err) {
				setError(err.message);
			}
		}

		setIsLoading(false);
	};

	const handleSubmit = async () => {
		if (!formData.content) {
			alert(__('Please enter message content.', 'fair-audience'));
			return;
		}

		setIsSaving(true);
		setError(null);

		try {
			const method = messageId ? 'PUT' : 'POST';
			const path = messageId
				? `/fair-audience/v1/extra-messages/${messageId}`
				: '/fair-audience/v1/extra-messages';

			await apiFetch({
				path,
				method,
				data: formData,
			});

			window.location.href =
				'admin.php?page=fair-audience-extra-messages';
		} catch (err) {
			setError(err.message);
			setIsSaving(false);
		}
	};

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>
					{messageId
						? __('Edit Extra Message', 'fair-audience')
						: __('Add New Extra Message', 'fair-audience')}
				</h1>
				<Spinner />
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>
				{messageId
					? __('Edit Extra Message', 'fair-audience')
					: __('Add New Extra Message', 'fair-audience')}
			</h1>

			{error && (
				<div className="notice notice-error">
					<p>{error}</p>
				</div>
			)}

			<div
				style={{
					marginTop: '20px',
					backgroundColor: '#ffffff',
					border: '1px solid #ddd',
					borderRadius: '4px',
					padding: '20px',
					boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
				}}
			>
				<TextareaControl
					label={__('Content', 'fair-audience')}
					value={formData.content}
					onChange={(value) =>
						setFormData({ ...formData, content: value })
					}
					help={__(
						'Plain text message. URLs will be automatically linked when included in emails.',
						'fair-audience'
					)}
					rows={5}
				/>

				<ToggleControl
					label={__('Active', 'fair-audience')}
					checked={formData.is_active}
					onChange={(value) =>
						setFormData({ ...formData, is_active: value })
					}
					help={__(
						'Active messages are appended to system emails.',
						'fair-audience'
					)}
				/>
			</div>

			<div style={{ marginTop: '20px' }}>
				<Button isPrimary onClick={handleSubmit} disabled={isSaving}>
					{isSaving
						? __('Saving...', 'fair-audience')
						: messageId
						? __('Update Message', 'fair-audience')
						: __('Create Message', 'fair-audience')}
				</Button>{' '}
				<Button
					isSecondary
					href="admin.php?page=fair-audience-extra-messages"
					disabled={isSaving}
				>
					{__('Cancel', 'fair-audience')}
				</Button>
			</div>
		</div>
	);
}
