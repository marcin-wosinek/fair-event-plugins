/**
 * @jest-environment jsdom
 *
 * The adapter only adds this plugin's Cancel label and class to the shared
 * dialog, whose behaviour fair-events-shared tests (#2228).
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { __ } from '@wordpress/i18n';
import { CONFIRM_ACTION_MODAL_CLASS } from 'fair-events-shared/src/ConfirmActionModal.js';
import ConfirmActionModal, { useConfirmAction } from '../ConfirmActionModal.js';

jest.mock( '@wordpress/i18n', () => {
	const actual = jest.requireActual( '@wordpress/i18n' );
	return { ...actual, __: jest.fn( ( text ) => text ) };
} );

test( 'translates Cancel in this plugin’s text domain and adds its class', () => {
	render(
		<ConfirmActionModal
			title="Delete venue?"
			confirmLabel="Delete venue"
			onConfirm={ jest.fn() }
			onCancel={ jest.fn() }
		>
			<p>Delete the venue Demo Hall?</p>
		</ConfirmActionModal>
	);

	expect( __ ).toHaveBeenCalledWith(
		'Cancel',
		'fair-payments-connector-experimental'
	);
	expect(
		screen.getByRole( 'button', { name: 'Cancel' } )
	).toBeInTheDocument();
	const frame = document.querySelector( '.components-modal__frame' );
	expect( frame ).toHaveClass( CONFIRM_ACTION_MODAL_CLASS );
	expect( frame ).toHaveClass(
		'fair-payments-connector-experimental-confirm-action-modal'
	);
} );

test( 're-exports the shared hook', () => {
	expect( typeof useConfirmAction ).toBe( 'function' );
} );
