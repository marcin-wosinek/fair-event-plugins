import { __ } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	ToggleControl,
	SelectControl,
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
		category_id: '',
	});
	const [categories, setCategories] = useState([]);
	const editorInitialized = useRef(false);

	useEffect(() => {
		loadData();
	}, []);

	// Initialize TinyMCE after data loads.
	useEffect(() => {
		if (isLoading || editorInitialized.current) {
			return;
		}

		if (window.wp && window.wp.editor) {
			window.wp.editor.initialize('extra-message-content', {
				tinymce: {
					toolbar1:
						'bold,italic,bullist,numlist,link,unlink,removeformat',
					plugins: 'lists,link',
					branding: false,
					menubar: false,
					statusbar: false,
				},
				quicktags: true,
				mediaButtons: false,
			});
			editorInitialized.current = true;
		}

		return () => {
			if (window.wp && window.wp.editor && editorInitialized.current) {
				window.wp.editor.remove('extra-message-content');
				editorInitialized.current = false;
			}
		};
	}, [isLoading]);

	const loadData = async () => {
		// Fetch categories.
		try {
			const cats = await apiFetch({
				path: '/wp/v2/categories?per_page=100',
			});
			setCategories(cats);
		} catch {
			// Non-critical: categories dropdown will just show "All".
		}

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
					category_id:
						response.category_id !== null
							? String(response.category_id)
							: '',
				});
			} catch (err) {
				setError(err.message);
			}
		}

		setIsLoading(false);
	};

	const getEditorContent = () => {
		if (window.tinymce) {
			const editor = window.tinymce.get('extra-message-content');
			if (editor) {
				return editor.getContent();
			}
		}
		const textarea = document.getElementById('extra-message-content');
		return textarea ? textarea.value : '';
	};

	const handleSubmit = async () => {
		const content = getEditorContent();

		if (!content || content === '<p></p>' || content === '<br>') {
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
				data: {
					content,
					is_active: formData.is_active,
					category_id: formData.category_id
						? parseInt(formData.category_id, 10)
						: null,
				},
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
				<label
					htmlFor="extra-message-content"
					style={{
						display: 'block',
						marginBottom: '8px',
						fontWeight: '600',
					}}
				>
					{__('Content', 'fair-audience')}
				</label>
				<textarea
					id="extra-message-content"
					defaultValue={formData.content}
					rows={10}
					style={{ width: '100%' }}
				/>

				<div style={{ marginTop: '16px' }}>
					<SelectControl
						label={__('Category', 'fair-audience')}
						value={formData.category_id}
						options={[
							{
								label: __('All categories', 'fair-audience'),
								value: '',
							},
							...categories.map((cat) => ({
								label: cat.name,
								value: String(cat.id),
							})),
						]}
						onChange={(value) =>
							setFormData({
								...formData,
								category_id: value,
							})
						}
						help={__(
							'Limit this message to events in a specific category, or leave as "All categories" for all events.',
							'fair-audience'
						)}
					/>
				</div>

				<div style={{ marginTop: '16px' }}>
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
