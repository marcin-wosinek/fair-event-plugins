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

/**
 * Edit component for Events List block
 *
 * @param {Object}   props               - Component props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const { timeFilter, categories, displayPattern } = attributes;

	const blockProps = useBlockProps();

	// Get all categories
	const allCategories = useSelect((select) => {
		const cats = select('core').getEntityRecords('taxonomy', 'category', {
			per_page: -1,
		});
		return cats || [];
	}, []);

	// Get all block patterns from Fair Events category (PHP-registered)
	const fairEventsPatterns = useSelect((select) => {
		const patterns = select('core').getBlockPatterns?.() || [];
		return patterns.filter((pattern) =>
			pattern.categories?.includes('fair-events')
		);
	}, []);

	// Get user-created patterns (reusable blocks / synced patterns)
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

	// Combine all patterns for the dropdown
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

	// Filter out "Uncategorized" and check if there are meaningful categories
	const meaningfulCategories = allCategories.filter(
		(cat) => cat.slug !== 'uncategorized'
	);
	const hasCategories =
		meaningfulCategories.length > 0 ||
		(allCategories.length === 1 &&
			allCategories[0]?.slug !== 'uncategorized');

	// Check if all categories are selected (empty array means "all")
	const isAllSelected = categories.length === 0;

	// Handle "All" checkbox toggle
	const handleAllToggle = (checked) => {
		if (checked) {
			setAttributes({ categories: [] });
		}
	};

	// Handle individual category checkbox toggle
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

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Events List Settings', 'fair-events')}>
					<SelectControl
						label={__('Display Pattern', 'fair-events')}
						value={displayPattern}
						options={[
							{
								label: __('Default', 'fair-events'),
								value: 'default',
							},
							...allPatterns,
						]}
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
								<CheckboxControl
									label={__('All Categories', 'fair-events')}
									checked={isAllSelected}
									onChange={handleAllToggle}
								/>
								{allCategories.map((cat) => (
									<CheckboxControl
										key={cat.id}
										label={cat.name}
										checked={
											isAllSelected ||
											categories.includes(cat.id)
										}
										disabled={isAllSelected}
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
			</InspectorControls>

			<div {...blockProps}>
				<div className="events-list-placeholder">
					<p>
						<strong>{__('Events List', 'fair-events')}</strong>
					</p>
					<p>
						{__('Display Pattern:', 'fair-events')}{' '}
						<code>{displayPattern}</code>
					</p>
					<p>
						{__('Time Filter:', 'fair-events')}{' '}
						<code>{timeFilter}</code>
					</p>
					<p>
						{__('Categories:', 'fair-events')}{' '}
						{isAllSelected ? (
							<code>{__('All', 'fair-events')}</code>
						) : (
							<code>{selectedCategoryNames.join(', ')}</code>
						)}
					</p>
					<p>
						<em>
							{__(
								'Event list will appear here on the frontend.',
								'fair-events'
							)}
						</em>
					</p>
				</div>
			</div>
		</>
	);
}
