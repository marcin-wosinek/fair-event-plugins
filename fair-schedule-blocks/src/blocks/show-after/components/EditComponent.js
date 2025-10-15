import { PanelBody } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import DateTimeControl from '../../../components/DateTimeControl.js';

export default function EditComponent({ attributes, setAttributes }) {
	const { showAfter } = attributes;

	const blockProps = useBlockProps({
		className: 'show-after-container',
	});

	const allowedBlocks = undefined;

	const template = [
		[
			'core/paragraph',
			{
				content: __(
					'This content will be shown after the date you set.',
					'fair-schedule-blocks'
				),
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'show-after-content',
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
					title={__('Visibility Settings', 'fair-schedule-blocks')}
				>
					<DateTimeControl
						value={showAfter}
						onChange={(formatted) =>
							setAttributes({ showAfter: formatted })
						}
						label={__(
							'Show After Date/Time',
							'fair-schedule-blocks'
						)}
						help={__(
							'Content will be shown after this date and time.',
							'fair-schedule-blocks'
						)}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
