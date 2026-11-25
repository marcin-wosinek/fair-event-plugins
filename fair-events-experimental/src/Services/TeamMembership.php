<?php
/**
 * Team membership of events.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEvents\Models\EventDates;
use FairEvents\Models\ScheduleItem;
use FairEventsExperimental\Core\Plugin;
use FairEventsExperimental\Models\TeamMemberRepository;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Resolves which event date owns an event's team and its programme
 * contributors, and keeps assignments in step with the event lifecycle
 * (#2394, #2422).
 *
 * A series keeps one team on its master, which every generated occurrence
 * reads, so past and newly generated occurrences always show the current
 * team. Programme contributors belong to the schedule item, which a series
 * also keeps on its master. Standalone events and independent copies own
 * their own assignments.
 *
 * The lifecycle hooks are registered whether or not the `team-members`
 * bundle is on: a deleted event's or schedule item's assignments are always
 * removed, and a copy always starts with its source's assignments.
 */
class TeamMembership {

	/**
	 * Storage.
	 *
	 * @var TeamMemberRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 *
	 * @param TeamMemberRepository|null $repository Storage.
	 */
	public function __construct( $repository = null ) {
		$this->repository = $repository ? $repository : new TeamMemberRepository();
	}

	/**
	 * Register the lifecycle hooks.
	 *
	 * @return void
	 */
	public static function register_lifecycle_hooks() {
		$service = new self();
		add_action( 'fair_events_event_date_deleted', array( $service, 'handle_event_date_deleted' ), 10, 1 );
		add_filter( 'fair_events_event_copy_extensions', array( $service, 'handle_event_copied' ), 10, 4 );
		add_filter( 'fair_events_schedule_item_removed', array( $service, 'handle_schedule_item_removed' ), 10, 2 );
		add_filter( 'fair_events_campaign_contributors', array( $service, 'filter_campaign_contributors' ), 10, 2 );
		add_filter( 'fair_events_campaign_team_profiles', array( self::class, 'filter_campaign_team_profiles' ), 10, 2 );
		add_filter( 'fair_events_campaign_snapshot_tables', array( self::class, 'filter_snapshot_tables' ) );
	}

	/**
	 * `fair_events_campaign_team_profiles` filter: the promotional profiles
	 * of the members a complete campaign-facts read references (#2424).
	 * Fair Events passes null, which stays the answer while this plugin is
	 * inactive.
	 *
	 * @param mixed $profiles   Value so far (null: not supplied).
	 * @param int[] $member_ids Referenced profile IDs.
	 * @return array|WP_Error See PromotionalTeamProfiles::read().
	 */
	public static function filter_campaign_team_profiles( $profiles, $member_ids ) {
		if ( null !== $profiles ) {
			return $profiles;
		}

		return PromotionalTeamProfiles::read( (array) $member_ids );
	}

	/**
	 * `fair_events_campaign_snapshot_tables` filter: the team tables a
	 * complete campaign-facts read touches.
	 *
	 * @param string[] $tables Table names.
	 * @return string[]
	 */
	public static function filter_snapshot_tables( $tables ) {
		$tables   = (array) $tables;
		$tables[] = TeamMemberRepository::members_table();
		$tables[] = TeamMemberRepository::memberships_table();
		return $tables;
	}

	/**
	 * The event date row that owns the team: the series master for a
	 * generated occurrence, otherwise the row itself.
	 *
	 * @param EventDates $event_date Event date row.
	 * @return int Owning event date ID.
	 */
	public static function owner_id( EventDates $event_date ) {
		if ( 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			return (int) $event_date->master_id;
		}

		return (int) $event_date->id;
	}

	/**
	 * The event date row that owns the programme: the schedule's own
	 * owner, which for a generated occurrence is its series master.
	 *
	 * @param EventDates $event_date Event date row.
	 * @return int Owning event date ID.
	 */
	public static function programme_owner_id( EventDates $event_date ) {
		if ( class_exists( \FairEvents\Services\EventSchedule::class ) ) {
			return \FairEvents\Services\EventSchedule::config_event_date_id( $event_date );
		}

		return self::owner_id( $event_date );
	}

	/**
	 * Titles of an event's schedule items, in programme order: a
	 * workshop's ticket option name, otherwise the item's own title.
	 *
	 * @param int $owner_id Event date that stores the schedule.
	 * @return array<int, string> Titles keyed by schedule item ID.
	 */
	public static function schedule_item_titles( $owner_id ) {
		$options = array();
		foreach ( \FairEvents\Models\TicketOption::get_all_by_event_date_id( (int) $owner_id ) as $option ) {
			$options[ (int) $option->id ] = (string) $option->name;
		}

		$titles = array();
		foreach ( ScheduleItem::get_all_by_event_date_id( (int) $owner_id ) as $item ) {
			$titles[ (int) $item->id ] = $item->ticket_option_id && isset( $options[ $item->ticket_option_id ] )
				? $options[ $item->ticket_option_id ]
				: (string) $item->title;
		}
		return $titles;
	}

	/**
	 * Members of an event date's team: IDs, names and surnames only.
	 *
	 * @param EventDates $event_date Event date row (an occurrence resolves to its series).
	 * @return array[]
	 */
	public function members( EventDates $event_date ) {
		return $this->repository->members_of( self::owner_id( $event_date ) );
	}

	/**
	 * Remove the memberships an event date owned once it is deleted.
	 *
	 * @param int $event_date_id Deleted event date ID.
	 * @return void
	 */
	public function handle_event_date_deleted( $event_date_id ) {
		if ( ! TeamMemberRepository::is_installed() ) {
			return;
		}

		$this->repository->delete_owner( (int) $event_date_id );
	}

	/**
	 * Remove the programme contributors of a schedule item the organizer
	 * removed. Runs inside the schedule save, so a failure here makes the
	 * save change nothing.
	 *
	 * @param bool|\WP_Error $result  Result so far; anything but true is a failure.
	 * @param int            $item_id Removed schedule item ID.
	 * @return bool|\WP_Error
	 */
	public function handle_schedule_item_removed( $result, $item_id ) {
		if ( true !== $result || ! TeamMemberRepository::is_installed() ) {
			return $result;
		}

		return $this->repository->delete_item( (int) $item_id );
	}

	/**
	 * Give an event copy its source's team and programme contributors, in
	 * their order, on the copy's own schedule items.
	 *
	 * Runs inside Fair Events' copy, so a failure here makes it remove the
	 * partial copy — whose assignments the deletion hook then removes. An
	 * older Fair Events passes no item map; the programme contributors are
	 * then not copied.
	 *
	 * @param bool|\WP_Error  $result               Result so far; anything but true is a failure.
	 * @param int             $source_owner_id      Source series master or single event.
	 * @param int             $destination_owner_id The copy's own event date ID.
	 * @param array<int, int> $item_map             Source-to-copy schedule item IDs.
	 * @return bool|\WP_Error
	 */
	public function handle_event_copied( $result, $source_owner_id, $destination_owner_id, $item_map = array() ) {
		if ( true !== $result || ! TeamMemberRepository::is_installed() ) {
			return $result;
		}

		return $this->repository->copy_owner( (int) $source_owner_id, (int) $destination_owner_id, is_array( $item_map ) ? $item_map : array() );
	}

	/**
	 * `fair_events_campaign_contributors` filter: the contributor facts of
	 * an occurrence for the campaign producer (#2424). Fair Events passes
	 * null, which stays the answer while this plugin is inactive.
	 *
	 * @param mixed $contributors  Value so far (null: not supplied).
	 * @param int   $event_date_id Selected occurrence.
	 * @return array|null|WP_Error See campaign_contributors().
	 */
	public function filter_campaign_contributors( $contributors, $event_date_id ) {
		if ( null !== $contributors ) {
			return $contributors;
		}

		return $this->campaign_contributors( (int) $event_date_id );
	}

	/**
	 * The ordered contributor assignments of an occurrence, in the shape of
	 * Event Content Studio campaign facts v1 (#2422).
	 *
	 * The event's own contributors come from the team owner and each
	 * programme item's from the schedule owner, so every date of a series
	 * reads the series' current assignments. Memberships without a role are
	 * left out. Profile fields are not part of this read; `memberIds` lists
	 * the profiles referenced, for the registry the producer assembles.
	 *
	 * @param int $event_date_id Selected occurrence.
	 * @return array|null|WP_Error Null while the team directory is off or
	 *                             never installed (assignments not
	 *                             supplied); otherwise `{ eventContributors,
	 *                             items, memberIds }` with `items` one
	 *                             `{ id, contributors }` per schedule item in
	 *                             programme order. A failed query or a
	 *                             broken reference is an error, never an
	 *                             empty list.
	 */
	public function campaign_contributors( $event_date_id ) {
		global $wpdb;

		if ( ! Plugin::team_members_available() || ! TeamMemberRepository::is_installed() ) {
			return null;
		}

		$event_date = EventDates::get_by_id_checked( (int) $event_date_id );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}
		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events-experimental' ),
				array( 'status' => 404 )
			);
		}

		$event_assignments = $this->repository->assignments_of( self::owner_id( $event_date ) );
		$programme_owner   = self::programme_owner_id( $event_date );
		$programme         = $this->repository->programme_assignments_of( $programme_owner );
		$items             = ScheduleItem::get_all_by_event_date_id( $programme_owner );
		if ( null === $event_assignments || null === $programme || '' !== $wpdb->last_error ) {
			return self::unavailable();
		}

		$member_ids = array();
		$contribute = static function ( array $assignments ) use ( &$member_ids ) {
			$out = array();
			foreach ( $assignments as $assignment ) {
				if ( null === $assignment['role'] ) {
					continue;
				}
				if ( null === $assignment['name'] ) {
					return null;
				}
				$member_ids[ $assignment['member_id'] ] = $assignment['member_id'];
				$out[]                                  = array(
					'memberId' => 'team-member:' . $assignment['member_id'],
					'role'     => $assignment['role'],
				);
			}
			return $out;
		};

		$event_contributors = $contribute( $event_assignments );
		if ( null === $event_contributors ) {
			return self::member_missing();
		}

		$item_contributors = array();
		foreach ( $items as $item ) {
			$contributors = $contribute( $programme[ (int) $item->id ] ?? array() );
			if ( null === $contributors ) {
				return self::member_missing();
			}
			$item_contributors[] = array(
				'id'           => 'schedule-item:' . (int) $item->id,
				'contributors' => $contributors,
			);
		}

		$member_ids = array_values( $member_ids );
		sort( $member_ids );

		return array(
			'eventContributors' => $event_contributors,
			'items'             => $item_contributors,
			'memberIds'         => $member_ids,
		);
	}

	/**
	 * Error for a failed assignment query.
	 *
	 * @return WP_Error
	 */
	private static function unavailable() {
		return new WP_Error(
			'fair_events_source_unavailable',
			__( 'The contributors of this event could not be read.', 'fair-events-experimental' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Error for an assignment whose profile no longer exists.
	 *
	 * @return WP_Error
	 */
	private static function member_missing() {
		return new WP_Error(
			'fair_events_team_member_missing',
			__( 'A contributor of this event refers to a team member who no longer exists.', 'fair-events-experimental' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Names and surnames for profile IDs a marketing consumer is authorized
	 * to publish (#2396, #2430). Nothing else of a profile is returned, and
	 * it works whether or not the directory is enabled.
	 *
	 * @param int[] $member_ids Profile IDs.
	 * @return array[] `{ id, name, surname }` per existing profile, keyed by ID.
	 */
	public static function published_names( array $member_ids ) {
		return ( new TeamMemberRepository() )->names_for( $member_ids );
	}
}
