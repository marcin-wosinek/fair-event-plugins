/**
 * @jest-environment jsdom
 *
 * Tests for EditInstancesModal (#981 Part 3).
 *
 * Covers:
 *   - Opens and lists occurrences with their cancel/restore action.
 *   - Cancel/Restore calls onToggleExdate with the occurrence's date.
 *   - Close calls onClose.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import EditInstancesModal from '../EditInstancesModal.js';
import { formatEventTiming } from '../../components/eventTiming.js';

const generatedOccurrences = [
	{
		id: 2,
		start_date: '2026-07-08',
		end_date: '2026-07-08',
		start_time: '18:00:00',
		end_time: null,
		status: 'active',
		timing_overrides: { dates: false, times: false },
	},
	{
		id: 3,
		start_date: '2026-07-15',
		end_date: '2026-07-15',
		start_time: null,
		end_time: '20:00:00',
		status: 'cancelled',
		timing_overrides: { dates: false, times: true },
	},
];

// Matches the timing summary in EditInstancesModal.
function instanceDateLabel( dateStr ) {
	return formatEventTiming(
		generatedOccurrences.find( ( occ ) => occ.start_date === dateStr )
	);
}

it( 'lists occurrences with Cancel / Restore actions', () => {
	render(
		<EditInstancesModal
			generatedOccurrences={ generatedOccurrences }
			togglingExdate={ null }
			onToggleExdate={ () => {} }
			onClose={ () => {} }
		/>
	);

	expect(
		screen.getByText( instanceDateLabel( '2026-07-08' ), { exact: false } )
	).toBeInTheDocument();
	expect(
		screen.getByText( instanceDateLabel( '2026-07-15' ), { exact: false } )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Cancel' } )
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'button', { name: 'Restore' } )
	).toBeInTheDocument();
} );

it( 'calls onToggleExdate with the date when Cancel is clicked', () => {
	const onToggleExdate = jest.fn();
	render(
		<EditInstancesModal
			generatedOccurrences={ generatedOccurrences }
			togglingExdate={ null }
			onToggleExdate={ onToggleExdate }
			onClose={ () => {} }
		/>
	);

	fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	expect( onToggleExdate ).toHaveBeenCalledWith( '2026-07-08' );
} );

it( 'calls onToggleExdate with the date when Restore is clicked', () => {
	const onToggleExdate = jest.fn();
	render(
		<EditInstancesModal
			generatedOccurrences={ generatedOccurrences }
			togglingExdate={ null }
			onToggleExdate={ onToggleExdate }
			onClose={ () => {} }
		/>
	);

	fireEvent.click( screen.getByRole( 'button', { name: 'Restore' } ) );
	expect( onToggleExdate ).toHaveBeenCalledWith( '2026-07-15' );
} );

it( 'calls onClose when Close is clicked', () => {
	const onClose = jest.fn();
	render(
		<EditInstancesModal
			generatedOccurrences={ generatedOccurrences }
			togglingExdate={ null }
			onToggleExdate={ () => {} }
			onClose={ onClose }
		/>
	);

	// The WP Modal chrome also renders its own "Close" dismiss button, so
	// disambiguate by taking the last one (our footer button).
	const closeButtons = screen.getAllByRole( 'button', { name: 'Close' } );
	fireEvent.click( closeButtons[ closeButtons.length - 1 ] );
	expect( onClose ).toHaveBeenCalled();
} );

it( 'shows a moved occurrence on its date but toggles its scheduled date', () => {
	const onToggleExdate = jest.fn();
	const moved = {
		id: 2,
		start_date: '2026-07-09',
		end_date: '2026-07-09',
		start_time: '18:00:00',
		end_time: null,
		recurrence_anchor: '2026-07-08',
		status: 'active',
		timing_overrides: { dates: true, times: false },
	};
	render(
		<EditInstancesModal
			generatedOccurrences={ [ moved ] }
			togglingExdate={ null }
			onToggleExdate={ onToggleExdate }
			onClose={ () => {} }
		/>
	);

	expect(
		screen.getByText( formatEventTiming( moved ), { exact: false } )
	).toHaveTextContent( '(own timing)' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	expect( onToggleExdate ).toHaveBeenCalledWith( '2026-07-08' );
} );

it( 'shows each date with only its supplied times and marks its own timing (#1851)', () => {
	render(
		<EditInstancesModal
			generatedOccurrences={ generatedOccurrences }
			togglingExdate={ null }
			onToggleExdate={ () => {} }
			onClose={ () => {} }
		/>
	);

	const endOnly = screen.getByText( /ends/, { exact: false } );
	expect( endOnly ).toHaveTextContent( '(own timing)' );
	expect(
		screen.getByText( instanceDateLabel( '2026-07-08' ), { exact: false } )
	).not.toHaveTextContent( '(own timing)' );
} );
