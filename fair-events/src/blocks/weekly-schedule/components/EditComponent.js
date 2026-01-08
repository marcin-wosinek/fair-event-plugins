/**
 * Weekly Schedule Block - Edit Component
 *
 * Provides the block editor interface for the Weekly Schedule block.
 * Allows users to configure:
 * - Display pattern (how events appear in schedule cells)
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
		className: 'weekly-schedule-placeholder',
	});

	// Get all categories
	const allCategories = useSelect((select) => {
		const cats = select('core').getEntityRecords('taxonomy', 'category', {
			per_page: -1,
		});
		return cats || [];
	}, []);

	// Get schedule-specific patterns
	const schedulePatterns = useSelect((select) => {
		const patterns = select('core').getBlockPatterns?.() || [];
		return patterns.filter(
			(pattern) =>
				pattern.categories?.includes('fair-events') &&
				pattern.name?.includes('schedule-event')
		);
	}, []);

	// Combine patterns for the dropdown
	const patternOptions = schedulePatterns.map((pattern) => ({
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
					title={__('Schedule Settings', 'fair-events')}
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
							'Use "With Time" patterns to show event start times',
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
							'Display previous/next week navigation',
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
							'Display draft events in the schedule',
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
							'Select event sources to display in the schedule.',
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
				<div className="placeholder-icon">📅</div>
				<h3>{__('Weekly Schedule', 'fair-events')}</h3>
				<p>
					{__(
						'Schedule will be displayed on the frontend',
						'fair-events'
					)}
				</p>
				{categories.length > 0 && (
					<p>
						<em>
							{__('Filtered by categories:', 'fair-events')}{' '}
							{selectedCategoryNames.join(', ')}
						</em>
					</p>
				)}
				{eventSources.length > 0 && (
					<p>
						<em>
							{eventSources.length}{' '}
							{__('event sources configured', 'fair-events')}
						</em>
					</p>
				)}
			</div>
		</>
	);
};

export default EditComponent;
