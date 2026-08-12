/**
 * Filter to customize core/button blocks inside fair-calendar-button/calendar-button
 *
 * @package FairCalendarButton
 */

import { addFilter } from '@wordpress/hooks';
import { createHigherOrderComponent } from '@wordpress/compose';
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody, Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';

/**
 * Higher-order component to customize core/button when inside calendar-button
 */
const withCalendarButtonCustomization = createHigherOrderComponent(
	(BlockEdit) => {
		return (props) => {
			const { name, clientId } = props;

			// Only apply to core/button blocks
			if (name !== 'core/button') {
				return <BlockEdit {...props} />;
			}

			// Get parent block info
			const { parentBlockId, isInsideCalendarButton } = useSelect(
				(select) => {
					const { getBlockParents, getBlock } =
						select('core/block-editor');
					const parents = getBlockParents(clientId);
					const immediateParentId = parents[parents.length - 1];
					const parentBlock = immediateParentId
						? getBlock(immediateParentId)
						: null;

					return {
						parentBlockId: immediateParentId,
						isInsideCalendarButton:
							parentBlock?.name ===
							'fair-calendar-button/calendar-button',
					};
				},
				[clientId]
			);

			const { selectBlock } = useDispatch('core/block-editor');

			// Function to focus parent block
			const focusParent = () => {
				if (parentBlockId) {
					selectBlock(parentBlockId);
				}
			};

			// Only customize if this button is inside a calendar-button
			if (!isInsideCalendarButton) {
				return <BlockEdit {...props} />;
			}

			return (
				<>
					{/* Original button edit component */}
					<BlockEdit {...props} />

					{/* Additional Inspector Controls */}
					<InspectorControls>
						<PanelBody
							title={__(
								'Calendar Event Details',
								'fair-calendar-button'
							)}
							initialOpen={true}
							icon="calendar-alt"
						>
							<Button
								variant="secondary"
								onClick={focusParent}
								icon="arrow-up-alt"
							>
								{__(
									'Edit Calendar Event',
									'fair-calendar-button'
								)}
							</Button>
						</PanelBody>
					</InspectorControls>
				</>
			);
		};
	},
	'withCalendarButtonCustomization'
);

// Apply the filter
addFilter(
	'editor.BlockEdit',
	'fair-calendar-button/customize-inner-button',
	withCalendarButtonCustomization
);
