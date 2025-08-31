/**
 * Edit component for the Schedule Accordion Block
 */

import { PanelBody, DateTimePicker } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { dateI18n, getSettings } from '@wordpress/date';

/**
 * Edit component for the Schedule Accordion Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const { autoCollapsedAfter } = attributes;

	// Get WordPress timezone settings
	const dateSettings = getSettings();

	const blockProps = useBlockProps({
		className: 'schedule-accordion-container',
	});

	// Template for allowed inner blocks
	const allowedBlocks = [
		'core/heading',
		'core/paragraph',
		'core/list',
		'core/group',
		'core/details',
	];

	// Default template with some example content
	const template = [
		[
			'core/heading',
			{
				level: 2,
				content: __('Schedule', 'fair-schedule-blocks'),
			},
		],
		[
			'core/paragraph',
			{
				content: __(
					'Replace this value with content you want to hide after some date'
				),
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'schedule-accordion-content',
		},
		{
			allowedBlocks,
			template,
			templateLock: false,
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={__('Accordion Settings', 'fair-schedule-blocks')}
				>
					<div style={{ marginBottom: '16px' }}>
						<label
							style={{
								display: 'block',
								marginBottom: '8px',
								fontWeight: 'bold',
							}}
						>
							{__('Auto-collapse after', 'fair-schedule-blocks')}
						</label>
						<DateTimePicker
							currentDate={autoCollapsedAfter || null}
							onChange={(date) => {
								// Format according to WordPress settings
								const formatted = date
									? dateI18n('c', date)
									: '';
								setAttributes({
									autoCollapsedAfter: formatted,
								});
							}}
						/>
						<p
							style={{
								fontSize: '12px',
								color: '#757575',
								marginTop: '8px',
							}}
						>
							{__(
								'Hide content after this date and time.',
								'fair-schedule-blocks'
							)}
						</p>
					</div>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
