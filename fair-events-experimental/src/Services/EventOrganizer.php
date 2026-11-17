<?php
/**
 * Organizer assigned to an event.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEvents\Helpers\OrganizationSchema;
use FairEvents\Models\EventDates;
use FairEventsExperimental\Models\OrganizerRepository;

defined( 'WPINC' ) || die;

/**
 * Resolves which organizer an event belongs to (#2305).
 *
 * Fair Events stores the assignment as a nullable organizer UUID on the
 * event date row; NULL means the sitewide organizer. A series keeps one
 * assignment on its master, which every generated occurrence uses; an
 * occurrence has none of its own.
 *
 * The saved assignment is what is stored. The effective organizer is the
 * one public output uses: the assigned additional organizer when it still
 * exists, otherwise the sitewide default. A stored ID that no longer
 * resolves is kept, never cleared, so nothing is lost while an organizer
 * is unavailable.
 */
class EventOrganizer {

	/**
	 * Organizer storage.
	 *
	 * @var OrganizerRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 *
	 * @param OrganizerRepository|null $repository Organizer storage.
	 */
	public function __construct( $repository = null ) {
		$this->repository = $repository ? $repository : new OrganizerRepository();
	}

	/**
	 * Register the event JSON-LD organizer filter.
	 *
	 * Only called while organizers are available, so turning the bundle off
	 * (or deactivating this plugin) restores Fair Events' sitewide organizer
	 * without touching saved assignments.
	 *
	 * @return void
	 */
	public static function register_hooks() {
		$service = new self();
		add_filter( 'fair_events_event_jsonld_organizer', array( $service, 'filter_jsonld_organizer' ), 10, 2 );
	}

	/**
	 * Whether the active Fair Events stores organizer assignments.
	 *
	 * @return bool
	 */
	public static function is_supported() {
		return method_exists( EventDates::class, 'get_organizer_id' )
			&& method_exists( EventDates::class, 'save_organizer_id' );
	}

	/**
	 * The event date row that owns the assignment: the series master for a
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
	 * The stored assignment for an event date.
	 *
	 * @param EventDates $event_date Event date row (an occurrence resolves to its series).
	 * @return string Organizer UUID, or {@see OrganizerRepository::DEFAULT_ID}.
	 */
	public function saved_id( EventDates $event_date ) {
		$stored = EventDates::get_organizer_id( self::owner_id( $event_date ) );

		return null === $stored ? OrganizerRepository::DEFAULT_ID : $stored;
	}

	/**
	 * The organizer record public output uses for an event date.
	 *
	 * @param EventDates $event_date Event date row.
	 * @return array Normalized organizer record; the sitewide default when
	 *               nothing is assigned or the assigned organizer can't be
	 *               resolved (or has no name to publish).
	 */
	public function effective( EventDates $event_date ) {
		$saved = $this->saved_id( $event_date );

		if ( OrganizerRepository::DEFAULT_ID !== $saved ) {
			$organizer = $this->repository->find( $saved );
			if ( null !== $organizer && '' !== $organizer['name'] ) {
				return $organizer;
			}
		}

		return $this->repository->find( OrganizerRepository::DEFAULT_ID );
	}

	/**
	 * Store an assignment on its owning row.
	 *
	 * @param int    $owner_id     Owning event date ID (a single event or a series master).
	 * @param string $organizer_id {@see OrganizerRepository::DEFAULT_ID} to clear, or an
	 *                             existing additional organizer's UUID.
	 * @return bool True on success.
	 */
	public function save( $owner_id, $organizer_id ) {
		$value = OrganizerRepository::DEFAULT_ID === $organizer_id ? null : (string) $organizer_id;

		return EventDates::save_organizer_id( (int) $owner_id, $value );
	}

	/**
	 * Whether an ID can be assigned: the default, or an existing additional organizer.
	 *
	 * @param mixed $organizer_id Candidate ID.
	 * @return bool
	 */
	public function is_assignable( $organizer_id ) {
		if ( ! is_string( $organizer_id ) ) {
			return false;
		}

		if ( OrganizerRepository::DEFAULT_ID === $organizer_id ) {
			return true;
		}

		return OrganizerRepository::is_valid_uuid( $organizer_id ) && null !== $this->repository->find( $organizer_id );
	}

	/**
	 * Picker options: each organizer's ID and name only, the default first.
	 *
	 * @return array[] `{ id, name, is_default }` per organizer.
	 */
	public function options() {
		return array_map(
			static function ( $organizer ) {
				return array(
					'id'         => $organizer['id'],
					'name'       => $organizer['name'],
					'is_default' => $organizer['is_default'],
				);
			},
			$this->repository->all()
		);
	}

	/**
	 * Stable JSON-LD `@id` of an additional organizer.
	 *
	 * @param string $organizer_id Organizer UUID.
	 * @return string
	 */
	public static function node_id( $organizer_id ) {
		return home_url( '/' ) . '#organizer-' . $organizer_id;
	}

	/**
	 * Replace the event JSON-LD organizer with the event's assigned one.
	 *
	 * The sitewide default keeps Fair Events' own reference (and its
	 * `#organization` identity). An additional organizer is embedded with
	 * its public identity fields under its own `@id`; its private
	 * notification recipients are never read.
	 *
	 * @param array      $organizer  Default organizer object.
	 * @param EventDates $event_date Event date the JSON-LD describes.
	 * @return array Organizer object.
	 */
	public function filter_jsonld_organizer( $organizer, $event_date ) {
		if ( ! $event_date instanceof EventDates || ! method_exists( OrganizationSchema::class, 'organizer_to_jsonld' ) ) {
			return $organizer;
		}

		$effective = $this->effective( $event_date );
		if ( ! is_array( $effective ) || $effective['is_default'] ) {
			return $organizer;
		}

		return OrganizationSchema::organizer_to_jsonld( $effective, self::node_id( $effective['id'] ) );
	}
}
