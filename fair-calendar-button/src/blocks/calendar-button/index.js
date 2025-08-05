/**
 * Calendar Button Block
 *
 * Block for adding calendar buttons to posts and pages.
 */

import { registerBlockType } from '@wordpress/blocks';
import EditComponent from './components/EditComponent.js';
import SaveComponent from './components/SaveComponent.js';

// Import filters to customize inner blocks
import './filters/buttonFilter.js';

/**
 * Register the block
 */
registerBlockType('fair-calendar-button/calendar-button', {
	/**
	 * Block edit function
	 *
	 * @param {Object}   props               - Block props
	 * @param {Object}   props.attributes    - Block attributes
	 * @param {Function} props.setAttributes - Function to set attributes
	 * @return {JSX.Element} The edit component
	 */
	edit: EditComponent,

	/**
	 * Block save function
	 *
	 * @param {Object} props            - Block props
	 * @param {Object} props.attributes - Block attributes
	 * @return {JSX.Element} The save component
	 */
	save: SaveComponent,
});
