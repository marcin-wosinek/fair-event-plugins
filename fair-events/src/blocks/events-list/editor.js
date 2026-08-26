/**
 * Events List Block
 *
 * Block for displaying a list of events with filtering options.
 */

import { registerBlockType } from '@wordpress/blocks';
import EditComponent from './components/EditComponent.js';
import './style.scss';

/**
 * Register the block
 */
registerBlockType( 'fair-events/events-list', {
	/**
	 * Block edit function
	 *
	 * @param {Object}   props               - Block props
	 * @param {Object}   props.attributes    - Block attributes
	 * @param {Function} props.setAttributes - Function to set attributes
	 * @return {JSX.Element} The edit component
	 */
	edit: EditComponent,
} );
