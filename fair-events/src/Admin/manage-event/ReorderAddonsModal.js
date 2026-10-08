/**
 * Reorder Add-ons Modal
 *
 * A focused popup for arranging the add-on options of the Prices tab (#1765).
 * Every move is applied to the caller's unsaved options straight away; nothing
 * is persisted here — the order is saved with the rest of the tab through
 * "Save tickets".
 *
 * @package FairEvents
 */

import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Modal,
	VisuallyHidden,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Icon, chevronDown, chevronUp, dragHandle } from '@wordpress/icons';

// Distance from the list's edge, in pixels, at which a drag starts scrolling.
const SCROLL_EDGE = 40;
const SCROLL_STEP = 12;

/**
 * Move one item of a list to another position, keeping the rest in order.
 * Returns the same array when nothing would change, so callers can skip the
 * state update (and the dirty flag that comes with it).
 *
 * @param {Array}  items List to reorder.
 * @param {number} from  Current index of the item.
 * @param {number} to    Index the item should end up at.
 * @return {Array} The reordered list, or `items` itself when unchanged.
 */
export const moveItem = ( items, from, to ) => {
	if (
		from === to ||
		from < 0 ||
		to < 0 ||
		from >= items.length ||
		to >= items.length
	) {
		return items;
	}
	const next = [ ...items ];
	const [ moved ] = next.splice( from, 1 );
	next.splice( to, 0, moved );
	return next;
};

/**
 * Index a dragged row should move to for a pointer position. The row only
 * moves once the pointer passes the middle of a neighbour, which keeps rows of
 * different heights from flipping back and forth.
 *
 * @param {Array<{top: number, height: number}>} rects   Row boxes, in order.
 * @param {number}                               current Index of the dragged row.
 * @param {number}                               y       Pointer Y coordinate.
 * @return {number} Target index.
 */
export const dropIndexForPointer = ( rects, current, y ) => {
	const middle = ( rect ) => rect.top + rect.height / 2;
	for ( let i = 0; i < current; i++ ) {
		if ( y < middle( rects[ i ] ) ) {
			return i;
		}
	}
	let target = current;
	for ( let i = current + 1; i < rects.length; i++ ) {
		if ( y > middle( rects[ i ] ) ) {
			target = i;
		}
	}
	return target;
};

// Saved options have an ID; unsaved ones only the editor's client key. Names
// can't identify an option — they may be empty or repeated.
const optionKey = ( option ) => option.client_key || `id-${ option.id }`;

const optionLabel = ( option ) =>
	option.name || __( '(unnamed add-on)', 'fair-events' );

export default function ReorderAddonsModal( { options, onReorder, onClose } ) {
	const [ draggingKey, setDraggingKey ] = useState( null );
	const [ announcement, setAnnouncement ] = useState( '' );
	const listRef = useRef( null );
	const rowRefs = useRef( new Map() );
	const buttonRefs = useRef( new Map() );
	const pendingFocus = useRef( null );
	const stopDragRef = useRef( null );
	// A drag reads the options and the row positions from pointer events
	// between renders: track the latest order, and ignore the pointer until
	// the rows have been laid out again after a move.
	const optionsRef = useRef( options );
	const awaitingRender = useRef( false );

	useEffect( () => {
		optionsRef.current = options;
		awaitingRender.current = false;
		// Rows are moved in the DOM when reordered, which can drop focus from
		// the button that was just pressed.
		if ( pendingFocus.current ) {
			buttonRefs.current.get( pendingFocus.current )?.focus();
			pendingFocus.current = null;
		}
	}, [ options ] );

	useEffect( () => () => stopDragRef.current?.(), [] );

	const move = ( from, to ) => {
		const current = optionsRef.current;
		const next = moveItem( current, from, to );
		if ( next === current ) {
			return false;
		}
		awaitingRender.current = true;
		onReorder( next );
		setAnnouncement(
			sprintf(
				/* translators: 1: add-on name, 2: new position, 3: number of add-ons */
				__( '%1$s moved to position %2$d of %3$d.', 'fair-events' ),
				optionLabel( current[ from ] ),
				to + 1,
				next.length
			)
		);
		return true;
	};

	const moveWithKeyboard = ( index, offset ) => {
		const key = optionKey( options[ index ] );
		if ( move( index, index + offset ) ) {
			pendingFocus.current = `${ key }:${ offset }`;
		}
	};

	const handlePointerMove = ( key, event ) => {
		const list = listRef.current;
		if ( list ) {
			const box = list.getBoundingClientRect();
			if ( event.clientY < box.top + SCROLL_EDGE ) {
				list.scrollTop -= SCROLL_STEP;
			} else if ( event.clientY > box.bottom - SCROLL_EDGE ) {
				list.scrollTop += SCROLL_STEP;
			}
		}
		if ( awaitingRender.current ) {
			return;
		}
		const current = optionsRef.current;
		const index = current.findIndex(
			( option ) => optionKey( option ) === key
		);
		const rows = current.map( ( option ) =>
			rowRefs.current.get( optionKey( option ) )
		);
		if ( index === -1 || rows.some( ( row ) => ! row ) ) {
			return;
		}
		const rects = rows.map( ( row ) => row.getBoundingClientRect() );
		move( index, dropIndexForPointer( rects, index, event.clientY ) );
	};

	// Mouse, touch, and pen all arrive as pointer events. The listeners sit on
	// the document because the dragged row is moved in the DOM while dragging,
	// which would end a capture held by its handle.
	const startDrag = ( key, event ) => {
		if ( event.button > 0 ) {
			return;
		}
		event.preventDefault();
		stopDragRef.current?.();
		const doc = event.currentTarget.ownerDocument;
		const onMove = ( moveEvent ) => handlePointerMove( key, moveEvent );
		const stop = () => {
			doc.removeEventListener( 'pointermove', onMove );
			doc.removeEventListener( 'pointerup', stop );
			doc.removeEventListener( 'pointercancel', stop );
			stopDragRef.current = null;
			setDraggingKey( null );
		};
		doc.addEventListener( 'pointermove', onMove );
		doc.addEventListener( 'pointerup', stop );
		doc.addEventListener( 'pointercancel', stop );
		stopDragRef.current = stop;
		setDraggingKey( key );
	};

	const setRef = ( refs, key ) => ( node ) => {
		if ( node ) {
			refs.current.set( key, node );
		} else {
			refs.current.delete( key );
		}
	};

	return (
		<Modal
			title={ __( 'Reorder add-ons', 'fair-events' ) }
			onRequestClose={ onClose }
			size="medium"
		>
			<VStack spacing={ 4 }>
				<p style={ { margin: 0 } }>
					{ __(
						'Drag an add-on by its handle, or use the arrow buttons, to change its position. Save tickets to save this order.',
						'fair-events'
					) }
				</p>
				<ol
					ref={ listRef }
					className="fair-events-reorder-addons"
					style={ {
						listStyle: 'none',
						margin: 0,
						padding: 0,
						maxHeight: 'min(60vh, 480px)',
						overflowY: 'auto',
						border: '1px solid #dcdcde',
						borderRadius: '2px',
						userSelect: draggingKey ? 'none' : undefined,
					} }
				>
					{ options.map( ( option, index ) => {
						const key = optionKey( option );
						const label = optionLabel( option );
						const isDragging = draggingKey === key;
						return (
							<li
								key={ key }
								ref={ setRef( rowRefs, key ) }
								style={ {
									display: 'flex',
									alignItems: 'center',
									gap: '4px',
									margin: 0,
									padding: '4px 8px 4px 0',
									borderTop:
										index > 0
											? '1px solid #dcdcde'
											: undefined,
									background: isDragging ? '#f0f6fc' : '#fff',
									boxShadow: isDragging
										? 'inset 3px 0 0 var(--wp-admin-theme-color, #3858e9)'
										: undefined,
								} }
							>
								{ /* Pointer-only: the arrow buttons are the keyboard path. */ }
								<span
									aria-hidden="true"
									className="fair-events-reorder-addons__handle"
									onPointerDown={ ( event ) =>
										startDrag( key, event )
									}
									style={ {
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										flex: '0 0 40px',
										height: '40px',
										cursor: isDragging
											? 'grabbing'
											: 'grab',
										touchAction: 'none',
									} }
								>
									<Icon icon={ dragHandle } />
								</span>
								<span
									style={ {
										flex: '1 1 auto',
										minWidth: 0,
										overflowWrap: 'anywhere',
									} }
								>
									{ label }
								</span>
								<Button
									ref={ setRef( buttonRefs, `${ key }:-1` ) }
									icon={ chevronUp }
									label={ sprintf(
										/* translators: %s: add-on name */
										__( 'Move %s up', 'fair-events' ),
										label
									) }
									disabled={ index === 0 }
									accessibleWhenDisabled
									onClick={ () =>
										moveWithKeyboard( index, -1 )
									}
								/>
								<Button
									ref={ setRef( buttonRefs, `${ key }:1` ) }
									icon={ chevronDown }
									label={ sprintf(
										/* translators: %s: add-on name */
										__( 'Move %s down', 'fair-events' ),
										label
									) }
									disabled={ index === options.length - 1 }
									accessibleWhenDisabled
									onClick={ () =>
										moveWithKeyboard( index, 1 )
									}
								/>
							</li>
						);
					} ) }
				</ol>
				<VisuallyHidden as="div" role="status" aria-live="polite">
					{ announcement }
				</VisuallyHidden>
				<HStack justify="flex-end">
					<Button variant="primary" onClick={ onClose }>
						{ __( 'Done', 'fair-events' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
