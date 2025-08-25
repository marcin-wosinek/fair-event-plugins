import './editor.css';
import './filters/buttonFilter.js';
import './filters/headingFilter.js';

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
import { useSelect, useDispatch } from '@wordpress/data';
import { useEffect, useRef } from '@wordpress/element';

const TEMPLATE = [
	['core/heading', { level: 2, content: 'Registration' }],
	['fair-registration/short-text-field', { label: 'Name' }],
	['fair-registration/email-field', {}],
	[
		'core/buttons',
		{},
		[['core/button', { text: 'Submit', className: 'registration-submit' }]],
	],
];

registerBlockType('fair-registration/form', {
	icon: <FontAwesomeIcon icon={faClipboard} />,
	edit: ({ attributes, setAttributes, clientId }) => {
		const { name, id } = attributes;
		const blockProps = useBlockProps({
			className: 'fair-registration-form-editor',
		});

		// Get all heading blocks within this form
		const allFormHeadings = useSelect(
			(select) => {
				const { getBlock } = select('core/block-editor');
				const formBlock = getBlock(clientId);

				if (!formBlock) return [];

				const findHeadings = (blocks) => {
					return blocks.reduce((acc, block) => {
						if (block.name === 'core/heading') {
							acc.push(block);
						}
						if (block.innerBlocks) {
							acc.push(...findHeadings(block.innerBlocks));
						}
						return acc;
					}, []);
				};

				return findHeadings(formBlock.innerBlocks);
			},
			[clientId]
		);

		const { updateBlockAttributes } = useDispatch('core/block-editor');
		const previousName = useRef(name);

		// Monitor form name changes and sync to form title heading
		useEffect(() => {
			// Only sync if name actually changed (not on initial render)
			if (
				previousName.current !== undefined &&
				previousName.current !== name &&
				name
			) {
				// Find heading with form title enabled
				const formTitleHeading = allFormHeadings.find(
					(heading) => heading.attributes.registrationFormTitle
				);

				if (formTitleHeading) {
					// Update the heading content with the new form name
					updateBlockAttributes(formTitleHeading.clientId, {
						content: name,
					});
				}
			}
			previousName.current = name;
		}, [name, allFormHeadings, updateBlockAttributes]);

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
					<InnerBlocks template={TEMPLATE} templateLock={false} />
				</div>
			</div>
		);
	},
	save: () => {
		return <InnerBlocks.Content />;
	},
});
