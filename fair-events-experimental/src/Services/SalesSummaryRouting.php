<?php
/**
 * Organizers for Fair Events' sales summaries.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Models\OrganizerRepository;

defined( 'WPINC' ) || die;

/**
 * Tells Fair Events' sales summaries (#2306) which organizers exist, where
 * their private notification addresses are, and which organizer each event
 * belongs to.
 *
 * Registered only while organizers can be assigned to events. Turning the
 * `organizers` bundle off unhooks it: Fair Events then pauses the additional
 * organizers' and the central summaries, and every saved preference and
 * assignment is kept.
 */
class SalesSummaryRouting {

	/**
	 * Organizer storage.
	 *
	 * @var OrganizerRepository
	 */
	private $repository;

	/**
	 * Event organizer resolution.
	 *
	 * @var EventOrganizer
	 */
	private $event_organizer;

	/**
	 * Constructor.
	 *
	 * @param OrganizerRepository|null $repository      Organizer storage.
	 * @param EventOrganizer|null      $event_organizer Event organizer resolution.
	 */
	public function __construct( $repository = null, $event_organizer = null ) {
		$this->repository      = $repository ? $repository : new OrganizerRepository();
		$this->event_organizer = $event_organizer ? $event_organizer : new EventOrganizer( $this->repository );
	}

	/**
	 * Hook the sales summary filters, when the active Fair Events has them.
	 *
	 * @return void
	 */
	public static function register_hooks() {
		if ( ! class_exists( \FairEvents\Notifications\SalesSummaryOrganizers::class ) ) {
			return;
		}

		$routing = new self();
		add_filter( \FairEvents\Notifications\SalesSummaryOrganizers::ORGANIZERS_FILTER, array( $routing, 'organizers' ) );
		add_filter( \FairEvents\Notifications\SalesSummaryOrganizers::EVENT_ORGANIZER_FILTER, array( $routing, 'event_organizer' ), 10, 2 );
	}

	/**
	 * Every organizer with its private notification addresses.
	 *
	 * @return array[] `{ id, name, notification_emails }`, the default first.
	 */
	public function organizers() {
		return array_map(
			static function ( $organizer ) {
				return array(
					'id'                  => $organizer['id'],
					'name'                => $organizer['name'],
					'notification_emails' => $organizer['notification_emails'],
				);
			},
			$this->repository->all()
		);
	}

	/**
	 * The organizer an event belongs to, as public output names it: the
	 * assigned organizer while it exists, otherwise the default.
	 *
	 * @param string|null $organizer_id Value from earlier filters.
	 * @param int         $owner_id     Single event or series master date ID.
	 * @return string|null Organizer ID; null when the event no longer exists.
	 */
	public function event_organizer( $organizer_id, $owner_id ) {
		$event_date = EventDates::get_by_id( (int) $owner_id );
		if ( ! $event_date ) {
			return $organizer_id;
		}

		$effective = $this->event_organizer->effective( $event_date );
		return is_array( $effective ) ? (string) $effective['id'] : $organizer_id;
	}
}
