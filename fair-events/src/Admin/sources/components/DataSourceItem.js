/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	SelectControl,
	TextControl,
	CheckboxControl,
	Button,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const DataSourceItem = ({ dataSource, onChange, onRemove, index }) => {
	const [categories, setCategories] = useState([]);
	const [loadingCategories, setLoadingCategories] = useState(false);
	const [error, setError] = useState(null);

	const sourceType = dataSource.source_type || 'categories';
	const config = dataSource.config || {};

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

	const handleSourceTypeChange = (newSourceType) => {
		onChange({
			source_type: newSourceType,
			config: {},
		});
	};

	const handleConfigChange = (newConfig) => {
		onChange({
			source_type: sourceType,
			config: newConfig,
		});
	};

	const handleCategoryToggle = (categoryId, checked) => {
		const currentIds = config.category_ids || [];
		const newIds = checked
			? [...currentIds, categoryId]
			: currentIds.filter((id) => id !== categoryId);

		handleConfigChange({ ...config, category_ids: newIds });
	};

	const handleUrlChange = (url) => {
		handleConfigChange({ ...config, url });
	};

	const sourceTypeOptions = [
		{ label: __('Event Categories', 'fair-events'), value: 'categories' },
		{ label: __('iCal URL', 'fair-events'), value: 'ical_url' },
		{
			label: __('Meetup API (Coming Soon)', 'fair-events'),
			value: 'meetup_api',
		},
	];

	const renderConfigFields = () => {
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
								maxHeight: '200px',
								overflowY: 'auto',
							}}
						>
							{categories.map((category) => (
								<CheckboxControl
									key={category.id}
									label={category.name}
									checked={(
										config.category_ids || []
									).includes(category.id)}
									onChange={(checked) =>
										handleCategoryToggle(
											category.id,
											checked
										)
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
					{__(
						'Meetup API integration is coming soon.',
						'fair-events'
					)}
				</Notice>
			);
		}

		return null;
	};

	return (
		<div
			style={{
				border: '1px solid #ddd',
				borderRadius: '4px',
				padding: '16px',
				backgroundColor: '#f9f9f9',
			}}
		>
			<VStack spacing={3}>
				<HStack justify="space-between" alignment="center">
					<h4 style={{ margin: 0 }}>
						{__('Data Source', 'fair-events')} #{index + 1}
					</h4>
					<Button
						variant="tertiary"
						isDestructive
						size="small"
						onClick={onRemove}
					>
						{__('Remove', 'fair-events')}
					</Button>
				</HStack>

				<SelectControl
					label={__('Source Type', 'fair-events')}
					value={sourceType}
					options={sourceTypeOptions}
					onChange={handleSourceTypeChange}
					help={__('Select the type of event source.', 'fair-events')}
				/>

				{renderConfigFields()}
			</VStack>
		</div>
	);
};

export default DataSourceItem;
