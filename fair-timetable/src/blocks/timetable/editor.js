/**
 * Timetable Block
 *
 * Container block for organizing timetable columns horizontally.
 */

import { registerBlockType } from '@wordpress/blocks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarAlt } from '@fortawesome/free-solid-svg-icons';
import EditComponent from './components/EditComponent.js';
import SaveComponent from './components/SaveComponent.js';

// Import styles
import './style.css';

/**
 * Register the block
 */
registerBlockType('fair-timetable/timetable', {
	icon: <FontAwesomeIcon icon={faCalendarAlt} />,

	/**
	 * Block edit function
	 *
	 * @param {Object}   props               - Block props
	 * @param {Object}   props.attributes    - Block attributes
	 * @param {Function} props.setAttributes - Function to set attributes
	 * @param {string}   props.clientId      - Block client ID
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
