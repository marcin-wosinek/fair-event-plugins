/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MigrationPanel, { describeStage } from '../MigrationPanel.js';

const cutoffs = { transaction_id: 40, relationship_id: 12 };

function status( overrides = {} ) {
	return {
		blockers: [],
		cutoffs,
		dry_run: null,
		backfill: null,
		shadow_work: {},
		comparisons: { event_dates: 0, blocking: 0, incomplete: 0 },
		verified: false,
		ownership_cutover: false,
		...overrides,
	};
}

function run( overrides = {} ) {
	return {
		status: 'complete',
		phase: 'summary',
		cutoffs,
		counts: { purchase_planned: 3, links_planned: 5 },
		totals: { EUR: { attributed: 120, unresolved: 23 } },
		findings: { no_evidence: 1, allocation_mismatch: 1 },
		last_error: null,
		started_at: '2036-01-01 10:00:00',
		completed_at: '2036-01-01 10:01:00',
		...overrides,
	};
}

describe( 'describeStage', () => {
	it( 'tells apart every stage of the migration', () => {
		expect( describeStage( status() ).text ).toMatch(
			/Start with a dry run/
		);
		expect(
			describeStage( status( { dry_run: run( { status: 'running' } ) } ) )
				.text
		).toMatch( /changes nothing/ );
		expect(
			describeStage(
				status( {
					dry_run: run(),
					backfill: run( { status: 'paused' } ),
				} )
			).tone
		).toBe( 'warning' );
		expect(
			describeStage(
				status( {
					dry_run: run(),
					backfill: run( { status: 'verified' } ),
				} )
			).tone
		).toBe( 'success' );
	} );
} );

describe( 'MigrationPanel', () => {
	it( 'explains why the migration can’t start yet', () => {
		render(
			<MigrationPanel
				status={ status( {
					blockers: [ 'payment_information_unavailable' ],
				} ) }
				onAction={ jest.fn() }
			/>
		);
		expect(
			screen.getByText(
				'Payment information can’t be read because Fair Payments Connector is inactive or not installed.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Run a dry run' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByRole( 'button', { name: 'Start the migration' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'asks for a dry run over the same records before starting', () => {
		const { rerender } = render(
			<MigrationPanel status={ status() } onAction={ jest.fn() } />
		);
		expect(
			screen.getByText(
				'Run a dry run and review it before starting the migration.'
			)
		).toBeInTheDocument();

		rerender(
			<MigrationPanel
				status={ status( {
					dry_run: run( {
						cutoffs: { transaction_id: 30, relationship_id: 12 },
					} ),
				} ) }
				onAction={ jest.fn() }
			/>
		);
		expect(
			screen.getByText(
				'New records arrived since the dry run. Run it again before starting.'
			)
		).toBeInTheDocument();
	} );

	it( 'shows what the dry run found', () => {
		render(
			<MigrationPanel
				status={ status( { dry_run: run() } ) }
				onAction={ jest.fn() }
			/>
		);
		expect(
			screen.getByText(
				'Paid: 120.00 EUR can be linked automatically, 23.00 EUR needs review.'
			)
		).toBeInTheDocument();
	} );

	it( 'starts only after the backup is confirmed, naming what changes', async () => {
		const onAction = jest.fn().mockResolvedValue( undefined );
		render(
			<MigrationPanel
				status={ status( { dry_run: run() } ) }
				onAction={ onAction }
			/>
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Start the migration' } )
		);

		const dialog = screen.getByRole( 'dialog', {
			name: 'Start the payment history migration',
		} );
		expect( dialog ).toHaveTextContent(
			'The migration creates Fair Events purchases for 3 historical registrations'
		);
		expect( dialog ).toHaveTextContent( 'doesn’t charge or refund anyone' );
		expect( dialog ).toHaveTextContent(
			'fair_events_signup_payment_links'
		);

		const confirm = screen
			.getAllByRole( 'button', { name: 'Start the migration' } )
			.pop();
		fireEvent.click( confirm );
		expect( onAction ).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'I took a database backup that includes these tables.',
			} )
		);
		fireEvent.click( confirm );

		await waitFor( () =>
			expect( onAction ).toHaveBeenCalledWith( '/backfill', {
				backup_confirmed: true,
			} )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'keeps the dialog open with the server’s message when starting fails', async () => {
		const onAction = jest
			.fn()
			.mockRejectedValue(
				new Error(
					'The dry run covered different records. Run it again before starting the migration.'
				)
			);
		render(
			<MigrationPanel
				status={ status( { dry_run: run() } ) }
				onAction={ onAction }
			/>
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Start the migration' } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'I took a database backup that includes these tables.',
			} )
		);
		fireEvent.click(
			screen
				.getAllByRole( 'button', { name: 'Start the migration' } )
				.pop()
		);

		expect(
			await screen.findAllByText(
				'The dry run covered different records. Run it again before starting the migration.'
			)
		).not.toHaveLength( 0 );
		expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
	} );

	it( 'offers to verify a finished migration again', async () => {
		const onAction = jest.fn().mockResolvedValue( undefined );
		render(
			<MigrationPanel
				status={ status( {
					dry_run: run(),
					backfill: run( {
						status: 'verification_failed',
						verification: {
							blockers: {
								shadow_work_outstanding: { transaction: 2 },
							},
						},
					} ),
				} ) }
				onAction={ onAction }
			/>
		);
		expect(
			screen.getAllByText(
				'Some recent payments are still waiting to be recorded.'
			)
		).not.toHaveLength( 0 );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Verify again' } )
		);
		await waitFor( () =>
			expect( onAction ).toHaveBeenCalledWith( '/verify', {} )
		);
	} );
} );
