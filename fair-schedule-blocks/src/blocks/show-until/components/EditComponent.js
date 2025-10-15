import { PanelBody } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import DateTimeControl from '../../../components/DateTimeControl.js';

export default function EditComponent({ attributes, setAttributes }) {
	const { hideAfter } = attributes;

	const blockProps = useBlockProps({
		className: 'show-until-container',
	});

	const allowedBlocks = undefined;

	const template = [
		[
			'core/paragraph',
			{
				content: __(
					'This content will be hidden after the date you set.',
					'fair-schedule-blocks'
				),
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'show-until-content',
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
						value={hideAfter}
						onChange={(formatted) =>
							setAttributes({ hideAfter: formatted })
						}
						label={__(
							'Hide After Date/Time',
							'fair-schedule-blocks'
						)}
						help={__(
							'Content will be hidden after this date and time.',
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
