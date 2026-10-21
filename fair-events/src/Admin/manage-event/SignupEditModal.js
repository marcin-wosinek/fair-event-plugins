/**
 * Signup Edit Modal
 *
 * Move a signup to another date of its series, or give it another ticket
 * type (#1532). When the target is full the server answers 409 with a
 * projection of the places taken, and the modal asks for a reason before
 * the administrator can go over capacity.
 *
 * @package FairEvents
 */

import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Modal,
	Button,
	Flex,
	FlexItem,
	Notice,
	SelectControl,
	Spinner,
	TextareaControl,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	targetOptionLabel,
	projectionMessage,
	WrappingModalStyle,
	WRAPPING_MODAL_CLASS,
} from 'fair-events-shared';

export const ACTION_MOVE = 'move';
export const ACTION_CHANGE_TYPE = 'change_type';

/**
 * Sentences saying what a purchase-wide action does to the tickets of the
 * purchase, on every date they are on. The action is offered beside one
 * ticket, possibly on a date the purchase is not registered for, so its
 * reach is spelled out before anything changes.
 *
 * @param {Object}  args
 * @param {boolean} args.isMove   Whether the action is a move.
 * @param {Object}  args.signup   Registration returned by the API.
 * @param {Object}  [args.counts] Result of purchaseTicketCounts().
 * @return {string[]} Sentences, in reading order
 */
export function scopeNotes( { isMove, signup, counts } ) {
	const total = counts
		? counts.confirmed
		: Math.max( ( signup.tickets || [] ).length, 1 );
	const movable = counts ? counts.onRegistrationDate : total;
	const elsewhere = total - movable;
	const inactive = counts ? counts.inactive : 0;
	const notes = [];

	if ( ! isMove ) {
		notes.push(
			sprintf(
				/* translators: %d: number of tickets in the registration */
				_n(
					'This changes the type of the whole registration, with its %d ticket.',
					'This changes the type of the whole registration, with all %d of its tickets.',
					Math.max( total, 1 ),
					'fair-events'
				),
				Math.max( total, 1 )
			)
		);
		if ( counts?.onOtherDates > 0 ) {
			notes.push(
				sprintf(
					/* translators: %d: number of tickets of the purchase on other dates */
					_n(
						'That includes %d ticket on another date.',
						'That includes %d tickets on other dates.',
						counts.onOtherDates,
						'fair-events'
					),
					counts.onOtherDates
				)
			);
		}
	} else if ( elsewhere === 0 ) {
		notes.push(
			sprintf(
				/* translators: %d: number of tickets in the registration */
				_n(
					'This moves the whole registration, with its %d ticket.',
					'This moves the whole registration, with all %d of its tickets.',
					Math.max( total, 1 ),
					'fair-events'
				),
				Math.max( total, 1 )
			)
		);
	} else {
		notes.push(
			movable > 0
				? sprintf(
						/* translators: 1: number of tickets that move, 2: date the purchase is registered for */
						_n(
							'This moves the purchase and the %1$d ticket still on the date it is registered for (%2$s).',
							'This moves the purchase and the %1$d tickets still on the date it is registered for (%2$s).',
							movable,
							'fair-events'
						),
						movable,
						signup.event_date_label
					)
				: sprintf(
						/* translators: %s: date the purchase is registered for */
						__(
							'No ticket of this purchase is still on the date it is registered for (%s), so no ticket moves: only the date the purchase is registered for changes.',
							'fair-events'
						),
						signup.event_date_label
					)
		);
		notes.push(
			sprintf(
				/* translators: %d: number of tickets moved individually to other dates */
				_n(
					'%d ticket was moved on its own to another date and stays where it is, unless that is the new date, which it then shares with the purchase.',
					'%d tickets were moved on their own to other dates and stay where they are; any already on the new date stay there with the purchase.',
					elsewhere,
					'fair-events'
				),
				elsewhere
			)
		);
	}

	if ( inactive > 0 ) {
		notes.push(
			sprintf(
				/* translators: %d: number of cancelled or otherwise inactive tickets */
				_n(
					'%d cancelled or otherwise inactive ticket is left as it is.',
					'%d cancelled or otherwise inactive tickets are left as they are.',
					inactive,
					'fair-events'
				),
				inactive
			)
		);
	}

	return notes;
}

export default function SignupEditModal( {
	signup,
	action,
	counts,
	onClose,
	onSaved,
} ) {
	const isMove = action === ACTION_MOVE;
	const [ targets, setTargets ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ targetId, setTargetId ] = useState( '' );
	const [ projection, setProjection ] = useState( null );
	const [ reason, setReason ] = useState( '' );
	const [ saving, setSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );
	// Refuses a second submission before the first one re-rendered the popup.
	const inFlight = useRef( false );

	useEffect( () => {
		apiFetch( {
			path: `/fair-events/v1/get-tickets/${ signup.id }/targets`,
		} )
			.then( ( data ) =>
				setTargets(
					( isMove ? data?.event_dates : data?.ticket_types ) || []
				)
			)
			.catch( ( err ) =>
				setLoadError(
					err.message ||
						__( 'Failed to load the choices.', 'fair-events' )
				)
			);
	}, [ signup.id, isMove ] );

	const handleTargetChange = ( value ) => {
		setTargetId( value );
		setProjection( null );
		setReason( '' );
		setSaveError( null );
	};

	const save = async () => {
		if ( inFlight.current ) {
			return;
		}
		inFlight.current = true;
		setSaving( true );
		setSaveError( null );
		const data = isMove
			? { event_date_id: Number( targetId ) }
			: { ticket_type_id: Number( targetId ) };
		if ( projection ) {
			data.override_reason = reason.trim();
		}
		try {
			await apiFetch( {
				path: `/fair-events/v1/get-tickets/${ signup.id }`,
				method: 'PUT',
				data,
			} );
			onSaved();
		} catch ( err ) {
			if ( err.code === 'capacity_exceeded' && err.data?.projection ) {
				setProjection( err.data.projection );
			} else {
				setSaveError(
					err.message ||
						__( 'Failed to update signup.', 'fair-events' )
				);
			}
		} finally {
			inFlight.current = false;
			setSaving( false );
		}
	};

	// The outcome of a dismissed request would be unknown to the user.
	const close = () => {
		if ( ! saving ) {
			onClose();
		}
	};

	const title = isMove
		? sprintf(
				/* translators: %s: participant name */
				__( 'Move %s to another date', 'fair-events' ),
				signup.name
			)
		: sprintf(
				/* translators: %s: participant name */
				__( 'Change ticket type for %s', 'fair-events' ),
				signup.name
			);

	const notes = scopeNotes( { isMove, signup, counts } );

	const renderBody = () => {
		if ( loadError ) {
			return (
				<Notice status="error" isDismissible={ false }>
					{ loadError }
				</Notice>
			);
		}
		if ( targets === null ) {
			return <Spinner />;
		}
		if ( targets.length === 0 ) {
			return (
				<p>
					{ isMove
						? __(
								'This series has no other active date to move the signup to.',
								'fair-events'
							)
						: __(
								'No other ticket type with the same dates is available for this signup.',
								'fair-events'
							) }
				</p>
			);
		}

		const reasonMissing = reason.trim() === '';

		return (
			<>
				<SelectControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					label={
						isMove
							? __( 'New date', 'fair-events' )
							: __( 'New ticket type', 'fair-events' )
					}
					value={ targetId }
					options={ [
						{ label: __( 'Choose…', 'fair-events' ), value: '' },
						...targets.map( ( target ) => ( {
							label: targetOptionLabel( target ),
							value: String( target.id ),
						} ) ),
					] }
					onChange={ handleTargetChange }
					disabled={ saving }
				/>
				{ ! isMove && (
					<p className="description">
						{ __(
							'The amount paid stays the same: no charge or refund is made for a price difference.',
							'fair-events'
						) }
					</p>
				) }
				{ saveError && (
					<Notice status="error" isDismissible={ false }>
						{ saveError }
					</Notice>
				) }
				{ projection && (
					<>
						<Notice status="warning" isDismissible={ false }>
							{ projectionMessage( projection ) }
						</Notice>
						<TextareaControl
							__nextHasNoMarginBottom
							label={ __( 'Reason', 'fair-events' ) }
							help={ __(
								'Required to go over capacity. It is kept with the signup.',
								'fair-events'
							) }
							value={ reason }
							onChange={ setReason }
							disabled={ saving }
						/>
					</>
				) }
				<Flex
					justify="flex-end"
					align="center"
					gap={ 2 }
					wrap
					style={ { marginTop: 16 } }
				>
					{ ! targetId && (
						<FlexItem>
							<span>
								{ isMove
									? __( 'Choose a date.', 'fair-events' )
									: __(
											'Choose a ticket type.',
											'fair-events'
										) }
							</span>
						</FlexItem>
					) }
					{ projection && reasonMissing && (
						<FlexItem>
							<span>
								{ __(
									'Enter a reason to go over capacity.',
									'fair-events'
								) }
							</span>
						</FlexItem>
					) }
					<FlexItem>
						<Button
							variant="tertiary"
							onClick={ close }
							disabled={ saving }
						>
							{ __( 'Cancel', 'fair-events' ) }
						</Button>
					</FlexItem>
					<FlexItem>
						{ projection ? (
							<Button
								variant="primary"
								isDestructive
								isBusy={ saving }
								disabled={ saving || reasonMissing }
								// Stay focusable while pending, so focus can
								// still return to the trigger afterwards.
								accessibleWhenDisabled={ saving }
								onClick={ save }
							>
								{ __( 'Exceed capacity', 'fair-events' ) }
							</Button>
						) : (
							<Button
								variant="primary"
								isBusy={ saving }
								disabled={ saving || ! targetId }
								accessibleWhenDisabled={ saving }
								onClick={ save }
							>
								{ isMove
									? __( 'Move signup', 'fair-events' )
									: __(
											'Change ticket type',
											'fair-events'
										) }
							</Button>
						) }
					</FlexItem>
				</Flex>
			</>
		);
	};

	return (
		<Modal
			title={ title }
			onRequestClose={ close }
			isDismissible={ ! saving }
			shouldCloseOnEsc={ ! saving }
			shouldCloseOnClickOutside={ ! saving }
			size="medium"
			className={ WRAPPING_MODAL_CLASS }
		>
			<WrappingModalStyle />
			{ notes.map( ( note ) => (
				<p key={ note }>{ note }</p>
			) ) }
			{ renderBody() }
		</Modal>
	);
}
