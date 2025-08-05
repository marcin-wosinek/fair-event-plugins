/**
 * Filter to customize core/button blocks inside fair-calendar-button/calendar-button
 *
 * @package FairCalendarButton
 */

import { addFilter } from '@wordpress/hooks';
import { createHigherOrderComponent } from '@wordpress/compose';
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody, Notice, Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import { useParentEventData } from '../utils/useParentEventData.js';

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

			// Get parent calendar-button event data
			const eventData = useParentEventData(clientId);

			// Get parent block ID and dispatch function
			const { parentBlockId } = useSelect(
				(select) => {
					const { getBlockParents } = select('core/block-editor');
					const parents = getBlockParents(clientId);
					return {
						parentBlockId: parents[parents.length - 1], // Immediate parent
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
			const isInsideCalendarButton =
				eventData && Object.keys(eventData).length > 0;

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
