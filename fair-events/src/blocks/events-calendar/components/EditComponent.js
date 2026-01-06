/**
 * Events Calendar Block - Edit Component
 *
 * Provides the block editor interface for the Events Calendar block.
 * Allows users to configure:
 * - Display pattern (how events appear in calendar cells)
 * - Start of week (Monday or Sunday)
 * - Show/hide navigation
 * - Category filtering (editor-side only)
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import {
	useBlockProps,
	InspectorControls,
	PanelColorSettings,
} from '@wordpress/block-editor';
import {
	PanelBody,
	ToggleControl,
	RadioControl,
	CheckboxControl,
	SelectControl,
	Icon,
	Notice,
} from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { calendar } from '@wordpress/icons';
import { EventSourceSelector } from 'fair-events-shared';

const EditComponent = ({ attributes, setAttributes }) => {
	const {
		startOfWeek,
		showNavigation,
		categories,
		displayPattern,
		showDrafts,
		backgroundColor,
		textColor,
		eventSources,
	} = attributes;

	const blockProps = useBlockProps({
		className: 'fair-events-calendar-placeholder',
	});

	// Get all categories
	const allCategories = useSelect((select) => {
		const cats = select('core').getEntityRecords('taxonomy', 'category', {
			per_page: -1,
		});
		return cats || [];
	}, []);

	// Get calendar-specific patterns
	const calendarPatterns = useSelect((select) => {
		const patterns = select('core').getBlockPatterns?.() || [];
		return patterns.filter(
			(pattern) =>
				pattern.categories?.includes('fair-events') &&
				pattern.name?.includes('calendar-event')
		);
	}, []);

	// Combine patterns for the dropdown
	const patternOptions = calendarPatterns.map((pattern) => ({
		label: pattern.title,
		value: pattern.name,
	}));

	// Get theme colors
	const themeColors = useSelect((select) => {
		const settings = select('core/block-editor').getSettings();
		return settings?.colors || [];
	}, []);

	// Check if there are multiple categories (more than just "Uncategorized")
	const meaningfulCategories = allCategories.filter(
		(cat) => cat.slug !== 'uncategorized'
	);
	const hasCategories = meaningfulCategories.length > 0;

	// Handle category checkbox toggle
	const handleCategoryToggle = (categoryId, checked) => {
		let newCategories;
		if (checked) {
			// Add category
			newCategories = [...categories, categoryId];
		} else {
			// Remove category
			newCategories = categories.filter((id) => id !== categoryId);
		}
		setAttributes({ categories: newCategories });
	};

	// Get selected category names for display
	const selectedCategoryNames = allCategories
		.filter((cat) => categories.includes(cat.id))
		.map((cat) => cat.name);

	// Check for old eventSources format (migration notice)
	const hasOldFormat =
		eventSources.length > 0 &&
		typeof eventSources[0] === 'object' &&
		'icalFeed' in eventSources[0];

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={__('Calendar Settings', 'fair-events')}
					initialOpen={true}
				>
					<SelectControl
						label={__('Event Display Pattern', 'fair-events')}
						value={displayPattern}
						options={patternOptions}
						onChange={(value) =>
							setAttributes({ displayPattern: value })
						}
						help={__(
							'Choose how events are displayed in calendar cells',
							'fair-events'
						)}
					/>

					<RadioControl
						label={__('Start of Week', 'fair-events')}
						selected={startOfWeek}
						options={[
							{
								label: __('Monday', 'fair-events'),
								value: 1,
							},
							{
								label: __('Sunday', 'fair-events'),
								value: 0,
							},
						]}
						onChange={(value) =>
							setAttributes({ startOfWeek: parseInt(value) })
						}
					/>

					<ToggleControl
						label={__('Show Navigation', 'fair-events')}
						checked={showNavigation}
						onChange={(value) =>
							setAttributes({ showNavigation: value })
						}
						help={__(
							'Display previous/next month navigation',
							'fair-events'
						)}
					/>

					<ToggleControl
						label={__('Show Draft Events', 'fair-events')}
						checked={showDrafts}
						onChange={(value) =>
							setAttributes({ showDrafts: value })
						}
						help={__(
							'Display draft events in the calendar',
							'fair-events'
						)}
					/>

					<div style={{ marginTop: '16px' }}>
						<strong>{__('Categories', 'fair-events')}</strong>
						{!hasCategories ? (
							<p
								style={{
									fontStyle: 'italic',
									color: '#757575',
								}}
							>
								{__(
									'Define more categories if you want to use category filtering',
									'fair-events'
								)}
							</p>
						) : (
							<>
								{allCategories.map((cat) => (
									<CheckboxControl
										key={cat.id}
										label={cat.name}
										checked={categories.includes(cat.id)}
										onChange={(checked) =>
											handleCategoryToggle(
												cat.id,
												checked
											)
										}
									/>
								))}
							</>
						)}
					</div>
				</PanelBody>

				<PanelColorSettings
					title={__('Colors', 'fair-events')}
					colorSettings={[
						{
							value: backgroundColor,
							onChange: (color) =>
								setAttributes({
									backgroundColor: color || 'primary',
								}),
							label: __('Background', 'fair-events'),
						},
						{
							value: textColor,
							onChange: (color) =>
								setAttributes({
									textColor: color || '#ffffff',
								}),
							label: __('Text', 'fair-events'),
						},
					]}
				>
					{showDrafts && (
						<p
							style={{
								fontSize: '12px',
								color: '#757575',
								marginTop: '12px',
							}}
						>
							{__(
								'Draft events will appear as outlined buttons using these colors.',
								'fair-events'
							)}
						</p>
					)}
				</PanelColorSettings>

				<PanelBody
					title={__('Event Sources', 'fair-events')}
					initialOpen={false}
				>
					<p style={{ marginBottom: '16px', color: '#666' }}>
						{__(
							'Select event sources to display in the calendar.',
							'fair-events'
						)}
					</p>

					{hasOldFormat && (
						<Notice status="warning" isDismissible={false}>
							{__(
								'Event sources format has changed. Please re-select your event sources.',
								'fair-events'
							)}
						</Notice>
					)}

					<EventSourceSelector
						selectedSources={eventSources}
						onChange={(slugs) =>
							setAttributes({ eventSources: slugs })
						}
						label=""
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div
					style={{
						padding: '40px',
						textAlign: 'center',
						border: '2px dashed #ddd',
						borderRadius: '4px',
						background: '#f9f9f9',
					}}
				>
					<Icon
						icon={calendar}
						style={{ width: '48px', height: '48px', opacity: 0.5 }}
					/>
					<h3 style={{ marginTop: '16px', color: '#666' }}>
						{__('Events Calendar', 'fair-events')}
					</h3>
					<p style={{ color: '#999', marginTop: '8px' }}>
						{__(
							'Calendar will be displayed on the frontend',
							'fair-events'
						)}
					</p>
					{categories.length > 0 && (
						<p style={{ color: '#666', marginTop: '8px' }}>
							{__('Categories:', 'fair-events')}{' '}
							<strong>{selectedCategoryNames.join(', ')}</strong>
						</p>
					)}
					{eventSources.length > 0 && (
						<p style={{ color: '#666', marginTop: '8px' }}>
							{__('Event Sources:', 'fair-events')}{' '}
							<strong>{eventSources.length}</strong>
						</p>
					)}
				</div>
			</div>
		</>
	);
};

export default EditComponent;
