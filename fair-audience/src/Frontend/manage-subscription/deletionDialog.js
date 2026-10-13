/**
 * "Delete My Data" confirmation dialog on the manage-subscription page.
 *
 * Without this script, or without <dialog> support, the trigger form posts
 * to the server, which renders the same confirmation as a page.
 *
 * @package FairAudience
 */

import { createDeletionDialogModel } from './deletionDialogModel.js';

/**
 * @param {Document|Element} root Where to look for the trigger and the dialog.
 * @return {Object|null} The dialog's model, or null when the dialog is not enhanced.
 */
export function initDeletionDialog( root ) {
	const triggerForm = root.querySelector(
		'[data-fair-audience-delete-trigger]'
	);
	const dialog = root.querySelector( '[data-fair-audience-delete-dialog]' );

	if ( ! triggerForm || ! dialog || typeof dialog.showModal !== 'function' ) {
		return null;
	}

	const trigger = triggerForm.querySelector( 'button[type="submit"]' );
	const confirmForm = dialog.querySelector( 'form' );
	const cancelButton = dialog.querySelector(
		'[data-fair-audience-delete-cancel]'
	);
	const confirmButton = dialog.querySelector( 'button[type="submit"]' );
	const idleLabel = confirmButton.textContent;
	const submittingLabel = confirmButton.dataset.submittingLabel || idleLabel;

	const render = ( { isOpen, isSubmitting } ) => {
		cancelButton.disabled = isSubmitting;
		confirmButton.disabled = isSubmitting;
		confirmButton.textContent = isSubmitting ? submittingLabel : idleLabel;
		dialog.setAttribute( 'aria-busy', isSubmitting ? 'true' : 'false' );

		if ( isOpen && ! dialog.open ) {
			dialog.hidden = false;
			dialog.showModal();
			cancelButton.focus();
		} else if ( ! isOpen && dialog.open ) {
			dialog.close();
			trigger.focus();
		}
	};

	const model = createDeletionDialogModel( render );

	triggerForm.addEventListener( 'submit', ( event ) => {
		event.preventDefault();
		model.open();
	} );

	cancelButton.addEventListener( 'click', () => model.dismiss() );

	// Escape: the model decides whether the dialog may close.
	dialog.addEventListener( 'cancel', ( event ) => {
		event.preventDefault();
		model.dismiss();
	} );

	// A click on the backdrop lands on the dialog element itself.
	dialog.addEventListener( 'click', ( event ) => {
		if ( event.target === dialog ) {
			model.dismiss();
		}
	} );

	confirmForm.addEventListener( 'submit', ( event ) => {
		if ( ! model.submit() ) {
			event.preventDefault();
		}
	} );

	window.addEventListener( 'pageshow', ( event ) => {
		if ( event.persisted ) {
			model.reset();
		}
	} );

	return model;
}
