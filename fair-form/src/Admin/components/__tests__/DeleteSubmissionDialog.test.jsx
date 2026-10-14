/**
 * @jest-environment jsdom
 *
 * Shared submission-deletion dialog (#1774): cancel sends nothing, confirm
 * sends exactly one request while pending, and a failure keeps the dialog
 * open with an inline error so the user can retry.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import DeleteSubmissionDialog from '../DeleteSubmissionDialog.js';

jest.mock( '@wordpress/api-fetch' );

const SUBMISSION = {
	id: 74,
	participant_name: 'Alex Demo',
	form_title: 'Workshop feedback',
	created_at: '2026-10-14 04:11:53',
};

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( res, rej ) => {
		resolve = res;
		reject = rej;
	} );
	return { promise, resolve, reject };
}

function renderDialog() {
	const onCancel = jest.fn();
	const onDeleted = jest.fn();
	render(
		<DeleteSubmissionDialog
			submission={ SUBMISSION }
			onCancel={ onCancel }
			onDeleted={ onDeleted }
		/>
	);
	return { onCancel, onDeleted, dialog: screen.getByRole( 'dialog' ) };
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'DeleteSubmissionDialog', () => {
	it( 'identifies the submission and explains what is kept', () => {
		const { dialog } = renderDialog();

		expect( within( dialog ).getByText( 'Alex Demo' ) ).toBeInTheDocument();
		expect(
			within( dialog ).getByText( 'Workshop feedback' )
		).toBeInTheDocument();
		expect( within( dialog ).getByText( '#74' ) ).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				/The participant, other submissions, and uploaded files are kept\./
			)
		).toBeInTheDocument();
	} );

	it( 'cancels without sending a request', () => {
		const { dialog, onCancel } = renderDialog();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( onCancel ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'sends one DELETE while pending and blocks closing', async () => {
		const request = deferred();
		apiFetch.mockReturnValue( request.promise );
		const { dialog, onCancel, onDeleted } = renderDialog();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Delete submission',
		} );

		fireEvent.click( confirm );
		fireEvent.click( confirm );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-form/v1/questionnaire-responses/74',
			method: 'DELETE',
		} );
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		fireEvent.keyDown( dialog, { key: 'Escape' } );
		expect( onCancel ).not.toHaveBeenCalled();

		request.resolve( null );
		await waitFor( () => expect( onDeleted ).toHaveBeenCalledWith( 74 ) );
	} );

	it( 'keeps the dialog open with an inline error and allows retry', async () => {
		apiFetch
			.mockRejectedValueOnce( { message: 'Database is unavailable.' } )
			.mockResolvedValueOnce( null );
		const { dialog, onDeleted } = renderDialog();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Delete submission',
		} );

		fireEvent.click( confirm );

		const notice = await waitFor( () => {
			const el = dialog.querySelector( '.components-notice' );
			expect( el ).not.toBeNull();
			return el;
		} );
		expect( notice ).toHaveTextContent( 'Database is unavailable.' );
		expect( onDeleted ).not.toHaveBeenCalled();
		expect( confirm ).toBeEnabled();

		fireEvent.click( confirm );

		await waitFor( () => expect( onDeleted ).toHaveBeenCalledWith( 74 ) );
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'falls back to a generic message when the error has none', async () => {
		apiFetch.mockRejectedValueOnce( {} );
		const { dialog } = renderDialog();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete submission',
			} )
		);

		await waitFor( () =>
			expect(
				dialog.querySelector( '.components-notice' )
			).toHaveTextContent(
				'The submission could not be deleted. Try again.'
			)
		);
	} );
} );
