import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
} from '@wordpress/block-editor';
import { PanelBody } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

export default function EditComponent() {
	const blockProps = useBlockProps({
		className: 'member-content-container',
	});

	// Allow any blocks inside
	const allowedBlocks = undefined;

	// Default template with placeholder content
	const template = [
		[
			'core/paragraph',
			{
				content: __(
					'This content will be shown to members of the selected groups.',
					'fair-membership'
				),
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'member-content-inner',
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
				<PanelBody title={__('Member Content', 'fair-membership')}>
					<p>
						{__(
							'This content will be displayed to users who are members of the selected groups.',
							'fair-membership'
						)}
					</p>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div className="member-content-label">
					{__('👥 Member Content', 'fair-membership')}
				</div>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
