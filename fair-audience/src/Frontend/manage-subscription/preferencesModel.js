/**
 * State of the email preferences form on the manage-subscription page.
 *
 * The chosen email profile and the weekly summary switch live here; every
 * related control is rendered from the view derived from them and never
 * read back. The email profile and the weekly preferences are independent:
 * changing one never hides or disables the other.
 *
 * @package FairAudience
 */

/**
 * Which controls are shown and usable for a state.
 *
 * Disabled controls are not submitted, so the server keeps what they hold:
 * the chosen feeds while the weekly summary is paused.
 *
 * @param {Object}  state               Form state.
 * @param {string}  state.profile       'marketing' or 'minimal'.
 * @param {boolean} state.weeklySummary Whether the weekly summary is on.
 * @return {Object} View.
 */
export function derivePreferencesView( { profile, weeklySummary } ) {
	return {
		selectedProfile: profile,
		feedsDisabled: ! weeklySummary,
	};
}

/**
 * @param {Object}   initialState Form state as the server rendered it.
 * @param {Function} onChange     Called with the derived view after every change.
 * @return {Object} Model.
 */
export function createPreferencesModel( initialState, onChange ) {
	let state = { ...initialState };

	return {
		getState: () => state,

		/**
		 * @param {Object} changes Changed state fields.
		 */
		update( changes ) {
			state = { ...state, ...changes };
			onChange( derivePreferencesView( state ) );
		},
	};
}
