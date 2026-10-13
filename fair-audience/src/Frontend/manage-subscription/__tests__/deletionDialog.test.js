/**
 * The "Delete My Data" dialog rendered from its model.
 */

import { initDeletionDialog } from '../deletionDialog.js';

const MARKUP = `
	<form method="post" data-fair-audience-delete-trigger>
		<input type="hidden" name="delete_my_data" value="1">
		<button type="submit">Delete My Data</button>
	</form>
	<dialog data-fair-audience-delete-dialog hidden>
		<form method="post">
			<input type="hidden" name="confirm_delete_my_data" value="1">
			<button type="button" data-fair-audience-delete-cancel>Cancel</button>
			<button type="submit" data-submitting-label="Deleting…">Delete My Data</button>
		</form>
	</dialog>
`;

function submitEvent() {
	return new Event( 'submit', { bubbles: true, cancelable: true } );
}

// jsdom has no modal dialogs; stand in for the two methods the script calls.
function setup( { withDialogSupport = true } = {} ) {
	document.body.innerHTML = MARKUP;

	const dialog = document.querySelector( 'dialog' );
	if ( withDialogSupport ) {
		dialog.showModal = jest.fn( () => {
			dialog.open = true;
		} );
		dialog.close = jest.fn( () => {
			dialog.open = false;
		} );
	} else {
		dialog.showModal = undefined;
	}

	const triggerForm = document.querySelector(
		'[data-fair-audience-delete-trigger]'
	);

	return {
		model: initDeletionDialog( document ),
		dialog,
		triggerForm,
		trigger: triggerForm.querySelector( 'button' ),
		confirmForm: dialog.querySelector( 'form' ),
		cancel: dialog.querySelector( '[data-fair-audience-delete-cancel]' ),
		confirm: dialog.querySelector( 'button[type="submit"]' ),
	};
}

describe( 'initDeletionDialog', () => {
	it( 'opens the dialog instead of posting the trigger form', () => {
		const { triggerForm, dialog, cancel } = setup();
		const event = submitEvent();

		triggerForm.dispatchEvent( event );

		expect( event.defaultPrevented ).toBe( true );
		expect( dialog.showModal ).toHaveBeenCalledTimes( 1 );
		expect( dialog.hidden ).toBe( false );
		expect( document.activeElement ).toBe( cancel );
	} );

	it( 'closes on Cancel and returns focus to the trigger', () => {
		const { triggerForm, dialog, cancel, trigger } = setup();

		triggerForm.dispatchEvent( submitEvent() );
		cancel.click();

		expect( dialog.close ).toHaveBeenCalledTimes( 1 );
		expect( document.activeElement ).toBe( trigger );
	} );

	it( 'closes on Escape and returns focus to the trigger', () => {
		const { triggerForm, dialog, trigger } = setup();

		triggerForm.dispatchEvent( submitEvent() );
		dialog.dispatchEvent( new Event( 'cancel', { cancelable: true } ) );

		expect( dialog.close ).toHaveBeenCalledTimes( 1 );
		expect( document.activeElement ).toBe( trigger );
	} );

	it( 'closes on a backdrop click but not on a click inside', () => {
		const { triggerForm, dialog, confirmForm } = setup();

		triggerForm.dispatchEvent( submitEvent() );
		confirmForm.click();
		expect( dialog.close ).not.toHaveBeenCalled();

		dialog.click();
		expect( dialog.close ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'lets one confirmed submission through and blocks repeats', () => {
		const { triggerForm, confirmForm, cancel, confirm, dialog } = setup();

		triggerForm.dispatchEvent( submitEvent() );

		const first = submitEvent();
		confirmForm.dispatchEvent( first );
		const second = submitEvent();
		confirmForm.dispatchEvent( second );

		expect( first.defaultPrevented ).toBe( false );
		expect( second.defaultPrevented ).toBe( true );
		expect( cancel.disabled ).toBe( true );
		expect( confirm.disabled ).toBe( true );
		expect( confirm.textContent ).toBe( 'Deleting…' );
		expect( dialog.getAttribute( 'aria-busy' ) ).toBe( 'true' );
	} );

	it( 'keeps the dialog open on Escape while submitting', () => {
		const { triggerForm, confirmForm, dialog } = setup();

		triggerForm.dispatchEvent( submitEvent() );
		confirmForm.dispatchEvent( submitEvent() );
		const escape = new Event( 'cancel', { cancelable: true } );
		dialog.dispatchEvent( escape );

		expect( escape.defaultPrevented ).toBe( true );
		expect( dialog.close ).not.toHaveBeenCalled();
	} );

	it( 'restores the controls when the page returns from the back/forward cache', () => {
		const { triggerForm, confirmForm, cancel, confirm, dialog } = setup();

		triggerForm.dispatchEvent( submitEvent() );
		confirmForm.dispatchEvent( submitEvent() );

		const pageshow = new Event( 'pageshow' );
		pageshow.persisted = true;
		window.dispatchEvent( pageshow );

		expect( dialog.close ).toHaveBeenCalledTimes( 1 );
		expect( cancel.disabled ).toBe( false );
		expect( confirm.disabled ).toBe( false );
		expect( confirm.textContent ).toBe( 'Delete My Data' );
	} );

	it( 'leaves the trigger form to the server without dialog support', () => {
		const { model, triggerForm } = setup( { withDialogSupport: false } );
		const event = submitEvent();

		triggerForm.dispatchEvent( event );

		expect( model ).toBeNull();
		expect( event.defaultPrevented ).toBe( false );
	} );
} );
