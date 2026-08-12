/**
 * Custom hook to access parent calendar-button event data from inner blocks
 *
 * @package FairCalendarButton
 */

import { useSelect } from '@wordpress/data';

/**
 * Hook to get parent calendar-button attributes from any inner block
 *
 * @param {string} clientId The client ID of the current block
 * @return {Object} Parent calendar-button attributes or empty object
 */
export function useParentEventData(clientId) {
	return useSelect(
		(select) => {
			const { getBlockParents, getBlock } = select('core/block-editor');

			if (!clientId) {
				return {};
			}

			const parents = getBlockParents(clientId);

			if (!parents || parents.length === 0) {
				return {};
			}

			// Find the calendar-button parent by traversing up the hierarchy
			for (const parentId of parents) {
				const parentBlock = getBlock(parentId);
				if (
					parentBlock?.name === 'fair-calendar-button/calendar-button'
				) {
					return parentBlock.attributes || {};
				}
			}

			return {};
		},
		[clientId]
	);
}
