/**
 * Simple Payment Block
 *
 * Block for displaying simple payment buttons.
 */

import { registerBlockType } from '@wordpress/blocks';
import { Icon, payment } from '@wordpress/icons';
import EditComponent from './components/EditComponent.js';
import SaveComponent from './components/SaveComponent.js';

/**
 * Register the block
 */
registerBlockType('fair-payment/simple-payment-block', {
	icon: <Icon icon={payment} />,

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
