/**
 * State transitions of the "Delete My Data" confirmation dialog.
 */

import { createDeletionDialogModel } from '../deletionDialogModel.js';

function setup() {
	const onChange = jest.fn();
	const model = createDeletionDialogModel( onChange );
	return { model, onChange };
}

describe( 'createDeletionDialogModel', () => {
	it( 'starts closed and idle', () => {
		const { model, onChange } = setup();

		expect( model.getState() ).toEqual( {
			isOpen: false,
			isSubmitting: false,
		} );
		expect( onChange ).not.toHaveBeenCalled();
	} );

	it( 'opens without submitting', () => {
		const { model, onChange } = setup();

		model.open();

		expect( model.getState() ).toEqual( {
			isOpen: true,
			isSubmitting: false,
		} );
		expect( onChange ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'dismisses back to closed without submitting', () => {
		const { model } = setup();

		model.open();
		model.dismiss();

		expect( model.getState() ).toEqual( {
			isOpen: false,
			isSubmitting: false,
		} );
	} );

	it( 'refuses a submission while closed', () => {
		const { model, onChange } = setup();

		expect( model.submit() ).toBe( false );
		expect( model.getState().isSubmitting ).toBe( false );
		expect( onChange ).not.toHaveBeenCalled();
	} );

	it( 'allows exactly one submission', () => {
		const { model } = setup();

		model.open();

		expect( model.submit() ).toBe( true );
		expect( model.submit() ).toBe( false );
		expect( model.submit() ).toBe( false );
		expect( model.getState() ).toEqual( {
			isOpen: true,
			isSubmitting: true,
		} );
	} );

	it( 'stays open when dismissed while submitting', () => {
		const { model } = setup();

		model.open();
		model.submit();
		model.dismiss();

		expect( model.getState() ).toEqual( {
			isOpen: true,
			isSubmitting: true,
		} );
	} );

	it( 'resets to closed and allows a new submission', () => {
		const { model } = setup();

		model.open();
		model.submit();
		model.reset();

		expect( model.getState() ).toEqual( {
			isOpen: false,
			isSubmitting: false,
		} );

		model.open();
		expect( model.submit() ).toBe( true );
	} );
} );
