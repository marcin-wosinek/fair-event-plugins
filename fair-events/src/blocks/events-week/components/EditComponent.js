/**
 * Events Week View Block - Edit Component
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
		showDrafts,
		backgroundColor,
		textColor,
		eventSources,
	} = attributes;

	const blockProps = useBlockProps({
		className: 'events-week-placeholder',
	});

	const allCategories = useSelect((select) => {
		const cats = select('core').getEntityRecords('taxonomy', 'category', {
			per_page: -1,
		});
		return cats || [];
	}, []);

	const meaningfulCategories = allCategories.filter(
		(cat) => cat.slug !== 'uncategorized'
	);
	const hasCategories = meaningfulCategories.length > 0;

	const handleCategoryToggle = (categoryId, checked) => {
		const newCategories = checked
			? [...categories, categoryId]
			: categories.filter((id) => id !== categoryId);
		setAttributes({ categories: newCategories });
	};

	const selectedCategoryNames = allCategories
		.filter((cat) => categories.includes(cat.id))
		.map((cat) => cat.name);

	const hasOldFormat =
		eventSources.length > 0 &&
		typeof eventSources[0] === 'object' &&
		'icalFeed' in eventSources[0];

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={__('Week View Settings', 'fair-events')}
					initialOpen={true}
				>
					<RadioControl
						label={__('Start of Week', 'fair-events')}
						selected={startOfWeek}
						options={[
							{ label: __('Monday', 'fair-events'), value: 1 },
							{ label: __('Sunday', 'fair-events'), value: 0 },
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
							allCategories.map((cat) => (
								<CheckboxControl
									key={cat.id}
									label={cat.name}
									checked={categories.includes(cat.id)}
									onChange={(checked) =>
										handleCategoryToggle(cat.id, checked)
									}
								/>
							))
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
							label: __('Event Background', 'fair-events'),
						},
						{
							value: textColor,
							onChange: (color) =>
								setAttributes({
									textColor: color || '#ffffff',
								}),
							label: __('Event Text', 'fair-events'),
						},
					]}
				/>

				<PanelBody
					title={__('Event Sources', 'fair-events')}
					initialOpen={false}
				>
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
				<Icon
					icon={calendar}
					style={{ width: '40px', height: '40px', opacity: 0.4 }}
				/>
				<h3>{__('Events Week View', 'fair-events')}</h3>
				<p>
					{__(
						'Current week will be displayed on the frontend',
						'fair-events'
					)}
				</p>
				{categories.length > 0 && (
					<p style={{ marginTop: '8px', color: '#666' }}>
						{__('Categories:', 'fair-events')}{' '}
						<strong>{selectedCategoryNames.join(', ')}</strong>
					</p>
				)}
				{eventSources.length > 0 && (
					<p style={{ marginTop: '4px', color: '#666' }}>
						{__('Event Sources:', 'fair-events')}{' '}
						<strong>{eventSources.length}</strong>
					</p>
				)}
			</div>
		</>
	);
};

export default EditComponent;
