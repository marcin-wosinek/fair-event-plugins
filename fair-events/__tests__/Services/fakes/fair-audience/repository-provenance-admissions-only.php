<?php
/**
 * A Fair Audience release whose admission filter skips relationships named
 * by purchase provenance, but whose activity filter still counts their
 * participant-scope selections (stage 2).
 *
 * @package FairEvents
 */

namespace FairAudience\Database;

// phpcs:disable Generic.Classes.DuplicateClassName -- stand-ins with Fair Audience's signatures, one loaded per test process.

/**
 * Stand-in repository.
 */
class EventParticipantRepository {

	/**
	 * Capability marker.
	 *
	 * @return bool
	 */
	public static function excludes_purchase_provenance() {
		return true;
	}
}
