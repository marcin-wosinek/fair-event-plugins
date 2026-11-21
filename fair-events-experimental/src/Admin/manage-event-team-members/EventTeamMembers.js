/**
 * Team members section of Manage Event's Event Details (#2394).
 *
 * Administrators add people from the sitewide directory to an event's team
 * and remove them again. Each change is saved at once and touches only that
 * member, so nothing else on the page needs saving. A series has one team,
 * managed on the series; its dates show it with a link there.
 *
 * @package FairEventsExperimental
 */

import { useEffect, useRef, useState } from '@wordpress/element';
import {
	BaseControl,
	Button,
	ComboboxControl,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { memberName } from '../team-members/utils.js';

export const SECTION_NAME = 'team-members';

const LIST_STYLE = { margin: 0, padding: 0, listStyle: 'none' };
const MEMBER_STYLE = {
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '4px 12px',
	marginBottom: '4px',
};

/**
 * URL of this page for another event date, opened on Event Details.
 *
 * @param {number} eventDateId Event date to open.
 * @return {string} Manage Event URL.
 */
function manageEventUrl( eventDateId ) {
	const url = new URL( window.location.href );
	url.searchParams.set( 'event_date_id', String( eventDateId ) );
	url.searchParams.delete( 'tab' );
	return url.toString();
}

/**
 * URL of the team member directory.
 *
 * @return {string} URL.
 */
function directoryUrl() {
	return (
		window.fairEventsTeamMembersData?.directoryUrl ||
		'admin.php?page=fair-events-team-members'
	);
}

/**
 * Picker label: name and surname, with the email when two people share a
 * name so the administrator can tell them apart.
 *
 * @param {Object}   member    Directory profile.
 * @param {Object[]} directory Every profile.
 * @return {string} Label.
 */
function pickerLabel( member, directory ) {
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
 * Team members section content.
 *
 * @param {Object} props             Component props.
 * @param {number} props.eventDateId Event date ID.
 * @return {JSX.Element} The section.
 */
export default function EventTeamMembers( { eventDateId } ) {
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ reloadKey, setReloadKey ] = useState( 0 );
	// `{ owner_event_date_id, series_event_date_id, members }`.
	const [ team, setTeam ] = useState( null );
	const [ directory, setDirectory ] = useState( [] );
	const [ pickerValue, setPickerValue ] = useState( null );
	// Member ID being added or removed, or null.
	const [ pending, setPending ] = useState( null );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const pendingRef = useRef( false );

	useEffect( () => {
		let cancelled = false;
		setLoading( true );
		setLoadError( null );

		apiFetch( {
			path: `/fair-events/v1/event-dates/${ eventDateId }/team-members`,
		} )
			.then( ( data ) =>
				data.series_event_date_id
					? [ data, [] ]
					: apiFetch( { path: '/fair-events/v1/team-members' } ).then(
							( list ) => [ data, list ]
						)
			)
			.then( ( [ data, list ] ) => {
				if ( cancelled ) {
					return;
				}
				setTeam( data );
				setDirectory( list );
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setLoadError(
						err?.message ||
							__(
								'The team could not be loaded.',
								'fair-events-experimental'
							)
					);
				}
			} )
			.finally( () => {
				if ( ! cancelled ) {
					setLoading( false );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ eventDateId, reloadKey ] );

	const change = async ( memberId, request, message, fallback ) => {
		if ( pendingRef.current ) {
			return;
		}
		pendingRef.current = true;
		setPending( memberId );
		setError( null );
		setSuccess( null );
		try {
			const data = await request();
			setTeam( data );
			setSuccess( message );
		} catch ( err ) {
			setError( err?.message || fallback );
			if ( err?.data?.series_event_date_id ) {
				setReloadKey( ( key ) => key + 1 );
			}
		} finally {
			pendingRef.current = false;
			setPending( null );
		}
	};

	const addMember = ( value ) => {
		setPickerValue( null );
		const member = directory.find(
			( item ) => String( item.id ) === String( value )
		);
		if ( ! member ) {
			return;
		}
		void change(
			member.id,
			() =>
				apiFetch( {
					path: `/fair-events/v1/event-dates/${ eventDateId }/team-members`,
					method: 'POST',
					data: { member_id: member.id },
				} ),
			sprintf(
				/* translators: %s: team member name */
				__( '%s was added to the team.', 'fair-events-experimental' ),
				memberName( member )
			),
			sprintf(
				/* translators: %s: team member name */
				__(
					'%s could not be added to the team. Try again.',
					'fair-events-experimental'
				),
				memberName( member )
			)
		);
	};

	const removeMember = ( member ) =>
		change(
			member.id,
			() =>
				apiFetch( {
					path: `/fair-events/v1/event-dates/${ eventDateId }/team-members/${ member.id }`,
					method: 'DELETE',
				} ),
			sprintf(
				/* translators: %s: team member name */
				__(
					'%s was removed from the team. Their profile stays in the directory.',
					'fair-events-experimental'
				),
				memberName( member )
			),
			sprintf(
				/* translators: %s: team member name */
				__(
					'%s could not be removed from the team. Try again.',
					'fair-events-experimental'
				),
				memberName( member )
			)
		);

	const label = __( 'Team members', 'fair-events-experimental' );

	if ( loading ) {
		return (
			<BaseControl label={ label } __nextHasNoMarginBottom>
				<div>
					<Spinner />
				</div>
			</BaseControl>
		);
	}

	if ( loadError ) {
		return (
			<BaseControl label={ label } __nextHasNoMarginBottom>
				<VStack spacing={ 2 }>
					<Notice status="error" isDismissible={ false }>
						{ loadError }
					</Notice>
					<div>
						<Button
							variant="secondary"
							onClick={ () => setReloadKey( ( key ) => key + 1 ) }
						>
							{ __( 'Try again', 'fair-events-experimental' ) }
						</Button>
					</div>
				</VStack>
			</BaseControl>
		);
	}

	const members = team.members || [];
	const isSeriesDate = !! team.series_event_date_id;

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

	if ( isSeriesDate ) {
		return (
			<BaseControl label={ label } __nextHasNoMarginBottom>
				<VStack spacing={ 2 }>
					{ notices }
					{ members.length ? (
						<ul style={ LIST_STYLE }>
							{ members.map( ( member ) => (
								<li key={ member.id }>
									{ memberName( member ) }
								</li>
							) ) }
						</ul>
					) : (
						<p style={ { margin: 0 } }>
							{ __(
								'The series has no team members yet.',
								'fair-events-experimental'
							) }
						</p>
					) }
					<p style={ { margin: 0, color: '#757575' } }>
						{ __(
							'This date is part of a series. All its dates share the series’ team, which is managed on the series.',
							'fair-events-experimental'
						) }
					</p>
					<div>
						<Button
							variant="secondary"
							href={ manageEventUrl( team.series_event_date_id ) }
						>
							{ __(
								'Manage the team on the series',
								'fair-events-experimental'
							) }
						</Button>
					</div>
				</VStack>
			</BaseControl>
		);
	}

	const linkedIds = new Set( members.map( ( member ) => member.id ) );
	const options = directory
		.filter( ( member ) => ! linkedIds.has( member.id ) )
		.map( ( member ) => ( {
			value: String( member.id ),
			label: pickerLabel( member, directory ),
		} ) );

	return (
		<BaseControl label={ label } __nextHasNoMarginBottom>
			<VStack spacing={ 2 }>
				{ members.length ? (
					<ul style={ LIST_STYLE }>
						{ members.map( ( member ) => {
							const name = memberName( member );
							return (
								<li key={ member.id } style={ MEMBER_STYLE }>
									<span
										style={ { overflowWrap: 'anywhere' } }
									>
										{ name }
									</span>
									<Button
										variant="link"
										isDestructive
										onClick={ () => removeMember( member ) }
										disabled={ null !== pending }
										isBusy={ pending === member.id }
										accessibleWhenDisabled
										label={ sprintf(
											/* translators: %s: team member name */
											__(
												'Remove %s from the team',
												'fair-events-experimental'
											),
											name
										) }
										showTooltip={ false }
									>
										{ pending === member.id
											? __(
													'Removing…',
													'fair-events-experimental'
												)
											: __(
													'Remove',
													'fair-events-experimental'
												) }
									</Button>
								</li>
							);
						} ) }
					</ul>
				) : (
					<p style={ { margin: 0 } }>
						{ __(
							'No one is on this event’s team yet.',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ notices }
				{ directory.length > 0 && options.length > 0 && (
					<ComboboxControl
						label={ __(
							'Add a team member',
							'fair-events-experimental'
						) }
						value={ pickerValue }
						options={ options }
						onChange={ addMember }
						disabled={ null !== pending }
						help={ __(
							'Type to search the directory. The person is added at once; all dates of a series share its team.',
							'fair-events-experimental'
						) }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
				) }
				{ directory.length > 0 && 0 === options.length && (
					<p style={ { margin: 0, color: '#757575' } }>
						{ __(
							'Everyone in the directory is on this team.',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ 0 === directory.length && (
					<p style={ { margin: 0, color: '#757575' } }>
						{ __(
							'The team member directory is empty. Add people there first.',
							'fair-events-experimental'
						) }
					</p>
				) }
				<div>
					<Button variant="link" href={ directoryUrl() }>
						{ __(
							'Manage team members',
							'fair-events-experimental'
						) }
					</Button>
				</div>
			</VStack>
		</BaseControl>
	);
}
