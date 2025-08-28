/**
 * Editor script for Time Column Body block
 */

import EditComponent from './components/EditComponent.js';
import SaveComponent from './components/SaveComponent.js';
import './view.css';
import './editor.css';

// Register the block
wp.blocks.registerBlockType('fair-timetable/time-column-body', {
	edit: EditComponent,
	save: SaveComponent,
});
