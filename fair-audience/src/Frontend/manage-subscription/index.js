/**
 * Manage-subscription page - Frontend Script
 *
 * @package FairAudience
 */

import { initDeletionDialog } from './deletionDialog.js';
import { initPreferences } from './preferences.js';
import './style.css';

( function () {
	'use strict';

	const init = () => {
		initPreferences( document );
		initDeletionDialog( document );
	};

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();
