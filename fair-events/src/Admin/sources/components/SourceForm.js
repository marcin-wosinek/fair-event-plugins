/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	TextControl,
	ToggleControl,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import DataSourceItem from './DataSourceItem.js';

const SourceForm = ({ source, onSuccess, onCancel }) => {
	const [name, setName] = useState(source?.name || '');
	const [slug, setSlug] = useState(source?.slug || '');
	const [dataSources, setDataSources] = useState(
		source?.data_sources || [{ source_type: 'categories', config: {} }]
	);
	const [enabled, setEnabled] = useState(source?.enabled ?? true);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);

	// Auto-generate slug from name if creating new source
	useEffect(() => {
		if (!source && name) {
			const generatedSlug = name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '');
			setSlug(generatedSlug);
		}
	}, [name, source]);

	const handleSubmit = async (e) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			const data = {
				name,
				slug,
				data_sources: dataSources,
				enabled,
			};

			if (source) {
				// Update existing
				await apiFetch({
					path: `/fair-events/v1/sources/${source.id}`,
					method: 'PUT',
					data,
				});
			} else {
				// Create new
				await apiFetch({
					path: '/fair-events/v1/sources',
					method: 'POST',
					data,
				});
			}

			onSuccess();
		} catch (err) {
			setError(
				err.message ||
					__(
						source
							? 'Failed to update source.'
							: 'Failed to create source.',
						'fair-events'
					)
			);
		} finally {
			setLoading(false);
		}
	};

	const handleAddDataSource = () => {
		setDataSources([
			...dataSources,
			{ source_type: 'categories', config: {} },
		]);
	};

	const handleRemoveDataSource = (index) => {
		if (dataSources.length > 1) {
			setDataSources(dataSources.filter((_, i) => i !== index));
		}
	};

	const handleDataSourceChange = (index, newDataSource) => {
		const updated = [...dataSources];
		updated[index] = newDataSource;
		setDataSources(updated);
	};

	return (
		<form onSubmit={handleSubmit}>
			<VStack spacing={4}>
				{error && (
					<Notice
						status="error"
						isDismissible
						onRemove={() => setError(null)}
					>
						{error}
					</Notice>
				)}

				<TextControl
					label={__('Source Name', 'fair-events')}
					value={name}
					onChange={setName}
					required
					help={__(
						'A descriptive name for this event source.',
						'fair-events'
					)}
				/>

				<TextControl
					label={__('Slug', 'fair-events')}
					value={slug}
					onChange={setSlug}
					required
					help={
						source
							? __(
									'URL-friendly identifier for this source.',
									'fair-events'
								)
							: __(
									'Auto-generated from name. Can be customized.',
									'fair-events'
								)
					}
				/>

				<div>
					<HStack justify="space-between" alignment="center">
						<label style={{ fontWeight: 500, margin: 0 }}>
							{__('Data Sources', 'fair-events')}
						</label>
						<Button
							variant="secondary"
							size="small"
							onClick={handleAddDataSource}
						>
							{__('Add Data Source', 'fair-events')}
						</Button>
					</HStack>
					<p className="description" style={{ marginTop: '8px' }}>
						{__(
							'Configure one or more data sources to aggregate events from.',
							'fair-events'
						)}
					</p>

					<VStack spacing={3} style={{ marginTop: '12px' }}>
						{dataSources.map((dataSource, index) => (
							<DataSourceItem
								key={index}
								dataSource={dataSource}
								index={index}
								onChange={(newDataSource) =>
									handleDataSourceChange(index, newDataSource)
								}
								onRemove={() => handleRemoveDataSource(index)}
							/>
						))}
					</VStack>
				</div>

				<ToggleControl
					label={__('Enable this source', 'fair-events')}
					checked={enabled}
					onChange={setEnabled}
					help={__(
						'Disabled sources will not be used for event imports.',
						'fair-events'
					)}
				/>

				<HStack justify="flex-end" spacing={2}>
					<Button
						variant="tertiary"
						onClick={onCancel}
						disabled={loading}
					>
						{__('Cancel', 'fair-events')}
					</Button>
					<Button variant="primary" type="submit" disabled={loading}>
						{loading ? (
							<>
								<Spinner style={{ marginRight: '8px' }} />
								{__('Saving...', 'fair-events')}
							</>
						) : source ? (
							__('Update Source', 'fair-events')
						) : (
							__('Create Source', 'fair-events')
						)}
					</Button>
				</HStack>
			</VStack>
		</form>
	);
};

export default SourceForm;
