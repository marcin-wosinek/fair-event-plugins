/**
 * Editor script for Schedule Accordion block
 */

import EditComponent from './components/EditComponent.js';
import SaveComponent from './components/SaveComponent.js';
import './view.css';
import './editor.css';

// Register the block
wp.blocks.registerBlockType('fair-schedule-blocks/schedule-accordion', {
	edit: EditComponent,
	save: SaveComponent,
});
