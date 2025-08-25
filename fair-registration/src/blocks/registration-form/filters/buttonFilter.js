/**
 * Filter to customize core/button blocks inside fair-registration/form
 *
 * @package FairRegistration
 */

import { addFilter } from '@wordpress/hooks';
import { createHigherOrderComponent } from '@wordpress/compose';
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody, SelectControl, Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';

/**
 * Higher-order component to customize core/button when inside registration-form
 */
const withRegistrationButtonCustomization = createHigherOrderComponent(
	(BlockEdit) => {
		return (props) => {
			const { name, clientId, attributes, setAttributes } = props;

			// Only apply to core/button blocks
			if (name !== 'core/button') {
				return <BlockEdit {...props} />;
			}

			// Get parent block info
			const { parentBlockId, isInsideRegistrationForm } = useSelect(
				(select) => {
					const { getBlockParents, getBlock } =
						select('core/block-editor');
					const parents = getBlockParents(clientId);

					// Check all parents to see if we're inside a registration form
					let insideForm = false;
					let formParentId = null;

					for (let i = parents.length - 1; i >= 0; i--) {
						const parentBlock = getBlock(parents[i]);
						if (parentBlock?.name === 'fair-registration/form') {
							insideForm = true;
							formParentId = parents[i];
							break;
						}
					}

					return {
						parentBlockId: formParentId,
						isInsideRegistrationForm: insideForm,
					};
				},
				[clientId]
			);

			const { selectBlock } = useDispatch('core/block-editor');

			// Function to focus parent registration form
			const focusParentForm = () => {
				if (parentBlockId) {
					selectBlock(parentBlockId);
				}
			};

			// Only customize if this button is inside a registration form
			if (!isInsideRegistrationForm) {
				return <BlockEdit {...props} />;
			}

			// Get or set default button type
			const buttonType = attributes.registrationButtonType || 'submit';

			const handleButtonTypeChange = (newType) => {
				setAttributes({
					registrationButtonType: newType,
					// Update button text based on type
					text:
						newType === 'submit'
							? 'Submit'
							: newType === 'reset'
								? 'Reset'
								: newType === 'cancel'
									? 'Cancel'
									: attributes.text,
				});
			};

			return (
				<>
					{/* Original button edit component */}
					<BlockEdit {...props} />

					{/* Additional Inspector Controls */}
					<InspectorControls>
						<PanelBody
							title={__(
								'Registration Form Button',
								'fair-registration'
							)}
							initialOpen={true}
							icon="clipboard"
						>
							<SelectControl
								label={__('Button Type', 'fair-registration')}
								value={buttonType}
								options={[
									{
										label: __(
											'Submit Form',
											'fair-registration'
										),
										value: 'submit',
									},
									{
										label: __(
											'Reset Form',
											'fair-registration'
										),
										value: 'reset',
									},
									{
										label: __(
											'Cancel',
											'fair-registration'
										),
										value: 'cancel',
									},
									{
										label: __(
											'Custom',
											'fair-registration'
										),
										value: 'custom',
									},
								]}
								onChange={handleButtonTypeChange}
								help={__(
									'Choose the button behavior for form interaction.',
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
	'withRegistrationButtonCustomization'
);

// Apply the filter
addFilter(
	'editor.BlockEdit',
	'fair-registration/customize-inner-button',
	withRegistrationButtonCustomization
);

/**
 * Add custom attributes to core/button when inside registration forms
 */
const addRegistrationButtonAttributes = (settings, name) => {
	if (name !== 'core/button') {
		return settings;
	}

	return {
		...settings,
		attributes: {
			...settings.attributes,
			registrationButtonType: {
				type: 'string',
				default: 'submit',
			},
		},
	};
};

addFilter(
	'blocks.registerBlockType',
	'fair-registration/add-button-attributes',
	addRegistrationButtonAttributes
);

/**
 * Add button type data attribute to button output
 */
const addRegistrationButtonProps = (extraProps, blockType, attributes) => {
	if (blockType.name !== 'core/button') {
		return extraProps;
	}

	if (attributes.registrationButtonType) {
		return {
			...extraProps,
			'data-registration-button-type': attributes.registrationButtonType,
		};
	}

	return extraProps;
};

addFilter(
	'blocks.getSaveContent.extraProps',
	'fair-registration/add-button-props',
	addRegistrationButtonProps
);
