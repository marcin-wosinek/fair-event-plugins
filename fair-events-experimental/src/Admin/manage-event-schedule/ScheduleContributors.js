/**
 * Programme contributors on the Schedule tab (#2422).
 *
 * `ScheduleContributors` loads the contributors of every saved schedule
 * item and the team member directory once, and reloads them after each
 * schedule save (`version`), so an item the save removed loses its list.
 * `ScheduleContributors.Slot` shows one entry's contributors in its card.
 * Contributors are saved on their own, at once, independently of "Save
 * schedule"; an entry must be saved first, since they belong to the saved
 * item.
 *
 * Rendered only while the team directory is available to the user.
 *
 * @package FairEventsExperimental
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from '@wordpress/element';
import {
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import ContributorAssignments from '../components/ContributorAssignments.js';

const Context = createContext( null );

const HINT_STYLE = { margin: 0, color: '#757575' };

/**
 * Assignments keyed by schedule item ID.
 *
 * @param {Object} data `/schedule-contributors` response.
 * @return {Object} Assignments by item ID.
 */
function byItem( data ) {
	return Object.fromEntries(
		( data.items || [] ).map( ( item ) => [
			item.schedule_item_id,
			item.assignments,
		] )
	);
}

/**
 * Loads and holds the programme contributors.
 *
 * @param {Object}      props             Component props.
 * @param {number}      props.eventDateId Event date ID.
 * @param {number}      props.version     Changes after each schedule save.
 * @param {JSX.Element} props.children    The schedule editor.
 * @return {JSX.Element} The provider.
 */
export default function ScheduleContributors( {
	eventDateId,
	version,
	children,
} ) {
	const [ state, setState ] = useState( {
		loading: true,
		error: null,
		items: {},
		directory: [],
	} );
	const [ reloadKey, setReloadKey ] = useState( 0 );
	const reload = useCallback( () => setReloadKey( ( key ) => key + 1 ), [] );

	useEffect( () => {
		let cancelled = false;
		setState( ( prev ) => ( { ...prev, loading: true, error: null } ) );

		Promise.all( [
			apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/schedule-contributors`,
			} ),
			apiFetch( { path: '/fair-events/v1/team-members' } ),
		] )
			.then( ( [ data, directory ] ) => {
				if ( ! cancelled ) {
					setState( {
						loading: false,
						error: null,
						items: byItem( data ),
						directory,
					} );
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setState( ( prev ) => ( {
						...prev,
						loading: false,
						error:
							err?.message ||
							__(
								'The contributors could not be loaded.',
								'fair-events-experimental'
							),
					} ) );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ eventDateId, version, reloadKey ] );

	const save = useCallback(
		async ( request ) => {
			const data = await request();
			setState( ( prev ) => ( { ...prev, items: byItem( data ) } ) );
		},
		[ setState ]
	);

	return (
		<Context.Provider value={ { ...state, eventDateId, save, reload } }>
			{ children }
		</Context.Provider>
	);
}

/**
 * The contributors of one schedule entry.
 *
 * @param {Object}  props          Component props.
 * @param {Object}  props.entry    Schedule entry; `id` is set once saved.
 * @param {boolean} props.readOnly Whether the schedule is read-only here.
 * @return {JSX.Element|null} The section.
 */
function Slot( { entry, readOnly } ) {
	const context = useContext( Context );
	if ( ! context ) {
		return null;
	}
	const { loading, error, items, directory, eventDateId, save, reload } =
		context;

	const heading = (
		<h4 style={ { margin: 0 } }>
			{ __( 'Contributors', 'fair-events-experimental' ) }
		</h4>
	);

	let body;
	if ( ! entry.id ) {
		body = (
			<p style={ HINT_STYLE }>
				{ __(
					'Save the schedule first, then assign contributors to this item.',
					'fair-events-experimental'
				) }
			</p>
		);
	} else if ( loading && ! items[ entry.id ] ) {
		body = <Spinner />;
	} else if ( error ) {
		body = (
			<VStack spacing={ 2 }>
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
				<div>
					<Button variant="secondary" onClick={ reload }>
						{ __( 'Try again', 'fair-events-experimental' ) }
					</Button>
				</div>
			</VStack>
		);
	} else {
		const path = `/fair-events/v1/event-dates/${ eventDateId }/schedule-items/${ entry.id }/contributors`;
		body = (
			<ContributorAssignments
				idPrefix={ `fair-events-schedule-contributors-${ entry.id }` }
				assignments={ items[ entry.id ] || [] }
				directory={ directory }
				readOnly={ readOnly }
				emptyText={ __(
					'No contributors yet.',
					'fair-events-experimental'
				) }
				addLabel={ __(
					'Add a contributor',
					'fair-events-experimental'
				) }
				onAdd={ ( memberId, role ) =>
					save( () =>
						apiFetch( {
							path,
							method: 'POST',
							data: { member_id: memberId, role },
						} )
					)
				}
				onRemove={ ( assignment ) =>
					save( () =>
						apiFetch( {
							path: `${ path }/${ assignment.id }`,
							method: 'DELETE',
						} )
					)
				}
				onReorder={ ( ids ) =>
					save( () =>
						apiFetch( {
							path: `${ path }/order`,
							method: 'PUT',
							data: { assignment_ids: ids },
						} )
					)
				}
				onStale={ reload }
			/>
		);
	}

	return (
		<div className="fair-events-schedule-contributors">
			<VStack spacing={ 2 }>
				{ heading }
				{ body }
				{ entry.id && ! readOnly && ! error && (
					<p style={ HINT_STYLE }>
						{ __(
							'Saved at once, separately from the schedule. On a series, changes apply to every date, past dates included.',
							'fair-events-experimental'
						) }
					</p>
				) }
			</VStack>
		</div>
	);
}

ScheduleContributors.Slot = Slot;
