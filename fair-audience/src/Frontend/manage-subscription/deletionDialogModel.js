/**
 * State of the "Delete My Data" confirmation dialog.
 *
 * The dialog's open and submitting phases live here; the DOM is rendered
 * from them and never read back.
 *
 * @package FairAudience
 */

/**
 * @param {Function} onChange Called with the new state after every change.
 * @return {Object} Model.
 */
export function createDeletionDialogModel( onChange ) {
	let state = { isOpen: false, isSubmitting: false };

	const update = ( changes ) => {
		state = { ...state, ...changes };
		onChange( state );
	};

	return {
		getState: () => state,

		open() {
			if ( ! state.isOpen ) {
				update( { isOpen: true } );
			}
		},

		// Closes without deleting. Refused once the deletion is on its way.
		dismiss() {
			if ( state.isOpen && ! state.isSubmitting ) {
				update( { isOpen: false } );
			}
		},

		/**
		 * @return {boolean} True for the one submission that may be sent.
		 */
		submit() {
			if ( ! state.isOpen || state.isSubmitting ) {
				return false;
			}
			update( { isSubmitting: true } );
			return true;
		},

		// The page came back without a new render, e.g. from the back/forward cache.
		reset() {
			update( { isOpen: false, isSubmitting: false } );
		},
	};
}
