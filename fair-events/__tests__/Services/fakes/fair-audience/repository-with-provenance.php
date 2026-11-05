<?php
/**
 * A Fair Audience release whose capacity filters skip relationships named
 * by purchase provenance, and their participant-scope activities.
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

	/**
	 * Capability marker.
	 *
	 * @return bool
	 */
	public static function excludes_provenance_activity_selections() {
		return true;
	}
}
