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

import { useState, useEffect } from '@wordpress/element';
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
import { targetOptionLabel, projectionMessage } from 'fair-events-shared';

export const ACTION_MOVE = 'move';
export const ACTION_CHANGE_TYPE = 'change_type';

export default function SignupEditModal( {
	signup,
	action,
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
			setSaving( false );
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

	const ticketCount = Math.max( ( signup.tickets || [] ).length, 1 );
	const scopeNote = isMove
		? sprintf(
				/* translators: %d: number of tickets in the registration */
				_n(
					'This moves the whole registration, with its %d ticket.',
					'This moves the whole registration, with all %d of its tickets.',
					ticketCount,
					'fair-events'
				),
				ticketCount
		  )
		: sprintf(
				/* translators: %d: number of tickets in the registration */
				_n(
					'This changes the type of the whole registration, with its %d ticket.',
					'This changes the type of the whole registration, with all %d of its tickets.',
					ticketCount,
					'fair-events'
				),
				ticketCount
		  );

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
						/>
					</>
				) }
				<Flex justify="flex-end" gap={ 2 } style={ { marginTop: 16 } }>
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
						<Button variant="tertiary" onClick={ onClose }>
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
								onClick={ save }
							>
								{ __( 'Exceed capacity', 'fair-events' ) }
							</Button>
						) : (
							<Button
								variant="primary"
								isBusy={ saving }
								disabled={ saving || ! targetId }
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
		<Modal title={ title } onRequestClose={ onClose }>
			<p>{ scopeNote }</p>
			{ renderBody() }
		</Modal>
	);
}
