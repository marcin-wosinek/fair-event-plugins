/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import CutoverPanel, { workTotals } from '../CutoverPanel.js';

function cutover( overrides = {} ) {
	return {
		active: false,
		activation: null,
		blockers: [],
		issues: [],
		work: {},
		...overrides,
	};
}

describe( 'workTotals', () => {
	it( 'adds every status of a kind and skips empty kinds', () => {
		expect(
			workTotals( {
				payment: { pending: 1, failed: 2 },
				transaction: { unresolved: 1 },
				confirmation: {},
			} )
		).toEqual( [
			[ 'transaction', 1 ],
			[ 'payment', 3 ],
		] );
	} );
} );

describe( 'CutoverPanel', () => {
	it( 'explains each blocker and withholds the switch', () => {
		render(
			<CutoverPanel
				cutover={ cutover( {
					blockers: [
						'migration_unverified',
						'audience_lifecycle_unavailable',
					],
				} ) }
				onAction={ jest.fn() }
			/>
		);

		expect(
			screen.getByText(
				'Fair Audience is too old to record its payments in Fair Events. Update Fair Audience first.'
			)
		).toBeInTheDocument();
		expect(
			screen.getAllByText( /The migration hasn’t been verified yet/ )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'Switch payment records to Fair Events',
			} )
		).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'switches only after the backup is confirmed, once', async () => {
		let resolve;
		const onAction = jest.fn(
			() =>
				new Promise( ( r ) => {
					resolve = r;
				} )
		);
		render( <CutoverPanel cutover={ cutover() } onAction={ onAction } /> );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Switch payment records to Fair Events',
			} )
		);
		expect(
			screen.getByText( 'fair_events_payment_shadow_work' )
		).toBeInTheDocument();
		const confirm = screen.getByRole( 'button', {
			name: 'Switch payment records',
		} );
		expect( confirm ).toBeDisabled();

		fireEvent.click(
			screen.getByLabelText(
				'I took a fresh database backup that includes these tables.'
			)
		);
		fireEvent.click( confirm );
		fireEvent.click( screen.getByRole( 'button', { name: 'Switching…' } ) );

		expect( onAction ).toHaveBeenCalledTimes( 1 );
		expect( onAction ).toHaveBeenCalledWith( '/cutover', {
			backup_confirmed: true,
		} );
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();

		await act( async () => resolve() );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'keeps the dialog open with the server’s error', async () => {
		const onAction = jest.fn().mockRejectedValue( {
			message:
				'The verification no longer passes. Verify the migration again before switching payment records.',
		} );
		render( <CutoverPanel cutover={ cutover() } onAction={ onAction } /> );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Switch payment records to Fair Events',
			} )
		);
		fireEvent.click(
			screen.getByLabelText(
				'I took a fresh database backup that includes these tables.'
			)
		);
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Switch payment records' } )
			);
		} );

		expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		expect(
			screen.getAllByText( /The verification no longer passes/ )[ 0 ]
		).toBeInTheDocument();
	} );

	it( 'shows the activation, what needs repair and the queued work', () => {
		render(
			<CutoverPanel
				cutover={ cutover( {
					active: true,
					activation: {
						activated_at: '2036-01-01 10:00:00',
						user_name: 'Ada Admin',
					},
					issues: [ 'verification_failed' ],
					work: { projection: { failed: 2 } },
				} ) }
				onAction={ jest.fn() }
			/>
		);

		expect(
			screen.getAllByText(
				/Payment records use Fair Events since .*Switched by Ada Admin\./
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getAllByText( /payment records keep using Fair Events/ )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Updates to pass to Fair Audience' )
		).toBeInTheDocument();
		expect( screen.getByText( '2' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Switch payment records to Fair Events',
			} )
		).not.toBeInTheDocument();
	} );
} );
