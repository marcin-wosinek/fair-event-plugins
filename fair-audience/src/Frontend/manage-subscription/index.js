/**
 * Manage-subscription page - Frontend Script
 *
 * @package FairAudience
 */

import { initDeletionDialog } from './deletionDialog.js';

( function () {
	'use strict';

	const init = () => initDeletionDialog( document );

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();
