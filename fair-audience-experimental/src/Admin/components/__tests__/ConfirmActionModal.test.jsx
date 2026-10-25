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
import ConfirmActionModal, { useConfirmAction } from '../ConfirmActionModal.js';

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
	expect( confirm ).toHaveAttribute( 'aria-disabled', 'true' );
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

describe( 'useConfirmAction', () => {
	const Harness = ( { action } ) => {
		const confirm = useConfirmAction();
		return (
			<>
				<button onClick={ () => confirm.open( { name: 'Demo Hall' } ) }>
					Open
				</button>
				{ confirm.target && (
					<ConfirmActionModal
						title={ `Delete ${ confirm.target.name }` }
						confirmLabel="Delete venue"
						busyLabel="Deleting…"
						isBusy={ confirm.isBusy }
						error={ confirm.error }
						onCancel={ confirm.close }
						onConfirm={ () =>
							confirm.run( action, 'The venue was not deleted.' )
						}
					>
						<p>Delete the venue?</p>
					</ConfirmActionModal>
				) }
			</>
		);
	};

	test( 'runs the action once for its target and closes on success', async () => {
		let resolve;
		const action = jest.fn(
			() => new Promise( ( done ) => ( resolve = done ) )
		);
		render( <Harness action={ action } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open' } ) );
		const confirm = screen.getByRole( 'button', { name: 'Delete venue' } );
		fireEvent.click( confirm );
		fireEvent.click( confirm );

		expect( action ).toHaveBeenCalledTimes( 1 );
		expect( action ).toHaveBeenCalledWith( { name: 'Demo Hall' } );

		await act( async () => resolve() );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	test( 'keeps the dialog open with the error, then retries', async () => {
		const action = jest
			.fn()
			.mockRejectedValueOnce( {} )
			.mockResolvedValueOnce();
		render( <Harness action={ action } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open' } ) );
		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Delete venue' } )
			)
		);

		expect(
			screen.getByRole( 'dialog', { name: 'Delete Demo Hall' } )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'The venue was not deleted.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();

		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Delete venue' } )
			)
		);

		expect( action ).toHaveBeenCalledTimes( 2 );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	test( 'shows the server message when there is one', async () => {
		const action = jest
			.fn()
			.mockRejectedValue( { message: 'Venue is in use.' } );
		render( <Harness action={ action } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open' } ) );
		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Delete venue' } )
			)
		);

		expect(
			screen.getByText( 'Venue is in use.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
	} );
} );
