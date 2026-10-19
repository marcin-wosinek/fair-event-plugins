/**
 * @jest-environment jsdom
 *
 * Tests for EventTimingFields (#1851): either time can be left empty and
 * cleared on its own, and Event length never fills a missing time.
 */
import '@testing-library/jest-dom';
import { useState } from '@wordpress/element';
import { render, screen, fireEvent } from '@testing-library/react';
import EventTimingFields from '../EventTimingFields.js';

function Harness( {
	initial,
	withDuration = false,
	error = null,
	onChangeSpy,
} ) {
	const [ value, setValue ] = useState( initial );
	return (
		<>
			<EventTimingFields
				value={ value }
				withDuration={ withDuration }
				error={ error }
				onChange={ ( patch ) => {
					onChangeSpy?.( patch );
					setValue( ( prev ) => ( { ...prev, ...patch } ) );
				} }
			/>
			<output data-testid="state">{ JSON.stringify( value ) }</output>
		</>
	);
}

const state = () => JSON.parse( screen.getByTestId( 'state' ).textContent );

const timed = {
	allDay: false,
	startDate: '2026-10-18',
	startTime: '10:00',
	endDate: '2026-10-18',
	endTime: '12:00',
};

test( 'marks both times optional and clears each on its own', () => {
	render( <Harness initial={ timed } /> );

	expect( screen.getByLabelText( 'Start time (optional)' ) ).toHaveValue(
		'10:00'
	);
	expect(
		screen.getByText( /Leave a time empty until it is known/ )
	).toBeInTheDocument();

	fireEvent.change( screen.getByLabelText( 'Start time (optional)' ), {
		target: { value: '' },
	} );
	expect( state() ).toMatchObject( { startTime: '', endTime: '12:00' } );

	fireEvent.change( screen.getByLabelText( 'End time (optional)' ), {
		target: { value: '' },
	} );
	fireEvent.change( screen.getByLabelText( 'Start time (optional)' ), {
		target: { value: '09:30' },
	} );
	expect( state() ).toMatchObject( { startTime: '09:30', endTime: '' } );
} );

test( 'hides the times for an explicit all-day choice without filling them', () => {
	render( <Harness initial={ { ...timed, startTime: '', endTime: '' } } /> );

	fireEvent.click( screen.getByLabelText( 'All day' ) );
	expect(
		screen.queryByLabelText( 'Start time (optional)' )
	).not.toBeInTheDocument();
	expect( screen.getByLabelText( 'Start date' ) ).toHaveValue( '2026-10-18' );

	fireEvent.click( screen.getByLabelText( 'All day' ) );
	expect( screen.getByLabelText( 'Start time (optional)' ) ).toHaveValue(
		''
	);
	expect( screen.getByLabelText( 'End time (optional)' ) ).toHaveValue( '' );
} );

test( 'explains that Event length needs a start time', () => {
	const onChangeSpy = jest.fn();
	render(
		<Harness
			initial={ { ...timed, startTime: '', endTime: '12:00' } }
			withDuration
			onChangeSpy={ onChangeSpy }
		/>
	);

	expect( screen.getByLabelText( 'Event length' ) ).toBeDisabled();
	expect(
		screen.getByText( 'Enter a start time to choose an event length.' )
	).toBeInTheDocument();
	expect( onChangeSpy ).not.toHaveBeenCalled();
} );

test( 'Event length sets the end from a supplied start time', () => {
	render(
		<Harness
			initial={ { ...timed, endTime: '', startTime: '23:30' } }
			withDuration
		/>
	);

	fireEvent.change( screen.getByLabelText( 'Event length' ), {
		target: { value: '60' },
	} );
	expect( state() ).toMatchObject( {
		startTime: '23:30',
		endDate: '2026-10-19',
		endTime: '00:30',
	} );
} );

test( 'shows the validation message it is given', () => {
	render(
		<Harness
			initial={ timed }
			error="The end date is before the start date."
		/>
	);
	// The notice also speaks the message through a live region.
	expect(
		document.querySelector( '.components-notice.is-error' )
	).toHaveTextContent( 'The end date is before the start date.' );
} );
