/**
 * Other Sessions Block
 *
 * Block for listing the upcoming sessions of a recurring event.
 */

import { registerBlockType } from '@wordpress/blocks';
import EditComponent from './components/EditComponent.js';
import './style.css';

/**
 * Register the block
 */
registerBlockType( 'fair-events/other-sessions', {
	/**
	 * Block edit function
	 *
	 * @param {Object} props               - Block props
	 * @param {Object} props.attributes    - Block attributes
	 * @param {Object} props.setAttributes - Attribute setter
	 * @return {JSX.Element} The edit component
	 */
	edit: EditComponent,
} );
