/**
 * Schedule Column Block
 *
 * Block for organizing time blocks in columns by track, day, or category.
 */

import { registerBlockType } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { columns as icon } from '@wordpress/icons';
import EditComponent from './components/EditComponent.js';
import SaveComponent from './components/SaveComponent.js';

/**
 * Register the block
 */
registerBlockType('fair-schedule/schedule-column', {
	icon,

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
