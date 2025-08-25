import './editor.css';
import './filters/buttonFilter.js';
import './filters/headingFilter.js';

import { registerBlockType } from '@wordpress/blocks';
import {
	InnerBlocks,
	InspectorControls,
	useBlockProps,
} from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	Button,
	BaseControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClipboard } from '@fortawesome/free-solid-svg-icons';
import { useSelect, useDispatch } from '@wordpress/data';
import { useEffect, useRef } from '@wordpress/element';

/**
 * Generate a random UUID v4
 * @returns {string} UUID string
 */
const generateUUID = () => {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
		/[xy]/g,
		function (c) {
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		}
	);
};

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

		// Initialize ID with UUID if not set
		useEffect(() => {
			if (!id) {
				setAttributes({ id: generateUUID() });
			}
		}, [id, setAttributes]);

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

		// Function to regenerate UUID
		const regenerateId = () => {
			setAttributes({ id: generateUUID() });
		};

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
						<BaseControl
							label={__('Form ID', 'fair-registration')}
							help={__(
								'Unique identifier for the form (automatically generated)',
								'fair-registration'
							)}
						>
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '8px',
									padding: '8px 12px',
									backgroundColor: '#f0f0f0',
									border: '1px solid #ddd',
									borderRadius: '4px',
									fontFamily: 'monospace',
									fontSize: '13px',
								}}
							>
								<span
									style={{
										flexGrow: 1,
										wordBreak: 'break-all',
									}}
								>
									{id || 'Generating...'}
								</span>
								<Button
									variant="secondary"
									size="small"
									onClick={regenerateId}
									icon="update"
									iconSize="16"
									title={__(
										'Generate new ID',
										'fair-registration'
									)}
								>
									{__('Reset', 'fair-registration')}
								</Button>
							</div>
						</BaseControl>
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
