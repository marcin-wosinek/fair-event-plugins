/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	TextControl,
	CheckboxControl,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';

const SourceTypeConfig = ({ sourceType, config, onChange }) => {
	const [categories, setCategories] = useState([]);
	const [loadingCategories, setLoadingCategories] = useState(false);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (sourceType === 'categories') {
			loadCategories();
		}
	}, [sourceType]);

	const loadCategories = async () => {
		setLoadingCategories(true);
		setError(null);

		try {
			const data = await apiFetch({
				path: '/fair-events/v1/sources/categories',
			});
			setCategories(data);
		} catch (err) {
			setError(
				err.message || __('Failed to load categories.', 'fair-events')
			);
		} finally {
			setLoadingCategories(false);
		}
	};

	const handleCategoryToggle = (categoryId, checked) => {
		const currentIds = config.category_ids || [];
		const newIds = checked
			? [...currentIds, categoryId]
			: currentIds.filter((id) => id !== categoryId);

		onChange({ ...config, category_ids: newIds });
	};

	const handleUrlChange = (url) => {
		onChange({ ...config, url });
	};

	if (sourceType === 'categories') {
		return (
			<VStack spacing={2}>
				<label style={{ fontWeight: 500 }}>
					{__('Select Event Categories', 'fair-events')}
				</label>

				{error && <Notice status="error">{error}</Notice>}

				{loadingCategories && (
					<div>
						<Spinner />
						<span style={{ marginLeft: '8px' }}>
							{__('Loading categories...', 'fair-events')}
						</span>
					</div>
				)}

				{!loadingCategories && categories.length === 0 && (
					<Notice status="warning" isDismissible={false}>
						{__(
							'No categories found. Create categories first.',
							'fair-events'
						)}
					</Notice>
				)}

				{!loadingCategories && categories.length > 0 && (
					<div
						style={{
							border: '1px solid #ddd',
							borderRadius: '4px',
							padding: '12px',
							maxHeight: '300px',
							overflowY: 'auto',
						}}
					>
						{categories.map((category) => (
							<CheckboxControl
								key={category.id}
								label={category.name}
								checked={(config.category_ids || []).includes(
									category.id
								)}
								onChange={(checked) =>
									handleCategoryToggle(category.id, checked)
								}
							/>
						))}
					</div>
				)}

				<p className="description">
					{__(
						'Events from these categories will be included in this source.',
						'fair-events'
					)}
				</p>
			</VStack>
		);
	}

	if (sourceType === 'ical_url') {
		return (
			<VStack spacing={2}>
				<TextControl
					label={__('iCal Feed URL', 'fair-events')}
					type="url"
					value={config.url || ''}
					onChange={handleUrlChange}
					required
					placeholder="https://example.com/events.ics"
					help={__(
						'Enter the URL of the iCal feed to import events from.',
						'fair-events'
					)}
				/>
			</VStack>
		);
	}

	if (sourceType === 'meetup_api') {
		return (
			<Notice status="info" isDismissible={false}>
				{__('Meetup API integration is coming soon.', 'fair-events')}
			</Notice>
		);
	}

	return null;
};

export default SourceTypeConfig;
