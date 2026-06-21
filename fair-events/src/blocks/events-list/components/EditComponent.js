/**
 * WordPress dependencies
 */
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	SelectControl,
	CheckboxControl,
} from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';
import { EventSourceSelector } from 'fair-events-shared';

/**
 * Edit component for Events List block
 *
 * @param {Object}   props               - Component props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const { timeFilter, categories, displayPattern, eventSources } = attributes;

	const blockProps = useBlockProps();

	const allCategories = useSelect((select) => {
		const cats = select('core').getEntityRecords('taxonomy', 'category', {
			per_page: -1,
		});
		return cats || [];
	}, []);

	const fairEventsPatterns = useSelect((select) => {
		const patterns = select('core').getBlockPatterns?.() || [];
		return patterns.filter((pattern) =>
			pattern.categories?.includes('fair-events')
		);
	}, []);

	const userPatterns = useSelect((select) => {
		const patterns = select('core').getEntityRecords(
			'postType',
			'wp_block',
			{
				per_page: -1,
			}
		);
		return patterns || [];
	}, []);

	const allPatterns = [
		...fairEventsPatterns.map((pattern) => ({
			label: pattern.title,
			value: pattern.name,
		})),
		...userPatterns.map((pattern) => ({
			label:
				(pattern.title?.rendered ||
					pattern.title?.raw ||
					__('Untitled Pattern', 'fair-events')) + ' (User Pattern)',
			value: 'wp_block:' + pattern.id,
		})),
	];

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

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Events List Settings', 'fair-events')}>
					<SelectControl
						label={__('Display Pattern', 'fair-events')}
						value={displayPattern}
						options={allPatterns}
						onChange={(value) =>
							setAttributes({ displayPattern: value })
						}
						help={__(
							'Choose a pattern for displaying events',
							'fair-events'
						)}
					/>
					<SelectControl
						label={__('Time Filter', 'fair-events')}
						value={timeFilter}
						options={[
							{
								label: __('All Events', 'fair-events'),
								value: 'all',
							},
							{
								label: __('Upcoming Events', 'fair-events'),
								value: 'upcoming',
							},
							{
								label: __('Past Events', 'fair-events'),
								value: 'past',
							},
							{
								label: __('Ongoing Events', 'fair-events'),
								value: 'ongoing',
							},
						]}
						onChange={(value) =>
							setAttributes({ timeFilter: value })
						}
						help={__(
							'Filter events by time relative to now',
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

				<PanelBody
					title={__('Event Sources', 'fair-events')}
					initialOpen={false}
				>
					<p style={{ marginBottom: '16px', color: '#666' }}>
						{__(
							'Select event sources to display in the list.',
							'fair-events'
						)}
					</p>

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
				<ServerSideRender
					block="fair-events/events-list"
					attributes={attributes}
				/>
			</div>
		</>
	);
}
