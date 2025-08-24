import { registerBlockType } from '@wordpress/blocks';
import {
	InnerBlocks,
	InspectorControls,
	useBlockProps,
} from '@wordpress/block-editor';
import { PanelBody, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClipboard } from '@fortawesome/free-solid-svg-icons';

const ALLOWED_BLOCKS = [
	'fair-registration/email-field',
	'fair-registration/short-text-field',
	'fair-registration/long-text-field',
	'fair-registration/phone-number-field',
	'fair-registration/checkbox-field',
	'fair-registration/select-field',
];

const TEMPLATE = [['fair-registration/email-field', {}]];

registerBlockType('fair-registration/form', {
	icon: <FontAwesomeIcon icon={faClipboard} />,
	edit: ({ attributes, setAttributes }) => {
		const { name, id } = attributes;
		const blockProps = useBlockProps({
			className: 'fair-registration-form-editor',
		});

		return (
			<div {...blockProps}>
				<InspectorControls>
					<PanelBody title={__('Form Settings', 'fair-registration')}>
						<TextControl
							label={__('Form Name', 'fair-registration')}
							value={name}
							onChange={(value) => setAttributes({ name: value })}
							help={__(
								'Internal name for the form',
								'fair-registration'
							)}
						/>
						<TextControl
							label={__('Form ID', 'fair-registration')}
							value={id}
							onChange={(value) => setAttributes({ id: value })}
							help={__(
								'Unique identifier for the form',
								'fair-registration'
							)}
						/>
					</PanelBody>
				</InspectorControls>

				<div className="fair-registration-form">
					<div className="fair-registration-form-header">
						<h3>
							{name ||
								__('Registration Form', 'fair-registration')}
						</h3>
					</div>

					<InnerBlocks
						allowedBlocks={ALLOWED_BLOCKS}
						template={TEMPLATE}
						templateLock={false}
					/>
				</div>
			</div>
		);
	},
	save: () => {
		return <InnerBlocks.Content />;
	},
});
