/**
 * Component tests for the Privacy tab (#1484): whether ticket payments send
 * the buyer's email to the payment provider.
 */
import '@testing-library/jest-dom';
import {
	act,
	render,
	screen,
	waitFor,
	fireEvent,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import PrivacyTab from '../PrivacyTab.js';

jest.mock( '@wordpress/api-fetch' );

const LABEL = 'Send ticket buyers’ emails to the payment provider';

function mockApiFetch( { shareEmail = false, save } = {} ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/wp/v2/settings' ) {
			return Promise.resolve( {
				fair_payment_share_ticket_buyer_email: shareEmail,
			} );
		}
		return save ? save() : Promise.resolve( { success: true } );
	} );
}

// Notice also speaks its message through an a11y live region; read the
// visible notice only.
function errorNoticeText() {
	return document.querySelector( '.components-notice.is-error' )?.textContent;
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'PrivacyTab', () => {
	it( 'shows the stored choice and explains the disclosure', async () => {
		mockApiFetch( { shareEmail: true } );
		render( <PrivacyTab onNotice={ () => {} } /> );

		const toggle = await screen.findByRole( 'checkbox', { name: LABEL } );
		expect( toggle ).toBeChecked();
		expect(
			screen.getByText(
				/sends personal data to the external payment provider/
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/does not change data already held by a provider/
			)
		).toBeInTheDocument();
	} );

	it( 'marks unsaved changes and saves only the privacy setting through the connector endpoint', async () => {
		mockApiFetch();
		const onNotice = jest.fn();
		render( <PrivacyTab onNotice={ onNotice } /> );

		const toggle = await screen.findByRole( 'checkbox', { name: LABEL } );
		expect(
			screen.queryByText( 'You have unsaved changes.' )
		).not.toBeInTheDocument();

		fireEvent.click( toggle );
		expect(
			screen.getByText( 'You have unsaved changes.' )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Save privacy settings' } )
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-payments-connector/v1/settings',
			method: 'POST',
			data: {
				settings: { fair_payment_share_ticket_buyer_email: true },
			},
		} );
		expect( onNotice ).toHaveBeenCalledWith( {
			status: 'success',
			message: 'Privacy settings saved.',
		} );
		expect(
			screen.queryByText( 'You have unsaved changes.' )
		).not.toBeInTheDocument();
	} );

	it( 'warns before leaving the page with unsaved changes', async () => {
		mockApiFetch();
		render( <PrivacyTab onNotice={ () => {} } /> );

		fireEvent.click(
			await screen.findByRole( 'checkbox', { name: LABEL } )
		);

		const event = new Event( 'beforeunload', { cancelable: true } );
		window.dispatchEvent( event );
		expect( event.defaultPrevented ).toBe( true );
	} );

	it( 'keeps the edit and shows the error inline when saving fails, so it can be retried', async () => {
		let attempts = 0;
		mockApiFetch( {
			save: () => {
				attempts += 1;
				return attempts === 1
					? Promise.reject( { message: 'Server unavailable.' } )
					: Promise.resolve( { success: true } );
			},
		} );
		render( <PrivacyTab onNotice={ () => {} } /> );

		const toggle = await screen.findByRole( 'checkbox', { name: LABEL } );
		fireEvent.click( toggle );

		const save = screen.getByRole( 'button', {
			name: 'Save privacy settings',
		} );
		await act( async () => {
			fireEvent.click( save );
		} );

		expect( errorNoticeText() ).toContain( 'Server unavailable.' );
		expect( toggle ).toBeChecked();
		expect(
			screen.getByText( 'You have unsaved changes.' )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click( save );
		} );

		expect( errorNoticeText() ).toBeUndefined();
		expect( attempts ).toBe( 2 );
	} );

	it( 'offers a retry when the setting cannot be loaded', async () => {
		mockApiFetch();
		apiFetch.mockRejectedValueOnce( { message: 'Load failed.' } );
		render( <PrivacyTab onNotice={ () => {} } /> );

		await waitFor( () =>
			expect( errorNoticeText() ).toContain( 'Load failed.' )
		);

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Try again' } )
			);
		} );

		await waitFor( () =>
			expect(
				screen.getByRole( 'checkbox', { name: LABEL } )
			).toBeInTheDocument()
		);
	} );
} );
