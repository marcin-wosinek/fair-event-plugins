/**
 * Ordered contributor assignments of one target: an event's team or one
 * programme item (#2422).
 *
 * Shows each assignment with its role, in order, with keyboard-operable
 * Move up / Move down and Remove buttons, and adds a person from the
 * directory with a role. Every change is saved at once and touches only
 * that assignment, or the order of this list. Read-only lists show the
 * assignments without any control.
 *
 * The parent owns the assignments and the requests; this component owns
 * the add form, the pending change and its result.
 *
 * @package FairEventsExperimental
 */

import { useRef, useState } from '@wordpress/element';
import {
	Button,
	ComboboxControl,
	Notice,
	TextControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { memberName } from '../team-members/utils.js';

/**
 * Accepted role slugs, as in Event Content Studio campaign facts v1.
 */
export const ROLE_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Longest accepted role slug.
 */
export const ROLE_MAX_LENGTH = 64;

/**
 * Roles offered as suggestions.
 */
export const SUGGESTED_ROLES = [ 'teacher', 'organizer' ];

const LIST_STYLE = { margin: 0, paddingLeft: '1.5em' };
const ITEM_STYLE = {
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '4px 12px',
	marginBottom: '6px',
};
const ROLE_STYLE = {
	display: 'inline-block',
	padding: '0 8px',
	borderRadius: '2px',
	background: '#f0f0f0',
	fontSize: '12px',
	lineHeight: '20px',
};
const ACTIONS_STYLE = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: '4px 8px',
};
const ADD_STYLE = {
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'flex-start',
	gap: '8px 12px',
};
const HINT_STYLE = { margin: 0, color: '#757575' };

/**
 * The name of an assignment's person, with a fallback for a profile that
 * no longer exists.
 *
 * @param {Object} assignment Assignment `{ name, surname }`.
 * @return {string} Name.
 */
export function assignmentName( assignment ) {
	return (
		memberName( assignment ) ||
		__( '(deleted team member)', 'fair-events-experimental' )
	);
}

/**
 * The name and role of an assignment, as one label.
 *
 * @param {Object} assignment Assignment `{ name, surname, role }`.
 * @return {string} Label.
 */
export function assignmentLabel( assignment ) {
	return assignment.role
		? sprintf(
				/* translators: 1: team member name, 2: their role, such as teacher */
				__( '%1$s (%2$s)', 'fair-events-experimental' ),
				assignmentName( assignment ),
				assignment.role
			)
		: assignmentName( assignment );
}

/**
 * Why a role cannot be added, or '' when it can.
 *
 * @param {string}      role        Entered role.
 * @param {Object|null} member      Chosen profile.
 * @param {Object[]}    assignments Current assignments.
 * @return {string} Reason.
 */
export function addBlockedReason( role, member, assignments ) {
	if ( ! member ) {
		return __( 'Choose a person to add.', 'fair-events-experimental' );
	}
	if ( ! role ) {
		return __(
			'Enter a role, such as teacher or organizer.',
			'fair-events-experimental'
		);
	}
	if ( role.length > ROLE_MAX_LENGTH || ! ROLE_PATTERN.test( role ) ) {
		return sprintf(
			/* translators: %d: maximum role length in characters */
			__(
				'Use up to %d lowercase letters, digits, hyphens or underscores, starting with a letter, such as teacher.',
				'fair-events-experimental'
			),
			ROLE_MAX_LENGTH
		);
	}
	if (
		assignments.some(
			( assignment ) =>
				assignment.member_id === member.id && assignment.role === role
		)
	) {
		return sprintf(
			/* translators: 1: team member name, 2: role, such as teacher */
			__(
				'%1$s is already %2$s here. Choose another role or person.',
				'fair-events-experimental'
			),
			memberName( member ),
			role
		);
	}
	return '';
}

/**
 * Picker label: name and surname, with the email when two people share a
 * name so the administrator can tell them apart.
 *
 * @param {Object}   member    Directory profile.
 * @param {Object[]} directory Every profile.
 * @return {string} Label.
 */
export function pickerLabel( member, directory ) {
	const name = memberName( member );
	const shared = directory.filter(
		( other ) => memberName( other ) === name
	);
	return shared.length > 1 && member.email
		? sprintf(
				/* translators: 1: team member name, 2: their email address */
				__( '%1$s (%2$s)', 'fair-events-experimental' ),
				name,
				member.email
			)
		: name;
}

/**
 * Contributor list with its controls.
 *
 * @param {Object}   props             Component props.
 * @param {string}   props.idPrefix    Unique prefix for the form's IDs.
 * @param {Object[]} props.assignments Ordered `{ id, member_id, name, surname, role }`.
 * @param {Object[]} props.directory   Every directory profile.
 * @param {boolean}  props.readOnly    Show the list without controls.
 * @param {string}   props.emptyText   Text for an empty list.
 * @param {string}   props.addLabel    Label of the person picker.
 * @param {Function} props.onAdd       `( memberId, role ) => Promise`.
 * @param {Function} props.onRemove    `( assignment ) => Promise`.
 * @param {Function} props.onReorder   `( assignmentIds ) => Promise`.
 * @param {Function} props.onStale     Called when the list changed meanwhile.
 * @return {JSX.Element} The list.
 */
export default function ContributorAssignments( {
	idPrefix,
	assignments,
	directory = [],
	readOnly = false,
	emptyText,
	addLabel,
	onAdd,
	onRemove,
	onReorder,
	onStale,
} ) {
	const [ memberId, setMemberId ] = useState( null );
	const [ role, setRole ] = useState( '' );
	const [ triedAdd, setTriedAdd ] = useState( false );
	// Key of the change being saved: 'add', or `${ action }-${ id }`.
	const [ pending, setPending ] = useState( null );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const pendingRef = useRef( false );

	const run = async ( key, request, message, fallback ) => {
		if ( pendingRef.current ) {
			return false;
		}
		pendingRef.current = true;
		setPending( key );
		setError( null );
		setSuccess( null );
		try {
			await request();
			setSuccess( message );
			return true;
		} catch ( err ) {
			setError( err?.message || fallback );
			if (
				'rest_team_order_stale' === err?.code ||
				err?.data?.series_event_date_id
			) {
				onStale?.();
			}
			return false;
		} finally {
			pendingRef.current = false;
			setPending( null );
		}
	};

	const member =
		directory.find( ( item ) => String( item.id ) === memberId ) || null;
	const trimmedRole = role.trim();
	const blocked = addBlockedReason( trimmedRole, member, assignments );

	const add = async () => {
		setTriedAdd( true );
		if ( blocked ) {
			return;
		}
		const label = sprintf(
			/* translators: 1: team member name, 2: role, such as teacher */
			__( '%1$s (%2$s)', 'fair-events-experimental' ),
			memberName( member ),
			trimmedRole
		);
		const added = await run(
			'add',
			() => onAdd( member.id, trimmedRole ),
			sprintf(
				/* translators: %s: team member name and role */
				__( '%s was added.', 'fair-events-experimental' ),
				label
			),
			sprintf(
				/* translators: %s: team member name and role */
				__(
					'%s could not be added. Try again.',
					'fair-events-experimental'
				),
				label
			)
		);
		if ( added ) {
			setMemberId( null );
			setRole( '' );
			setTriedAdd( false );
		}
	};

	const remove = ( assignment ) =>
		run(
			`remove-${ assignment.id }`,
			() => onRemove( assignment ),
			sprintf(
				/* translators: %s: team member name, with their role when they have one */
				__(
					'%s was removed. Their profile and other assignments stay as they are.',
					'fair-events-experimental'
				),
				assignmentLabel( assignment )
			),
			sprintf(
				/* translators: %s: team member name, with their role when they have one */
				__(
					'%s could not be removed. Try again.',
					'fair-events-experimental'
				),
				assignmentLabel( assignment )
			)
		);

	const move = ( index, delta ) => {
		const target = index + delta;
		if ( target < 0 || target >= assignments.length ) {
			return;
		}
		const ids = assignments.map( ( assignment ) => assignment.id );
		[ ids[ index ], ids[ target ] ] = [ ids[ target ], ids[ index ] ];
		const assignment = assignments[ index ];
		void run(
			`move-${ assignment.id }`,
			() => onReorder( ids ),
			sprintf(
				/* translators: 1: team member name with role, 2: new position number */
				__( '%1$s is now number %2$d.', 'fair-events-experimental' ),
				assignmentLabel( assignment ),
				target + 1
			),
			__(
				'The new order could not be saved. Try again.',
				'fair-events-experimental'
			)
		);
	};

	const notices = (
		<>
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			{ success && (
				<Notice status="success" onRemove={ () => setSuccess( null ) }>
					{ success }
				</Notice>
			) }
		</>
	);

	const busy = null !== pending;
	const roles = [
		...new Set( [
			...SUGGESTED_ROLES,
			...assignments
				.map( ( assignment ) => assignment.role )
				.filter( Boolean ),
		] ),
	];

	return (
		<VStack spacing={ 2 }>
			{ assignments.length ? (
				<ol style={ LIST_STYLE }>
					{ assignments.map( ( assignment, index ) => {
						const label = assignmentLabel( assignment );
						return (
							<li key={ assignment.id }>
								<div style={ ITEM_STYLE }>
									<span
										style={ { overflowWrap: 'anywhere' } }
									>
										{ assignmentName( assignment ) }
									</span>
									{ assignment.role ? (
										<span style={ ROLE_STYLE }>
											{ assignment.role }
										</span>
									) : (
										<span style={ HINT_STYLE }>
											{ __(
												'No role — not included in campaigns',
												'fair-events-experimental'
											) }
										</span>
									) }
									{ ! readOnly && (
										<span style={ ACTIONS_STYLE }>
											<Button
												variant="link"
												onClick={ () =>
													move( index, -1 )
												}
												disabled={ busy || 0 === index }
												isBusy={
													pending ===
													`move-${ assignment.id }`
												}
												accessibleWhenDisabled
												label={ sprintf(
													/* translators: %s: team member name, with their role when they have one */
													__(
														'Move %s up',
														'fair-events-experimental'
													),
													label
												) }
												showTooltip={ false }
											>
												{ __(
													'Move up',
													'fair-events-experimental'
												) }
											</Button>
											<Button
												variant="link"
												onClick={ () =>
													move( index, 1 )
												}
												disabled={
													busy ||
													index ===
														assignments.length - 1
												}
												accessibleWhenDisabled
												label={ sprintf(
													/* translators: %s: team member name, with their role when they have one */
													__(
														'Move %s down',
														'fair-events-experimental'
													),
													label
												) }
												showTooltip={ false }
											>
												{ __(
													'Move down',
													'fair-events-experimental'
												) }
											</Button>
											<Button
												variant="link"
												isDestructive
												onClick={ () =>
													remove( assignment )
												}
												disabled={ busy }
												isBusy={
													pending ===
													`remove-${ assignment.id }`
												}
												accessibleWhenDisabled
												label={ sprintf(
													/* translators: %s: team member name, with their role when they have one */
													__(
														'Remove %s',
														'fair-events-experimental'
													),
													label
												) }
												showTooltip={ false }
											>
												{ pending ===
												`remove-${ assignment.id }`
													? __(
															'Removing…',
															'fair-events-experimental'
														)
													: __(
															'Remove',
															'fair-events-experimental'
														) }
											</Button>
										</span>
									) }
								</div>
							</li>
						);
					} ) }
				</ol>
			) : (
				<p style={ { margin: 0 } }>{ emptyText }</p>
			) }
			{ notices }
			{ ! readOnly && directory.length > 0 && (
				<div style={ ADD_STYLE }>
					<div style={ { flex: '2 1 200px', minWidth: 0 } }>
						<ComboboxControl
							label={ addLabel }
							value={ memberId }
							options={ directory.map( ( item ) => ( {
								value: String( item.id ),
								label: pickerLabel( item, directory ),
							} ) ) }
							onChange={ ( value ) => setMemberId( value ) }
							disabled={ busy }
							help={ __(
								'Type to search the directory.',
								'fair-events-experimental'
							) }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
					</div>
					<div style={ { flex: '1 1 140px', minWidth: 0 } }>
						<TextControl
							label={ __( 'Role', 'fair-events-experimental' ) }
							value={ role }
							onChange={ setRole }
							list={ `${ idPrefix }-roles` }
							disabled={ busy }
							help={ __(
								'Lowercase, such as teacher or organizer.',
								'fair-events-experimental'
							) }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
						<datalist id={ `${ idPrefix }-roles` }>
							{ roles.map( ( item ) => (
								<option key={ item } value={ item } />
							) ) }
						</datalist>
					</div>
					<div style={ { paddingTop: '24px' } }>
						<Button
							variant="secondary"
							onClick={ add }
							isBusy={ 'add' === pending }
							disabled={ busy }
							accessibleWhenDisabled
							aria-describedby={
								triedAdd && blocked
									? `${ idPrefix }-add-reason`
									: undefined
							}
							__next40pxDefaultSize
						>
							{ 'add' === pending
								? __( 'Adding…', 'fair-events-experimental' )
								: __( 'Add', 'fair-events-experimental' ) }
						</Button>
					</div>
				</div>
			) }
			{ ! readOnly && triedAdd && blocked && (
				<p
					id={ `${ idPrefix }-add-reason` }
					role="alert"
					style={ { margin: 0, color: '#cc1818' } }
				>
					{ blocked }
				</p>
			) }
		</VStack>
	);
}
