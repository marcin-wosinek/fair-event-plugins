import { PanelBody, DateTimePicker } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { dateI18n } from '@wordpress/date';

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
					<div style={{ marginBottom: '16px' }}>
						<label
							style={{
								display: 'block',
								marginBottom: '8px',
								fontWeight: 'bold',
							}}
						>
							{__('Hide After Date/Time', 'fair-schedule-blocks')}
						</label>
						<DateTimePicker
							currentDate={hideAfter || null}
							onChange={(date) => {
								const formatted = date
									? dateI18n('c', date)
									: '';
								setAttributes({
									hideAfter: formatted,
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
								'Content will be hidden after this date and time.',
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
