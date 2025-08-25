/**
 * Filter to customize core/heading blocks inside fair-registration/form
 *
 * @package FairRegistration
 */

import { addFilter } from '@wordpress/hooks';
import { createHigherOrderComponent } from '@wordpress/compose';
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody, ToggleControl, Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import { useEffect } from '@wordpress/element';

/**
 * Higher-order component to customize core/heading when inside registration-form
 */
const withRegistrationHeadingCustomization = createHigherOrderComponent(
	(BlockEdit) => {
		return (props) => {
			const { name, clientId, attributes, setAttributes } = props;

			// Only apply to core/heading blocks
			if (name !== 'core/heading') {
				return <BlockEdit {...props} />;
			}

			// Get parent block info and all heading blocks in the form
			const { parentBlockId, isInsideRegistrationForm, allFormHeadings } =
				useSelect(
					(select) => {
						const { getBlockParents, getBlock, getBlocks } =
							select('core/block-editor');
						const parents = getBlockParents(clientId);

						// Check all parents to see if we're inside a registration form
						let insideForm = false;
						let formParentId = null;

						for (let i = parents.length - 1; i >= 0; i--) {
							const parentBlock = getBlock(parents[i]);
							if (
								parentBlock?.name === 'fair-registration/form'
							) {
								insideForm = true;
								formParentId = parents[i];
								break;
							}
						}

						// Get all heading blocks within the registration form
						let headings = [];
						if (formParentId) {
							const formBlock = getBlock(formParentId);
							const findHeadings = (blocks) => {
								return blocks.reduce((acc, block) => {
									if (block.name === 'core/heading') {
										acc.push(block);
									}
									if (block.innerBlocks) {
										acc.push(
											...findHeadings(block.innerBlocks)
										);
									}
									return acc;
								}, []);
							};
							headings = findHeadings(formBlock.innerBlocks);
						}

						return {
							parentBlockId: formParentId,
							isInsideRegistrationForm: insideForm,
							allFormHeadings: headings,
						};
					},
					[clientId]
				);

			const { selectBlock, updateBlockAttributes } =
				useDispatch('core/block-editor');

			// Function to focus parent registration form
			const focusParentForm = () => {
				if (parentBlockId) {
					selectBlock(parentBlockId);
				}
			};

			// Only customize if this heading is inside a registration form
			if (!isInsideRegistrationForm) {
				return <BlockEdit {...props} />;
			}

			// Get or set default form title setting
			const isFormTitle = attributes.registrationFormTitle || false;

			const handleFormTitleToggle = (value) => {
				if (value) {
					// If turning this heading ON, turn OFF all other headings in the same form
					allFormHeadings.forEach((heading) => {
						if (
							heading.clientId !== clientId &&
							heading.attributes.registrationFormTitle
						) {
							updateBlockAttributes(heading.clientId, {
								registrationFormTitle: false,
							});
						}
					});

					// Immediately sync the current heading content to form name
					if (parentBlockId && attributes.content) {
						updateBlockAttributes(parentBlockId, {
							name: attributes.content.replace(/<[^>]*>/g, ''), // Strip HTML tags
						});
					}
				}

				setAttributes({
					registrationFormTitle: value,
				});
			};

			// Monitor heading content changes and sync to form name when this is the form title
			useEffect(() => {
				if (isFormTitle && parentBlockId && attributes.content) {
					const plainTextContent = attributes.content.replace(
						/<[^>]*>/g,
						''
					); // Strip HTML tags
					updateBlockAttributes(parentBlockId, {
						name: plainTextContent,
					});
				}
			}, [
				attributes.content,
				isFormTitle,
				parentBlockId,
				updateBlockAttributes,
			]);

			return (
				<>
					{/* Original heading edit component */}
					<BlockEdit {...props} />

					{/* Additional Inspector Controls */}
					<InspectorControls>
						<PanelBody
							title={__(
								'Registration Form Title',
								'fair-registration'
							)}
							initialOpen={true}
							icon={'heading'}
						>
							<ToggleControl
								label={__('Form Title', 'fair-registration')}
								checked={isFormTitle}
								onChange={handleFormTitleToggle}
								help={__(
									'When enabled, this heading will be saved as the registration form name.',
									'fair-registration'
								)}
							/>

							<Button
								variant="secondary"
								onClick={focusParentForm}
								icon="arrow-up-alt"
								style={{ marginTop: '10px' }}
							>
								{__(
									'Edit Registration Form',
									'fair-registration'
								)}
							</Button>
						</PanelBody>
					</InspectorControls>
				</>
			);
		};
	},
	'withRegistrationHeadingCustomization'
);

// Apply the filter
addFilter(
	'editor.BlockEdit',
	'fair-registration/customize-inner-heading',
	withRegistrationHeadingCustomization
);

/**
 * Add custom attributes to core/heading when inside registration forms
 */
const addRegistrationHeadingAttributes = (settings, name) => {
	if (name !== 'core/heading') {
		return settings;
	}

	return {
		...settings,
		attributes: {
			...settings.attributes,
			registrationFormTitle: {
				type: 'boolean',
				default: false,
			},
		},
	};
};

addFilter(
	'blocks.registerBlockType',
	'fair-registration/add-heading-attributes',
	addRegistrationHeadingAttributes
);

/**
 * Add form title data attribute to heading output
 */
const addRegistrationHeadingProps = (extraProps, blockType, attributes) => {
	if (blockType.name !== 'core/heading') {
		return extraProps;
	}

	if (attributes.registrationFormTitle) {
		return {
			...extraProps,
			'data-registration-form-title': attributes.registrationFormTitle,
			'data-form-title-content': attributes.content || '',
		};
	}

	return extraProps;
};

addFilter(
	'blocks.getSaveContent.extraProps',
	'fair-registration/add-heading-props',
	addRegistrationHeadingProps
);
