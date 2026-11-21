<?php
/**
 * Team membership of events.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Models\TeamMemberRepository;

defined( 'WPINC' ) || die;

/**
 * Resolves which event date owns an event's team and keeps memberships in
 * step with the event lifecycle (#2394).
 *
 * A series keeps one team on its master, which every generated occurrence
 * reads, so past and newly generated occurrences always show the current
 * team. Standalone events and independent copies own their own team.
 *
 * The lifecycle hooks are registered whether or not the `team-members`
 * bundle is on: a deleted event's memberships are always removed, and a
 * copy always starts with its source's team.
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
		add_filter( 'fair_events_event_copy_extensions', array( $service, 'handle_event_copied' ), 10, 3 );
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
	 * Give an event copy its source's team.
	 *
	 * Runs inside Fair Events' copy, so a failure here makes it remove the
	 * partial copy — whose memberships the deletion hook then removes.
	 *
	 * @param bool|\WP_Error $result               Result so far; anything but true is a failure.
	 * @param int            $source_owner_id      Source series master or single event.
	 * @param int            $destination_owner_id The copy's own event date ID.
	 * @return bool|\WP_Error
	 */
	public function handle_event_copied( $result, $source_owner_id, $destination_owner_id ) {
		if ( true !== $result || ! TeamMemberRepository::is_installed() ) {
			return $result;
		}

		return $this->repository->copy_owner( (int) $source_owner_id, (int) $destination_owner_id );
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
