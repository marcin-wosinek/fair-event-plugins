/**
 * @jest-environment jsdom
 *
 * Component tests for the add-on ordering popup (#1765).
 *
 * Exercises:
 *   - The shared move operation, including moves that change nothing.
 *   - Keyboard-accessible "Move up" / "Move down" buttons.
 *   - Pointer dragging (mouse and touch both arrive as pointer events).
 *   - Whole option objects travel with a move; names are never the identity.
 *   - Closing the popup does nothing but close it.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import { useState } from '@wordpress/element';
import ReorderAddonsModal, {
	moveItem,
	dropIndexForPointer,
} from '../ReorderAddonsModal.js';

const ROW_HEIGHT = 40;

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	// jsdom has no layout: stack the rows in DOM order, 40px each.
	jest.spyOn(
		window.HTMLElement.prototype,
		'getBoundingClientRect'
	).mockImplementation( function () {
		if ( this.tagName !== 'LI' ) {
			return { top: -1000, bottom: 2000, height: 3000 };
		}
		const index = Array.from( this.parentElement.children ).indexOf( this );
		return {
			top: index * ROW_HEIGHT,
			bottom: ( index + 1 ) * ROW_HEIGHT,
			height: ROW_HEIGHT,
		};
	} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

const savedOptions = () => [
	{ id: 11, client_key: 'option-1', name: 'Yoga', price: 5, capacity: 10 },
	{ id: 12, client_key: 'option-2', name: 'Dinner', price: 20 },
	{ id: 13, client_key: 'option-3', name: 'Hike', price: 0 },
	{ id: 14, client_key: 'option-4', name: 'Sauna', price: 8 },
];

// Keeps the options in state like the Prices tab does, and records every
// reorder the popup asks for.
function Harness( { initial, onReorder, onClose } ) {
	const [ options, setOptions ] = useState( initial );
	return (
		<ReorderAddonsModal
			options={ options }
			onReorder={ ( next ) => {
				onReorder( next );
				setOptions( next );
			} }
			onClose={ onClose }
		/>
	);
}

function renderModal( initial = savedOptions() ) {
	const onReorder = jest.fn();
	const onClose = jest.fn();
	render(
		<Harness
			initial={ initial }
			onReorder={ onReorder }
			onClose={ onClose }
		/>
	);
	return { onReorder, onClose, initial };
}

const rows = () =>
	within( screen.getByRole( 'list' ) ).getAllByRole( 'listitem' );

const rowNames = () =>
	rows().map(
		( row ) => row.querySelector( 'span:not([aria-hidden])' ).textContent
	);

const handleOf = ( row ) =>
	row.querySelector( '.fair-events-reorder-addons__handle' );

// jsdom's PointerEvent support varies; a MouseEvent carries what the popup
// reads (clientY, button) and reaches the same listeners.
const pointer = ( target, type, clientY ) =>
	fireEvent(
		target,
		new window.MouseEvent( type, {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientY,
		} )
	);

const drag = ( row, ...positions ) => {
	pointer( handleOf( row ), 'pointerdown', positions[ 0 ] );
	positions
		.slice( 1 )
		.forEach( ( y ) => pointer( document, 'pointermove', y ) );
	pointer( document, 'pointerup', positions[ positions.length - 1 ] );
};

describe( 'moveItem', () => {
	it( 'moves an item to any position, keeping the others in order', () => {
		const items = [ 'a', 'b', 'c', 'd' ];
		expect( moveItem( items, 0, 3 ) ).toEqual( [ 'b', 'c', 'd', 'a' ] );
		expect( moveItem( items, 3, 0 ) ).toEqual( [ 'd', 'a', 'b', 'c' ] );
		expect( moveItem( items, 1, 2 ) ).toEqual( [ 'a', 'c', 'b', 'd' ] );
		expect( moveItem( items, 2, 1 ) ).toEqual( [ 'a', 'c', 'b', 'd' ] );
		// The input is never mutated.
		expect( items ).toEqual( [ 'a', 'b', 'c', 'd' ] );
	} );

	it( 'returns the same array when nothing would change', () => {
		const items = [ 'a', 'b', 'c' ];
		expect( moveItem( items, 1, 1 ) ).toBe( items );
		expect( moveItem( items, -1, 0 ) ).toBe( items );
		expect( moveItem( items, 0, -1 ) ).toBe( items );
		expect( moveItem( items, 3, 0 ) ).toBe( items );
		expect( moveItem( items, 0, 3 ) ).toBe( items );
	} );
} );

describe( 'dropIndexForPointer', () => {
	const rects = [
		{ top: 0, height: 40 },
		{ top: 40, height: 100 },
		{ top: 140, height: 40 },
	];

	it( 'keeps the row in place until the pointer passes a neighbour’s middle', () => {
		expect( dropIndexForPointer( rects, 0, 20 ) ).toBe( 0 );
		expect( dropIndexForPointer( rects, 0, 89 ) ).toBe( 0 );
		expect( dropIndexForPointer( rects, 0, 91 ) ).toBe( 1 );
		expect( dropIndexForPointer( rects, 0, 161 ) ).toBe( 2 );
		expect( dropIndexForPointer( rects, 2, 91 ) ).toBe( 2 );
		expect( dropIndexForPointer( rects, 2, 89 ) ).toBe( 1 );
		expect( dropIndexForPointer( rects, 2, 19 ) ).toBe( 0 );
	} );

	it( 'clamps to the ends when the pointer leaves the list', () => {
		expect( dropIndexForPointer( rects, 1, -500 ) ).toBe( 0 );
		expect( dropIndexForPointer( rects, 1, 5000 ) ).toBe( 2 );
	} );
} );

describe( 'ReorderAddonsModal', () => {
	it( 'lists the add-ons in their current order and explains how the order is saved', () => {
		renderModal();
		expect(
			screen.getByRole( 'dialog', { name: 'Reorder add-ons' } )
		).toBeInTheDocument();
		expect( rowNames() ).toEqual( [ 'Yoga', 'Dinner', 'Hike', 'Sauna' ] );
		expect(
			screen.getByText( /Save tickets to save this order\./ )
		).toBeInTheDocument();
	} );

	it( 'moves an add-on up and down with the arrow buttons', () => {
		const { onReorder, initial } = renderModal();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Hike up' } )
		);
		expect( rowNames() ).toEqual( [ 'Yoga', 'Hike', 'Dinner', 'Sauna' ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Yoga down' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Yoga down' } )
		);
		expect( rowNames() ).toEqual( [ 'Hike', 'Dinner', 'Yoga', 'Sauna' ] );

		expect( onReorder ).toHaveBeenCalledTimes( 3 );
		// Whole option objects are moved, never rebuilt.
		const last = onReorder.mock.calls[ 2 ][ 0 ];
		expect( last[ 0 ] ).toBe( initial[ 2 ] );
		expect( last[ 1 ] ).toBe( initial[ 1 ] );
		expect( last[ 2 ] ).toBe( initial[ 0 ] );
		expect( last[ 3 ] ).toBe( initial[ 3 ] );
	} );

	it( 'keeps focus on the pressed button so repeated presses keep moving the add-on', () => {
		renderModal();

		const down = screen.getByRole( 'button', { name: 'Move Yoga down' } );
		down.focus();
		fireEvent.click( down );
		expect(
			screen.getByRole( 'button', { name: 'Move Yoga down' } )
		).toHaveFocus();

		const up = screen.getByRole( 'button', { name: 'Move Sauna up' } );
		up.focus();
		fireEvent.click( up );
		expect(
			screen.getByRole( 'button', { name: 'Move Sauna up' } )
		).toHaveFocus();
	} );

	it( 'does nothing for a move past either end', () => {
		const { onReorder } = renderModal();

		const firstUp = screen.getByRole( 'button', { name: 'Move Yoga up' } );
		const lastDown = screen.getByRole( 'button', {
			name: 'Move Sauna down',
		} );
		expect( firstUp ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( lastDown ).toHaveAttribute( 'aria-disabled', 'true' );

		fireEvent.click( firstUp );
		fireEvent.click( lastDown );

		expect( onReorder ).not.toHaveBeenCalled();
		expect( rowNames() ).toEqual( [ 'Yoga', 'Dinner', 'Hike', 'Sauna' ] );
	} );

	it( 'announces the new position', () => {
		renderModal();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Sauna up' } )
		);
		expect( screen.getByRole( 'status' ) ).toHaveTextContent(
			'Sauna moved to position 3 of 4.'
		);
	} );

	it( 'drags an add-on to any position', () => {
		const { onReorder, initial } = renderModal();

		// Sauna from the bottom to the top.
		drag( rows()[ 3 ], 140, 90, 50, 10 );
		expect( rowNames() ).toEqual( [ 'Sauna', 'Yoga', 'Dinner', 'Hike' ] );

		// Yoga from second to last in one long movement.
		drag( rows()[ 1 ], 60, 150 );
		expect( rowNames() ).toEqual( [ 'Sauna', 'Dinner', 'Hike', 'Yoga' ] );

		// Dinner into the middle.
		drag( rows()[ 1 ], 60, 101 );
		expect( rowNames() ).toEqual( [ 'Sauna', 'Hike', 'Dinner', 'Yoga' ] );

		const last =
			onReorder.mock.calls[ onReorder.mock.calls.length - 1 ][ 0 ];
		expect( last ).toEqual( [
			initial[ 3 ],
			initial[ 2 ],
			initial[ 1 ],
			initial[ 0 ],
		] );
		expect( screen.getByRole( 'status' ) ).toHaveTextContent(
			'Dinner moved to position 3 of 4.'
		);
	} );

	it( 'leaves the order alone when an add-on is dropped where it started', () => {
		const { onReorder } = renderModal();

		drag( rows()[ 1 ], 60, 65, 55, 60 );
		// A press without any movement.
		drag( rows()[ 2 ], 100 );

		expect( onReorder ).not.toHaveBeenCalled();
		expect( rowNames() ).toEqual( [ 'Yoga', 'Dinner', 'Hike', 'Sauna' ] );
	} );

	it( 'stops following the pointer once the drag ends', () => {
		const { onReorder } = renderModal();

		drag( rows()[ 0 ], 20, 61 );
		expect( onReorder ).toHaveBeenCalledTimes( 1 );

		pointer( document, 'pointermove', 150 );
		expect( onReorder ).toHaveBeenCalledTimes( 1 );
		expect( rowNames() ).toEqual( [ 'Dinner', 'Yoga', 'Hike', 'Sauna' ] );
	} );

	it( 'ignores a press with a secondary mouse button', () => {
		const { onReorder } = renderModal();
		fireEvent(
			handleOf( rows()[ 0 ] ),
			new window.MouseEvent( 'pointerdown', {
				bubbles: true,
				button: 2,
				clientY: 20,
			} )
		);
		pointer( document, 'pointermove', 150 );
		expect( onReorder ).not.toHaveBeenCalled();
	} );

	it( 'tells unsaved, unnamed, and same-named add-ons apart', () => {
		const initial = [
			{ id: 21, client_key: 'option-1', name: 'Workshop', price: 10 },
			{ client_key: 'option-2', name: 'Workshop', price: 25 },
			{ client_key: 'option-3', name: '', price: 3 },
			{ client_key: 'option-4', name: '', price: 4 },
		];
		const { onReorder } = renderModal( initial );
		expect( rowNames() ).toEqual( [
			'Workshop',
			'Workshop',
			'(unnamed add-on)',
			'(unnamed add-on)',
		] );

		// The second "Workshop" goes first, by button.
		fireEvent.click(
			within( rows()[ 1 ] ).getByRole( 'button', {
				name: 'Move Workshop up',
			} )
		);
		// The last unnamed add-on goes first, by drag.
		drag( rows()[ 3 ], 140, 10 );

		const last =
			onReorder.mock.calls[ onReorder.mock.calls.length - 1 ][ 0 ];
		expect( last.map( ( option ) => option.price ) ).toEqual( [
			4, 25, 10, 3,
		] );
		expect( last[ 2 ] ).toBe( initial[ 0 ] );
	} );

	it( 'only closes on Done, the close button, or Escape', async () => {
		const { onReorder, onClose } = renderModal();

		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		expect( onClose ).toHaveBeenCalledTimes( 1 );

		// The popup's own close paths wait for its closing animation.
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		await waitFor( () => expect( onClose ).toHaveBeenCalledTimes( 2 ) );

		fireEvent.keyDown( screen.getByRole( 'dialog' ), {
			key: 'Escape',
			code: 'Escape',
			keyCode: 27,
		} );
		await waitFor( () => expect( onClose ).toHaveBeenCalledTimes( 3 ) );

		expect( onReorder ).not.toHaveBeenCalled();
	} );
} );
