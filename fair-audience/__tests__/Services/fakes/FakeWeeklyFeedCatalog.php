<?php
/**
 * Stand-in for Fair Events' weekly feed catalog.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services\Fakes;

/**
 * Offers Workshops (1) and Concerts (2); Archive (3) exists but is not offered.
 */
class FakeWeeklyFeedCatalog {

	/**
	 * Feeds that can be chosen.
	 *
	 * @return array[]
	 */
	public function subscribable() {
		return array(
			array(
				'id'   => 2,
				'name' => 'Concerts',
			),
			array(
				'id'   => 1,
				'name' => 'Workshops',
			),
		);
	}

	/**
	 * Existing feeds among the given IDs.
	 *
	 * @param int[] $ids Feed IDs.
	 * @return array[]
	 */
	public function describe( array $ids ) {
		$known = array(
			1 => 'Workshops',
			2 => 'Concerts',
			3 => 'Archive',
		);
		$feeds = array();
		foreach ( $ids as $id ) {
			if ( isset( $known[ $id ] ) ) {
				$feeds[] = array(
					'id'   => $id,
					'name' => $known[ $id ],
				);
			}
		}
		return $feeds;
	}
}
