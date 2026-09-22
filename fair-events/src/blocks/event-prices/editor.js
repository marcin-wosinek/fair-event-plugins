/**
 * Event Prices Block
 *
 * Block for displaying an event's public ticket prices.
 */

import { registerBlockType } from '@wordpress/blocks';
import EditComponent from './components/EditComponent.js';
import './style.css';

/**
 * Register the block
 */
registerBlockType( 'fair-events/event-prices', {
	/**
	 * Block edit function
	 *
	 * @param {Object} props         - Block props
	 * @param {Object} props.context - Block context (postId, postType)
	 * @return {JSX.Element} The edit component
	 */
	edit: EditComponent,
} );
