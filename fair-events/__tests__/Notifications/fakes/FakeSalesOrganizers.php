<?php
/**
 * FakeSalesOrganizers test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\SalesSummaryOrganizers;
use FairEvents\Notifications\SalesSummarySettings;

/**
 * Organizer directory with fixed organizers and event ownership. Without
 * organizers it behaves as when organizer management is unavailable.
 */
class FakeSalesOrganizers extends SalesSummaryOrganizers {

	/**
	 * Organizers, or null while resolution is unavailable.
	 *
	 * @var array[]|null
	 */
	public $organizers;

	/**
	 * Organizer ID by owning event ID.
	 *
	 * @var array<int, string|null>
	 */
	public $owners;

	/**
	 * Constructor.
	 *
	 * @param array[]|null $organizers Organizers.
	 * @param array        $owners     Organizer ID by event ID.
	 */
	public function __construct( $organizers, array $owners ) {
		$this->organizers = $organizers;
		$this->owners     = $owners;
	}

	/**
	 * Resolution availability.
	 *
	 * @return bool
	 */
	public function resolution_available() {
		return null !== $this->organizers;
	}

	/**
	 * Every organizer.
	 *
	 * @return array[]
	 */
	public function all() {
		if ( null === $this->organizers ) {
			return array(
				array(
					'id'                  => SalesSummarySettings::DEFAULT_ORGANIZER,
					'name'                => 'Site',
					'notification_emails' => array( 'site@example.com' ),
				),
			);
		}
		return $this->organizers;
	}

	/**
	 * Owner of an event; while unavailable, only events without an
	 * assignment resolve, to the default.
	 *
	 * @param int $owner_id Event ID.
	 * @return string|null
	 */
	public function owner_of( $owner_id ) {
		$owner = $this->owners[ (int) $owner_id ] ?? null;
		if ( null === $this->organizers ) {
			return SalesSummarySettings::DEFAULT_ORGANIZER === $owner ? $owner : null;
		}
		return $owner;
	}
}
