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
import ReadersPanel from '../ReadersPanel.js';

function readers( overrides = {} ) {
	return {
		active: false,
		activation: null,
		blockers: [],
		relationship_admissions: [],
		...overrides,
	};
}

describe( 'ReadersPanel', () => {
	it( 'explains each blocker, names blocking dates and withholds the switch', () => {
		render(
			<ReadersPanel
				readers={ readers( {
					blockers: [
						'verification_before_cutover',
						'relationship_admissions',
					],
					relationship_admissions: [ 12, 15 ],
				} ) }
				onAction={ jest.fn() }
			/>
		);

		expect(
			screen.getAllByText(
				/The last verification ran before payment/
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getAllByText(
				/still count Fair Audience registrations/
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getAllByText( 'Event dates: 12, 15' )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'Switch statistics to Fair Events',
			} )
		).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'confirms in a dialog, then switches once', async () => {
		let resolve;
		const onAction = jest.fn(
			() =>
				new Promise( ( r ) => {
					resolve = r;
				} )
		);
		render( <ReadersPanel readers={ readers() } onAction={ onAction } /> );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Switch statistics to Fair Events',
			} )
		);
		expect(
			screen.getByText( /series pass revenue counts once/ )
		).toBeInTheDocument();

		const confirm = screen.getByRole( 'button', {
			name: 'Switch statistics',
		} );
		fireEvent.click( confirm );
		fireEvent.click( confirm );
		expect( onAction ).toHaveBeenCalledTimes( 1 );
		expect( onAction ).toHaveBeenCalledWith( '/readers', {} );

		await act( async () => resolve() );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Switch statistics' } )
			).not.toBeInTheDocument()
		);
	} );

	it( 'keeps the dialog open with the error when the switch is refused', async () => {
		const onAction = jest.fn( () =>
			Promise.reject(
				new Error(
					'The verification no longer passes. Verify the migration again before switching statistics.'
				)
			)
		);
		render( <ReadersPanel readers={ readers() } onAction={ onAction } /> );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Switch statistics to Fair Events',
			} )
		);
		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Switch statistics' } )
			)
		);

		expect(
			screen.getAllByText( /The verification no longer passes/ )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Switch statistics' } )
		).toBeInTheDocument();
	} );

	it( 'shows who switched and offers no switch afterwards', () => {
		render(
			<ReadersPanel
				readers={ readers( {
					active: true,
					activation: {
						activated_at: '2026-11-03 08:00:00',
						reason: 'reader_cutover',
						user_name: 'Ada',
					},
				} ) }
				onAction={ jest.fn() }
			/>
		);

		expect(
			screen.getAllByText( /Switched by Ada/ )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Switch statistics to Fair Events',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'explains an automatic switch on a site without earlier records', () => {
		render(
			<ReadersPanel
				readers={ readers( {
					active: true,
					activation: {
						activated_at: '2026-11-03 08:00:00',
						reason: 'no_source_history',
					},
				} ) }
				onAction={ jest.fn() }
			/>
		);

		expect(
			screen.getAllByText( /had no earlier Fair Audience records/ )[ 0 ]
		).toBeInTheDocument();
	} );
} );
