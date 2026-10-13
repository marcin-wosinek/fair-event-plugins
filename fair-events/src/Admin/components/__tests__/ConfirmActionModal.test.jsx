/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
	act,
} from '@testing-library/react';
import ConfirmActionModal from '../ConfirmActionModal.js';

const renderModal = ( props = {} ) => {
	const onConfirm = jest.fn();
	const onCancel = jest.fn();
	render(
		<ConfirmActionModal
			title="Delete venue?"
			confirmLabel="Delete venue"
			busyLabel="Deleting…"
			onConfirm={ onConfirm }
			onCancel={ onCancel }
			{ ...props }
		>
			<p>Delete the venue Demo Hall?</p>
		</ConfirmActionModal>
	);
	return { onConfirm, onCancel };
};

test( 'shows the title, the consequences and an action-specific button', () => {
	renderModal( { isDestructive: true } );

	expect(
		screen.getByRole( 'dialog', { name: 'Delete venue?' } )
	).toBeInTheDocument();
	expect(
		screen.getByText( 'Delete the venue Demo Hall?' )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Delete venue' } )
	).toHaveClass( 'is-destructive' );
} );

test( 'confirming and cancelling call their handlers', () => {
	const { onConfirm, onCancel } = renderModal();

	fireEvent.click( screen.getByRole( 'button', { name: 'Delete venue' } ) );
	expect( onConfirm ).toHaveBeenCalledTimes( 1 );

	fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	expect( onCancel ).toHaveBeenCalledTimes( 1 );
} );

test( 'Escape cancels while idle', async () => {
	const { onCancel } = renderModal();

	fireEvent.keyDown( screen.getByRole( 'dialog' ), {
		key: 'Escape',
		code: 'Escape',
		keyCode: 27,
	} );

	await waitFor( () => expect( onCancel ).toHaveBeenCalledTimes( 1 ) );
} );

test( 'a pending action cannot be submitted again or dismissed', async () => {
	const { onConfirm, onCancel } = renderModal( { isBusy: true } );

	const confirm = screen.getByRole( 'button', { name: 'Deleting…' } );
	expect( confirm ).toBeDisabled();
	expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toBeDisabled();
	expect(
		screen.queryByRole( 'button', { name: 'Close' } )
	).not.toBeInTheDocument();

	fireEvent.click( confirm );
	fireEvent.keyDown( screen.getByRole( 'dialog' ), {
		key: 'Escape',
		code: 'Escape',
		keyCode: 27,
	} );

	await act( () => new Promise( ( resolve ) => setTimeout( resolve, 50 ) ) );

	expect( onConfirm ).not.toHaveBeenCalled();
	expect( onCancel ).not.toHaveBeenCalled();
} );

test( 'an error stays in the dialog next to its context', () => {
	renderModal( { error: 'Demo Hall was not deleted.' } );

	expect(
		within( screen.getByRole( 'dialog' ) ).getByText(
			'Demo Hall was not deleted.'
		)
	).toBeInTheDocument();
	expect(
		screen.getByText( 'Delete the venue Demo Hall?' )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Delete venue' } )
	).not.toBeDisabled();
} );

test( 'the confirming button can be withheld while cancelling stays possible', () => {
	const { onConfirm, onCancel } = renderModal( { confirmDisabled: true } );

	const confirm = screen.getByRole( 'button', { name: 'Delete venue' } );
	expect( confirm ).toBeDisabled();
	fireEvent.click( confirm );
	expect( onConfirm ).not.toHaveBeenCalled();

	fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	expect( onCancel ).toHaveBeenCalledTimes( 1 );
} );
