/**
 * @jest-environment jsdom
 *
 * Component tests for the confirmation dialog shared by Audience
 * Experimental, Events Experimental, Payments Connector Experimental,
 * Finance and Platform (#2228). Each plugin's adapter only adds its Cancel
 * label and class, so the behaviour is covered once here.
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
import { Modal } from '@wordpress/components';
import ConfirmActionModal, {
	useConfirmAction,
	CONFIRM_ACTION_MODAL_CLASS,
} from '../ConfirmActionModal.js';

const pressEscape = ( element ) =>
	fireEvent.keyDown( element, {
		key: 'Escape',
		code: 'Escape',
		keyCode: 27,
	} );

const renderModal = ( props = {} ) => {
	const onConfirm = jest.fn();
	const onCancel = jest.fn();
	render(
		<ConfirmActionModal
			title="Delete venue?"
			confirmLabel="Delete venue"
			busyLabel="Deleting…"
			cancelLabel="Cancel"
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

	pressEscape( screen.getByRole( 'dialog' ) );

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
	pressEscape( screen.getByRole( 'dialog' ) );

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

test( 'carries the shared class beside the class it is given', () => {
	renderModal( { className: 'fair-demo-confirm-action-modal' } );

	const frame = document.querySelector( '.components-modal__frame' );
	expect( frame ).toHaveClass( CONFIRM_ACTION_MODAL_CLASS );
	expect( frame ).toHaveClass( 'fair-demo-confirm-action-modal' );
	expect( document.querySelector( 'style' ).textContent ).toContain(
		`.${ CONFIRM_ACTION_MODAL_CLASS } .components-modal__header-heading`
	);
} );

test( 'uses the Cancel label it is given', () => {
	renderModal( { cancelLabel: 'Cancelar' } );

	expect(
		screen.getByRole( 'button', { name: 'Cancelar' } )
	).toBeInTheDocument();
} );

test( 'puts focus on the confirming button, which stays focusable while pending', () => {
	const onConfirm = jest.fn();
	const props = {
		title: 'Delete venue?',
		confirmLabel: 'Delete venue',
		busyLabel: 'Deleting…',
		cancelLabel: 'Cancel',
		onConfirm,
		onCancel: jest.fn(),
	};
	const { rerender } = render(
		<ConfirmActionModal { ...props }>
			<p>Delete the venue Demo Hall?</p>
		</ConfirmActionModal>
	);
	const confirm = screen.getByRole( 'button', { name: 'Delete venue' } );
	confirm.focus();

	rerender(
		<ConfirmActionModal { ...props } isBusy>
			<p>Delete the venue Demo Hall?</p>
		</ConfirmActionModal>
	);

	const pending = screen.getByRole( 'button', { name: 'Deleting…' } );
	expect( pending ).not.toHaveAttribute( 'disabled' );
	expect( pending ).toHaveFocus();
} );

test( 'a click outside does not cancel while pending', async () => {
	const { onCancel } = renderModal( { isBusy: true } );
	const overlay = document.querySelector(
		'.components-modal__screen-overlay'
	);

	fireEvent.mouseDown( overlay );
	fireEvent.mouseUp( overlay );
	fireEvent.click( overlay );
	await act( () => new Promise( ( resolve ) => setTimeout( resolve, 50 ) ) );

	expect( onCancel ).not.toHaveBeenCalled();
} );

test( 'idle, the close button cancels', async () => {
	const { onCancel } = renderModal();

	fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );

	await waitFor( () => expect( onCancel ).toHaveBeenCalledTimes( 1 ) );
} );

describe( 'inside another modal', () => {
	const Nested = ( { isBusy, onOuterClose } ) => (
		<Modal title="Edit entry" onRequestClose={ onOuterClose }>
			<ConfirmActionModal
				title="Unsplit entry?"
				confirmLabel="Unsplit"
				busyLabel="Unsplitting…"
				cancelLabel="Cancel"
				isBusy={ isBusy }
				onConfirm={ jest.fn() }
				onCancel={ jest.fn() }
			>
				<p>The parts merge back into one entry.</p>
			</ConfirmActionModal>
		</Modal>
	);

	test( 'Escape while pending reaches neither dialog', async () => {
		const onOuterClose = jest.fn();
		render( <Nested isBusy onOuterClose={ onOuterClose } /> );

		// Mounted together, the outer modal marks the inner one's portal
		// aria-hidden in jsdom, so find the button by its text.
		pressEscape( screen.getByText( 'Unsplitting…' ) );
		await act(
			() => new Promise( ( resolve ) => setTimeout( resolve, 50 ) )
		);

		expect( onOuterClose ).not.toHaveBeenCalled();
		expect( screen.getByText( 'Unsplit entry?' ) ).toBeInTheDocument();
	} );
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
						cancelLabel="Cancel"
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
	test( 'clears a stale error on retry and on dismissal', async () => {
		let reject;
		const action = jest
			.fn()
			.mockRejectedValueOnce( { message: 'Venue is in use.' } )
			.mockImplementationOnce(
				() => new Promise( ( _, fail ) => ( reject = fail ) )
			);
		render( <Harness action={ action } /> );
		const errorText = () =>
			screen.queryByText( 'Venue is in use.', {
				selector: '.components-notice__content',
			} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open' } ) );
		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Delete venue' } )
			)
		);
		expect( errorText() ).toBeInTheDocument();

		// Retrying hides the old error while the new attempt runs.
		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Delete venue' } )
			)
		);
		expect( errorText() ).not.toBeInTheDocument();
		await act( async () => reject( { message: 'Venue is in use.' } ) );
		expect( errorText() ).toBeInTheDocument();

		// Dismissing and reopening starts clean.
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Open' } ) );
		expect( errorText() ).not.toBeInTheDocument();
	} );

	test( 'close is ignored while the action runs', async () => {
		let resolve;
		const action = jest.fn(
			() => new Promise( ( done ) => ( resolve = done ) )
		);
		const Probe = () => {
			const confirm = useConfirmAction();
			return (
				<>
					<button onClick={ () => confirm.open( { name: 'Hall' } ) }>
						Open
					</button>
					<button
						onClick={ () => confirm.run( action, 'Not deleted.' ) }
					>
						Run
					</button>
					<button onClick={ confirm.close }>Close it</button>
					<output>{ confirm.target ? 'open' : 'closed' }</output>
				</>
			);
		};
		render( <Probe /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Run' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close it' } ) );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'open' );

		await act( async () => resolve() );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'closed' );
	} );

	test( 'two dialogs on one page keep their own state', async () => {
		let resolveFirst;
		const first = jest.fn(
			() => new Promise( ( done ) => ( resolveFirst = done ) )
		);
		const second = jest.fn().mockResolvedValue();
		const Two = () => {
			const a = useConfirmAction();
			const b = useConfirmAction();
			return (
				<>
					<button onClick={ () => a.run( first, 'A failed.' ) }>
						Run A
					</button>
					<button onClick={ () => b.run( second, 'B failed.' ) }>
						Run B
					</button>
					<span data-testid="a">{ String( a.isBusy ) }</span>
					<span data-testid="b">{ String( b.isBusy ) }</span>
				</>
			);
		};
		render( <Two /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Run A' } ) );
		await act( async () =>
			fireEvent.click( screen.getByRole( 'button', { name: 'Run B' } ) )
		);

		expect( second ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByTestId( 'a' ) ).toHaveTextContent( 'true' );
		expect( screen.getByTestId( 'b' ) ).toHaveTextContent( 'false' );

		await act( async () => resolveFirst() );
		expect( screen.getByTestId( 'a' ) ).toHaveTextContent( 'false' );
	} );
} );
