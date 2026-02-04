/**
 * Event Info Block
 *
 * Block for displaying basic event information (dates and venue).
 */

import { registerBlockType } from '@wordpress/blocks';
import EditComponent from './components/EditComponent.js';

/**
 * Register the block
 */
registerBlockType('fair-events/event-info', {
	/**
	 * Block edit function
	 *
	 * @param {Object} props         - Block props
	 * @param {Object} props.context - Block context (postId, postType)
	 * @return {JSX.Element} The edit component
	 */
	edit: EditComponent,
});
