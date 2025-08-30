/**
 * Editor script for Time Column block
 */

import EditComponent from './components/EditComponent.js';
import SaveComponent from './components/SaveComponent.js';
import './view.css';
import './editor.css';

// Register the block
wp.blocks.registerBlockType('fair-timetable/time-column', {
	edit: EditComponent,
	save: SaveComponent,
});
