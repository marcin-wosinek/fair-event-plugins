import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
} from '@wordpress/block-editor';
import { PanelBody } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

export default function EditComponent() {
	const blockProps = useBlockProps({
		className: 'non-member-content-container',
	});

	// Allow any blocks inside
	const allowedBlocks = undefined;

	// Default template with placeholder content
	const template = [
		[
			'core/paragraph',
			{
				content: __(
					'This content will be shown to non-members and logged-out users.',
					'fair-membership'
				),
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'non-member-content-inner',
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
				<PanelBody title={__('Non-Member Content', 'fair-membership')}>
					<p>
						{__(
							'This content will be displayed to users who are not members and logged-out users.',
							'fair-membership'
						)}
					</p>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div className="non-member-content-label">
					{__('🔒 Non-Member Content', 'fair-membership')}
				</div>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
