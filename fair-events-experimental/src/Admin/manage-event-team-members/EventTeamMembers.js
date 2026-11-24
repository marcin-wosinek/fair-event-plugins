/**
 * Team members section of Manage Event's Event Details (#2394, #2422).
 *
 * Administrators assign people from the sitewide directory to an event's
 * team, each with a role and in order. Each change is saved at once and
 * touches only that assignment or the order, so nothing else on the page
 * needs saving. A series has one team, managed on the series; its dates
 * show the team and the programme contributors read-only, with links to
 * where they are managed.
 *
 * @package FairEventsExperimental
 */

import { useEffect, useState } from '@wordpress/element';
import {
	BaseControl,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { decodeEntityText } from 'fair-events-shared/src/event-utils.js';
import ContributorAssignments, {
	assignmentLabel,
} from '../components/ContributorAssignments.js';

export const SECTION_NAME = 'team-members';

const HINT_STYLE = { margin: 0, color: '#757575' };

/**
 * URL of this page for another event date, opened on a tab.
 *
 * @param {number} eventDateId Event date to open.
 * @param {string} [tab]       Tab to open; Event Details when omitted.
 * @return {string} Manage Event URL.
 */
export function manageEventUrl( eventDateId, tab ) {
	const url = new URL( window.location.href );
	url.searchParams.set( 'event_date_id', String( eventDateId ) );
	if ( tab ) {
		url.searchParams.set( 'tab', tab );
	} else {
		url.searchParams.delete( 'tab' );
	}
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
 * Title of a schedule item, with a fallback for an untitled one.
 *
 * @param {Object} item Programme item `{ title }`.
 * @return {string} Title.
 */
function itemTitle( item ) {
	return (
		decodeEntityText( item.title || '' ).trim() ||
		__( '(untitled item)', 'fair-events-experimental' )
	);
}

/**
 * The series' programme contributors, read-only, on one of its dates.
 *
 * @param {Object}   props          Component props.
 * @param {Object[]} props.items    Programme items with their assignments.
 * @param {number}   props.seriesId Event date that stores the schedule.
 * @return {JSX.Element|null} The summary, or null without assignments.
 */
function ProgrammeSummary( { items, seriesId } ) {
	const assigned = items.filter( ( item ) => item.assignments.length > 0 );
	if ( ! assigned.length ) {
		return null;
	}

	return (
		<VStack spacing={ 1 }>
			<h4 style={ { margin: 0 } }>
				{ __( 'Programme contributors', 'fair-events-experimental' ) }
			</h4>
			<ul style={ { margin: 0, paddingLeft: '1.5em' } }>
				{ assigned.map( ( item ) => (
					<li
						key={ item.schedule_item_id }
						style={ { overflowWrap: 'anywhere' } }
					>
						{ sprintf(
							/* translators: 1: schedule item title, 2: comma-separated contributors with roles */
							__( '%1$s: %2$s', 'fair-events-experimental' ),
							itemTitle( item ),
							item.assignments
								.map( ( assignment ) =>
									assignmentLabel( assignment )
								)
								.join( ', ' )
						) }
					</li>
				) ) }
			</ul>
			<div>
				<Button
					variant="link"
					href={ manageEventUrl( seriesId, 'schedule' ) }
				>
					{ __(
						'Manage programme contributors in the series’ schedule',
						'fair-events-experimental'
					) }
				</Button>
			</div>
		</VStack>
	);
}

/**
 * Team members section content.
 *
 * @param {Object}  props             Component props.
 * @param {number}  props.eventDateId Event date ID.
 * @param {boolean} props.isSeries    Whether the event is a series.
 * @return {JSX.Element} The section.
 */
export default function EventTeamMembers( { eventDateId, isSeries = false } ) {
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ reloadKey, setReloadKey ] = useState( 0 );
	// `{ owner_event_date_id, series_event_date_id, members, assignments }`.
	const [ team, setTeam ] = useState( null );
	const [ directory, setDirectory ] = useState( [] );
	// Programme items of the series, on one of its dates.
	const [ programme, setProgramme ] = useState( [] );

	useEffect( () => {
		let cancelled = false;
		setLoading( true );
		setLoadError( null );

		apiFetch( {
			path: `/fair-events/v1/event-dates/${ eventDateId }/team-members`,
		} )
			.then( ( data ) =>
				data.series_event_date_id
					? apiFetch( {
							path: `/fair-events/v1/event-dates/${ eventDateId }/schedule-contributors`,
						} ).then( ( schedule ) => [
							data,
							[],
							schedule.items || [],
						] )
					: apiFetch( { path: '/fair-events/v1/team-members' } ).then(
							( list ) => [ data, list, [] ]
						)
			)
			.then( ( [ data, list, items ] ) => {
				if ( cancelled ) {
					return;
				}
				setTeam( data );
				setDirectory( list );
				setProgramme( items );
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

	const reload = () => setReloadKey( ( key ) => key + 1 );
	const label = __( 'Team members', 'fair-events-experimental' );

	if ( loading && ! team ) {
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
						<Button variant="secondary" onClick={ reload }>
							{ __( 'Try again', 'fair-events-experimental' ) }
						</Button>
					</div>
				</VStack>
			</BaseControl>
		);
	}

	const assignments = team.assignments || [];
	const seriesId = team.series_event_date_id;
	const teamPath = `/fair-events/v1/event-dates/${ eventDateId }`;

	if ( seriesId ) {
		return (
			<BaseControl label={ label } __nextHasNoMarginBottom>
				<VStack spacing={ 3 }>
					<p style={ HINT_STYLE }>
						{ __(
							'This date is part of a series. All its dates share the series’ team and programme contributors, which are managed on the series. They cannot be changed for this date alone.',
							'fair-events-experimental'
						) }
					</p>
					<ContributorAssignments
						idPrefix={ `fair-events-team-${ eventDateId }` }
						assignments={ assignments }
						readOnly
						emptyText={ __(
							'The series has no team members yet.',
							'fair-events-experimental'
						) }
					/>
					<div>
						<Button
							variant="secondary"
							href={ manageEventUrl( seriesId ) }
						>
							{ __(
								'Manage the team on the series',
								'fair-events-experimental'
							) }
						</Button>
					</div>
					<ProgrammeSummary
						items={ programme }
						seriesId={ seriesId }
					/>
				</VStack>
			</BaseControl>
		);
	}

	const save = async ( request ) => {
		const data = await request();
		setTeam( data );
	};

	return (
		<BaseControl label={ label } __nextHasNoMarginBottom>
			<VStack spacing={ 2 }>
				<ContributorAssignments
					idPrefix={ `fair-events-team-${ eventDateId }` }
					assignments={ assignments }
					directory={ directory }
					emptyText={ __(
						'No one is on this event’s team yet.',
						'fair-events-experimental'
					) }
					addLabel={ __(
						'Add a team member',
						'fair-events-experimental'
					) }
					onAdd={ ( memberId, role ) =>
						save( () =>
							apiFetch( {
								path: `${ teamPath }/team-assignments`,
								method: 'POST',
								data: { member_id: memberId, role },
							} )
						)
					}
					onRemove={ ( assignment ) =>
						save( () =>
							apiFetch(
								assignment.role
									? {
											path: `${ teamPath }/team-assignments/${ assignment.id }`,
											method: 'DELETE',
										}
									: {
											path: `${ teamPath }/team-members/${ assignment.member_id }`,
											method: 'DELETE',
										}
							)
						)
					}
					onReorder={ ( ids ) =>
						save( () =>
							apiFetch( {
								path: `${ teamPath }/team-assignments/order`,
								method: 'PUT',
								data: { assignment_ids: ids },
							} )
						)
					}
					onStale={ reload }
				/>
				<p style={ HINT_STYLE }>
					{ isSeries
						? __(
								'People with a role are listed in campaigns in this order. Changes apply to every date of the series, past dates included.',
								'fair-events-experimental'
							)
						: __(
								'People with a role are listed in campaigns in this order.',
								'fair-events-experimental'
							) }
				</p>
				{ 0 === directory.length && (
					<p style={ HINT_STYLE }>
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
