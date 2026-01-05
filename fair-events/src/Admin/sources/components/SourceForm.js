/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	TextControl,
	SelectControl,
	ToggleControl,
	ColorPicker,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import SourceTypeConfig from './SourceTypeConfig.js';

const SourceForm = ({ source, onSuccess, onCancel }) => {
	const [name, setName] = useState(source?.name || '');
	const [sourceType, setSourceType] = useState(
		source?.source_type || 'categories'
	);
	const [config, setConfig] = useState(source?.config || {});
	const [color, setColor] = useState(source?.color || '#0073aa');
	const [enabled, setEnabled] = useState(source?.enabled ?? true);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);

	const sourceTypeOptions = [
		{ label: __('Event Categories', 'fair-events'), value: 'categories' },
		{ label: __('iCal URL', 'fair-events'), value: 'ical_url' },
		{
			label: __('Meetup API (Coming Soon)', 'fair-events'),
			value: 'meetup_api',
		},
	];

	const handleSubmit = async (e) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			const data = {
				name,
				source_type: sourceType,
				config,
				color,
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

				<SelectControl
					label={__('Source Type', 'fair-events')}
					value={sourceType}
					options={sourceTypeOptions}
					onChange={setSourceType}
					disabled={!!source}
					help={
						source
							? __(
									'Source type cannot be changed after creation.',
									'fair-events'
								)
							: __(
									'Select the type of event source.',
									'fair-events'
								)
					}
				/>

				<SourceTypeConfig
					sourceType={sourceType}
					config={config}
					onChange={setConfig}
				/>

				<div>
					<label
						style={{
							display: 'block',
							marginBottom: '8px',
							fontWeight: 500,
						}}
					>
						{__('Color', 'fair-events')}
					</label>
					<ColorPicker color={color} onChange={setColor} />
					<p className="description">
						{__(
							'Choose a color to identify this source visually.',
							'fair-events'
						)}
					</p>
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
